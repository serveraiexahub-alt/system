'use strict';
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

  function parseStatement() {
    const t = peek();
    if (!t) return null;
    if (t.t === 'op' && t.v === ';') { i++; return null; }
    if (t.t === 'kw') {
      switch (t.v) {
        case 'local': {
          i++;
          if (isKw('function')) {
            i++;
            const name = next().v;
            const fn = parseFuncBody();
            return ['LocalFunc', name, fn];
          }
          const names = [next().v];
          while (optOp(',')) names.push(next().v);
          let exprs = [];
          if (optOp('=')) exprs = parseExprList();
          return ['Local', names, exprs];
        }
        case 'function': {
          i++;
          const path = [next().v];
          while (isOp('.') || isOp(':')) { const sep = next().v; path.push(next().v); if (sep === ':') { path.method = true; break; } }
          const fn = parseFuncBody(path.method);
          return ['FuncDecl', path, fn];
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
          return ['If', cond, thenB, elses, elseB];
        }
        case 'while': {
          i++;
          const cond = parseExpr();
          eatKw('do');
          const body = parseBlock(['end']);
          eatKw('end');
          return ['While', cond, body];
        }
        case 'repeat': {
          i++;
          const body = parseBlock(['until']);
          eatKw('until');
          const cond = parseExpr();
          return ['Repeat', body, cond];
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
            return ['NumFor', first, start, stop, step, body];
          }
          const names = [first];
          while (optOp(',')) names.push(next().v);
          eatKw('in');
          const exprs = parseExprList();
          eatKw('do');
          const body = parseBlock(['end']);
          eatKw('end');
          return ['GenFor', names, exprs, body];
        }
        case 'do': {
          i++;
          const body = parseBlock(['end']);
          eatKw('end');
          return ['Do', body];
        }
        case 'return': {
          i++;
          const exprs = [];
          if (!(peek() && peek().t === 'kw' && (peek().v === 'end' || peek().v === 'else' || peek().v === 'elseif' || peek().v === 'until'))
            && !(peek() && peek().t === 'eof')) {
            if (!(peek() && peek().t === 'op' && peek().v === ';')) exprs.push.apply(exprs, parseExprList());
          }
          optOp(';');
          return ['Return', exprs];
        }
        case 'break': { i++; return ['Break']; }
        case 'goto': { i++; return null; }
        default: break;
      }
    }
    return parseExprStatement();
  }

  function parseExprStatement() {
    const expr = parseSuffixed();
    if (isOp('=') || isOp(',')) {
      const targets = [toLHS(expr)];
      while (optOp(',')) targets.push(toLHS(parseSuffixed()));
      eatOp('=');
      const values = parseExprList();
      return ['Set', targets, values];
    }
    if (expr[0] !== 'Call' && expr[0] !== 'Invoke') throw new Error('statement is not a call');
    return ['CallStat', expr];
  }

  function toLHS(e) {
    if (e[0] === 'Name') return ['Name', e[1]];
    if (e[0] === 'Index') return e;
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
    '..': [5, 4],
    '+': [6, 6], '-': [6, 6],
    '*': [7, 7], '/': [7, 7], '%': [7, 7],
    '^': [10, 9]
  };
  const UNARY = { 'not': 8, '-': 8, '#': 8 };

  function parseExpr(limit) {
    limit = limit === undefined ? 0 : limit;
    let left;
    const t = peek();
    if (!t) throw new Error('unexpected eof');
    if (t.t === 'op' && UNARY[t.v]) {
      i++;
      const operand = parseExpr(UNARY[t.v]);
      left = ['Un', t.v, operand];
    } else if (t.t === 'kw' && t.v === 'not') {
      i++;
      const operand = parseExpr(UNARY.not);
      left = ['Un', 'not', operand];
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
      left = ['Bin', opv, left, right];
    }
    return left;
  }

  function parseSimple() {
    const t = peek();
    if (!t) throw new Error('unexpected eof');
    if (t.t === 'num') { i++; return ['Num', t.raw]; }
    if (t.t === 'str') { i++; return t.long ? ['Str', t.v] : ['Str', t.v]; }
    if (t.t === 'kw') {
      if (t.v === 'nil') { i++; return ['Nil']; }
      if (t.v === 'true') { i++; return ['True']; }
      if (t.v === 'false') { i++; return ['False']; }
      if (t.v === 'function') { i++; return parseFuncBody(); }
      throw new Error('unexpected keyword ' + t.v);
    }
    if (t.t === 'op') {
      if (t.v === '...') { i++; return ['Vararg']; }
      if (t.v === '{') return parseTable();
    }
    return parseSuffixed();
  }

  function parsePrimary() {
    const t = peek();
    if (t && t.t === 'name') { i++; return ['Name', t.v]; }
    if (t && t.t === 'op' && t.v === '(') { i++; const e = parseExpr(); eatOp(')'); return e; }
    throw new Error('unexpected token in primary');
  }

  function parseSuffixed() {
    let e = parsePrimary();
    for (;;) {
      if (isOp('.')) { i++; const n = next().v; e = ['Index', e, ['Str', n]]; }
      else if (isOp('[')) { i++; const k = parseExpr(); eatOp(']'); e = ['Index', e, k]; }
      else if (isOp(':')) { i++; const n = next().v; const args = parseArgs(); e = ['Invoke', e, n, args]; }
      else if (isOp('(') || isOp('{') || (peek() && peek().t === 'str')) { const args = parseArgs(); e = ['Call', e, args]; }
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
    return [['Str', t.v]];
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
        items.push([['Str', name], parseExpr()]);
      } else {
        items.push([null, parseExpr()]);
      }
      if (!optOp(',') && !optOp(';')) break;
    }
    eatOp('}');
    return ['Table', items];
  }

  function parseFuncBody(isMethod) {
    eatOp('(');
    const params = [];
    let vararg = false;
    if (isMethod) params.push('self');
    while (!isOp(')')) {
      if (isOp('...')) { i++; vararg = true; break; }
      params.push(next().v);
      if (!optOp(',')) break;
    }
    eatOp(')');
    const body = parseBlock(['end']);
    eatKw('end');
    return ['Func', params, vararg, body];
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
local __U = table.unpack or unpack
local __G = (getfenv and getfenv()) or _ENV
local function __pack(...) return {n = select('#', ...), ...} end
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
  if t == 'Call' then
    local f = __eval(e[2], env)
    local args = __evalList(e[3], env)
    return __pack(f(__U(args, 1, args.n)))
  elseif t == 'Invoke' then
    local obj = __eval(e[2], env)
    local f = obj[e[3]]
    local args = __evalList(e[4], env)
    local all = {n = args.n + 1, obj}
    for k = 1, args.n do all[k + 1] = args[k] end
    return __pack(f(__U(all, 1, all.n)))
  elseif t == 'Vararg' then
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
  if t == 'Num' then return tonumber(e[2]) or 0
  elseif t == 'Str' then return e[2]
  elseif t == 'Nil' then return nil
  elseif t == 'True' then return true
  elseif t == 'False' then return false
  elseif t == 'Vararg' then local v = env.va or {n=0} return v[1]
  elseif t == 'Name' then return __get(env, e[2])
  elseif t == 'Index' then
    local o = __eval(e[2], env)
    if o == nil then error('attempt to index a nil value', 0) end
    local k = e[3]
    if k[1] == 'Str' then return o[k[2]] end
    return o[__eval(k, env)]
  elseif t == 'Bin' then
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
    end
    error('bad op ' .. tostring(op), 0)
  elseif t == 'Un' then
    local op = e[2]
    local v = __eval(e[3], env)
    if op == '-' then return -v
    elseif op == 'not' then return not v
    elseif op == '#' then return #v
    end
    error('bad unop ' .. tostring(op), 0)
  elseif t == 'Table' then
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
  elseif t == 'Func' then
    return __fn(e, env)
  elseif t == 'Call' or t == 'Invoke' then
    local m = __evalMulti(e, env)
    return m[1]
  end
  error('bad expr ' .. tostring(t), 0)
end

local function __assign(target, val, env)
  if target[1] == 'Name' then
    __set(env, target[2], val)
  else
    local o = __eval(target[2], env)
    if o == nil then error('attempt to index a nil value', 0) end
    local k = target[3]
    if k[1] == 'Str' then o[k[2]] = val else o[__eval(k, env)] = val end
  end
end

__exec = function(stmts, env)
  for si = 1, #stmts do
    local s = stmts[si]
    local t = s[1]
    if t == 'Local' then
      local vals = __evalList(s[3], env)
      local names = s[2]
      for k = 1, #names do env.v[names[k]] = vals[k] end
    elseif t == 'LocalFunc' then
      local name = s[2]
      env.v[name] = nil
      local fn = __fn(s[3], env)
      env.v[name] = fn
    elseif t == 'Set' then
      local refs = {}
      for k = 1, #s[2] do
        local tg = s[2][k]
        if tg[1] == 'Name' then
          refs[k] = {0, tg[2]}
        else
          refs[k] = {1, __eval(tg[2], env), tg[3]}
        end
      end
      local vals = __evalList(s[3], env)
      for k = 1, #s[2] do
        local tg, r = s[2][k], refs[k]
        local v = vals[k]
        if tg[1] == 'Name' then
          __set(env, tg[2], v)
        else
          local o = r[2]
          if o == nil then error('attempt to index a nil value', 0) end
          local key = r[3]
          if key[1] == 'Str' then o[key[2]] = v else o[__eval(key, env)] = v end
        end
      end
    elseif t == 'FuncDecl' then
      local path = s[2]
      local fn = __fn(s[3], env)
      if #path == 1 then
        __set(env, path[1], fn)
      else
        local o = __get(env, path[1])
        for k = 2, #path - 1 do o = o[path[k]] end
        o[path[#path]] = fn
      end
    elseif t == 'CallStat' then
      __evalMulti(s[2], env)
    elseif t == 'If' then
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
    elseif t == 'While' then
      while __eval(s[2], env) do
        local e2 = __env(env)
        local sig = __exec(s[3], e2)
        if sig then
          if sig.t == 'break' then break end
          return sig
        end
      end
    elseif t == 'Repeat' then
      while true do
        local e2 = __env(env)
        local sig = __exec(s[2], e2)
        if sig then
          if sig.t == 'break' then break end
          return sig
        end
        if __eval(s[3], e2) then break end
      end
    elseif t == 'NumFor' then
      local a = tonumber(__eval(s[3], env)) or 0
      local b = tonumber(__eval(s[4], env)) or 0
      local c = s[5] and (tonumber(__eval(s[5], env)) or 1) or 1
      if c == 0 then error("'for' step is zero", 0) end
      local i = a
      while (c > 0 and i <= b) or (c < 0 and i >= b) do
        local e2 = __env(env)
        e2.v[s[2]] = i
        local sig = __exec(s[6], e2)
        if sig then
          if sig.t == 'break' then break end
          return sig
        end
        i = i + c
      end
    elseif t == 'GenFor' then
      local vals = __evalList(s[3], env)
      local f, st, ctl = vals[1], vals[2], vals[3]
      while true do
        local res = __pack(f(st, ctl))
        if res[1] == nil then break end
        ctl = res[1]
        local e2 = __env(env)
        local names = s[2]
        for k = 1, #names do e2.v[names[k]] = res[k] end
        local sig = __exec(s[4], e2)
        if sig then
          if sig.t == 'break' then break end
          return sig
        end
      end
    elseif t == 'Do' then
      local sig = __exec(s[2], __env(env))
      if sig then return sig end
    elseif t == 'Return' then
      return {t = 'return', v = __evalList(s[2], env)}
    elseif t == 'Break' then
      return {t = 'break'}
    end
  end
  return nil
end

return function(ast)
  local root = __env(nil)
  local sig = __exec(ast, root)
  if sig and sig.t == 'return' then return __U(sig.v, 1, sig.v.n) end
end
`;

function buildVM(ast, rid) {
  const nm = rid ? { A: rid(), F: rid() } : { A: 'AST', F: 'RUN' };
  const parts = [];
  parts.push('local ' + nm.A + '=' + toLua(ast));
  parts.push('local ' + nm.F + '=(function()' + VM_RUNTIME + 'end)()');
  parts.push('return ' + nm.F + '(' + nm.A + ')');
  return parts.join(' ');
}

module.exports = { parseLua: parseLua, buildVM: buildVM, toLua: toLua };
