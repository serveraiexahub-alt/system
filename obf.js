const LUA_KW = {
  'and': 1, 'break': 1, 'do': 1, 'else': 1, 'elseif': 1, 'end': 1, 'false': 1,
  'for': 1, 'function': 1, 'goto': 1, 'if': 1, 'in': 1, 'local': 1, 'nil': 1,
  'not': 1, 'or': 1, 'repeat': 1, 'return': 1, 'then': 1, 'true': 1, 'until': 1, 'while': 1
};

function isDigit(c) { return c >= '0' && c <= '9'; }
function isHex(c) { return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
function isNameStart(c) { return c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c.charCodeAt(0) >= 128; }
function isNameChar(c) { return isNameStart(c) || isDigit(c); }

function utf8Bytes(cp) {
  const out = [];
  if (cp < 0x80) out.push(cp);
  else if (cp < 0x800) { out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63)); }
  else if (cp < 0x10000) { out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)); }
  else if (cp < 0x110000) { out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)); }
  return out;
}

function toByteString(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i);
    if (cp > 0xFFFF) i++;
    const bs = utf8Bytes(cp);
    for (let k = 0; k < bs.length; k++) out += String.fromCharCode(bs[k]);
  }
  return out;
}

function lexLua(src) {
  const toks = [];
  let i = 0;
  const n = src.length;

  function longBracketLevel(p) {
    if (src[p] !== '[') return -1;
    let q = p + 1, eq = 0;
    while (q < n && src[q] === '=') { eq++; q++; }
    if (q < n && src[q] === '[') return { level: eq, start: q + 1 };
    return -1;
  }

  function readLong(startPos, level) {
    const close = ']' + '='.repeat(level) + ']';
    const idx = src.indexOf(close, startPos);
    if (idx < 0) return { text: src.slice(startPos), end: n, unterminated: true };
    return { text: src.slice(startPos, idx), end: idx + close.length };
  }

  while (i < n) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\n') { toks.push({ t: 'nl' }); i++; continue; }

    if (c === '-' && src[i + 1] === '-') {
      const lb = longBracketLevel(i + 2);
      if (lb !== -1) {
        const r = readLong(lb.start, lb.level);
        i = r.end; continue;
      }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    if (c === '[') {
      const lb = longBracketLevel(i);
      if (lb !== -1) {
        const r = readLong(lb.start, lb.level);
        let text = r.text;
        if (text[0] === '\r') text = text.slice(text[1] === '\n' ? 2 : 1);
        else if (text[0] === '\n') text = text.slice(1);
        toks.push({ t: 'str', v: text, long: true });
        i = r.end; continue;
      }
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1, out = '';
      let closed = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') {
          const e = src[j + 1];
          j += 2;
          if (e === 'a') out += '\x07';
          else if (e === 'b') out += '\b';
          else if (e === 'f') out += '\f';
          else if (e === 'n') out += '\n';
          else if (e === 'r') out += '\r';
          else if (e === 't') out += '\t';
          else if (e === 'v') out += '\x0b';
          else if (e === '\\') out += '\\';
          else if (e === '"') out += '"';
          else if (e === "'") out += "'";
          else if (e === '\n') out += '\n';
          else if (e === '\r') { out += '\n'; if (src[j] === '\n') j++; }
          else if (e === 'z') { while (j < n && /\s/.test(src[j])) j++; }
          else if (e === 'x') {
            let h = '';
            while (h.length < 2 && isHex(src[j] || '')) { h += src[j]; j++; }
            out += String.fromCharCode(parseInt(h || '0', 16));
          }
          else if (e === 'u' && src[j] === '{') {
            j++;
            let h = '';
            while (j < n && src[j] !== '}') { h += src[j]; j++; }
            j++;
            const cp = parseInt(h, 16);
            if (isFinite(cp)) out += String.fromCharCode.apply(null, utf8Bytes(cp));
          }
          else if (isDigit(e || '')) {
            let d3 = e;
            while (d3.length < 3 && isDigit(src[j] || '')) { d3 += src[j]; j++; }
            out += String.fromCharCode(parseInt(d3, 10) & 255);
          }
          else if (e === undefined) { j = n; }
          else out += e;
          continue;
        }
        if (d === quote) { closed = true; j++; break; }
        if (d === '\n') break;
        out += d; j++;
      }
      toks.push({ t: 'str', v: out, closed: closed });
      i = j; continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      let j = i;
      if (src[j] === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X')) {
        j += 2;
        while (j < n && (isHex(src[j]) || src[j] === '.')) j++;
        if (src[j] === 'p' || src[j] === 'P') {
          j++;
          if (src[j] === '+' || src[j] === '-') j++;
          while (j < n && isDigit(src[j])) j++;
        }
      } else {
        while (j < n && isDigit(src[j])) j++;
        if (src[j] === '.' && src[j + 1] !== '.') {
          j++;
          while (j < n && isDigit(src[j])) j++;
        }
        if (src[j] === 'e' || src[j] === 'E') {
          let k = j + 1;
          if (src[k] === '+' || src[k] === '-') k++;
          if (isDigit(src[k] || '')) {
            j = k;
            while (j < n && isDigit(src[j])) j++;
          }
        }
      }
      toks.push({ t: 'num', raw: src.slice(i, j) });
      i = j; continue;
    }

    if (isNameStart(c)) {
      let j = i + 1;
      while (j < n && isNameChar(src[j])) j++;
      const word = src.slice(i, j);
      toks.push({ t: LUA_KW[word] ? 'kw' : 'name', v: word });
      i = j; continue;
    }

    const three = src.substr(i, 3);
    if (three === '...') { toks.push({ t: 'op', v: '...' }); i += 3; continue; }
    const two = src.substr(i, 2);
    if (two === '..' || two === '==' || two === '~=' || two === '<=' || two === '>=' ||
        two === '//' || two === '<<' || two === '>>' || two === '::') {
      toks.push({ t: 'op', v: two }); i += 2; continue;
    }
    toks.push({ t: 'op', v: c }); i++; continue;
  }
  return toks;
}

function rngFactory(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const CONTINUE_PREV = {
  '+': 1, '-': 1, '*': 1, '/': 1, '%': 1, '^': 1, '..': 1, '(': 1, '[': 1, '{': 1,
  ',': 1, '=': 1, '==': 1, '~=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, 'and': 1, 'or': 1,
  'not': 1, '#': 1, '.': 1, ':': 1, '//': 1, '<<': 1, '>>': 1, '::': 1
};
const CONTINUE_NEXT = {
  'and': 1, 'or': 1, ')': 1, ']': 1, '}': 1, ',': 1, '.': 1, ':': 1, '..': 1,
  '+': 1, '-': 1, '*': 1, '/': 1, '%': 1, '^': 1, '==': 1, '~=': 1, '<': 1, '>': 1,
  '<=': 1, '>=': 1, '//': 1, '<<': 1, '>>': 1
};
const STMT_KEYWORDS = {
  'local': 1, 'if': 1, 'for': 1, 'while': 1, 'do': 1, 'return': 1, 'end': 1,
  'function': 1, 'repeat': 1, 'break': 1, 'goto': 1, 'until': 1, 'else': 1, 'elseif': 1
};

function luaObfuscate(source, options) {
  const o = Object.assign({
    strings: true, numbers: true, rename: true, junk: true, wrap: true, hideErrors: false, seed: Date.now()
  }, options || {});
  const rnd = rngFactory(o.seed || 1);
  const toks = lexLua(source);
  const real = toks.filter(function (x) { return x.t !== 'nl'; });

  for (let i = 0; i < real.length; i++) real[i].idx = i;

  const depthAt = new Array(real.length).fill(0);
  const braceAt = new Array(real.length).fill(0);
  let par = 0, brace = 0;
  for (let i = 0; i < real.length; i++) {
    const tk = real[i];
    depthAt[i] = par;
    braceAt[i] = brace;
    if (tk.t === 'op') {
      if (tk.v === '(' || tk.v === '[') par++;
      else if (tk.v === ')' || tk.v === ']') par = Math.max(0, par - 1);
      else if (tk.v === '{') brace++;
      else if (tk.v === '}') brace = Math.max(0, brace - 1);
    }
  }

  const ends = new Array(real.length).fill(false);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t !== 'nl') continue;
    let prev = null, next = null, pi = -1, ni = -1;
    for (let a = i - 1; a >= 0; a--) if (toks[a].t !== 'nl') { prev = toks[a]; pi = a; break; }
    for (let b = i + 1; b < toks.length; b++) if (toks[b].t !== 'nl') { next = toks[b]; ni = b; break; }
    if (!prev || !next) continue;
    const prevMark = prev.t === 'op' || prev.t === 'kw' ? prev.v : null;
    const nextMark = next.t === 'op' || next.t === 'kw' ? next.v : null;
    if (prevMark && CONTINUE_PREV[prevMark]) continue;
    if (nextMark && CONTINUE_NEXT[nextMark]) continue;
    if (next.t === 'kw' && (next.v === 'end' || next.v === 'until' || next.v === 'else' || next.v === 'elseif')) continue;
    let pidx = 0;
    for (let k = pi; k >= 0; k--) { if (toks[k].t !== 'nl') { pidx = real.indexOf(toks[k]); break; } }
    if (pidx >= 0) ends[pidx] = true;
  }

  const usedNames = new Set();
  for (let i = 0; i < real.length; i++) if (real[i].t === 'name') usedNames.add(real[i].v);
  const banned = { 'self': 1, '_ENV': 1, '_G': 1, 'arg': 1, '...': 1, 'game': 1, 'script': 1, 'workspace': 1, 'continue': 1, 'type': 1, 'export': 1 };
  let nameCounter = 0;
  function makeName() {
    let out;
    do {
      nameCounter++;
      const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      out = '';
      let v = nameCounter;
      while (v > 0) { out += c[v % c.length]; v = Math.floor(v / c.length); }
      out = '_' + out + (rnd() < 0.5 ? 'l' : 'I');
    } while (usedNames.has(out));
    usedNames.add(out);
    return out;
  }

  const renameMap = new Array(real.length).fill(null);

  if (o.rename) {
    const stack = [new Map()];
    function resolve(name) {
      for (let s = stack.length - 1; s >= 0; s--) if (stack[s].has(name)) return stack[s].get(name);
      return null;
    }
    function declare(name, newName) { stack[stack.length - 1].set(name, newName); }
    function pushScope() { stack.push(new Map()); }
    function popScope() { if (stack.length > 1) stack.pop(); }

    const fieldAfter = new Set();
    for (let i = 0; i < real.length; i++) {
      const tk = real[i];
      if ((tk.t === 'op' && (tk.v === '.' || tk.v === ':')) && real[i + 1] && real[i + 1].t === 'name') {
        fieldAfter.add(i + 1);
      }
      if (tk.t === 'kw' && tk.v === 'goto' && real[i + 1] && real[i + 1].t === 'name') fieldAfter.add(i + 1);
      if (tk.t === 'op' && tk.v === '::') {
        if (real[i + 1] && real[i + 1].t === 'name') fieldAfter.add(i + 1);
        if (real[i + 2] && real[i + 2].t === 'op' && real[i + 2].v === '::' && real[i + 3] && real[i + 3].t === 'name') fieldAfter.add(i + 3);
      }
    }
    for (let i = 0; i < real.length; i++) {
      const tk = real[i];
      if (braceAt[i] > 0 && tk.t === 'name' && !fieldAfter.has(i)) {
        const prev = real[i - 1];
        const next = real[i + 1];
        const atKeyPos = (!prev || (prev.t === 'op' && (prev.v === '{' || prev.v === ',' || prev.v === ';'))) &&
                         (next && next.t === 'op' && next.v === '=');
        if (atKeyPos) fieldAfter.add(i);
      }
    }

    let pendingFor = null;
    let pendingLocal = null;

    for (let i = 0; i < real.length; i++) {
      const tk = real[i];

      if (tk.t === 'kw' && tk.v === 'for') {
        const names = [];
        let j = i + 1;
        while (j < real.length && real[j].t === 'name') {
          names.push(j);
          if (real[j + 1] && real[j + 1].t === 'op' && real[j + 1].v === ',') j += 2;
          else break;
        }
        pendingFor = { names: names, start: i };
      }

      if (tk.t === 'kw' && tk.v === 'do') {
        pushScope();
        if (pendingFor) {
          pendingFor.names.forEach(function (ni) {
            const orig = real[ni].v;
            if (banned[orig] || fieldAfter.has(ni)) return;
            const nn = makeName();
            declare(orig, nn);
            renameMap[ni] = nn;
          });
          pendingFor = null;
        }
      }

      if (tk.t === 'kw' && tk.v === 'local') {
        const next = real[i + 1];
        if (next && next.t === 'kw' && next.v === 'function') {
          const nameIdx = i + 2;
          if (real[nameIdx] && real[nameIdx].t === 'name' && !fieldAfter.has(nameIdx) && !banned[real[nameIdx].v]) {
            const nn = makeName();
            declare(real[nameIdx].v, nn);
            renameMap[nameIdx] = nn;
          }
          pendingLocal = null;
        } else {
          const names = [];
          let j = i + 1;
          while (j < real.length && real[j].t === 'name') {
            names.push(j);
            if (real[j + 1] && real[j + 1].t === 'op' && real[j + 1].v === ',') j += 2;
            else break;
          }
          const afterNames = j + 1;
          const hasAssign = real[afterNames] && real[afterNames].t === 'op' && real[afterNames].v === '=';
          if (hasAssign) pendingLocal = { names: names, rhsStart: afterNames + 1, endAt: -1 };
          else pendingLocal = { names: names, rhsStart: -1, endAt: i };
          continue;
        }
      }

      if (pendingLocal && pendingLocal.endAt === -1) {
        if (tk.t === 'op' && tk.v === '=' && i === pendingLocal.rhsStart - 1) {
          // RHS begins below
        }
        if (i === pendingLocal.rhsStart) {
          let stopAt = i;
          while (stopAt < real.length && !ends[stopAt]) stopAt++;
          pendingLocal.endAt = stopAt;
        }
      }

      if (pendingLocal && pendingLocal.endAt >= 0 && i >= pendingLocal.endAt) {
        const refNames = new Set();
        const from = pendingLocal.rhsStart >= 0 ? pendingLocal.rhsStart : i;
        for (let k = from; k <= pendingLocal.endAt && k < real.length; k++) {
          if (real[k].t === 'name' && !fieldAfter.has(k)) refNames.add(real[k].v);
        }
        pendingLocal.names.forEach(function (ni) {
          const orig = real[ni].v;
          if (banned[orig] || fieldAfter.has(ni) || refNames.has(orig)) return;
          const nn = makeName();
          declare(orig, nn);
          renameMap[ni] = nn;
        });
        pendingLocal = null;
      }

      if (tk.t === 'name' && !fieldAfter.has(i) && renameMap[i] === null) {
        const mapped = resolve(tk.v);
        if (mapped) renameMap[i] = mapped;
      }

      if (tk.t === 'kw' && tk.v === 'function') {
        let j = i + 1;
        while (j < real.length && real[j].t !== 'kw' && !(real[j].t === 'op' && real[j].v === '(')) {
          j++;
        }
        if (real[j] && real[j].t === 'op' && real[j].v === '(') {
          pushScope();
          let k = j + 1;
          while (k < real.length && real[k].t === 'name') {
            if (!fieldAfter.has(k) && !banned[real[k].v]) {
              const nn = makeName();
              declare(real[k].v, nn);
              renameMap[k] = nn;
            }
            if (real[k + 1] && real[k + 1].t === 'op' && real[k + 1].v === ',') k += 2;
            else break;
          }
        }
      }

      if (tk.t === 'kw' && (tk.v === 'do' || tk.v === 'then' || tk.v === 'else' || tk.v === 'repeat')) {
        if (tk.v !== 'do') pushScope();
        else if (i > 0) { /* handled above, do already pushed for/while body */ }
      }

      if (tk.t === 'kw' && (tk.v === 'end' || tk.v === 'until')) popScope();
    }
  }

  const pool = [];
  const poolIndex = new Map();
  function poolAdd(bin) {
    const enc = luaEncodeBytes(bin);
    if (poolIndex.has(enc)) return poolIndex.get(enc);
    pool.push(enc);
    const idx = pool.length;
    poolIndex.set(enc, idx);
    return idx;
  }

  const DECOY = 37;
  function luaEncodeBytes(str) {
    const bs = toByteString(str);
    let out = '';
    for (let i = 0; i < bs.length; i++) {
      const b = bs.charCodeAt(i) & 255;
      const m = ((i + 1) * DECOY) % 251;
      out += '\\' + String((b + m) % 256).padStart(3, '0');
    }
    return out;
  }

  function luaEscapeBytes(str) {
    const bs = toByteString(str);
    let out = '';
    for (let i = 0; i < bs.length; i++) {
      const code = bs.charCodeAt(i) & 255;
      out += '\\' + String(code).padStart(3, '0');
    }
    return out;
  }

  function emitString(bin) {
    const idx = poolAdd(bin);
    return '__S(' + idx + ')';
  }

  function numExpr(raw) {
    const v = parseInt(raw, 10);
    if (!isFinite(v) || String(v) !== raw) return null;
    if (v < 0 || v > 100000000) return null;
    const a = Math.floor(rnd() * 997) + 1;
    const b = v + a;
    if (rnd() < 0.5) return '(' + b + '-' + a + ')';
    const c = Math.floor(rnd() * 997) + 1;
    return '(' + (v + c) + '-' + c + ')';
  }

  const outTok = [];
  for (let i = 0; i < real.length; i++) {
    const tk = real[i];
    if (tk.t === 'name' && renameMap[i]) { outTok.push(renameMap[i]); continue; }
    if (tk.t === 'str') {
      if (o.strings) { outTok.push(emitString(tk.v)); }
      else outTok.push('"' + luaEscapeBytes(tk.v) + '"');
      continue;
    }
    if (tk.t === 'num') {
      if (o.numbers) {
        const e = numExpr(tk.raw);
        outTok.push(e || tk.raw);
      } else outTok.push(tk.raw);
      continue;
    }
    if (tk.t === 'kw' || tk.t === 'name') outTok.push(tk.v);
    else outTok.push(tk.v);
  }

  let body = '';
  for (let i = 0; i < outTok.length; i++) {
    if (i > 0) {
      const prev = outTok[i - 1];
      const cur = outTok[i];
      const prevWord = /[A-Za-z0-9_]$/.test(prev);
      const curWord = /^[A-Za-z0-9_]/.test(cur);
      let needSpace = prevWord && curWord;
      if (!needSpace) {
        const a = prev[prev.length - 1], b = cur[0];
        if (a === '-' && b === '-') needSpace = true;
        else if (a === '[' && b === '[') needSpace = true;
        else if (a === '[' && b === '=') needSpace = true;
        else if (a === '.' && b === '.') needSpace = true;
        else if (a === ':' && b === ':') needSpace = true;
        else if (a === '/' && b === '/') needSpace = true;
        else if (a === '<' && b === '<') needSpace = true;
        else if (a === '>' && b === '>') needSpace = true;
        else if (a === '~' && b === '=') needSpace = true;
        else if (a === '=' && b === '=') needSpace = true;
      }
      body += needSpace ? ' ' : (rnd() < 0.06 ? ' ' : '');
    }
    body += outTok[i];
    if (o.junk && rnd() < 0.02 && /^(then|do|else|repeat)$/.test(outTok[i])) {
      body += ' local ' + makeName() + '=(' + (Math.floor(rnd() * 1000) + 1) + '-' + (Math.floor(rnd() * 500)) + ')';
    }
  }

  let pre = '';
  if (pool.length) {
    const key = Math.floor(rnd() * 200) + 29;
    pre = 'local __P={' + pool.map(function (s) { return '"' + s + '"'; }).join(',') + '}\n' +
      'local __K=' + key + '\n' +
      'local __D=' + DECOY + '\n' +
      'local __C={}\n' +
      'local function __S(i)\n' +
      'if __C[i] then return __C[i] end\n' +
      'local d=__P[i]\n' +
      'local n=#d\n' +
      'local t={}\n' +
      'for j=1,n do\n' +
      'local b=d:byte(j)\n' +
      'local m=(j*__D)%251\n' +
      'b=(b-m)%256\n' +
      't[j]=string.char(b)\n' +
      'end\n' +
      'local r=table.concat(t)\n' +
      '__C[i]=r\n' +
      'return r\n' +
      'end\n';
  }

  let result = pre + body;

  if (o.wrap) result = wrapLoader(result, rnd, o.hideErrors);
  return { code: result, stats: { strings: pool.length, original: source.length, output: result.length } };
}

function wrapLoader(src, rnd, hideErrors) {
  const key = Math.floor(rnd() * 200) + 17;
  const bytes = toByteString(src);
  let enc = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes.charCodeAt(i) & 255;
    const m = ((i + 1) * key) % 251;
    enc += '\\' + String((b + m) % 256).padStart(3, '0');
  }
  const j1 = Math.floor(rnd() * 9000) + 1000;
  const j2 = Math.floor(rnd() * 9000) + 1000;
  const j3 = Math.floor(rnd() * 9000) + 1000;
  const lines = [
    'local __d="' + enc + '"',
    'local __k=' + key,
    'local __n=#__d',
    'local __t={}',
    'local __z=' + j1,
    'local __y=' + j2,
    'local __x=' + j3,
    'for __i=1,__n do',
    'local __b=__d:byte(__i)',
    'local __m=(__i*__k)%251',
    '__t[__i]=string.char((__b-__m)%256)',
    'end',
    'if (__z-__y) ~= ' + (j1 - j2) + ' then return end',
    'local __s=table.concat(__t)',
    'if #__s < 1 then return end',
    'if __x ~= ' + j3 + ' then return end',
    'local __ld=loadstring or load'
  ];
  if (hideErrors) {
    lines.push('local __fn,__er=pcall(function() return __ld(__s,"@") end)');
    lines.push('if not __fn or not __er then return end');
    lines.push('local __ok,__res=pcall(__er)');
    lines.push('if not __ok then return end');
    lines.push('return __res');
  } else {
    lines.push('local __fn,__er=__ld(__s,"@")');
    lines.push('if not __fn then return end');
    lines.push('return __fn()');
  }
  return lines.join('\n');
}

module.exports = { luaObfuscate: luaObfuscate, lexLua: lexLua };
