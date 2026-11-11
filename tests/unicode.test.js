// Permanent regression: non-ASCII (Thai/emoji) must survive every level.
// The luaHash check runs over UTF-8 bytes in Lua, so the JS side must hash
// bytes too - otherwise the loader silently returns and nothing runs.
const { luaObfuscate } = require('../obf.js');
const { execSync } = require('child_process');
const fs = require('fs');
const samples = [
  ['thai', 'local m="สวัสดีครับ ภาษาไทย" print(#m)'],
  ['emoji', 'local m="ทดสอบ 📊 🔥" print(#m)'],
  ['mixed', 'local a,b="ไทย","abc" local t=0 for i=1,3 do t=t+i end print(#a,#b,t)'],
  ['long-thai', 'local s="' + 'ก'.repeat(50) + '" print(#s)'],
  ['emoji-heavy', 'local s="🎮🔥📊💎👑" print(#s)'],
  ['ascii', 'local t=0 for i=1,5 do t=t+i end print(t)']
];
let fail = 0, total = 0;
for (const [name, src] of samples) {
  fs.writeFileSync('tests/.tmp_plain.lua', src);
  const want = execSync('lua5.1 tests/.tmp_plain.lua', { encoding: 'utf8' }).trim();
  for (const lv of [1, 2, 3, 4, 5, 6]) {
    total++;
    fs.writeFileSync('tests/.tmp_out.lua', luaObfuscate(src, { level: lv, seed: 3 }).code);
    let got = '';
    try { got = execSync('timeout 60 lua5.1 tests/runlua.lua tests/.tmp_out.lua', { encoding: 'utf8' }).trim(); }
    catch (e) { got = (String(e.stdout || '') + String(e.stderr || '')).trim(); }
    if (got !== want) { fail++; console.log('FAIL', name, 'L' + lv, 'got=' + JSON.stringify(got).slice(0, 60), 'want=' + JSON.stringify(want)); }
  }
}
console.log('UNICODE ' + (total - fail) + '/' + total + (fail ? ' FAILED' : ' OK'));
process.exitCode = fail ? 1 : 0;
