'use strict';
const T = {"Local": 1, "LocalFunc": 2, "Set": 3, "FuncDecl": 4, "CallStat": 5, "If": 6, "While": 7, "Repeat": 8, "NumFor": 9, "GenFor": 10, "Do": 11, "Return": 12, "Break": 13, "Continue": 28, "Num": 14, "Str": 15, "Nil": 16, "True": 17, "False": 18, "Vararg": 19, "Name": 20, "Index": 21, "Bin": 22, "Un": 23, "Table": 24, "Func": 25, "Call": 26, "Invoke": 27};
// Lua 5.1/Luau subset parser -> compact AST
function parseLua(tokens) {
  let i = 0;
  const toks = tokens.filter(function (t) { return t.t !== 'nl'; });
  function peek(k) { return toks[i + (k || 0)]; }
  function next() { return toks[i++]; }
  function isOp(v) { const t = peek(); return t && t.t === 'op' && t.v === v; }
  function isKw(v) { const t = peek(); return t && t.t === 'kw' && t.v === v; }
  function eatOp(v) { if (!isOp(v)) throw new Error('expected ' + v); i++; }
  function eatKw(v) { if (!isKw(v)) throw new Error('expected ' + v); i++; }
  function optOp(v) { if (isOp(v)) { i++; return true; } return false; }

  function parseBlock(ends) {
    const body = [];
    while (peek()) {
      const t = peek();
      if (t.t === 'kw' && ends.indexOf(t.v) >= 0) break;
      if (t.t === 'eof') break;
      const s = parseStatement();
      if (s) body.push(s);
    }
    return body;
  }

  function skipType() {
    let depth = 0;
    for (;;) {
      const t = peek();
      if (!t) return;
      if (depth === 0 && (t.t === 'op' && (t.v === '=' || t.v === ',' || t.v === ')'))) return;
      if (depth === 0 && t.t === 'kw' && /^(local|if|for|while|do|return|end|repeat|function|break|continue|else|elseif|until)$/.test(t.v)) return;
      if (t.t === 'op' && (t.v === '{' || t.v === '(' || t.v === '[')) depth++;
      if (t.t === 'op' && (t.v === '}' || t.v === ')' || t.v === ']')) { if (depth === 0) return; depth--; }
      i++;
    }
  }

  function parseStatement() {
    const t = peek();
    if (!t) return null;
    if (t.t === 'op' && t.v === ';') { i++; return null; }
    if (t.t === 'op' && t.v === '::') { i++; if (peek()) i++; if (isOp('::')) i++; return null; }
    if (t.t === 'kw') {
      switch (t.v) {
        case 'local': {
          i++;
          if (isKw('function')) {
            i++;
            const name = next().v;
            const fn = parseFuncBody();
            return [T.LocalFunc, name, fn];
          }
          const names = [next().v];
          if (optOp(':')) skipType();
          while (optOp(',')) { names.push(next().v); if (optOp(':')) skipType(); }
          let exprs = [];
          if (optOp('=')) exprs = parseExprList();
          return [T.Local, names, exprs];
        }
        case 'function': {
          i++;
          const path = [next().v];
          while (isOp('.') || isOp(':')) { const sep = next().v; path.push(next().v); if (sep === ':') { path.method = true; break; } }
          const fn = parseFuncBody(path.method);
          return [T.FuncDecl, path, fn];
        }
        case 'if': {
          i++;
          const cond = parseExpr();
          eatKw('then');
          const thenB = parseBlock(['elseif', 'else', 'end']);
          const elses = [];
          while (isKw('elseif')) {
            i++;
            const c = parseExpr();
            eatKw('then');
            const b = parseBlock(['elseif', 'else', 'end']);
            elses.push([c, b]);
          }
          let elseB = null;
          if (isKw('else')) { i++; elseB = parseBlock(['end']); }
          eatKw('end');
          return [T.If, cond, thenB, elses, elseB];
        }
        case 'while': {
          i++;
          const cond = parseExpr();
          eatKw('do');
          const body = parseBlock(['end']);
          eatKw('end');
          return [T.While, cond, body];
        }
        case 'repeat': {
          i++;
          const body = parseBlock(['until']);
          eatKw('until');
          const cond = parseExpr();
          return [T.Repeat, body, cond];
        }
        case 'for': {
          i++;
          const first = next().v;
          if (optOp('=')) {
            const start = parseExpr();
            eatOp(',');
            const stop = parseExpr();
            let step = null;
            if (optOp(',')) step = parseExpr();
            eatKw('do');
            const body = parseBlock(['end']);
            eatKw('end');
            return [T.NumFor, first, start, stop, step, body];
          }
          const names = [first];
          while (optOp(',')) names.push(next().v);
          eatKw('in');
          const exprs = parseExprList();
          eatKw('do');
          const body = parseBlock(['end']);
          eatKw('end');
          return [T.GenFor, names, exprs, body];
        }
        case 'do': {
          i++;
          const body = parseBlock(['end']);
          eatKw('end');
          return [T.Do, body];
        }
        case 'return': {
          i++;
          const exprs = [];
          if (!(peek() && peek().t === 'kw' && (peek().v === 'end' || peek().v === 'else' || peek().v === 'elseif' || peek().v === 'until'))
            && !(peek() && peek().t === 'eof')) {
            if (!(peek() && peek().t === 'op' && peek().v === ';')) exprs.push.apply(exprs, parseExprList());
          }
          optOp(';');
          return [T.Return, exprs];
        }
        case 'break': { i++; return [T.Break]; }
        case 'continue': { i++; return [T.Continue]; }
        case 'goto': { i++; if (peek()) i++; return null; }
        default: break;
      }
    }
    return parseExprStatement();
  }

  const COMPOUND = { '+=': '+', '-=': '-', '*=': '*', '/=': '/', '//=': '//', '%=': '%', '^=': '^', '..=': '..' };

  function parseExprStatement() {
    const expr = parseSuffixed();
    const ct = peek();
    if (ct && ct.t === 'op' && COMPOUND[ct.v]) {
      const op = COMPOUND[ct.v];
      i++;
      const value = parseExpr();
      return [T.Set, [toLHS(expr)], [[T.Bin, op, expr, value]]];
    }
    if (isOp('=') || isOp(',')) {
      const targets = [toLHS(expr)];
      while (optOp(',')) targets.push(toLHS(parseSuffixed()));
      eatOp('=');
      const values = parseExprList();
      return [T.Set, targets, values];
    }
    if (expr[0] !== T.Call && expr[0] !== T.Invoke) throw new Error('statement is not a call');
    return [T.CallStat, expr];
  }

  function toLHS(e) {
    if (e[0] === T.Name) return [T.Name, e[1]];
    if (e[0] === T.Index) return e;
    throw new Error('bad assignment target');
  }

  function parseExprList() {
    const out = [parseExpr()];
    while (optOp(',')) out.push(parseExpr());
    return out;
  }

  const BIN = {
    'or': [1, 1], 'and': [2, 2],
    '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
    '|': [4, 4], '~': [5, 5], '&': [6, 6],
    '<<': [7, 7], '>>': [7, 7],
    '..': [9, 8],
    '+': [10, 10], '-': [10, 10],
    '*': [11, 11], '/': [11, 11], '//': [11, 11], '%': [11, 11],
    '^': [14, 13]
  };
  const UNARY = { 'not': 12, '-': 12, '#': 12, '~': 12 };

  function parseExpr(limit) {
    limit = limit === undefined ? 0 : limit;
    let left;
    const t = peek();
    if (!t) throw new Error('unexpected eof');
    if (t.t === 'op' && UNARY[t.v]) {
      i++;
      const operand = parseExpr(UNARY[t.v]);
      left = [T.Un, t.v, operand];
    } else if (t.t === 'kw' && t.v === 'not') {
      i++;
      const operand = parseExpr(UNARY.not);
      left = [T.Un, 'not', operand];
    } else {
      left = parseSimple();
    }
    for (;;) {
      const op = peek();
      let opv = null;
      if (op && op.t === 'op' && BIN[op.v]) opv = op.v;
      else if (op && op.t === 'kw' && (op.v === 'and' || op.v === 'or')) opv = op.v;
      if (!opv) break;
      const lp = BIN[opv][0], rp = BIN[opv][1];
      if (lp <= limit) break;
      i++;
      const right = parseExpr(rp);
      left = [T.Bin, opv, left, right];
    }
    return left;
  }

  function parseSimple() {
    const t = peek();
    if (!t) throw new Error('unexpected eof');
    if (t.t === 'num') { i++; return [T.Num, t.raw]; }
    if (t.t === 'str') { i++; return t.long ? [T.Str, t.v] : [T.Str, t.v]; }
    if (t.t === 'kw') {
      if (t.v === 'nil') { i++; return [T.Nil]; }
      if (t.v === 'true') { i++; return [T.True]; }
      if (t.v === 'false') { i++; return [T.False]; }
      if (t.v === 'function') { i++; return parseFuncBody(); }
      if (t.v === 'if') {
        i++;
        const cond = parseExpr();
        eatKw('then');
        const a = parseExpr();
        eatKw('else');
        const b = parseExpr();
        return [T.Bin, 'and', cond, a];
      }
      throw new Error('unexpected keyword ' + t.v);
    }
    if (t.t === 'op') {
      if (t.v === '...') { i++; return [T.Vararg]; }
      if (t.v === '{') return parseTable();
    }
    return parseSuffixed();
  }

  function parsePrimary() {
    const t = peek();
    if (t && t.t === 'name') { i++; return [T.Name, t.v]; }
    if (t && t.t === 'op' && t.v === '(') { i++; const e = parseExpr(); eatOp(')'); return e; }
    throw new Error('unexpected token in primary');
  }

  function parseSuffixed() {
    let e = parsePrimary();
    for (;;) {
      if (isOp('.')) { i++; const n = next().v; e = [T.Index, e, [T.Str, n]]; }
      else if (isOp('[')) { i++; const k = parseExpr(); eatOp(']'); e = [T.Index, e, k]; }
      else if (isOp(':')) { i++; const n = next().v; const args = parseArgs(); e = [T.Invoke, e, n, args]; }
      else if (isOp('(') || isOp('{') || (peek() && peek().t === 'str')) { const args = parseArgs(); e = [T.Call, e, args]; }
      else break;
    }
    return e;
  }

  function parseArgs() {
    if (isOp('(')) {
      i++;
      const args = [];
      if (!isOp(')')) args.push.apply(args, parseExprList());
      eatOp(')');
      return args;
    }
    if (isOp('{')) return [parseTable()];
    const t = next();
    if (t.t !== 'str') throw new Error('bad call args');
    return [[T.Str, t.v]];
  }

  function parseTable() {
    eatOp('{');
    const items = [];
    while (!isOp('}')) {
      if (isOp('[')) {
        i++;
        const k = parseExpr();
        eatOp(']');
        eatOp('=');
        items.push([k, parseExpr()]);
      } else if (peek() && peek().t === 'name' && toks[i + 1] && toks[i + 1].t === 'op' && toks[i + 1].v === '=') {
        const name = next().v; i++;
        items.push([[T.Str, name], parseExpr()]);
      } else {
        items.push([null, parseExpr()]);
      }
      if (!optOp(',') && !optOp(';')) break;
    }
    eatOp('}');
    return [T.Table, items];
  }

  function parseFuncBody(isMethod) {
    eatOp('(');
    const params = [];
    let vararg = false;
    if (isMethod) params.push('self');
    while (!isOp(')')) {
      if (isOp('...')) { i++; vararg = true; break; }
      params.push(next().v);
      if (optOp(':')) skipType();
      if (!optOp(',')) break;
    }
    eatOp(')');
    if (optOp(':')) skipType();
    const body = parseBlock(['end']);
    eatKw('end');
    return [T.Func, params, vararg, body];
  }

  const ast = parseBlock([]);
  if (i < toks.length) throw new Error('unparsed tokens');
  return ast;
}
module.exports = { parseLua: parseLua };

function luaQuote(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34) out += '\\"';
    else if (c === 92) out += '\\\\';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c < 32) out += '\\' + c;
    else out += s[i];
  }
  return out + '"';
}

function toLua(value) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return luaQuote(value);
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (Array.isArray(value)) return '{' + value.map(toLua).join(',') + '}';
  const keys = Object.keys(value);
  return '{' + keys.map(function (k) { return '[' + luaQuote(k) + ']=' + toLua(value[k]); }).join(',') + '}';
}

const VM_RUNTIME = `
local _G = (getgenv and getgenv()) or _G or (getfenv and getfenv()) or _ENV
local _K = __KEY__
local _M = {}
for _i = 0, 31 do _M[_i] = (_i - _K) % 32 end
local _U = table.unpack or unpack
local _sel = select
local _type = type
local _tonum = tonumber
local _tostr = tostring
local _err = error
local _pcall = pcall
local _char = string.char
local _sub = string.sub
local _find = string.find
local _fmt = string.format
local _concat = table.concat
local _floor = math.floor
local function _band(a, b)
  local r, bit = 0, 1
  a, b = _floor(a) % 4294967296, _floor(b) % 4294967296
  for _ = 1, 32 do
    local x, y = a % 2, b % 2
    if x == 1 and y == 1 then r = r + bit end
    a, b, bit = (a - x) / 2, (b - y) / 2, bit * 2
  end
  return r
end
local function _bor(a, b)
  local r, bit = 0, 1
  a, b = _floor(a) % 4294967296, _floor(b) % 4294967296
  for _ = 1, 32 do
    local x, y = a % 2, b % 2
    if x == 1 or y == 1 then r = r + bit end
    a, b, bit = (a - x) / 2, (b - y) / 2, bit * 2
  end
  return r
end
local function _bxor(a, b)
  local r, bit = 0, 1
  a, b = _floor(a) % 4294967296, _floor(b) % 4294967296
  for _ = 1, 32 do
    local x, y = a % 2, b % 2
    if x ~= y then r = r + bit end
    a, b, bit = (a - x) / 2, (b - y) / 2, bit * 2
  end
  return r
end
local function _shl(a, b)
  return (_floor(a) * (2 ^ _floor(b))) % 4294967296
end
local function _shr(a, b)
  return _floor(_floor(a) / (2 ^ _floor(b)))
end
local _insert = table.insert
local _rawget = rawget
local _rawequal = rawequal
local _getup = nil
local _hookfn = nil
local _getinfo = nil
do
  local d = _G.debug
  if _type(d) == "table" then
    _getup = d.getupvalue
    _hookfn = d.sethook
    _getinfo = d.getinfo
  end
end
local function _canary()
  if _char(65) ~= "A" then return false end
  if _sub("abcd", 2, 3) ~= "bc" then return false end
  if _floor(1.75) ~= 1 then return false end
  if _concat({"a", "b"}) ~= "ab" then return false end
  if _tonum("12") ~= 12 then return false end
  if _type(_G) ~= "table" then return false end
  if _rawget(_G, "string") ~= nil and _rawget(_rawget(_G, "string"), "char") ~= _char then return false end
  return true
end
local __U = _U
local __G = _G
local function __pack(...) return {n = _sel('#', ...), ...} end
local __strcache = {}
local function __str(n)
  if _type(n) == "string" then return n end
  local c = n[4]
  if c then return c end
  local b, k = n[3], n[2]
  local o = {}
  for i = 1, #b do o[i] = _char((b[i] + k) % 256) end
  local s = _concat(o)
  n[4] = s
  __strcache[#__strcache + 1] = n
  return s
end
local function __env(parent) return {v = {}, p = parent} end
local function __get(e, k)
  while e do
    local v = e.v[k]
    if v ~= nil then return v end
    e = e.p
  end
  return __G[k]
end
local function __set(e, k, val)
  local cur = e
  while cur do
    if cur.v[k] ~= nil then cur.v[k] = val return end
    cur = cur.p
  end
  __G[k] = val
end
local __exec, __eval, __evalList, __evalMulti, __fn

__fn = function(node, env)
  local params, isva, body = node[2], node[3], node[4]
  local np = #params
  return function(...)
    local args = __pack(...)
    local e = __env(env)
    for idx = 1, np do e.v[params[idx]] = args[idx] end
    if isva then
      local extra = {n = 0}
      for idx = np + 1, args.n do extra.n = extra.n + 1 extra[extra.n] = args[idx] end
      e.va = extra
    end
    local sig = __exec(body, e)
    if sig and sig.t == 'return' then return __U(sig.v, 1, sig.v.n) end
  end
end

__evalMulti = function(e, env)
  local t = e[1]
  if t == 26 then
    local f = __eval(e[2], env)
    local args = __evalList(e[3], env)
    return __pack(f(__U(args, 1, args.n)))
  elseif t == 27 then
    local obj = __eval(e[2], env)
    local f = obj[__str(e[3])]
    local args = __evalList(e[4], env)
    local all = {n = args.n + 1, obj}
    for k = 1, args.n do all[k + 1] = args[k] end
    return __pack(f(__U(all, 1, all.n)))
  elseif t == 19 then
    return env.va or {n = 0}
  end
  return __pack(__eval(e, env))
end

__evalList = function(list, env)
  local out = {n = 0}
  for k = 1, #list do
    if k == #list then
      local m = __evalMulti(list[k], env)
      for j = 1, m.n do out.n = out.n + 1 out[out.n] = m[j] end
    else
      out.n = out.n + 1
      out[out.n] = __eval(list[k], env)
    end
  end
  return out
end

__eval = function(e, env)
  local t = e[1]
  if t == 14 then return _tonum(e[2]) or 0
  elseif t == 15 then return __str(e)
  elseif t == 16 then return nil
  elseif t == 17 then return true
  elseif t == 18 then return false
  elseif t == 19 then local v = env.va or {n=0} return v[1]
  elseif t == 20 then return __get(env, __str(e[2]))
  elseif t == 21 then
    local o = __eval(e[2], env)
    if o == nil then _err('attempt to index a nil value', 0) end
    local k = e[3]
    if k[1] == 15 then return o[__str(k)] end
    return o[__eval(k, env)]
  elseif t == 22 then
    local op = e[2]
    if op == 'and' then local a = __eval(e[3], env) if not a then return a end return __eval(e[4], env) end
    if op == 'or' then local a = __eval(e[3], env) if a then return a end return __eval(e[4], env) end
    local a = __eval(e[3], env)
    local b = __eval(e[4], env)
    if op == '+' then return a + b
    elseif op == '-' then return a - b
    elseif op == '*' then return a * b
    elseif op == '/' then return a / b
    elseif op == '%' then return a % b
    elseif op == '^' then return a ^ b
    elseif op == '..' then return a .. b
    elseif op == '==' then return a == b
    elseif op == '~=' then return a ~= b
    elseif op == '<' then return a < b
    elseif op == '>' then return a > b
    elseif op == '<=' then return a <= b
    elseif op == '>=' then return a >= b
    elseif op == '//' then return _floor(a / b)
    elseif op == '&' then return _band(a, b)
    elseif op == '|' then return _bor(a, b)
    elseif op == '~' then return _bxor(a, b)
    elseif op == '<<' then return _shl(a, b)
    elseif op == '>>' then return _shr(a, b)
    end
    _err('bad op ' .. _tostr(op), 0)
  elseif t == 23 then
    local op = e[2]
    local v = __eval(e[3], env)
    if op == '~' then return _bxor(v, -1) end
    if op == '-' then return -v
    elseif op == 'not' then return not v
    elseif op == '#' then return #v
    end
    _err('bad unop ' .. _tostr(op), 0)
  elseif t == 24 then
    local items = e[2]
    local out = {}
    local n = 0
    for k = 1, #items do
      local key = items[k][1]
      if key == nil then
        n = n + 1
        out[n] = __eval(items[k][2], env)
      else
        out[__eval(key, env)] = __eval(items[k][2], env)
      end
    end
    return out
  elseif t == 25 then
    return __fn(e, env)
  elseif t == 26 or t == 27 then
    local m = __evalMulti(e, env)
    return m[1]
  end
  _err('bad expr ' .. _tostr(t), 0)
end

local function __assign(target, val, env)
  if target[1] == 20 then
    __set(env, __str(target[2]), val)
  else
    local o = __eval(target[2], env)
    if o == nil then _err('attempt to index a nil value', 0) end
    local k = target[3]
    if k[1] == 15 then o[__str(k)] = val else o[__eval(k, env)] = val end
  end
end

__exec = function(stmts, env)
  __tick = (__tick or 0) + 1
  if __tick % 4000 == 0 and not _canary() then return nil end
  if __tick % 1500 == 0 then
    for k = 1, #__strcache do __strcache[k][4] = nil end
    __strcache = {}
  end
  for si = 1, #stmts do
    local s = stmts[si]
    local t = s[1]
    if t == 1 then
      local vals = __evalList(s[3], env)
      local names = s[2]
      for k = 1, #names do env.v[__str(names[k])] = vals[k] end
    elseif t == 2 then
      local name = s[2]
      env.v[__str(name)] = nil
      local fn = __fn(s[3], env)
      env.v[__str(name)] = fn
    elseif t == 3 then
      local refs = {}
      for k = 1, #s[2] do
        local tg = s[2][k]
        if tg[1] == 20 then
          refs[k] = {0, __str(tg[2])}
        else
          refs[k] = {1, __eval(tg[2], env), tg[3]}
        end
      end
      local vals = __evalList(s[3], env)
      for k = 1, #s[2] do
        local tg, r = s[2][k], refs[k]
        local v = vals[k]
        if tg[1] == 20 then
          __set(env, __str(tg[2]), v)
        else
          local o = r[2]
          if o == nil then _err('attempt to index a nil value', 0) end
          local key = r[3]
          if key[1] == 15 then o[__str(key)] = v else o[__eval(key, env)] = v end
        end
      end
    elseif t == 4 then
      local path = s[2]
      local fn = __fn(s[3], env)
      if #path == 1 then
        __set(env, __str(path[1]), fn)
      else
        local o = __get(env, __str(path[1]))
        for k = 2, #path - 1 do o = o[__str(path[k])] end
        o[__str(path[#path])] = fn
      end
    elseif t == 5 then
      __evalMulti(s[2], env)
    elseif t == 6 then
      local sig
      if __eval(s[2], env) then
        sig = __exec(s[3], env)
      else
        local elses = s[4]
        for k = 1, #elses do
          if __eval(elses[k][1], env) then
            sig = __exec(elses[k][2], env)
            break
          end
        end
        if not sig and s[5] then sig = __exec(s[5], env) end
      end
      if sig then return sig end
    elseif t == 7 then
      while __eval(s[2], env) do
        local e2 = s[4] and __env(env) or env
        local sig = __exec(s[3], e2)
        if sig then
          if sig.t == 'break' then break end
          if sig.t == 'continue' then sig = nil else return sig end
        end
      end
    elseif t == 8 then
      while true do
        local e2 = s[4] and __env(env) or env
        local sig = __exec(s[2], e2)
        if sig then
          if sig.t == 'break' then break end
          if sig.t ~= 'continue' then return sig end
        end
        if __eval(s[3], e2) then break end
      end
    elseif t == 9 then
      local a = _tonum(__eval(s[3], env)) or 0
      local b = _tonum(__eval(s[4], env)) or 0
      local c = s[5] and (_tonum(__eval(s[5], env)) or 1) or 1
      if c == 0 then _err("'for' step is zero", 0) end
      local i = a
      while (c > 0 and i <= b) or (c < 0 and i >= b) do
        local e2 = __env(env)
        e2.v[__str(s[2])] = i
        local sig = __exec(s[6], e2)
        if sig then
          if sig.t == 'break' then break end
          if sig.t ~= 'continue' then return sig end
        end
        i = i + c
      end
    elseif t == 10 then
      local vals = __evalList(s[3], env)
      local f, st, ctl = vals[1], vals[2], vals[3]
      while true do
        local res = __pack(f(st, ctl))
        if res[1] == nil then break end
        ctl = res[1]
        local e2 = __env(env)
        local names = s[2]
        for k = 1, #names do e2.v[__str(names[k])] = res[k] end
        local sig = __exec(s[4], e2)
        if sig then
          if sig.t == 'break' then break end
          if sig.t ~= 'continue' then return sig end
        end
      end
    elseif t == 11 then
      local sig = __exec(s[2], s[3] and __env(env) or env)
      if sig then return sig end
    elseif t == 12 then
      return {t = 'return', v = __evalList(s[2], env)}
    elseif t == 13 then
      return {t = 'break'}
    elseif t == 28 then
      return {t = 'continue'}
    end
  end
  return nil
end

local function _rs(n)
  if _type(n) ~= "table" then return end
  local t = n[1]
  if _type(t) == "number" and t >= 0 and t <= 31 then
    local real = _M[t]
    n[1] = real
    if real == 15 then return end
    for i = 2, #n do _rs(n[i]) end
  else
    for i = 1, #n do _rs(n[i]) end
  end
end

return function(ast)
  if not _canary() then return end
  if _getinfo then
    local function _probe() return _getinfo(1, "S") end
    local ok, info = _pcall(_probe)
    if not ok or not info or info.what ~= "Lua" then return end
  end
  _rs(ast)
  local root = __env(nil)
  local sig = __exec(ast, root)
  if sig and sig.t == 'return' then
    local res = __U(sig.v, 1, sig.v.n)
    for k = 1, #ast do ast[k] = nil end
    return res
  end
end
`;


const AST_TAG = {"Local": 1, "LocalFunc": 2, "Set": 3, "FuncDecl": 4, "CallStat": 5, "If": 6, "While": 7, "Repeat": 8, "NumFor": 9, "GenFor": 10, "Do": 11, "Return": 12, "Break": 13, "Continue": 28, "Num": 14, "Str": 15, "Nil": 16, "True": 17, "False": 18, "Vararg": 19, "Name": 20, "Index": 21, "Bin": 22, "Un": 23, "Table": 24, "Func": 25, "Call": 26, "Invoke": 27};

function encodeAst(node) {
  if (!Array.isArray(node)) return node;
  if (typeof node[0] === 'string') {
    const out = new Array(node.length);
    out[0] = AST_TAG[node[0]];
    for (let i = 1; i < node.length; i++) out[i] = encodeAst(node[i]);
    return out;
  }
  return node.map(encodeAst);
}


function makeGen() {
  let n = 0;
  const A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return function () {
    n++;
    let s = '';
    let v = n;
    while (v > 0) { s = A[(v - 1) % 52] + s; v = Math.floor((v - 1) / 52); }
    return s + '_' + (n % 97);
  };
}

function renameAst(ast, rid) {
  const scopes = [new Map()];
  function declare(n) {
    const g = rid();
    scopes[scopes.length - 1].set(n, g);
    return g;
  }
  function lookup(n) {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].has(n)) return scopes[i].get(n);
    }
    return null;
  }
  function ex(e) {
    if (!Array.isArray(e)) return e;
    const t = e[0];
    if (t === T.Name) {
      const g = lookup(e[1]);
      return [T.Name, g === null ? e[1] : g];
    }
    if (t === T.Index) return [T.Index, ex(e[1]), ex(e[2])];
    if (t === T.Bin) return [T.Bin, e[1], ex(e[2]), ex(e[3])];
    if (t === T.Un) return [T.Un, e[1], ex(e[2])];
    if (t === T.Call) return [T.Call, ex(e[1]), e[2].map(ex)];
    if (t === T.Invoke) return [T.Invoke, ex(e[1]), e[2], e[3].map(ex)];
    if (t === T.Table) return [T.Table, e[1].map(function (p) { return [p[0] ? ex(p[0]) : null, ex(p[1])]; })];
    if (t === T.Func) {
      scopes.push(new Map());
      const params = e[1].map(declare);
      const body = blk(e[3]);
      scopes.pop();
      return [T.Func, params, e[2], body];
    }
    if (t === T.Str || t === T.Num || t === T.Nil || t === T.True || t === T.False || t === T.Vararg) return e;
    return e.map(function (x, i) { return i === 0 ? x : (Array.isArray(x) ? ex(x) : x); });
  }

  function blockHasLocals(body) {
    let hit = false;
    (function walk(stmts) {
      for (const st of stmts) {
        if (!Array.isArray(st)) continue;
        const t = st[0];
        if (t === T.Local || t === T.LocalFunc || t === T.NumFor || t === T.GenFor) { hit = true; }
        if (t === T.Func) continue;
        for (let i = 1; i < st.length; i++) {
          const v = st[i];
          if (Array.isArray(v) && v.length && Array.isArray(v[0])) walk(v);
          else if (Array.isArray(v) && v.length && typeof v[0] === 'number') {
            if (v[0] === T.If) { walk(v[2] || []); for (const e of (v[3] || [])) walk(e[1] || []); walk(v[4] || []); }
            else if (v[0] === T.While) walk(v[2] || []);
            else if (v[0] === T.Repeat) walk(v[1] || []);
            else if (v[0] === T.NumFor) walk(v[5] || []);
            else if (v[0] === T.GenFor) walk(v[3] || []);
            else if (v[0] === T.Do) walk(v[1] || []);
          }
        }
      }
    })(body);
    return hit;
  }

  function blk(stmts) {
    scopes.push(new Map());
    const out = [];
    for (const s of stmts) {
      const t = s[0];
      if (t === T.Local) {
        const vals = s[2].map(ex);
        const names = s[1].map(declare);
        out.push([T.Local, names, vals]);
      } else if (t === T.LocalFunc) {
        const g = declare(s[1]);
        out.push([T.LocalFunc, g, ex(s[2])]);
      } else if (t === T.Set) {
        const targets = s[1].map(function (tg) {
          if (tg[0] === T.Name) { const g = lookup(tg[1]); return [T.Name, g === null ? tg[1] : g]; }
          return ex(tg);
        });
        out.push([T.Set, targets, s[2].map(ex)]);
      } else if (t === T.FuncDecl) {
        const path = s[1].slice();
        const g = lookup(path[0]);
        if (g !== null) path[0] = g;
        out.push([T.FuncDecl, path, ex(s[2])]);
      } else if (t === T.CallStat) {
        out.push([T.CallStat, ex(s[1])]);
      } else if (t === T.If) {
        const elses = s[3].map(function (p) { return [ex(p[0]), blk(p[1])]; });
        out.push([T.If, ex(s[1]), blk(s[2]), elses, s[4] ? blk(s[4]) : null]);
      } else if (t === T.While) {
        const wb = blk(s[2]);
        out.push([T.While, ex(s[1]), wb, blockHasLocals(wb)]);
      } else if (t === T.Repeat) {
        scopes.push(new Map());
        const body = blk(s[1]);
        const cond = ex(s[2]);
        scopes.pop();
        out.push([T.Repeat, body, cond, blockHasLocals(body)]);
      } else if (t === T.NumFor) {
        const a = ex(s[2]), b = ex(s[3]), c = s[4] ? ex(s[4]) : null;
        scopes.push(new Map());
        const g = declare(s[1]);
        const body = blk(s[4 + 1]);
        scopes.pop();
        out.push([T.NumFor, g, a, b, c, body]);
      } else if (t === T.GenFor) {
        const exprs = s[2].map(ex);
        scopes.push(new Map());
        const names = s[1].map(declare);
        const body = blk(s[3]);
        scopes.pop();
        out.push([T.GenFor, names, exprs, body]);
      } else if (t === T.Do) {
        const db = blk(s[1]);
        out.push([T.Do, db, blockHasLocals(db)]);
      } else if (t === T.Return) {
        out.push([T.Return, s[1].map(ex)]);
      } else if (t === T.Break) {
        out.push([T.Break]);
      } else if (t === T.Continue) {
        out.push([T.Continue]);
      } else {
        out.push(s);
      }
    }
    scopes.pop();
    return out;
  }
  return blk(ast);
}

function encStr(str, K, rnd) {
  const buf = Buffer.from(String(str), 'utf8');
  const kk = 1 + Math.floor(rnd() * 250);
  const bytes = [];
  for (let i = 0; i < buf.length; i++) bytes.push(((buf[i] - kk) % 256 + 256) % 256);
  return [(AST_TAG.Str + K) % 32, kk, bytes];
}

function encodeNode(node, K, rnd) {
  if (!Array.isArray(node)) return node;
  if (typeof node[0] === 'number' && node[0] >= 1 && node[0] <= 28) {
    const tag = node[0];
    if (tag === 15) return encStr(node[1], K, rnd);
    const out = new Array(node.length);
    out[0] = (tag + K) % 32;
    const isOpSlot = (tag === 22 || tag === 23) && node.length > 1;
    const nameArr = (tag === 1 || tag === 4 || tag === 10);
    const nameOne = (tag === 2 || tag === 9 || tag === 20);
    for (let i = 1; i < node.length; i++) {
      if (isOpSlot && i === 1) { out[i] = node[i]; continue; }
      if (nameOne && i === 1 && typeof node[i] === 'string') { out[i] = encStr(node[i], K, rnd); continue; }
      if (nameArr && i === 1 && Array.isArray(node[i])) {
        out[i] = node[i].map(function (x) { return (typeof x === 'string') ? encStr(x, K, rnd) : encodeNode(x, K, rnd); });
        continue;
      }
      if (tag === 27 && i === 2 && typeof node[i] === 'string') { out[i] = encStr(node[i], K, rnd); continue; }
      out[i] = encodeNode(node[i], K, rnd);
    }
    return out;
  }
  return node.map(function (x) { return encodeNode(x, K, rnd); });
}

function buildVM(ast, rid, rnd) {
  const nm = rid ? { A: rid(), F: rid() } : { A: 'AST', F: 'RUN' };
  const rf = rnd || Math.random;
  const K = 1 + Math.floor(rf() * 30);
  const renamed = (process.env.VM_RENAME === '0') ? ast : renameAst(ast, rid || makeGen());
  const body = encodeNode(renamed, K, rf);
  const k1 = 1 + Math.floor(rf() * 400);
  const k2 = 1 + Math.floor(rf() * 400);
  const kExpr = '((' + (K + k1) + '-' + k1 + ')+(' + k2 + '-' + k2 + '))';
  const runtime = VM_RUNTIME.replace('__KEY__', kExpr);
  const parts = [];
  parts.push('local ' + nm.A + '=' + toLua(body));
  parts.push('local ' + nm.F + '=(function()' + runtime + 'end)()');
  parts.push('return ' + nm.F + '(' + nm.A + ')');
  return parts.join(' ');
}

module.exports = { parseLua: parseLua, buildVM: buildVM, toLua: toLua };
