// Luau caps a function at 200 local registers. A register-heavy script used to
// fail with "Out of local registers ... exceeded limit 200" because levels 1-4
// keep the body as real Lua. The obfuscator must notice and take the VM path.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { luaObfuscate } = require('../../obf.js');

const LUAU = process.env.LUAU_BIN || '/tmp/luau-0.746/luau';
if (!fs.existsSync(LUAU)) {
  console.log('LOCALS skipped (set LUAU_BIN)');
  process.exit(0);
}

const dir = __dirname;
const n = 230;
const lines = [];
for (let i = 0; i < n; i++) lines.push('local v' + i + ' = ' + i);
lines.push('local s = 0');
for (let i = 0; i < n; i++) lines.push('s = s + v' + i);
lines.push('print(s)');
const src = lines.join('\n');
const want = String((n * (n - 1)) / 2);

let fail = 0, total = 0;
for (const lv of [1, 2, 3, 4, 5, 6]) {
  total++;
  const f = path.join(dir, '.locals' + lv + '.lua');
  const out = luaObfuscate(src, { level: lv, seed: 91 });
  fs.writeFileSync(f, out.code);
  const r = spawnSync(LUAU, [f], { encoding: 'utf8', timeout: 120000 });
  const got = (String(r.stdout || '') + String(r.stderr || ''))
    .split('\n').filter(function (l) { return l.indexOf('[obf]') !== 0; }).join('\n').trim().split('\n')[0];
  if (got !== want) { fail++; console.log('FAIL L' + lv, 'got=' + JSON.stringify(got.slice(0, 90))); }
}
console.log('LOCALS ' + (total - fail) + '/' + total + (fail ? ' FAILED' : ' OK') + '  (230 locals)');
process.exitCode = fail ? 1 : 0;
