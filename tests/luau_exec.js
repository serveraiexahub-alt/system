
const fs = require('fs');
const M = require("/tmp/luauweb.js");
function ready(fn) { if (M.calledRun) return fn(); M.onRuntimeInitialized = fn; }
ready(function () {
  const code = fs.readFileSync(process.argv[2], 'utf8');
  const fn = M.cwrap('executeScript', 'string', ['string']);
  try { const out = String(fn(code) || '').trim(); if (out) console.log(out.split('\n')[0]); }
  catch (e) { console.log('THROW:' + e.message); }
  setTimeout(() => process.exit(0), 200);
});
