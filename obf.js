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
  if (typeof Buffer !== 'undefined') return Buffer.from(String(str), 'utf8').toString('latin1');
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
  3: { layers: 3, junk: 8,   decoys: 60,  junkMul: 8,   strings: true, numbers: true, rename: true, fakes: 1 },
  4: { layers: 4, junk: 15,  decoys: 120, junkMul: 15,  strings: true, numbers: true, rename: true, fakes: 2 },
  5: { layers: 5, junk: 25,  decoys: 200, junkMul: 25,  strings: true, numbers: true, rename: true, fakes: 3 },
  6: { layers: 6, junk: 40,  decoys: 300, junkMul: 40,  strings: true, numbers: true, rename: true, fakes: 3, shard: true }
};

function luaObfuscate(source, options) {
  const opts = options || {};
  const lv = LEVELS[Math.max(1, Math.min(5, Number(opts.level) || 3))];
  const o = Object.assign({
    strings: lv.strings, numbers: lv.numbers, rename: lv.rename,
    junk: true, wrap: true, hideErrors: true, seed: Date.now(),
    layers: lv.layers, junkSize: lv.junk, decoys: lv.decoys, junkMul: lv.junkMul, fakes: lv.fakes || 0, remote: false
  }, opts);
  const rnd = rngFactory(o.seed || 1);
  const toks = lexLua(source);
  const real = toks.filter(function (x) { return x.t !== 'nl'; });

  for (let i = 0; i < real.length; i++) { real[i].idx = i; real[i].ridx = i; }

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
    const ptk = toks[pi];
    const pidx = (ptk && typeof ptk.ridx === 'number') ? ptk.ridx : -1;
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

  if (o.wrap && Number(o.level) >= 5 && !o.remote && process.env.FULL_VM !== '0') {
    const vmCode = tryFullVM(source, rid);
    if (vmCode) {
      let packed = vmCode;
      let prev = -1;
      const packRounds = Number(o.level) >= 6 ? 3 : 2;
      for (let li = 0; li < packRounds; li++) {
        const p2 = packBlob(packed, rnd, o.hideErrors && li === 1, rid, prev, li === 1 ? 0 : undefined);
        packed = p2.code;
        prev = p2.scheme;
      }
      const mul = Math.max(0, Number(o.junkMul) || 0);
      const target = Math.min(600000, Math.floor(String(source).length * mul));
      let out = packed;
      if (target > 0) {
        const built = buildJunkToSize(rnd, rid, target, Math.max(0, Number(o.decoys) || 0));
        if (built.code) out = built.code + ' return (function() ' + out + ' end)()';
      }
      return {
        code: out,
        vault: null,
        stats: { strings: 0, original: source.length, output: out.length, decoys: 0, junk: Math.max(0, out.length - packed.length), fullVm: true }
      };
    }
  }

  if (o.wrap) {
    let layers = Math.max(1, Math.min(8, Number(o.layers) || 1));
    const srcBytes = source.length;
    let budget = 8000000;
    for (let li = 0; li < layers; li++) {
      const need = Math.ceil(srcBytes * (o.remote ? 3 : 1.7));
      if (need > budget) { layers = Math.max(1, li); break; }
      budget -= need;
    }
    let prev = -1;
    const lvNum = Number(o.level) || 1;
    for (let li = 0; li < layers; li++) {
      const isOuter = li === layers - 1;
      const force = isOuter ? (lvNum >= 4 ? 4 : (lvNum >= 3 ? 3 : undefined)) : undefined;
      const packed = packBlob(result, rnd, o.hideErrors, rid, prev, force);
      result = packed.code;
      prev = packed.scheme;
    }
  }

  const mul = Math.max(0, Number(o.junkMul) || 0);
  const minDecoys = Math.max(0, Math.min(400, Number(o.decoys) || 0));
  if (mul > 0 || minDecoys > 0) {
    const baseLen = String(source).length;
    const room = Math.max(0, 8500000 - result.length);
    const targetChars = Math.min(room, Math.floor(baseLen * mul));
    const built = buildJunkToSize(rnd, rid, targetChars, minDecoys);
    if (built.code) {
      const rn = rid();
      const st = Math.floor(rnd() * 3);
      let wrap;
      if (st === 0) wrap = ' local ' + rn + '=function() ' + result + ' end return ' + rn + '()';
      else if (st === 1) wrap = ' local ' + rn + '=function() ' + result + ' end if ' + rn + ' then return ' + rn + '() end';
      else wrap = ' local ' + rn + '=function() ' + result + ' end return ' + rn + ' and ' + rn + '()';
      result = built.code + wrap;

      let fakeCount = Math.max(0, Math.min(4, Number(o.fakes) || 0));
      while (fakeCount > 0 && result.length * (fakeCount + 1) > 8500000) fakeCount--;
      for (let fi = 0; fi < fakeCount; fi++) {
        const decoySrc = fakeSource(rnd, rid);
        let decoy = decoySrc;
        let prevS = -1;
        const dl = Math.max(1, Math.min(4, Number(o.layers) || 1) - 1);
        for (let li = 0; li < dl; li++) {
          const p2 = packBlob(decoy, rnd, false, rid, prevS);
          decoy = p2.code;
          prevS = p2.scheme;
        }
        result = falseGate(rnd, rid) + decoy + ' end ' + result;
      }
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
  const urlBytes = [];
  for (let i = 0; i < url.length; i++) urlBytes.push(url.charCodeAt(i) & 255);
  const urlKey = 1 + Math.floor(rnd() * 200);
  const encUrl = urlBytes.map(function (c) { return (c + urlKey) % 256; });
  const U1 = rid(), U2 = rid(), U3 = rid();
  parts.push('local ' + U1 + '={' + encUrl.join(',') + '}');
  parts.push('local ' + U2 + '={} for ' + U3 + '=1,#' + U1 + ' do ' + U2 + '[' + U3 + ']=string.char((' + U1 + '[' + U3 + ']-' + urlKey + ')%256) end');
  parts.push('local ' + R + '=nil');
  parts.push('local ' + U3 + '=table.concat(' + U2 + ')');
  parts.push('pcall(function() ' + R + '=game:HttpGet(' + U3 + ') end)');
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




function falseGate(rnd, rid) {
  const x = rid(), y = rid(), z = rid();
  const a = 2 + Math.floor(rnd() * 50);
  const b = 2 + Math.floor(rnd() * 50);
  const c = a * b + 1;
  return 'local ' + x + '=' + a + ' local ' + y + '=' + b + ' local ' + z + '=' + c
    + ' if (' + x + '*' + y + '-(' + z + '-1))~=0 then ';
}

function fakeSource(rnd, rid) {
  const a = rid(), b = rid(), c = rid(), t = rid();
  const n1 = 20 + Math.floor(rnd() * 900);
  const n2 = 20 + Math.floor(rnd() * 900);
  const s1 = rid();
  return 'local ' + a + '=' + n1 + ' local ' + b + '=' + n2 + ' local ' + t + '={} '
    + 'for ' + c + '=1,' + a + ' do ' + t + '[' + c + ']=(' + c + '*' + b + ')%' + (n1 + 7) + ' end '
    + 'local ' + s1 + '="' + rid() + '" '
    + 'return ' + a + ',' + b + ',' + s1;
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
    const out = new Array(arr.length / 2);
    for (let i = 0, p2 = 0; i < arr.length; i += 2, p2++) {
      const v = arr[i] * 256 + arr[i + 1];
      out[p2] = B62[Math.floor(v / 3844)] + B62[Math.floor((v % 3844) / 62)] + B62[v % 62];
    }
    return { blob: out.join(''), len: bytes.length, k1: k1, k2: k2, k3: k3 };
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


function schemeD(src, rnd, hideErrors, rid) {
  const bytes = toByteString(src);
  const n = bytes.length;
  const k1 = 1 + Math.floor(rnd() * 190);
  const k2 = 1 + Math.floor(rnd() * 90);
  const k3 = Math.floor(rnd() * 256);
  const nm = loaderNames(rid);

  const enc = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = bytes.charCodeAt(i) & 255;
    const sw = (b % 16) * 16 + Math.floor(b / 16);
    const j = i + 1;
    enc[i] = (sw + ((j * k1 + j * j * k2 + k3) % 256)) % 256;
  }

  const blockCount = Math.max(2, Math.min(6, 2 + Math.floor(rnd() * 5)));
  const per = Math.max(1, Math.ceil(n / blockCount));
  const blocks = [];
  for (let b = 0; b < blockCount; b++) {
    const start = b * per;
    const end = Math.min(n, start + per);
    if (start >= end) break;
    const len = end - start;
    const off = Math.floor(rnd() * len);
    const rot = new Array(len);
    for (let j = 0; j < len; j++) rot[j] = enc[start + ((j + off) % len)];
    blocks.push({ start: start, len: len, off: off, data: rot });
  }

  const ids = [];
  while (ids.length < blocks.length + 3) {
    const v = 2 + Math.floor(rnd() * 90000);
    if (ids.indexOf(v) < 0) ids.push(v);
  }
  const initId = ids[0];
  const blockIds = ids.slice(1, 1 + blocks.length);
  const endId = ids[1 + blocks.length];
  const decoyId = ids[2 + blocks.length];

  const p = [];
  p.push('local ' + nm.BL + '={' + blocks.map(function (b) { return '{' + b.data.join(',') + '}'; }).join(',') + '}');
  p.push('local ' + nm.LEN + '={' + blocks.map(function (b) { return b.len; }).join(',') + '}');
  p.push('local ' + nm.ORD + '={' + blocks.map(function (b) { return b.off; }).join(',') + '}');
  p.push('local ' + nm.OUT + '={}');
  p.push('local ' + nm.C + '=0');
  p.push('local ' + nm.S + '=""');
  p.push('local ' + nm.T + '=' + initId);
  p.push('while ' + nm.T + '~=0 do');

  const branch = [];
  branch.push('if ' + nm.T + '==' + initId + ' then ' + nm.C + '=1 ' + nm.T + '=' + blockIds[0]);

  blocks.forEach(function (b, bi) {
    const nextState = bi + 1 < blocks.length ? blockIds[bi + 1] : endId;
    const aid = 2 + Math.floor(rnd() * 97);
    const bid = 2 + Math.floor(rnd() * 97);
    const opaque = '(' + aid + '*' + bid + ')-(' + aid + '*' + bid + '-' + nextState + ')';
    const L = [];
    L.push('local ' + nm.D + '=' + nm.BL + '[' + (bi + 1) + '] local ' + nm.Q + '={}');
    L.push('for ' + nm.I + '=1,' + nm.LEN + '[' + (bi + 1) + '] do');
    L.push('local ' + nm.V + '=' + nm.D + '[((' + nm.I + '-1-' + nm.ORD + '[' + (bi + 1) + '])%' + b.len + ')+1]');
    L.push('local ' + nm.P + '=' + (b.start) + '+' + nm.I);
    L.push('local ' + nm.HX + '=((' + nm.V + '-(((' + nm.P + '*' + k1 + '+' + nm.P + '*' + nm.P + '*' + k2 + '+' + k3 + ')%256)))%256)');
    L.push(nm.Q + '[' + nm.I + ']=string.char((' + nm.HX + '%16)*16+math.floor(' + nm.HX + '/16))');
    L.push('end');
    L.push(nm.OUT + '[' + (bi + 1) + ']=table.concat(' + nm.Q + ')');
    L.push(nm.T + '=' + opaque);
    branch.push('elseif ' + nm.T + '==' + blockIds[bi] + ' then ' + L.join(' '));
  });

  branch.push('elseif ' + nm.T + '==' + endId + ' then ' +
    'for ' + nm.I + '=1,' + blocks.length + ' do ' + nm.S + '=' + nm.S + '..(' + nm.OUT + '[' + nm.I + '] or "") end ' +
    'if #' + nm.S + '~=' + numLit(n, rnd) + ' then ' + nm.T + '=0 else ' +
    'local ' + nm.LD + '=string.char(108,111,97,100,115,116,114,105,110,103) local ' + nm.G + '=getfenv and getfenv() or _ENV ' +
    nm.LD + '=' + nm.G + '[' + nm.LD + '] or ' + nm.G + '[string.char(108,111,97,100)] ' +
    'local ' + nm.RES + '=' + nm.LD + '(' + nm.S + ') if not ' + nm.RES + ' then ' + nm.T + '=0 else ' +
    'return ' + nm.RES + '() end end');

  branch.push('elseif ' + nm.T + '==' + decoyId + ' then local ' + nm.V + '=0 for ' + nm.I + '=1,3 do ' + nm.V + '=' + nm.V + '+' + nm.I + ' end ' + nm.T + '=0');
  branch.push('else ' + nm.T + '=0 end end');
  p.push(branch.join(' '));
  return p.join(' ');
}


const VM_OPS = ['CONST','MOV','LEN','NEWT','JGT','SUBSTR','FIND','SUB','ADD','MUL','DIV','MOD','CHR','APPEND','JMP','CONCAT','LOADFN','CALL','RET','HALT','RUN','SLICE'];

function schemeE(src, rnd, hideErrors, rid) {
  const bytes = toByteString(src);
  const n = bytes.length;
  const k1 = 1 + Math.floor(rnd() * 190);
  const k2 = Math.floor(rnd() * 250);
  const blob = [];
  const enc = [];
  for (let i = 0; i < n; i++) {
    const b = bytes.charCodeAt(i) & 255;
    const j = i + 1;
    enc.push((b + ((j * k1 + k2) % 256)) % 256);
  }
  if (enc.length % 2) enc.push(0);
  for (let i = 0; i < enc.length; i += 2) {
    const v = enc[i] * 256 + enc[i + 1];
    blob.push(B62[Math.floor(v / 3844)] + B62[Math.floor((v % 3844) / 62)] + B62[v % 62]);
  }
  const blobStr = blob.join('');

  const omap = {};
  const used = {};
  for (let i = 0; i < VM_OPS.length; i++) {
    let v;
    do { v = Math.floor(rnd() * 31); } while (used[v]);
    used[v] = 1;
    omap[VM_OPS[i]] = v;
  }
  const mkey = Math.floor(rnd() * 31);

  const consts = {
    1: B62,
    2: blobStr,
    3: k1,
    4: k2,
    5: 3844,
    6: 62,
    7: 256,
    8: 1,
    9: k1,
    10: k2,
    11: 1,
    12: 3,
    13: 0,
    14: enc.length / 2,
    15: n
  };
  const konst = [];
  const kIdx = {};
  let kc = 1;
  function K(v) {
    const key = String(v);
    if (kIdx[key] === undefined) { kIdx[key] = kc; konst.push(v); kc++; }
    return kIdx[key];
  }
  function op(name) { return omap[name]; }
  function ins(name, a, b, c) {
    const w = op(name) * 1000000 + (a || 0) * 10000 + (b || 0) * 100 + (c || 0);
    return (w * 1 + mkey * 1) * 1;
  }
  const prog = [];
  function emit(name, a, b, c) {
    const o = (op(name) + mkey) % 31;
    prog.push(o * 1000000 + (a || 0) * 10000 + (b || 0) * 100 + (c || 0));
  }
  const r = {
    alpha: 1, blobr: 2, len: 3, out: 4, i: 5, j: 6, k1r: 7, k2r: 8,
    c3844: 9, c62: 10, c256: 11, one: 12, three: 13, zero: 14,
    t1: 15, t2: 16, t3: 17, t4: 18, t5: 19, t6: 20, t7: 21, t8: 22,
    s1: 23, s2: 24, hi: 25, lo: 26, jj: 27, by: 28, st: 29, ln: 30, exp: 31, ld: 32, res: 33, ok: 34
  };

  emit('CONST', r.alpha, K(B62), 0);
  emit('CONST', r.blobr, K(blobStr), 0);
  emit('LEN', r.len, r.blobr, 0);
  emit('NEWT', r.out, 0, 0);
  emit('CONST', r.i, K(1), 0);
  emit('CONST', r.j, K(0), 0);
  emit('CONST', r.k1r, K(k1), 0);
  emit('CONST', r.k2r, K(k2), 0);
  emit('CONST', r.c3844, K(3844), 0);
  emit('CONST', r.c62, K(62), 0);
  emit('CONST', r.c256, K(256), 0);
  emit('CONST', r.one, K(1), 0);
  emit('CONST', r.three, K(3), 0);
  emit('CONST', r.zero, K(0), 0);
  emit('CONST', r.exp, K(n), 0);

  const loopPos = prog.length + 1;
  emit('JGT', r.i, r.len, 0);
  const jgtAt = prog.length - 1;

  emit('SUBSTR', r.t1, r.blobr, r.i);
  emit('FIND', r.t1, r.alpha, r.t1);
  emit('SUB', r.t1, r.t1, r.one);
  emit('ADD', r.t2, r.i, r.one);
  emit('SUBSTR', r.t3, r.blobr, r.t2);
  emit('FIND', r.t3, r.alpha, r.t3);
  emit('SUB', r.t3, r.t3, r.one);
  emit('ADD', r.t4, r.t2, r.one);
  emit('SUBSTR', r.t5, r.blobr, r.t4);
  emit('FIND', r.t5, r.alpha, r.t5);
  emit('SUB', r.t5, r.t5, r.one);
  emit('MUL', r.t6, r.t1, r.c3844);
  emit('MUL', r.t7, r.t3, r.c62);
  emit('ADD', r.t6, r.t6, r.t7);
  emit('ADD', r.t6, r.t6, r.t5);
  emit('DIV', r.hi, r.t6, r.c256);
  emit('MOD', r.lo, r.t6, r.c256);

  emit('ADD', r.j, r.j, r.one);
  emit('MUL', r.jj, r.j, r.k1r);
  emit('ADD', r.jj, r.jj, r.k2r);
  emit('MOD', r.jj, r.jj, r.c256);
  emit('SUB', r.by, r.hi, r.jj);
  emit('MOD', r.by, r.by, r.c256);
  emit('CHR', r.by, r.by, 0);
  emit('APPEND', r.out, r.by, 0);

  emit('ADD', r.j, r.j, r.one);
  emit('MUL', r.jj, r.j, r.k1r);
  emit('ADD', r.jj, r.jj, r.k2r);
  emit('MOD', r.jj, r.jj, r.c256);
  emit('SUB', r.by, r.lo, r.jj);
  emit('MOD', r.by, r.by, r.c256);
  emit('CHR', r.by, r.by, 0);
  emit('APPEND', r.out, r.by, 0);

  emit('ADD', r.i, r.i, r.three);
  emit('JMP', loopPos, 0, 0);

  const endPos = prog.length + 1;
  emit('CONCAT', r.st, r.out, 0);
  emit('SLICE', r.st, r.st, r.exp);
  emit('LEN', r.ln, r.st, 0);
  const jgt1 = prog.length;
  emit('JGT', r.ln, r.exp, 0);
  const jgt2 = prog.length;
  emit('JGT', r.exp, r.ln, 0);
  emit('CONST', r.ld, K('__LOAD__'), 0);
  emit('CALL', r.res, r.st, 0);
  emit('RUN', r.res, 0, 0);
  const haltPos = prog.length + 1;
  emit('HALT', 0, 0, 0);
  prog[jgt1] = ((op('JGT') + mkey) % 31) * 1000000 + r.ln * 10000 + r.exp * 100 + haltPos;
  prog[jgt2] = ((op('JGT') + mkey) % 31) * 1000000 + r.exp * 10000 + r.ln * 100 + haltPos;

  prog[jgtAt] = ((op('JGT') + mkey) % 31) * 1000000 + r.i * 10000 + r.len * 100 + endPos;
  prog[jgtAt + 0] = prog[jgtAt];

  const nm = loaderNames(rid);
  const p = [];
  p.push('local ' + nm.K1 + '={' + konst.map(function (v) { return typeof v === 'string' ? '"' + v + '"' : v; }).join(',') + '}');
  p.push('local ' + nm.BL + '={' + prog.join(',') + '}');
  p.push('local ' + nm.OUT + '={}');
  p.push('local ' + nm.P + '=1');
  p.push('local ' + nm.C + '=' + mkey);
  p.push('while true do');
  p.push('local ' + nm.V + '=' + nm.BL + '[' + nm.P + ']');
  p.push(nm.P + '=' + nm.P + '+1');
  p.push('local ' + nm.I + '=(math.floor(' + nm.V + '/1000000)-' + nm.C + ')%31');
  p.push('local ' + nm.HX + '=math.floor(' + nm.V + '/10000)%100');
  p.push('local ' + nm.T + '=math.floor(' + nm.V + '/100)%100');
  p.push('local ' + nm.G + '=' + nm.V + '%100');

  p.push('if ' + nm.I + '==' + op('CONST') + ' then ' + nm.OUT + '[' + nm.HX + ']=' + nm.K1 + '[' + nm.T + ']');
  p.push('elseif ' + nm.I + '==' + op('MOV') + ' then ' + nm.OUT + '[' + nm.HX + ']=' + nm.OUT + '[' + nm.T + ']');
  p.push('elseif ' + nm.I + '==' + op('LEN') + ' then ' + nm.OUT + '[' + nm.HX + ']=#' + nm.OUT + '[' + nm.T + ']');
  p.push('elseif ' + nm.I + '==' + op('NEWT') + ' then ' + nm.OUT + '[' + nm.HX + ']={}');
  p.push('elseif ' + nm.I + '==' + op('SUBSTR') + ' then ' + nm.OUT + '[' + nm.HX + ']=' + nm.OUT + '[' + nm.T + ']:sub(' + nm.OUT + '[' + nm.G + '],' + nm.OUT + '[' + nm.G + '])');
  p.push('elseif ' + nm.I + '==' + op('FIND') + ' then ' + nm.OUT + '[' + nm.HX + ']=string.find(' + nm.OUT + '[' + nm.T + '],' + nm.OUT + '[' + nm.G + '],1,true)');
  p.push('elseif ' + nm.I + '==' + op('SUB') + ' then ' + nm.OUT + '[' + nm.HX + ']=' + nm.OUT + '[' + nm.T + ']-' + nm.OUT + '[' + nm.G + ']');
  p.push('elseif ' + nm.I + '==' + op('ADD') + ' then ' + nm.OUT + '[' + nm.HX + ']=' + nm.OUT + '[' + nm.T + ']+' + nm.OUT + '[' + nm.G + ']');
  p.push('elseif ' + nm.I + '==' + op('MUL') + ' then ' + nm.OUT + '[' + nm.HX + ']=' + nm.OUT + '[' + nm.T + ']*' + nm.OUT + '[' + nm.G + ']');
  p.push('elseif ' + nm.I + '==' + op('DIV') + ' then ' + nm.OUT + '[' + nm.HX + ']=math.floor(' + nm.OUT + '[' + nm.T + ']/' + nm.OUT + '[' + nm.G + '])');
  p.push('elseif ' + nm.I + '==' + op('MOD') + ' then ' + nm.OUT + '[' + nm.HX + ']=' + nm.OUT + '[' + nm.T + ']%' + nm.OUT + '[' + nm.G + ']');
  p.push('elseif ' + nm.I + '==' + op('CHR') + ' then ' + nm.OUT + '[' + nm.HX + ']=string.char(' + nm.OUT + '[' + nm.T + '])');
  p.push('elseif ' + nm.I + '==' + op('APPEND') + ' then ' + nm.OUT + '[' + nm.HX + '][#' + nm.OUT + '[' + nm.HX + ']+1]=' + nm.OUT + '[' + nm.T + ']');
  p.push('elseif ' + nm.I + '==' + op('JMP') + ' then ' + nm.P + '=' + nm.HX);
  p.push('elseif ' + nm.I + '==' + op('JGT') + ' then if ' + nm.OUT + '[' + nm.HX + ']>' + nm.OUT + '[' + nm.T + '] then ' + nm.P + '=' + nm.G + ' end');
  p.push('elseif ' + nm.I + '==' + op('CONCAT') + ' then ' + nm.OUT + '[' + nm.HX + ']=table.concat(' + nm.OUT + '[' + nm.T + '] or {})');
  p.push('elseif ' + nm.I + '==' + op('CALL') + ' then local ' + nm.LD + '=string.char(108,111,97,100,115,116,114,105,110,103) local ' + nm.G + '=getfenv and getfenv() or _ENV ' + nm.LD + '=' + nm.G + '[' + nm.LD + '] or ' + nm.G + '[string.char(108,111,97,100)] ' + nm.OUT + '[' + nm.HX + ']=' + nm.LD + '(' + nm.OUT + '[' + nm.T + '])');
  p.push('elseif ' + nm.I + '==' + op('RET') + ' then return ' + nm.OUT + '[' + nm.HX + ']');
  p.push('elseif ' + nm.I + '==' + op('RUN') + ' then local ' + nm.FN + '=' + nm.OUT + '[' + nm.HX + '] if type(' + nm.FN + ')=="function" then return ' + nm.FN + '() end return ' + nm.FN);
  p.push('elseif ' + nm.I + '==' + op('SLICE') + ' then ' + nm.OUT + '[' + nm.HX + ']=string.sub(' + nm.OUT + '[' + nm.T + '],1,' + nm.OUT + '[' + nm.G + '])');
  p.push('else break end');
  p.push('end');
  p.push('return nil');
  return p.join(' ');
}

const SCHEMES = process.env.VM_ONLY === '1' ? [schemeE] : [schemeA, schemeB, schemeC, schemeD, schemeE];

function packBlob(src, rnd, hideErrors, rid, avoid, forceIdx) {
  let idx = (typeof forceIdx === 'number' && forceIdx >= 0 && forceIdx < SCHEMES.length)
    ? forceIdx
    : Math.floor(rnd() * SCHEMES.length);
  if (SCHEMES.length > 1 && typeof forceIdx !== 'number') {
    let guard = 0;
    while (idx === avoid && guard++ < 12) idx = Math.floor(rnd() * SCHEMES.length);
  }
  return { code: SCHEMES[idx](src, rnd, hideErrors, rid), scheme: idx };
}

const { parseLua, buildVM } = require('./vm.js');

function tryFullVM(src, rid) {
  try {
    const ast = parseLua(lexLua(src));
    return buildVM(ast, rid);
  } catch (e) {
    return null;
  }
}

module.exports = { luaObfuscate: luaObfuscate, lexLua: lexLua, tryFullVM: tryFullVM };
