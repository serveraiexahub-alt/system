// Regression against the real Luau interpreter.
// Luau has no getfenv and no _ENV, and it accepts `continue`, so this is the
// closest thing to Roblox we can run locally.
//
// Needs the Luau wasm build; pass its path in LUAU_WASM (defaults to
// /tmp/luauweb.js). The test is skipped when it is missing.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { luaObfuscate } = require('../obf.js');

const WASM = process.env.LUAU_WASM || '/tmp/luauweb.js';
if (!fs.existsSync(WASM)) {
  console.log('LUAU skipped (set LUAU_WASM to luau-web.js)');
  process.exit(0);
}

const dir = __dirname;
fs.writeFileSync(path.join(dir, 'luau_exec.js'), `
const fs = require('fs');
const M = require(${JSON.stringify(WASM)});
function ready(fn) { if (M.calledRun) return fn(); M.onRuntimeInitialized = fn; }
ready(function () {
  const code = fs.readFileSync(process.argv[2], 'utf8');
  const fn = M.cwrap('executeScript', 'string', ['string']);
  try { const out = String(fn(code) || '').trim(); if (out) console.log(out.split('\\n')[0]); }
  catch (e) { console.log('THROW:' + e.message); }
  setTimeout(() => process.exit(0), 200);
});
`);

const STUB = `
local ENV = setmetatable({}, { __index = _G })
getgenv = function() return ENV end
local function any()
  return setmetatable({}, {
    __index = function(t, k) local v = any(); rawset(t, k, v); return v end,
    __newindex = function() end,
    __call = function() return any() end,
    __len = function() return 0 end,
    __concat = function() return '' end,
    __tostring = function() return '' end,
    __add=function() return any() end, __sub=function() return any() end,
    __mul=function() return any() end, __div=function() return any() end,
    __eq=function() return false end, __lt=function() return false end, __le=function() return false end,
  })
end
ENV.game = any(); ENV.workspace = any()
ENV.Instance = { new = function() return any() end }
ENV.Color3 = { fromRGB = function() return any() end, new = function() return any() end }
ENV.Vector2 = { new = function() return any() end }
ENV.Vector3 = { new = function() return any() end }
ENV.UDim = { new = function() return any() end }
ENV.UDim2 = { new = function() return any() end, fromOffset = function() return any() end, fromScale = function() return any() end }
ENV.CFrame = { new = function() return any() end }
ENV.Enum = setmetatable({}, { __index = function() return setmetatable({}, { __index = function() return any() end }) end })
ENV.TweenInfo = { new = function() return any() end }
ENV.task = { spawn = function(f) if type(f) == 'function' then pcall(f) end return any() end, wait = function() return 0 end, delay = function() end, defer = function() end }
ENV.warn = function() end
ENV.readfile = function() return '{}' end
ENV.writefile = function() end
ENV.isfile = function() return false end
ENV.gethui = function() return any() end
`;

const PEEL = `
getfenv = nil; _ENV = nil
getgenv = function() return _G end
local real = loadstring
local cap = {}
loadstring = function(s, c) cap[#cap + 1] = s; return real(s, c) end
_G.loadstring = loadstring
local f = assert(real(io.open(arg[1], 'r'):read('*a'), 'o'))
pcall(f)
local h = io.open(arg[2], 'w'); h:write(cap[#cap]); h:close()
`;
fs.writeFileSync(path.join(dir, 'peel.lua'), PEEL);

const lines = [];
for (let i = 0; i < 60; i++) lines.push('local v' + i + ' = ' + i);
lines.push('local msg = "ทดสอบ 📊 ภาษาไทย"');
lines.push('local acc = 0');
lines.push('for i = 1, 6 do');
lines.push('  if i == 3 then continue end');
lines.push('  acc = acc + i');
lines.push('end');
for (let i = 0; i < 60; i += 20) lines.push('acc = acc + v' + i);
lines.push('print(#msg, acc)');
const src = lines.join('\n');

function runInLuau(body) {
  const f = path.join(dir, '.luau_case.lua');
  fs.writeFileSync(f, STUB + '\n' + body);
  let out = '';
  try { out = execSync('timeout 90 node ' + path.join(dir, 'luau_exec.js') + ' ' + f, { encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  return out.trim().split('\n')[0].trim();
}

const want = runInLuau(src);
let fail = 0, total = 0;
for (const lv of [1, 2, 3, 4, 5, 6]) {
  total++;
  const obf = path.join(dir, '.luau_obf.lua');
  const pay = path.join(dir, '.luau_payload.lua');
  fs.writeFileSync(obf, luaObfuscate(src, { level: lv, seed: 41 }).code);
  execSync('timeout 90 lua5.1 ' + path.join(dir, 'peel.lua') + ' ' + obf + ' ' + pay, { encoding: 'utf8' });
  const got = runInLuau(fs.readFileSync(pay, 'utf8'));
  if (got !== want) { fail++; console.log('FAIL L' + lv, 'got=' + JSON.stringify(got), 'want=' + JSON.stringify(want)); }
}
console.log('LUAU ' + (total - fail) + '/' + total + (fail ? ' FAILED' : ' OK') + '  (expected ' + JSON.stringify(want) + ')');
process.exitCode = fail ? 1 : 0;
