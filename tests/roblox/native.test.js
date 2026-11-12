// End-to-end check against a real Luau interpreter.
//
// Builds the Luau CLI once (needs g++ and make) and runs the obfuscated output
// for every level inside a Roblox-like environment, then compares the constructed
// instance tree with the un-obfuscated script. This is what catches mistakes
// that plain Lua 5.1 cannot see, such as _G not being the globals in Luau or
// `continue` being valid syntax.
//
// Set LUAU_DIR to a built Luau checkout to skip the build step.
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { luaObfuscate } = require('../../obf.js');

const dir = __dirname;
const LUAU_DIR = process.env.LUAU_DIR || '/tmp/luau-0.746';
const LUAU = path.join(LUAU_DIR, 'luau');
const SOURCE = process.env.TEST_SCRIPT || '/tmp/mm2.lua';

if (!fs.existsSync(SOURCE)) {
  console.log('ROBLOX skipped (set TEST_SCRIPT to a Lua file)');
  process.exit(0);
}
if (!fs.existsSync(LUAU)) {
  console.log('ROBLOX skipped (build Luau and set LUAU_DIR, e.g. /tmp/luau-0.746)');
  process.exit(0);
}

const mock = fs.readFileSync(path.join(dir, 'mock.lua'), 'utf8') + `

function __report(tag)
  local seen = {}
  for _, c in ipairs(__ALLCLASSES) do seen[c] = (seen[c] or 0) + 1 end
  local out = {}
  for c, n in pairs(seen) do out[#out+1] = tostring(c) .. 'x' .. n end
  table.sort(out)
  print('REPORT instances=' .. tostring(__createdCount()) .. ' classes=' .. table.concat(out, ','))
end
`;

function run(codeFile, tag) {
  const combined = path.join(dir, '.case.lua');
  fs.writeFileSync(combined,
    mock + '\nlocal __ok, __err = pcall(function()\n' +
    fs.readFileSync(codeFile, 'utf8') + '\nend)\n' +
    "print('STATUS', tostring(__ok), tostring(__err or ''))\n__report('" + tag + "')\n");
  const r = spawnSync(LUAU, [combined], { encoding: 'utf8', timeout: 240000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const report = (out.match(/REPORT .*/) || [''])[0];
  const status = (out.match(/STATUS\t(\w+)\t(.*)/) || []);
  return { report, ok: status[1] === 'true', err: status[2] || '' };
}

const src = fs.readFileSync(SOURCE, 'utf8');
const plain = run(SOURCE, 'orig');
if (!plain.ok) {
  console.log('ROBLOX skipped (the plain script does not run in this mock: ' + plain.err.trim().slice(0, 80) + ')');
  process.exit(0);
}

let fail = 0, total = 0;
for (const lv of [1, 2, 3, 4, 5, 6]) {
  total++;
  const f = path.join(dir, '.obf' + lv + '.lua');
  fs.writeFileSync(f, luaObfuscate(src, { level: lv, seed: 707 }).code);
  const got = run(f, 'L' + lv);
  if (!got.ok || got.report !== plain.report) {
    fail++;
    console.log('FAIL L' + lv, got.ok ? 'tree differs' : 'error: ' + got.err.trim().slice(0, 100));
    if (got.report !== plain.report) console.log('  want:', plain.report.slice(0, 120), '\n  got :', got.report.slice(0, 120));
  }
}
console.log('ROBLOX ' + (total - fail) + '/' + total + (fail ? ' FAILED' : ' OK') + '  (' + plain.report.slice(0, 60) + ')');
process.exitCode = fail ? 1 : 0;
