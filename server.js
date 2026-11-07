'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 30;
const MAX_CODE = 2 * 1024 * 1024;
const MAX_NAME = 64;

app.use(express.json({ limit: '3mb' }));

let db = load();
function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return { users: {}, files: {} }; }
}
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

function hash(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verify(pw, stored) {
  const p = String(stored).split(':');
  if (p.length !== 2) return false;
  const a = Buffer.from(p[1], 'hex');
  const b = crypto.scryptSync(pw, p[0], 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function id(n) { return crypto.randomBytes(n || 8).toString('base64url'); }

function sign(payload) {
  const d = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return d + '.' + crypto.createHmac('sha256', SECRET).update(d).digest('base64url');
}
function unsign(token) {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const d = token.slice(0, i), s = token.slice(i + 1);
  const e = crypto.createHmac('sha256', SECRET).update(d).digest('base64url');
  const a = Buffer.from(s), b = Buffer.from(e);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(d, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch (err) { return null; }
}

function parseCookies(req) {
  const out = {};
  const c = req.headers.cookie;
  if (!c) return out;
  for (const part of c.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function userFromReq(req) {
  const p = unsign(parseCookies(req).token);
  if (!p || !p.uid) return null;
  const u = db.users[p.uid];
  return u ? { id: u.id, username: u.username } : null;
}

function auth(req, res, next) {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = u;
  next();
}

function setSession(res, uid) {
  const token = sign({ uid: uid, exp: Date.now() + SESSION_DAYS * 86400000 });
  res.setHeader('Set-Cookie', 'token=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + (SESSION_DAYS * 86400));
}

const hits = {};
function limiter(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  const now = Date.now();
  const win = 15 * 60 * 1000, max = 30;
  hits[ip] = (hits[ip] || []).filter(function (t) { return now - t < win; });
  if (hits[ip].length >= max) return res.status(429).json({ error: 'Too many attempts, try again later' });
  hits[ip].push(now);
  next();
}

function rawUrl(req, fid) {
  return (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.headers.host + '/raw/' + fid;
}

// ---------- API ----------
app.post('/api/signup', limiter, function (req, res) {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-20 characters (a-z, 0-9, _)' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  for (const u of Object.values(db.users)) if (u.username === username) return res.status(409).json({ error: 'Username already taken' });
  const uid = id(10);
  db.users[uid] = { id: uid, username: username, hash: hash(password), created: Date.now() };
  save();
  setSession(res, uid);
  res.status(201).json({ ok: true, user: { id: uid, username: username } });
});

app.post('/api/login', limiter, function (req, res) {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  let found = null;
  for (const u of Object.values(db.users)) if (u.username === username) found = u;
  if (!found || !verify(password, found.hash)) return res.status(401).json({ error: 'Invalid username or password' });
  setSession(res, found.id);
  res.json({ ok: true, user: { id: found.id, username: found.username } });
});

app.post('/api/logout', function (req, res) {
  res.setHeader('Set-Cookie', 'token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', function (req, res) {
  res.json({ user: userFromReq(req) });
});

app.get('/api/files', auth, function (req, res) {
  const list = Object.values(db.files)
    .filter(function (f) { return f.owner === req.user.id; })
    .map(function (f) { return { id: f.id, name: f.name, created: f.created, updated: f.updated, rawUrl: rawUrl(req, f.id) }; })
    .sort(function (a, b) { return b.updated - a.updated; });
  res.json({ files: list });
});

app.post('/api/files', auth, function (req, res) {
  const name = String((req.body || {}).name || '').trim();
  const code = String((req.body || {}).code || '');
  if (!name) return res.status(400).json({ error: 'File name is required' });
  if (name.length > MAX_NAME) return res.status(400).json({ error: 'File name too long' });
  if (code.length > MAX_CODE) return res.status(400).json({ error: 'Code exceeds 2 MB limit' });
  const fid = id(8);
  const now = Date.now();
  db.files[fid] = { id: fid, owner: req.user.id, name: name, code: code, created: now, updated: now };
  save();
  res.status(201).json({ id: fid, name: name, rawUrl: rawUrl(req, fid) });
});

app.get('/api/files/:id', auth, function (req, res) {
  const f = db.files[req.params.id];
  if (!f || f.owner !== req.user.id) return res.status(404).json({ error: 'File not found' });
  res.json({ id: f.id, name: f.name, code: f.code });
});

app.put('/api/files/:id', auth, function (req, res) {
  const f = db.files[req.params.id];
  if (!f || f.owner !== req.user.id) return res.status(404).json({ error: 'File not found' });
  const name = String((req.body || {}).name || '').trim();
  const code = String((req.body || {}).code || '');
  if (!name) return res.status(400).json({ error: 'File name is required' });
  if (name.length > MAX_NAME) return res.status(400).json({ error: 'File name too long' });
  if (code.length > MAX_CODE) return res.status(400).json({ error: 'Code exceeds 2 MB limit' });
  f.name = name;
  f.code = code;
  f.updated = Date.now();
  save();
  res.json({ ok: true, id: f.id, rawUrl: rawUrl(req, f.id) });
});

app.delete('/api/files/:id', auth, function (req, res) {
  const f = db.files[req.params.id];
  if (!f || f.owner !== req.user.id) return res.status(404).json({ error: 'File not found' });
  delete db.files[f.id];
  save();
  res.json({ ok: true });
});

app.get('/raw/:id', function (req, res) {
  const f = db.files[req.params.id];
  if (!f) return res.status(404).send('Not found');
  const accept = String(req.headers.accept || '').toLowerCase();
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const isBrowser = accept.includes('text/html') && !ua.includes('roblox') && !ua.includes('httpget') && !ua.includes('wininet') && req.query.raw !== '1';
  if (isBrowser) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(LOCK_PAGE);
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(f.code);
});

app.get('/', function (req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML);
});

const LOCK_PAGE = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<title>Access Denied</title>
<link rel="icon" type="image/png" href="https://files.catbox.moe/okwlyx.png">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #000; color: #fff; min-height: 100vh;
  display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.box { max-width: 520px; }
.box img { width: 76px; height: 76px; border-radius: 18px; border: 1px solid #333; margin-bottom: 28px; }
h1 { font-size: 22px; line-height: 1.8; letter-spacing: 1px; font-weight: 700; }
p { margin-top: 18px; color: #8a8a8a; font-size: 12px; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="box">
<img src="https://files.catbox.moe/okwlyx.png" alt="">
<h1>ที่นี้ไม่ต้อนรับคุณเชิญออก🚪</h1>
<p>This resource is only accessible by script</p>
</div>
</body>
</html>`;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<title>SYSTEM</title>
<link rel="icon" type="image/png" href="https://files.catbox.moe/okwlyx.png">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #000000;
  --bg2: #0a0a0a;
  --panel: #0d0d0d;
  --line: #1c1c1c;
  --line2: #2a2a2a;
  --fg: #f5f5f5;
  --muted: #8a8a8a;
  --accent: #ffffff;
}
html, body { height: 100%; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.i { width: 18px; height: 18px; flex: 0 0 auto; }
a { color: var(--fg); text-decoration: none; }
button { font-family: inherit; cursor: pointer; }

.auth-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.card {
  width: 100%; max-width: 400px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 28px;
}
.brand { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.brand .logo { width: 34px; height: 34px; border: 1px solid var(--fg); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
.brand .logo .i { width: 18px; height: 18px; }
.brand .logo img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
.brand h1 { font-size: 18px; font-weight: 700; letter-spacing: 2px; }
.sub { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
.field { margin-bottom: 14px; }
.field label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.field label .i { width: 13px; height: 13px; }
.input {
  width: 100%; background: var(--bg2); border: 1px solid var(--line2);
  color: var(--fg); border-radius: 9px; padding: 11px 12px; font-family: inherit; font-size: 13px;
}
.input:focus { outline: none; border-color: var(--fg); }
.btn {
  width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--fg); color: #000; border: 1px solid var(--fg); border-radius: 9px;
  padding: 12px; font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
}
.btn:hover { background: #e2e2e2; }
.btn.ghost { background: transparent; color: var(--fg); border-color: var(--line2); font-weight: 600; }
.btn.ghost:hover { border-color: var(--fg); }
.btn.small { width: auto; padding: 7px 12px; font-size: 12px; }
.btn.danger { background: transparent; color: var(--fg); border-color: var(--line2); }
.btn.danger:hover { border-color: var(--fg); background: #141414; }
.err { color: #ffffff; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 9px 12px; font-size: 12px; margin-bottom: 14px; display: none; }
.switch { text-align: center; margin-top: 18px; font-size: 12px; color: var(--muted); }
.switch a { border-bottom: 1px dotted var(--muted); }

header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: rgba(0,0,0,.85); backdrop-filter: blur(8px); z-index: 10;
}
header .brand { margin: 0; }
header .brand h1 { font-size: 16px; }
header .right { display: flex; align-items: center; gap: 14px; }
header .who { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13px; }
main { max-width: 900px; margin: 0 auto; padding: 26px 22px 80px; }
.bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.bar h2 { font-size: 15px; letter-spacing: 1px; text-transform: uppercase; }
.bar .count { color: var(--muted); font-size: 12px; }
.grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
.file {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px;
}
.file .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.file .nm { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 14px; word-break: break-all; }
.file .nm .i { color: var(--muted); }
.file .meta { color: var(--muted); font-size: 11px; }
.file .raw { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.file .raw .lbl { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; flex: 0 0 auto; }
.file .raw input {
  flex: 1; background: var(--bg2); border: 1px solid var(--line2); color: var(--fg);
  border-radius: 8px; padding: 8px 10px; font-family: inherit; font-size: 12px; min-width: 0;
}
.actions { display: flex; gap: 8px; }
.iconbtn {
  width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--line2); border-radius: 8px; color: var(--fg);
}
.iconbtn:hover { border-color: var(--fg); }
.empty { text-align: center; color: var(--muted); padding: 60px 20px; border: 1px dashed var(--line); border-radius: 12px; }
.empty .i { width: 30px; height: 30px; margin-bottom: 12px; color: var(--muted); }

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50; }
.modal { width: 100%; max-width: 640px; background: var(--panel); border: 1px solid var(--line2); border-radius: 14px; padding: 24px; max-height: 90vh; display: flex; flex-direction: column; }
.modal h3 { display: flex; align-items: center; gap: 8px; font-size: 15px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 18px; }
.modal .body { overflow: auto; }
textarea.input { min-height: 260px; resize: vertical; font-size: 12px; line-height: 1.5; white-space: pre; }
.modal .foot { display: flex; gap: 10px; margin-top: 18px; }
.modal .foot .btn { flex: 1; }
.hint { color: var(--muted); font-size: 11px; margin-top: 8px; }
.toast {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
  background: var(--fg); color: #000; border-radius: 10px; padding: 12px 16px; font-size: 12px;
  display: flex; align-items: center; gap: 10px; z-index: 100; max-width: 92vw; box-shadow: 0 8px 30px rgba(0,0,0,.5);
}
.toast input { flex: 1; background: #000; color: #fff; border: none; border-radius: 6px; padding: 7px 9px; font-family: inherit; font-size: 12px; min-width: 0; }
.toast .copy { background: #000; color: #fff; border: none; border-radius: 6px; padding: 7px 11px; font-size: 11px; }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function () {
  var app = document.getElementById('app');
  var ICON = {
    code: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    user: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
    lock: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
    plus: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    edit: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>',
    trash: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
    link: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    copy: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    logout: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>',
    file: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>',
    close: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Request failed');
        return d;
      });
    });
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(function () { fallbackCopy(txt); });
    } else { fallbackCopy(txt); }
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  function loader(u) { return 'loadstring(game:HttpGet("' + u + '"))()'; }
  function toast(rawUrl) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var t = document.createElement('div'); t.className = 'toast';
    var inp = document.createElement('input'); inp.readOnly = true; inp.value = rawUrl;
    var b = document.createElement('button'); b.className = 'copy'; b.textContent = 'COPY';
    b.onclick = function () { copyText(rawUrl); b.textContent = 'OK'; setTimeout(function () { b.textContent = 'COPY'; }, 1500); };
    t.appendChild(inp); t.appendChild(b);
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 9000);
  }
  var state = { user: null, files: [] };

  function brand() {
    return '<div class="brand"><div class="logo"><img src="https://files.catbox.moe/okwlyx.png" alt=""></div><h1>SYSTEM</h1></div>';
  }

  function renderAuth(mode) {
    var signup = mode === 'signup';
    app.innerHTML =
      '<div class="auth-wrap"><div class="card">' + brand() +
      '<div class="sub">' + (signup ? 'Create your account' : 'Sign in to your account') + '</div>' +
      '<div class="err" id="err"></div>' +
      '<div class="field"><label>' + ICON.user + ' Username</label><input class="input" id="username" autocomplete="username" spellcheck="false"></div>' +
      '<div class="field"><label>' + ICON.lock + ' Password</label><input class="input" id="password" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></div>' +
      '<button class="btn" id="go">' + (signup ? 'Create account' : 'Sign in') + '</button>' +
      '<div class="switch">' + (signup ? 'Already have an account? <a href="#" id="sw">Sign in</a>' : 'No account? <a href="#" id="sw">Create one</a>') + '</div>' +
      '</div></div>';
    document.getElementById('sw').onclick = function (e) { e.preventDefault(); renderAuth(signup ? 'login' : 'signup'); };
    document.getElementById('go').onclick = submitAuth;
    document.getElementById('password').onkeydown = function (e) { if (e.key === 'Enter') submitAuth(); };
    document.getElementById('username').focus();
    function submitAuth() {
      var u = document.getElementById('username').value.trim();
      var p = document.getElementById('password').value;
      var err = document.getElementById('err');
      err.style.display = 'none';
      var path = signup ? '/api/signup' : '/api/login';
      api(path, { method: 'POST', body: { username: u, password: p } }).then(function (d) {
        state.user = d.user;
        renderApp();
        loadFiles();
      }).catch(function (e) { err.textContent = e.message; err.style.display = 'block'; });
    }
  }

  function renderApp() {
    app.innerHTML =
      '<header>' + brand() +
      '<div class="right">' +
      '<div class="who">' + ICON.user + '<span>' + esc(state.user.username) + '</span></div>' +
      '<button class="iconbtn" id="logout" title="Sign out">' + ICON.logout + '</button>' +
      '</div></header>' +
      '<main>' +
      '<div class="bar"><h2>Files</h2><button class="btn small" id="new"><span style="display:inline-flex;gap:6px;align-items:center">' + ICON.plus + ' New file</span></button></div>' +
      '<div class="grid" id="grid"></div>' +
      '</main>';
    document.getElementById('logout').onclick = function () {
      api('/api/logout', { method: 'POST' }).then(function () { state.user = null; renderAuth('login'); });
    };
    document.getElementById('new').onclick = function () { openModal(); };
  }

  function loadFiles() {
    api('/api/files').then(function (d) {
      state.files = d.files;
      renderFiles();
    }).catch(function () { renderAuth('login'); });
  }

  function fmt(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderFiles() {
    var grid = document.getElementById('grid');
    if (!grid) return;
    if (!state.files.length) {
      grid.innerHTML = '<div class="empty">' + ICON.file + '<div>No files yet</div><div style="margin-top:6px">Create your first script</div></div>';
      return;
    }
    grid.innerHTML = state.files.map(function (f) {
      return '<div class="file" data-id="' + esc(f.id) + '">' +
        '<div class="top"><div class="nm">' + ICON.file + '<span>' + esc(f.name) + '</span></div>' +
        '<div class="meta">' + fmt(f.updated) + '</div></div>' +
        '<div class="raw"><span class="lbl">' + ICON.link + ' RAW</span>' +
        '<input readonly value="' + esc(f.rawUrl) + '">' +
        '<button class="iconbtn cp" title="Copy link">' + ICON.copy + '</button></div>' +
        '<div class="raw"><span class="lbl">' + ICON.code + ' LOADER</span>' +
        '<input readonly value="' + esc(loader(f.rawUrl)) + '">' +
        '<button class="iconbtn cp2" title="Copy loader">' + ICON.copy + '</button></div>' +
        '<div class="actions">' +
        '<button class="iconbtn ed" title="Edit">' + ICON.edit + '</button>' +
        '<button class="iconbtn rm" title="Delete">' + ICON.trash + '</button>' +
        '</div></div>';
    }).join('');
    var nodes = grid.querySelectorAll('.file');
    Array.prototype.forEach.call(nodes, function (node) {
      var id = node.getAttribute('data-id');
      node.querySelector('.cp').onclick = function () {
        var inp = node.querySelector('.raw input'); copyText(inp.value); toast(inp.value);
      };
      node.querySelector('.cp2').onclick = function () {
        var inp = node.querySelectorAll('.raw input')[1]; copyText(inp.value); toast(inp.value);
      };
      node.querySelector('.ed').onclick = function () { openModal(id); };
      node.querySelector('.rm').onclick = function () {
        if (!confirm('Delete this file? The raw link will stop working.')) return;
        api('/api/files/' + id, { method: 'DELETE' }).then(function () { loadFiles(); }).catch(function (e) { alert(e.message); });
      };
    });
  }

  function openModal(id) {
    var editing = !!id;
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal">' +
      '<h3>' + (editing ? ICON.edit + ' Edit file' : ICON.plus + ' New file') + '</h3>' +
      '<div class="body">' +
      '<div class="field"><label>' + ICON.file + ' File name</label><input class="input" id="fname" placeholder="myscript" spellcheck="false"></div>' +
      '<div class="field"><label>' + ICON.code + ' Code</label><textarea class="input" id="fcode" placeholder="print(&quot;hello&quot;)"></textarea></div>' +
      '<div class="field"><label>' + ICON.file + ' Upload file</label><input class="input" type="file" id="ffile" accept=".lua,.txt,.js,.json,text/plain"></div>' +
      '<div class="hint">The raw link stays the same after you edit. Paste it into your executor.</div>' +
      '</div>' +
      '<div class="foot"><button class="btn ghost" id="cancel">Cancel</button><button class="btn" id="save">' + (editing ? 'Save changes' : 'Create') + '</button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    var nameEl = overlay.querySelector('#fname');
    var codeEl = overlay.querySelector('#fcode');
    overlay.querySelector('#ffile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        codeEl.value = String(reader.result || '');
        if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.[^.]+$/, '');
      };
      reader.readAsText(file);
    });
    if (editing) {
      api('/api/files/' + id).then(function (d) { nameEl.value = d.name; codeEl.value = d.code; }).catch(function (e) { alert(e.message); overlay.remove(); });
    } else { nameEl.focus(); }
    overlay.querySelector('#cancel').onclick = function () { overlay.remove(); };
    overlay.querySelector('#save').onclick = function () {
      var name = nameEl.value.trim();
      var code = codeEl.value;
      var method = editing ? 'PUT' : 'POST';
      var path = editing ? '/api/files/' + id : '/api/files';
      api(path, { method: method, body: { name: name, code: code } }).then(function (d) {
        overlay.remove();
        loadFiles();
        toast(loader(d.rawUrl));
      }).catch(function (e) { alert(e.message); });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  function boot() {
    api('/api/me').then(function (d) {
      state.user = d.user;
      if (state.user) { renderApp(); loadFiles(); } else { renderAuth('login'); }
    }).catch(function () { renderAuth('login'); });
  }
  boot();
})();
</script>
</body>
</html>`;

app.listen(PORT, function () {
  console.log('SYSTEM listening on http://localhost:' + PORT);
});
