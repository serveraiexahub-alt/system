// A UTF-8 BOM is not valid Lua. Before it was stripped, a BOM made the VM path
// bail out ("statement is not a call"), levels 1-4 fell back to packing, and the
// payload then failed with "Out of local registers ... exceeded limit 200".
const { luaObfuscate } = require('../obf.js');
const fs = require('fs');
const { spawnSync } = require('child_process');

const LUAU = process.env.LUAU_BIN || '/tmp/luau-0.746/luau';
if (!fs.existsSync(LUAU)) {
  console.log('BOM skipped (set LUAU_BIN)');
  process.exit(0);
}

const lines = [];
for (let i = 0; i < 40; i++) lines.push('local v' + i + ' = ' + i);
lines.push('local s = 0');
for (let i = 0; i < 40; i++) lines.push('s = s + v' + i);
lines.push('print(s)');
const body = lines.join('\n');
const want = String((40 * 39) / 2);

const variants = [
  ['plain', body],
  ['bom', '\uFEFF' + body],
  ['crlf', body.replace(/\n/g, '\r\n')],
  ['bom+crlf', '\uFEFF' + body.replace(/\n/g, '\r\n')]
];

let fail = 0, total = 0;
for (const [name, src] of variants) {
  for (const lv of [1, 3, 4, 6]) {
    total++;
    const f = '/tmp/_bom_case.lua';
    fs.writeFileSync(f, luaObfuscate(src, { level: lv, seed: 21 }).code);
    const r = spawnSync(LUAU, [f], { encoding: 'utf8', timeout: 120000 });
    const got = (String(r.stdout || '') + String(r.stderr || ''))
      .split('\n').filter(function (l) { return l.indexOf('[obf]') !== 0; }).join('\n').trim().split('\n')[0];
    if (got !== want) { fail++; console.log('FAIL', name, 'L' + lv, 'got=' + JSON.stringify(got.slice(0, 60))); }
  }
}
console.log('BOM ' + (total - fail) + '/' + total + (fail ? ' FAILED' : ' OK'));
process.exitCode = fail ? 1 : 0;
