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

const LEVELS = {
  1: { layers: 1, junk: 1,   decoys: 6,   junkMul: 1,   strings: true, numbers: true, rename: true },
  2: { layers: 2, junk: 2.5, decoys: 14,  junkMul: 2.5, strings: true, numbers: true, rename: true },
  3: { layers: 3, junk: 5,   decoys: 40,  junkMul: 5,   strings: true, numbers: true, rename: true },
  4: { layers: 3, junk: 7.5, decoys: 80,  junkMul: 7.5, strings: true, numbers: true, rename: true },
  5: { layers: 4, junk: 10,  decoys: 140, junkMul: 10,  strings: true, numbers: true, rename: true }
};

function luaObfuscate(source, options) {
  const opts = options || {};
  const lv = LEVELS[Math.max(1, Math.min(5, Number(opts.level) || 3))];
  const o = Object.assign({
    strings: lv.strings, numbers: lv.numbers, rename: lv.rename,
    junk: true, wrap: true, hideErrors: true, seed: Date.now(),
    layers: lv.layers, junkSize: lv.junk, decoys: lv.decoys, junkMul: lv.junkMul, remote: false
  }, opts);
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

  const ridChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let ridCounter = 0;
  function rid() {
    for (let tries = 0; tries < 60; tries++) {
      const maxLen = tries < 20 ? 2 : (tries < 40 ? 3 : 5);
      const len = 1 + Math.floor(rnd() * maxLen);
      let out = '';
      for (let i = 0; i < len; i++) out += ridChars[Math.floor(rnd() * ridChars.length)];
      if (usedNames.has(out)) continue;
      if (LUA_KW[out]) continue;
      usedNames.add(out);
      return out;
    }
    let out;
    do {
      ridCounter++;
      out = 'z' + ridCounter.toString(36);
    } while (usedNames.has(out) || LUA_KW[out]);
    usedNames.add(out);
    return out;
  }

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
  const poolRaw = [];
  const poolIndex = new Map();
  function poolAdd(bin) {
    const enc = luaEncodeBytes(bin);
    if (poolIndex.has(enc)) return poolIndex.get(enc);
    pool.push(enc);
    poolRaw.push(toByteString(bin));
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

  const sfn = rid();
  function emitString(bin) {
    const idx = poolAdd(bin);
    return sfn + '(' + idx + ')';
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
    if (o.junk && rnd() < 0.08 && /^(then|do|else|repeat)$/.test(outTok[i])) {
      body += ' local ' + makeName() + '=(' + (Math.floor(rnd() * 1000) + 1) + '-' + (Math.floor(rnd() * 500)) + ')';
    }
  }

  let pre = '';
  let vault = null;
  if (o.remote && pool.length) {
    vault = poolRaw.slice();
    pre = buildRemotePre(rnd, rid, o.remoteUrl || '__VAULT_URL__', o.remoteKey, sfn);
  } else if (pool.length) {
    const key = Math.floor(rnd() * 200) + 29;
    const vP = rid(), vK = rid(), vD = rid(), vC = rid(), vS = sfn;
    const vI = rid(), vJ = rid(), vB = rid(), vM = rid(), vT = rid(), vR = rid(), vN = rid();
    pre = 'local ' + vP + '={' + pool.map(function (s) { return '"' + s + '"'; }).join(',') + '} ' +
      'local ' + vK + '=' + key + ' ' +
      'local ' + vD + '=' + DECOY + ' ' +
      'local ' + vC + '={} ' +
      'local function ' + vS + '(' + vI + ') ' +
      'if ' + vC + '[' + vI + '] then return ' + vC + '[' + vI + '] end ' +
      'local ' + vD + 'x=' + vP + '[' + vI + '] ' +
      'local ' + vN + '=#' + vD + 'x ' +
      'local ' + vT + '={} ' +
      'for ' + vJ + '=1,' + vN + ' do ' +
      'local ' + vB + '=' + vD + 'x:byte(' + vJ + ') ' +
      'local ' + vM + '=(' + vJ + '*' + DECOY + ')%251 ' +
      vB + '=(' + vB + '-' + vM + ')%256 ' +
      vT + '[' + vJ + ']=string.char(' + vB + ') ' +
      'end ' +
      'local ' + vR + '=table.concat(' + vT + ') ' +
      vC + '[' + vI + ']=' + vR + ' ' +
      'return ' + vR + ' end ';
  }

  let result = pre + body;

  if (o.wrap) {
    const layers = Math.max(1, Math.min(8, Number(o.layers) || 1));
    let prev = -1;
    for (let li = 0; li < layers; li++) {
      const packed = packBlob(result, rnd, o.hideErrors, rid, prev);
      result = packed.code;
      prev = packed.scheme;
    }
  }

  const mul = Math.max(0, Number(o.junkMul) || 0);
  const minDecoys = Math.max(0, Math.min(400, Number(o.decoys) || 0));
  if (mul > 0 || minDecoys > 0) {
    const baseLen = String(source).length;
    const targetChars = Math.min(900000, Math.floor(baseLen * mul));
    const built = buildJunkToSize(rnd, rid, targetChars, minDecoys);
    if (built.code) {
      const st = Math.floor(rnd() * 4);
      const rn = rid();
      let wrap;
      if (st === 0) wrap = ' return (function() ' + result + ' end)()';
      else if (st === 1) wrap = ' local ' + rn + '=function() ' + result + ' end return ' + rn + '()';
      else if (st === 2) wrap = ' local ' + rn + '=function() ' + result + ' end if ' + rn + ' then return ' + rn + '() end';
      else wrap = ' local ' + rn + '=function() ' + result + ' end return ' + rn + ' and ' + rn + '()';
      result = built.code + wrap;
    }
    var decoyCount = built.count;
    var junkChars = built.code.length;
  }

  return { code: result, vault: vault, stats: { strings: pool.length, original: source.length, output: result.length, decoys: (typeof decoyCount === 'number' ? decoyCount : 0), junk: (typeof junkChars === 'number' ? junkChars : 0) } };
}


function buildJunk(rnd, rid, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const fn = rid();
    const p1 = rid(), p2 = rid(), v1 = rid(), v2 = rid(), t1 = rid(), i1 = rid();
    const kind = Math.floor(rnd() * 4);
    if (kind === 0) {
      out.push('local function ' + fn + '(' + p1 + ',' + p2 + ') '
        + 'local ' + v1 + '=0 '
        + 'for ' + i1 + '=1,(' + p1 + ' or 1) do '
        + v1 + '=(' + v1 + '+(((' + i1 + '*(' + p2 + ' or 3))%251)+7))%65521 '
        + 'end '
        + 'local ' + t1 + '={' + v1 + ',(' + p1 + ' or 2)+(' + p2 + ' or 4)} '
        + 'return ' + t1 + '[1]%(' + t1 + '[2]+1) end');
    } else if (kind === 1) {
      out.push('local function ' + fn + '(' + p1 + ') '
        + 'local ' + t1 + '={} '
        + 'for ' + i1 + '=1,(' + p1 + ' or 4) do '
        + t1 + '[' + i1 + ']=string.char(((' + i1 + '*37)%90)+33) '
        + 'end '
        + 'local ' + v1 + '=table.concat(' + t1 + ') '
        + 'local ' + v2 + '=#' + v1 + ' '
        + 'return ' + v2 + '%(' + p1 + ' or 5) end');
    } else if (kind === 2) {
      out.push('local function ' + fn + '(' + p1 + ',' + p2 + ') '
        + 'local ' + v1 + '=(' + p1 + ' or 1)*(' + p2 + ' or 1) '
        + 'local ' + v2 + '=0 '
        + 'while ' + v1 + '>0 do '
        + v2 + '=' + v2 + '+(' + v1 + '%2) '
        + v1 + '=math.floor(' + v1 + '/2) '
        + 'end '
        + 'return ' + v2 + ' end');
    } else {
      out.push('local function ' + fn + '(' + p1 + ') '
        + 'local ' + t1 + '={' + p1 + ' or 1,2,3,5,8,13} '
        + 'local ' + v1 + '=0 '
        + 'for ' + i1 + '=1,#' + t1 + ' do '
        + v1 + '=' + v1 + '+' + t1 + '[' + i1 + ']*' + i1 + ' '
        + 'end '
        + 'return ' + v1 + '%1000 end');
    }
  }
  return out.join(' ');
}

function buildJunkToSize(rnd, rid, targetChars, minCount) {
  const blocks = [];
  const names = [];
  let total = 0;
  let guard = 0;
  const hardMax = 20000;
  const perBlock = 28;
  let current = [];
  let currentNames = [];

  function flush() {
    if (!current.length) return;
    const caller = buildJunkCaller(rnd, rid, currentNames, 'b');
    blocks.push('do ' + current.join(' ') + ' ' + caller + 'end');
    total += 5;
    current = [];
    currentNames = [];
  }

  while ((total < targetChars || names.length < minCount) && names.length < hardMax && guard < 200000) {
    const one = buildJunk(rnd, rid, 1);
    const nm = extractFnName(one);
    current.push(one);
    currentNames.push(nm);
    names.push(nm);
    total += one.length + 1;
    guard++;
    if (current.length >= perBlock) flush();
  }
  flush();
  return { code: blocks.join(' '), names: names, count: names.length };
}

function extractFnName(code) {
  const m = /^local function (\w+)/.exec(code);
  return m ? m[1] : '';
}

function buildJunkCaller(rnd, rid, fns, tag) {
  const call = rid(), guard = rid(), i = rid();
  const pick = fns.length ? fns : [];
  if (!pick.length) return '';
  const calls = pick.map(function (f) { return f + '(' + (Math.floor(rnd() * 90) + 1) + ',' + (Math.floor(rnd() * 90) + 2) + ')'; }).join(' ');
  return 'local ' + guard + '=0 for ' + i + '=1,0 do ' + guard + '=' + guard + '+1 end '
    + 'if ' + guard + '>' + (Math.floor(rnd() * 9) + 1) + ' then ' + calls + ' end ';
}

function buildRemotePre(rnd, rid, url, keyPair, sfn) {
  const A = rid(), M = rid(), R = rid(), K1 = rid(), K2 = rid(), B = rid(), I = rid();
  const T = rid(), N = rid(), S = rid(), L = rid(), Q = rid(), G = rid(), D = rid();
  const ch0 = M + '[' + R + ':sub(' + I + ',' + I + ')]';
  const ch1 = M + '[' + R + ':sub(' + I + '+1,' + I + '+1)]';
  const ch2 = M + '[' + R + ':sub(' + I + '+2,' + I + '+2)]';
  const parts = [];
  parts.push('local ' + A + '=string.char(97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,48,49,50,51,52,53,54,55,56,57)');
  parts.push('local ' + M + '={} for ' + I + '=1,#' + A + ' do ' + M + '[' + A + ':sub(' + I + ',' + I + ')]=' + I + '-1 end');
  parts.push('local ' + R + '=nil');
  parts.push('pcall(function() ' + R + '=game:HttpGet("' + url + '") end)');
  parts.push('if type(' + R + ')~="string" then return end');
  parts.push('local ' + K1 + '=' + ((keyPair && keyPair.k1) || (1 + Math.floor(rnd() * 200))));
  parts.push('local ' + K2 + '=' + ((keyPair && keyPair.k2) || Math.floor(rnd() * 250)));
  parts.push('local ' + B + '={} local ' + I + '=1 local ' + Q + '=0');
  parts.push('while ' + I + '<=#' + R + ' do local ' + D + '=' + ch0 + '*3844+' + ch1 + '*62+' + ch2
    + ' ' + Q + '=' + Q + '+1 ' + B + '[' + Q + ']=(math.floor(' + D + '/256)-((' + Q + '*' + K1 + '+' + K2 + ')%256))%256'
    + ' ' + Q + '=' + Q + '+1 ' + B + '[' + Q + ']=((' + D + '%256)-((' + Q + '*' + K1 + '+' + K2 + ')%256))%256'
    + ' ' + I + '=' + I + '+3 end');
  parts.push('local ' + T + '={} local ' + I + '=1');
  parts.push('while ' + I + '+1<=#' + B + ' do local ' + N + '=' + B + '[' + I + ']*256+' + B + '[' + I + '+1] '
    + 'local ' + S + '="" for ' + L + '=0,' + N + '-1 do ' + S + '=' + S + '..string.char(' + B + '[' + I + '+2+' + L + ']) end '
    + T + '[#' + T + '+1]=' + S + ' ' + I + '=' + I + '+2+' + N + ' end');
  parts.push('local function ' + sfn + '(' + I + ') return ' + T + '[' + I + '] end');
  return parts.join(' ') + ' ';
}


function numLit(v, rnd) {
  const a = 1 + Math.floor(rnd() * 4000);
  const style = Math.floor(rnd() * 3);
  if (style === 0) return '(' + (v + a) + '-' + a + ')';
  if (style === 1) return '(' + (v * 2 + a) + '-' + (v + a) + ')';
  const b = 2 + Math.floor(rnd() * 90);
  return 'math.floor((' + (v * b) + '/' + b + '))';
}

const B62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const B62N = '(' + B62.split('').map(function (c) { return c.charCodeAt(0); }).join(',') + ')';

function chunk(src, rnd, count) {
  const bytes = toByteString(src);
  const n = bytes.length;
  const cc = Math.max(2, Math.min(count, n));
  const lens = [];
  let remain = n;
  for (let c = 0; c < cc - 1; c++) {
    const slots = cc - c;
    const maxLen = Math.max(1, Math.floor(remain / slots) * 2);
    const len = Math.max(1, Math.min(remain - (slots - 1), 1 + Math.floor(rnd() * maxLen)));
    lens.push(len);
    remain -= len;
  }
  lens.push(Math.max(0, remain));
  const parts = [];
  let off = 0;
  for (let c = 0; c < cc; c++) {
    parts.push(bytes.slice(off, off + lens[c]));
    off += lens[c];
  }
  return { parts: parts, lens: lens, n: n, bytes: bytes };
}

function shuffleOrder(rnd, count) {
  const order = [];
  for (let i = 0; i < count; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  return order;
}

function wrapTail(parts, rnd, hideErrors, LD, S, FN, ER, OK, RES) {
  const style = Math.floor(rnd() * 4);
  if (hideErrors) {
    parts.push('local ' + FN + ',' + ER + '=pcall(function() return ' + LD + '(' + S + ',"@") end)');
    parts.push('if not ' + FN + ' or not ' + ER + ' then return end');
    parts.push('local ' + OK + ',' + RES + '=pcall(' + ER + ')');
    parts.push('if not ' + OK + ' then return end');
    parts.push('return ' + RES);
  } else if (style === 0) {
    parts.push('return (function() local ' + FN + '=' + LD + '(' + S + ') return ' + FN + ' and ' + FN + '() end)()');
  } else if (style === 1) {
    parts.push('local ' + FN + '=' + LD + '(' + S + ')');
    parts.push('if ' + FN + ' then return ' + FN + '() end');
  } else if (style === 2) {
    parts.push('local ' + FN + '=' + LD + '(' + S + ')');
    parts.push(ER + '=' + FN + '() if ' + FN + ' then return ' + ER + ' end');
  } else {
    parts.push('local ' + FN + '=' + LD + '(' + S + ')');
    parts.push('return ' + FN + ' and ' + FN + '()');
  }
}

function loaderNames(rid) {
  return {
    A: rid(), M: rid(), BL: rid(), LEN: rid(), K1: rid(), K2: rid(), K3: rid(),
    ORD: rid(), OUT: rid(), P: rid(), I: rid(), C: rid(), V: rid(), HX: rid(),
    B1: rid(), B2: rid(), Q: rid(), N: rid(), S: rid(), LD: rid(), FN: rid(),
    ER: rid(), OK: rid(), RES: rid(), T: rid(), D: rid(), G: rid()
  };
}

function schemeA(src, rnd, hideErrors, rid) {
  const ch = chunk(src, rnd, 2 + Math.floor(rnd() * 5));
  const order = shuffleOrder(rnd, ch.parts.length);
  const names = loaderNames(rid);
  const recs = order.map(function (orig) {
    const bytes = ch.parts[orig];
    const k1 = 1 + Math.floor(rnd() * 251);
    const k2 = Math.floor(rnd() * 256);
    const k3 = Math.floor(rnd() * 256);
    const arr = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes.charCodeAt(i) & 255;
      arr.push((b + (((i + 1) * k1 + k2) % 256)) % 256);
    }
    if (arr.length % 2) arr.push(0);
    let blob = '';
    for (let i = 0; i < arr.length; i += 2) {
      const v = arr[i] * 256 + arr[i + 1];
      blob += B62[Math.floor(v / 3844)] + B62[Math.floor((v % 3844) / 62)] + B62[v % 62];
    }
    return { blob: blob, len: bytes.length, k1: k1, k2: k2, k3: k3 };
  });
  const p = [];
  const nm = names;
  p.push('local ' + nm.A + '=string.char' + B62N);
  p.push('local ' + nm.M + '={} for ' + nm.I + '=1,#' + nm.A + ' do ' + nm.M + '[' + nm.A + ':sub(' + nm.I + ',' + nm.I + ')]=' + nm.I + '-1 end');
  p.push('local ' + nm.BL + '={' + recs.map(function (r) { return '"' + r.blob + '"'; }).join(',') + '}');
  p.push('local ' + nm.LEN + '={' + recs.map(function (r) { return r.len; }).join(',') + '}');
  p.push('local ' + nm.K1 + '={' + recs.map(function (r) { return r.k1; }).join(',') + '}');
  p.push('local ' + nm.K2 + '={' + recs.map(function (r) { return r.k2; }).join(',') + '}');
  p.push('local ' + nm.K3 + '={' + recs.map(function (r) { return r.k3; }).join(',') + '}');
  p.push('local ' + nm.ORD + '={' + order.map(function (v) { return v + 1; }).join(',') + '}');
  p.push('local ' + nm.OUT + '={}');
  p.push('for ' + nm.C + '=1,#' + nm.BL + ' do');
  p.push('local ' + nm.V + '=' + nm.BL + '[' + nm.C + '] local ' + nm.I + '=1 local ' + nm.P + '=0 local ' + nm.Q + '={}');
  p.push('while ' + nm.I + '<=#' + nm.V + ' do');
  const ch0 = nm.M + '[' + nm.V + ':sub(' + nm.I + ',' + nm.I + ')]';
  const ch1 = nm.M + '[' + nm.V + ':sub(' + nm.I + '+1,' + nm.I + '+1)]';
  const ch2 = nm.M + '[' + nm.V + ':sub(' + nm.I + '+2,' + nm.I + '+2)]';
  p.push('local ' + nm.HX + '=' + ch0 + '*3844+' + ch1 + '*62+' + ch2);
  p.push('local ' + nm.B1 + '=math.floor(' + nm.HX + '/256) local ' + nm.B2 + '=' + nm.HX + '%256');
  p.push(nm.P + '=' + nm.P + '+1 ' + nm.Q + '[' + nm.P + ']=(' + nm.B1 + '-((' + nm.P + '*' + nm.K1 + '[' + nm.C + ']+' + nm.K2 + '[' + nm.C + '])%256))%256');
  p.push(nm.P + '=' + nm.P + '+1 ' + nm.Q + '[' + nm.P + ']=(' + nm.B2 + '-((' + nm.P + '*' + nm.K1 + '[' + nm.C + ']+' + nm.K2 + '[' + nm.C + '])%256))%256');
  p.push(nm.I + '=' + nm.I + '+3 end');
  p.push('local ' + nm.N + '={} for ' + nm.I + '=1,' + nm.LEN + '[' + nm.C + '] do ' + nm.N + '[' + nm.I + ']=string.char(' + nm.Q + '[' + nm.I + ']) end');
  p.push(nm.OUT + '[' + nm.ORD + '[' + nm.C + ']]=table.concat(' + nm.N + ') end');
  p.push('local ' + nm.S + '=table.concat(' + nm.OUT + ')');
  p.push('if #' + nm.S + '~=' + numLit(ch.n, rnd) + ' then return end');
  p.push('local ' + nm.LD + '=string.char(108,111,97,100,115,116,114,105,110,103) local ' + nm.G + '=getfenv and getfenv() or _ENV');
  p.push(nm.LD + '=' + nm.G + '[' + nm.LD + '] or ' + nm.G + '[string.char(108,111,97,100)]');
  wrapTail(p, rnd, hideErrors, nm.LD, nm.S, nm.FN, nm.ER, nm.OK, nm.RES);
  return p.join(' ');
}

function schemeB(src, rnd, hideErrors, rid) {
  const bytes = toByteString(src);
  const n = bytes.length;
  const k1 = 1 + Math.floor(rnd() * 90);
  const k2 = 1 + Math.floor(rnd() * 90);
  const k3 = Math.floor(rnd() * 256);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const b = bytes.charCodeAt(i) & 255;
    const j = i + 1;
    const e = (b + ((j * j * k1 + j * k2 + k3) % 256)) % 256;
    pairs.push((e < 16 ? '0' : '') + e.toString(16));
  }
  const hex = pairs.reverse().join('');
  const nm = loaderNames(rid);
  const p = [];
  p.push('local ' + nm.V + '="' + hex + '"');
  p.push('local ' + nm.I + '=0 local ' + nm.Q + '={}');
  p.push('for ' + nm.C + '=#' + nm.V + ',2,-2 do');
  p.push(nm.I + '=' + nm.I + '+1');
  p.push('local ' + nm.B1 + '=tonumber(' + nm.V + ':sub(' + nm.C + '-1,' + nm.C + '),16)');
  p.push(nm.Q + '[' + nm.I + ']=string.char((' + nm.B1 + '-((' + nm.I + '*' + nm.I + '*' + k1 + '+' + nm.I + '*' + k2 + '+' + k3 + ')%256))%256)');
  p.push('end');
  p.push('local ' + nm.S + '=table.concat(' + nm.Q + ')');
  p.push('if #' + nm.S + '~=' + numLit(n, rnd) + ' then return end');
  p.push('local ' + nm.LD + '=string.char(108,111,97,100,115,116,114,105,110,103) local ' + nm.G + '=getfenv and getfenv() or _ENV');
  p.push(nm.LD + '=' + nm.G + '[' + nm.LD + '] or ' + nm.G + '[string.char(108,111,97,100)]');
  wrapTail(p, rnd, hideErrors, nm.LD, nm.S, nm.FN, nm.ER, nm.OK, nm.RES);
  return p.join(' ');
}

function schemeC(src, rnd, hideErrors, rid) {
  const bytes = toByteString(src);
  const n = bytes.length;
  const k1 = 1 + Math.floor(rnd() * 200);
  const k2 = Math.floor(rnd() * 256);
  const arr = [];
  for (let i = 0; i < n; i++) {
    const b = bytes.charCodeAt(i) & 255;
    const j = i + 1;
    arr.push((b + ((j * j * 7 + j * k1 + k2) % 256)) % 256);
  }
  const nm = loaderNames(rid);
  const p = [];
  p.push('local ' + nm.V + '={' + arr.join(',') + '}');
  p.push('local ' + nm.Q + '={}');
  p.push('for ' + nm.I + '=1,#' + nm.V + ' do');
  p.push(nm.Q + '[' + nm.I + ']=string.char((' + nm.V + '[' + nm.I + ']-((' + nm.I + '*' + nm.I + '*7+' + nm.I + '*' + k1 + '+' + k2 + ')%256))%256)');
  p.push('end');
  p.push('local ' + nm.S + '=table.concat(' + nm.Q + ')');
  p.push('if #' + nm.S + '~=' + numLit(n, rnd) + ' and #' + nm.S + '~=' + numLit(n + 1, rnd) + ' then return end');
  p.push('local ' + nm.LD + '=string.char(108,111,97,100,115,116,114,105,110,103) local ' + nm.G + '=getfenv and getfenv() or _ENV');
  p.push(nm.LD + '=' + nm.G + '[' + nm.LD + '] or ' + nm.G + '[string.char(108,111,97,100)]');
  wrapTail(p, rnd, hideErrors, nm.LD, nm.S, nm.FN, nm.ER, nm.OK, nm.RES);
  return p.join(' ');
}

const SCHEMES = [schemeA, schemeB, schemeC];

function packBlob(src, rnd, hideErrors, rid, avoid) {
  let idx = Math.floor(rnd() * SCHEMES.length);
  if (SCHEMES.length > 1) {
    let guard = 0;
    while (idx === avoid && guard++ < 12) idx = Math.floor(rnd() * SCHEMES.length);
  }
  return { code: SCHEMES[idx](src, rnd, hideErrors, rid), scheme: idx };
}

module.exports = { luaObfuscate: luaObfuscate, lexLua: lexLua };
