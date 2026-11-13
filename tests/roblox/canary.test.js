// The VM's anti-hook canary used to `return` when it did not match, which made
// the whole script run and do nothing on executors that wrap the string library
// or where getgenv() is not a plain table. Forcing the canary to fail must not
// change the program's result.
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { luaObfuscate } = require('../../obf.js');

const dir = __dirname;
const LUAU = process.env.LUAU_BIN || '/tmp/luau-0.746/luau';
const LUA51 = process.env.LUA51_BIN || 'lua5.1';
if (!fs.existsSync(LUAU)) {
  console.log('CANARY skipped (set LUAU_BIN)');
  process.exit(0);
}
try { execSync(LUA51 + ' -v', { stdio: 'ignore' }); }
catch (e) { console.log('CANARY skipped (needs lua5.1 to peel the layers)'); process.exit(0); }

const MOCK = fs.readFileSync(path.join(dir, 'mock.lua'), 'utf8');
const source = [
  'local G = (getgenv and getgenv()) or _G',
  'local t = 0',
  'for i = 1, 8 do',
  '  if i == 4 then continue end',
  '  t = t + i',
  'end',
  'print(t)'
].join('\n');
const want = '32';

const obf = path.join(dir, '.canary.lua');
const payload = path.join(dir, '.canary_payload.lua');
fs.writeFileSync(obf, luaObfuscate(source, { level: 6, seed: 12 }).code);
execSync(LUA51 + ' ' + path.join(dir, '..', 'peel.lua') + ' ' + obf + ' ' + payload, { encoding: 'utf8' });

function run(code) {
  const f = path.join(dir, '.canary_run.lua');
  fs.writeFileSync(f, MOCK + '\nlocal ok,err=pcall(function()\n' + code + '\nend)\nprint("R", tostring(ok), tostring(err or ""))');
  const r = spawnSync(LUAU, [f], { encoding: 'utf8', timeout: 120000 });
  return (String(r.stdout || '') + String(r.stderr || ''))
    .split('\n').filter(function (l) { return l.indexOf('[obf]') !== 0; });
}

const normal = run(fs.readFileSync(payload, 'utf8'));
const forced = fs.readFileSync(payload, 'utf8')
  .replace('local function _canary()', 'local function _canary() return false end local function _dead_canary()');

let fail = 0;
if (normal[0] !== want) { fail++; console.log('FAIL normal run:', normal[0]); }
const patched = run(forced);
if (patched[0] !== want) { fail++; console.log('FAIL canary-forced run:', patched[0]); }
console.log('CANARY ' + (2 - fail) + '/2' + (fail ? ' FAILED' : ' OK') + '  (result ' + want + ' either way)');
process.exitCode = fail ? 1 : 0;
