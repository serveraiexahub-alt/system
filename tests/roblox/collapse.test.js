// Regression: a big script packed without the VM must still compile.
//
// Luau gives one function 200 local registers. A packed payload is compiled as a
// single main chunk where every top-level local stays alive, so a script with a
// few hundred top-level `local` declarations used to die with
// "Out of local registers when trying to allocate ..." inside the player's
// executor. The fix turns those declarations into assignments, and this test
// proves the semantics survive (sum of 1..120 is 7260).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { luaObfuscate } = require('../../obf.js');

const dir = __dirname;
const LUAU_DIR = process.env.LUAU_DIR || '/tmp/luau-0.746';
const LUAU = path.join(LUAU_DIR, 'luau');
if (!fs.existsSync(LUAU)) {
  console.log('COLLAPSE skipped (build Luau and set LUAU_DIR, e.g. /tmp/luau-0.746)');
  process.exit(0);
}

const N = 120;
const lines = [];
for (let i = 1; i <= N; i++) lines.push('local v' + i + ' = ' + i);
lines.push('local acc = 0');
for (let i = 1; i <= N; i++) lines.push('acc = acc + v' + i);
// a closure that captures two of the collapsed names
lines.push('local function addV1V2() return v1 + v2 end');
lines.push('print("TOTAL", acc + addV1V2() - 3)');
const src = lines.join('\n');

const mock = fs.readFileSync(path.join(dir, 'mock.lua'), 'utf8');

function run(code, tag) {
  const combined = path.join(dir, '.collapse_' + tag + '.lua');
  fs.writeFileSync(combined, mock + '\nlocal __ok, __err = pcall(function()\n' + code + '\nend)\n' +
    "print('STATUS', tostring(__ok), tostring(__err or ''))\n");
  const r = spawnSync(LUAU, [combined], { encoding: 'utf8', timeout: 240000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const total = (out.match(/TOTAL\s+(\d+)/) || [])[1] || '';
  return { total, ok: /STATUS\ttrue/.test(out), raw: out };
}

const want = String((N * (N + 1)) / 2 + 1 + 2 - 3);
let fail = 0, total = 0;
for (const lv of [1, 3]) {
  const save = process.env.FULL_VM;
  process.env.FULL_VM = '0';                       // force the packed fallback
  const out = luaObfuscate(src, { level: lv, seed: 4242 });
  if (save === undefined) delete process.env.FULL_VM; else process.env.FULL_VM = save;
  if (out.stats.fullVm || out.stats.collapsed < N) {
    fail++;
    console.log('FAIL L' + lv, 'the collapse did not fire (fullVm=' + out.stats.fullVm + ' collapsed=' + out.stats.collapsed + ')');
  }
  for (let round = 0; round < 2; round++) {
    total++;
    const got = run(out.code, 'L' + lv + '_' + round);
    if (!got.ok || got.total !== want) {
      fail++;
      console.log('FAIL L' + lv + ' round ' + round, 'want TOTAL ' + want, 'got', got.total || got.raw.split('\n').slice(-3).join(' | ').slice(0, 160));
    }
  }
}
console.log('COLLAPSE ' + (total + 2 - fail) + '/' + (total + 2) + (fail ? ' FAILED' : ' OK') + '  (TOTAL ' + want + ')');
process.exitCode = fail ? 1 : 0;
