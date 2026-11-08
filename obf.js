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
    strings: true, numbers: true, rename: true, junk: true, wrap: true, hideErrors: false, seed: Date.now(), layers: 1
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

  const ridChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function rid() {
    for (;;) {
      const len = 1 + Math.floor(rnd() * 2);
      let out = '';
      for (let i = 0; i < len; i++) out += ridChars[Math.floor(rnd() * ridChars.length)];
      if (usedNames.has(out)) continue;
      if (LUA_KW[out]) continue;
      usedNames.add(out);
      return out;
    }
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
    if (o.junk && rnd() < 0.02 && /^(then|do|else|repeat)$/.test(outTok[i])) {
      body += ' local ' + makeName() + '=(' + (Math.floor(rnd() * 1000) + 1) + '-' + (Math.floor(rnd() * 500)) + ')';
    }
  }

  let pre = '';
  if (pool.length) {
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
    const layers = Math.max(1, Math.min(3, Number(o.layers) || 1));
    for (let li = 0; li < layers; li++) result = packBlob(result, rnd, o.hideErrors, rid);
  }
  return { code: result, stats: { strings: pool.length, original: source.length, output: result.length } };
}

const B62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function packBlob(src, rnd, hideErrors, rid) {
  const bytes = toByteString(src);
  const n = bytes.length;

  const chunkCount = Math.max(2, Math.min(6, 2 + Math.floor(rnd() * 4)));
  const lens = [];
  let remain = n;
  for (let c = 0; c < chunkCount - 1; c++) {
    const slots = chunkCount - c;
    const maxLen = Math.max(1, Math.floor(remain / slots) * 2);
    const len = Math.max(1, Math.min(remain - (slots - 1), 1 + Math.floor(rnd() * maxLen)));
    lens.push(len);
    remain -= len;
  }
  lens.push(Math.max(0, remain));

  const chunks = [];
  let off = 0;
  for (let c = 0; c < chunkCount; c++) {
    const len = lens[c];
    const k1 = 1 + Math.floor(rnd() * 251);
    const k2 = Math.floor(rnd() * 256);
    const arr = [];
    for (let i = 0; i < len; i++) {
      const b = bytes.charCodeAt(off + i) & 255;
      arr.push((b + (((i + 1) * k1 + k2) % 256)) % 256);
    }
    off += len;
    if (arr.length % 2) arr.push(0);
    let blob = '';
    for (let i = 0; i < arr.length; i += 2) {
      const v = arr[i] * 256 + arr[i + 1];
      blob += B62[Math.floor(v / 3844)] + B62[Math.floor((v % 3844) / 62)] + B62[v % 62];
    }
    chunks.push({ k1: k1, k2: k2, len: len, blob: blob });
  }

  const order = [];
  for (let i = 0; i < chunkCount; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }

  let chk = n % 65521;
  for (let i = 0; i < n; i++) chk = (chk + (bytes.charCodeAt(i) & 255)) % 65521;
  const jx = Math.floor(rnd() * 9000) + 1000, jy = Math.floor(rnd() * 9000) + 1000;

  const A = rid(), M = rid(), BL = rid(), LEN = rid(), K1 = rid(), K2 = rid();
  const ORD = rid(), OUT = rid(), P = rid(), I = rid(), C = rid();
  const V = rid(), HX = rid(), B1 = rid(), B2 = rid(), Q = rid(), N = rid(), S = rid();
  const LD = rid(), FN = rid(), ER = rid(), OK = rid(), RES = rid();

  const blobTable = order.map(function (o) { return '"' + chunks[o].blob + '"'; }).join(',');
  const lenTable = order.map(function (o) { return chunks[o].len; }).join(',');
  const k1Table = order.map(function (o) { return chunks[o].k1; }).join(',');
  const k2Table = order.map(function (o) { return chunks[o].k2; }).join(',');

  const parts = [];
  const abcNums = B62.split('').map(function (c) { return c.charCodeAt(0); }).join(',');
  parts.push('local ' + A + '=string.char(' + abcNums + ')');
  parts.push('local ' + M + '={}');
  parts.push('for ' + I + '=1,#' + A + ' do ' + M + '[' + A + ':sub(' + I + ',' + I + ')]=' + I + '-1 end');
  parts.push('local ' + BL + '={' + blobTable + '}');
  parts.push('local ' + LEN + '={' + lenTable + '}');
  parts.push('local ' + K1 + '={' + k1Table + '}');
  parts.push('local ' + K2 + '={' + k2Table + '}');
  parts.push('local ' + ORD + '={' + order.map(function (v) { return v + 1; }).join(',') + '}');
  parts.push('local ' + OUT + '={}');
  parts.push('for ' + C + '=1,#' + BL + ' do');
  parts.push('local ' + V + '=' + BL + '[' + C + ']');
  parts.push('local ' + I + '=1');
  parts.push('local ' + P + '=0');
  parts.push('local ' + Q + '={}');
  parts.push('while ' + I + '<=#' + V + ' do');
  const ch0 = M + '[' + V + ':sub(' + I + ',' + I + ')]';
  const ch1 = M + '[' + V + ':sub(' + I + '+1,' + I + '+1)]';
  const ch2 = M + '[' + V + ':sub(' + I + '+2,' + I + '+2)]';
  parts.push('local ' + HX + '=' + ch0 + '*3844+' + ch1 + '*62+' + ch2);
  parts.push('local ' + B1 + '=math.floor(' + HX + '/256)');
  parts.push('local ' + B2 + '=' + HX + '%256');
  parts.push(P + '=' + P + '+1 ' + Q + '[' + P + ']=(' + B1 + '-((' + P + '*' + K1 + '[' + C + ']+' + K2 + '[' + C + '])%256))%256');
  parts.push(P + '=' + P + '+1 ' + Q + '[' + P + ']=(' + B2 + '-((' + P + '*' + K1 + '[' + C + ']+' + K2 + '[' + C + '])%256))%256');
  parts.push(I + '=' + I + '+3 end');
  parts.push('local ' + N + '={}');
  parts.push('for ' + I + '=1,' + LEN + '[' + C + '] do ' + N + '[' + I + ']=string.char(' + Q + '[' + I + ']) end');
  parts.push(OUT + '[' + ORD + '[' + C + ']]=table.concat(' + N + ')');
  parts.push('end');
  parts.push('local ' + S + '=table.concat(' + OUT + ')');
  parts.push('if #' + S + '~=' + n + ' then return end');
  parts.push('local ' + Q + '=' + (n % 65521) + ' for ' + I + '=1,#' + S + ' do ' + Q + '=(' + Q + '+string.byte(' + S + ',' + I + '))%65521 end');
  parts.push('if ' + Q + '~=' + chk + ' then return end');
  parts.push('if (' + jx + '-' + jy + ')~=' + (jx - jy) + ' then return end');
  parts.push('local ' + LD + '=nil');
  parts.push('local ' + LD + 'x=getfenv and getfenv() or _ENV');
  parts.push(LD + '=' + LD + 'x[string.char(108,111,97,100,115,116,114,105,110,103)] or ' + LD + 'x[string.char(108,111,97,100)]');
  if (hideErrors) {
    parts.push('local ' + FN + ',' + ER + '=pcall(function() return ' + LD + '(' + S + ',"@") end)');
    parts.push('if not ' + FN + ' or not ' + ER + ' then return end');
    parts.push('local ' + OK + ',' + RES + '=pcall(' + ER + ')');
    parts.push('if not ' + OK + ' then return end');
    parts.push('return ' + RES);
  } else {
    parts.push('local ' + FN + ',' + ER + '=' + LD + '(' + S + ',"@")');
    parts.push('if not ' + FN + ' then return end');
    parts.push('return ' + FN + '()');
  }
  return parts.join(' ');
}

module.exports = { luaObfuscate: luaObfuscate, lexLua: lexLua };
