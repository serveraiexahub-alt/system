'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const APP_NAME = 'สกัด HUB';
const SESSION_DAYS = 30;
const MAX_CODE = 2 * 1024 * 1024;
const MAX_NAME = 64;
const MAX_HISTORY = 100;

function loadSecret() {
  const f = path.join(path.dirname(DATA_FILE), '.secret');
  try {
    const s = fs.readFileSync(f, 'utf8').trim();
    if (s) return s;
  } catch (e) {}
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(f, s); } catch (e) {}
  return s;
}
const SECRET = process.env.SECRET || loadSecret();

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

function canView(f, u) { return f.owner === u.id || (f.shares || []).indexOf(u.id) >= 0; }
function canDelete(f, u) { return f.owner === u.id; }

function lineCounts(code) {
  const m = {};
  String(code).split('\n').forEach(function (l) { m[l] = (m[l] || 0) + 1; });
  return m;
}
function lineDiff(a, b) {
  const ca = lineCounts(a), cb = lineCounts(b);
  const keys = {};
  Object.keys(ca).forEach(function (k) { keys[k] = 1; });
  Object.keys(cb).forEach(function (k) { keys[k] = 1; });
  let added = 0, removed = 0;
  Object.keys(keys).forEach(function (k) {
    const x = ca[k] || 0, y = cb[k] || 0;
    if (y > x) added += y - x;
    if (x > y) removed += x - y;
  });
  return { added: added, removed: removed };
}
function diffStat(oldCode, newCode) {
  const a = String(oldCode), b = String(newCode);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const ld = lineDiff(a, b);
  return {
    charsAdded: Math.max(0, b.length - i - j),
    charsRemoved: Math.max(0, a.length - i - j),
    linesAdded: ld.added,
    linesRemoved: ld.removed,
    total: b.length
  };
}

function pushHistory(f, stat) {
  f.history.push({ ts: Date.now(), charsAdded: stat.charsAdded, charsRemoved: stat.charsRemoved, linesAdded: stat.linesAdded, linesRemoved: stat.linesRemoved, total: stat.total });
  if (f.history.length > MAX_HISTORY) f.history = f.history.slice(f.history.length - MAX_HISTORY);
}

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
  const u = req.user;
  const list = Object.values(db.files)
    .filter(function (f) { return canView(f, u); })
    .map(function (f) {
      const owner = db.users[f.owner];
      return {
        id: f.id, name: f.name, created: f.created, updated: f.updated,
        rawUrl: rawUrl(req, f.id),
        role: f.owner === u.id ? 'owner' : 'editor',
        ownerName: owner ? owner.username : '?'
      };
    })
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
  const f = { id: fid, owner: req.user.id, name: name, code: code, created: now, updated: now, shares: [], invites: [], history: [] };
  pushHistory(f, { charsAdded: code.length, charsRemoved: 0, linesAdded: code ? code.split('\n').length : 0, linesRemoved: 0, total: code.length });
  db.files[fid] = f;
  save();
  res.status(201).json({ id: fid, name: name, rawUrl: rawUrl(req, fid) });
});

app.get('/api/files/:id', auth, function (req, res) {
  const f = db.files[req.params.id];
  if (!f || !canView(f, req.user)) return res.status(404).json({ error: 'File not found' });
  res.json({ id: f.id, name: f.name, code: f.code, role: canDelete(f, req.user) ? 'owner' : 'editor' });
});

app.put('/api/files/:id', auth, function (req, res) {
  const f = db.files[req.params.id];
  if (!f || !canView(f, req.user)) return res.status(404).json({ error: 'File not found' });
  const name = String((req.body || {}).name || '').trim();
  const code = String((req.body || {}).code || '');
  if (!name) return res.status(400).json({ error: 'File name is required' });
  if (name.length > MAX_NAME) return res.status(400).json({ error: 'File name too long' });
  if (code.length > MAX_CODE) return res.status(400).json({ error: 'Code exceeds 2 MB limit' });
  pushHistory(f, diffStat(f.code, code));
  f.name = name;
  f.code = code;
  f.updated = Date.now();
  save();
  res.json({ ok: true, id: f.id, rawUrl: rawUrl(req, f.id) });
});

app.delete('/api/files/:id', auth, function (req, res) {
  const f = db.files[req.params.id];
  if (!f || !canDelete(f, req.user)) return res.status(404).json({ error: 'File not found' });
  delete db.files[f.id];
  save();
  res.json({ ok: true });
});

app.get('/api/files/:id/history', auth, function (req, res) {
  const f = db.files[req.params.id];
  if (!f || !canView(f, req.user)) return res.status(404).json({ error: 'File not found' });
  res.json({ history: f.history || [], name: f.name });
});

app.post('/api/files/:id/invite', auth, function (req, res) {
  const f = db.files[req.params.id];
  if (!f || !canDelete(f, req.user)) return res.status(404).json({ error: 'File not found' });
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'Username is required' });
  let target = null;
  for (const u of Object.values(db.users)) if (u.username === username) target = u;
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === f.owner) return res.status(400).json({ error: 'That is you' });
  if ((f.shares || []).indexOf(target.id) >= 0) return res.status(409).json({ error: 'Already has access' });
  if ((f.invites || []).indexOf(target.id) >= 0) return res.status(409).json({ error: 'Already invited' });
  f.invites = f.invites || [];
  f.invites.push(target.id);
  save();
  res.json({ ok: true });
});

app.get('/api/invites', auth, function (req, res) {
  const out = [];
  Object.values(db.files).forEach(function (f) {
    if ((f.invites || []).indexOf(req.user.id) >= 0) {
      const owner = db.users[f.owner];
      out.push({ fileId: f.id, name: f.name, ownerName: owner ? owner.username : '?' });
    }
  });
  res.json({ invites: out });
});

app.post('/api/invites/:fileId/accept', auth, function (req, res) {
  const f = db.files[req.params.fileId];
  if (!f) return res.status(404).json({ error: 'File not found' });
  const i = (f.invites || []).indexOf(req.user.id);
  if (i < 0) return res.status(404).json({ error: 'Invite not found' });
  f.invites.splice(i, 1);
  f.shares = f.shares || [];
  if (f.shares.indexOf(req.user.id) < 0) f.shares.push(req.user.id);
  save();
  res.json({ ok: true });
});

app.post('/api/invites/:fileId/decline', auth, function (req, res) {
  const f = db.files[req.params.fileId];
  if (!f) return res.status(404).json({ error: 'File not found' });
  const i = (f.invites || []).indexOf(req.user.id);
  if (i >= 0) { f.invites.splice(i, 1); save(); }
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
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<title>สกัด HUB</title>
<link rel="icon" type="image/png" href="https://files.catbox.moe/okwlyx.png">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg:#000; --bg2:#0a0a0a; --panel:#0d0d0d; --line:#1c1c1c; --line2:#2a2a2a; --fg:#f5f5f5; --muted:#8a8a8a; }
html, body { height: 100%; }
body { background: var(--bg); color: var(--fg); font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.i { width: 18px; height: 18px; flex: 0 0 auto; }
a { color: var(--fg); text-decoration: none; }
button { font-family: inherit; cursor: pointer; }
.auth-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.card { width: 100%; max-width: 400px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 28px; }
.brand { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.brand .logo { width: 34px; height: 34px; border: 1px solid var(--fg); border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.brand .logo img { width: 100%; height: 100%; object-fit: cover; }
.brand h1 { font-size: 18px; font-weight: 700; letter-spacing: 1px; }
.sub { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
.field { margin-bottom: 14px; }
.field label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.field label .i { width: 13px; height: 13px; }
.input { width: 100%; background: var(--bg2); border: 1px solid var(--line2); color: var(--fg); border-radius: 9px; padding: 11px 12px; font-family: inherit; font-size: 13px; }
.input:focus { outline: none; border-color: var(--fg); }
.btn { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--fg); color: #000; border: 1px solid var(--fg); border-radius: 9px; padding: 12px; font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
.btn.ghost { background: transparent; color: var(--fg); border-color: var(--line2); font-weight: 600; }
.btn.small { width: auto; padding: 7px 12px; font-size: 12px; }
.err { color: #fff; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 9px 12px; font-size: 12px; margin-bottom: 14px; display: none; }
.switch { text-align: center; margin-top: 18px; font-size: 12px; color: var(--muted); }
.switch a { border-bottom: 1px dotted var(--muted); }
header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: rgba(0,0,0,.85); backdrop-filter: blur(8px); z-index: 10; }
header .brand { margin: 0; }
header .brand h1 { font-size: 15px; }
header .right { display: flex; align-items: center; gap: 10px; }
header .who { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13px; }
main { max-width: 900px; margin: 0 auto; padding: 24px 18px 80px; }
.bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.bar h2 { font-size: 15px; letter-spacing: 1px; text-transform: uppercase; }
.grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
.file { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
.file .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.file .nm { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 14px; word-break: break-all; }
.file .nm .i { color: var(--muted); }
.file .meta { color: var(--muted); font-size: 11px; text-align: right; }
.tag { font-size: 10px; border: 1px solid var(--line2); color: var(--muted); border-radius: 6px; padding: 2px 6px; letter-spacing: 1px; }
.file .raw { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.file .raw .lbl { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; flex: 0 0 auto; }
.file .raw input { flex: 1; background: var(--bg2); border: 1px solid var(--line2); color: var(--fg); border-radius: 8px; padding: 8px 10px; font-family: inherit; font-size: 12px; min-width: 0; }
.actions { display: flex; gap: 8px; }
.iconbtn { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid var(--line2); border-radius: 8px; color: var(--fg); position: relative; }
.iconbtn:hover { border-color: var(--fg); }
.badge { position: absolute; top: -6px; right: -6px; background: var(--fg); color: #000; border-radius: 10px; min-width: 16px; height: 16px; font-size: 10px; font-weight: 700; display: none; align-items: center; justify-content: center; padding: 0 4px; }
.empty { text-align: center; color: var(--muted); padding: 60px 20px; border: 1px dashed var(--line); border-radius: 12px; }
.empty .i { width: 30px; height: 30px; margin-bottom: 12px; color: var(--muted); }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50; }
.modal { width: 100%; max-width: 640px; background: var(--panel); border: 1px solid var(--line2); border-radius: 14px; padding: 22px; max-height: 90vh; display: flex; flex-direction: column; }
.modal.smallm { max-width: 380px; }
.modal h3 { display: flex; align-items: center; gap: 8px; font-size: 15px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 16px; }
.modal .body { overflow: auto; }
textarea.input { min-height: 240px; resize: vertical; font-size: 12px; line-height: 1.5; white-space: pre; }
.modal .foot { display: flex; gap: 10px; margin-top: 16px; }
.modal .foot .btn { flex: 1; }
.modal .body .btn { margin-bottom: 10px; }
.hint { color: var(--muted); font-size: 11px; margin-top: 8px; }
.toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); background: var(--fg); color: #000; border-radius: 10px; padding: 12px 16px; font-size: 12px; display: flex; align-items: center; gap: 10px; z-index: 100; max-width: 92vw; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
.toast input { flex: 1; background: #000; color: #fff; border: none; border-radius: 6px; padding: 7px 9px; font-family: inherit; font-size: 12px; min-width: 0; }
.toast .copy { background: #000; color: #fff; border: none; border-radius: 6px; padding: 7px 11px; font-size: 11px; white-space: nowrap; }
.hist { border-bottom: 1px solid var(--line); padding: 10px 0; font-size: 12px; }
.hist .hw { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
.hist .plus { color: #b9ffb9; }
.hist .minus { color: #ffb9b9; }
.inv { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line); padding: 12px 0; }
.inv .inva { display: flex; gap: 8px; flex: 0 0 auto; }
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
    more: '<svg class="i" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle></svg>',
    userplus: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>',
    info: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
    check: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    x: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, opts) {
    opts = opts || {};
    return fetch(path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }); });
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(function () { fallbackCopy(txt); });
    else fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
  }
  function loader(u) { return 'loadstring(game:HttpGet("' + u + '"))()'; }
  function fmt(ts) { var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function rel(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + ' วินาทีที่แล้ว';
    var m = Math.floor(s / 60); if (m < 60) return m + ' นาทีที่แล้ว';
    var h = Math.floor(m / 60); if (h < 24) return h + ' ชั่วโมงที่แล้ว';
    var d = Math.floor(h / 24); if (d < 30) return d + ' วันที่แล้ว';
    return fmt(ts);
  }
  function toast(txt) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var t = document.createElement('div'); t.className = 'toast';
    var inp = document.createElement('input'); inp.readOnly = true; inp.value = txt;
    var b = document.createElement('button'); b.className = 'copy'; b.textContent = 'COPY';
    b.onclick = function () { copyText(txt); b.textContent = 'OK'; setTimeout(function () { b.textContent = 'COPY'; }, 1500); };
    t.appendChild(inp); t.appendChild(b); document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 9000);
  }
  var state = { user: null, files: [], invites: [] };
  function brand() { return '<div class="brand"><div class="logo"><img src="https://files.catbox.moe/okwlyx.png" alt=""></div><h1>สกัด HUB</h1></div>'; }
  function renderAuth(mode) {
    var signup = mode === 'signup';
    app.innerHTML = '<div class="auth-wrap"><div class="card">' + brand() +
      '<div class="sub">' + (signup ? 'Create your account' : 'Sign in to your account') + '</div>' +
      '<div class="err" id="err"></div>' +
      '<div class="field"><label>' + ICON.user + ' Username</label><input class="input" id="username" autocomplete="username" spellcheck="false"></div>' +
      '<div class="field"><label>' + ICON.lock + ' Password</label><input class="input" id="password" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></div>' +
      '<button class="btn" id="go">' + (signup ? 'Create account' : 'Sign in') + '</button>' +
      '<div class="switch">' + (signup ? 'Already have an account? <a href="#" id="sw">Sign in</a>' : 'No account? <a href="#" id="sw">Create one</a>') + '</div></div></div>';
    document.getElementById('sw').onclick = function (e) { e.preventDefault(); renderAuth(signup ? 'login' : 'signup'); };
    document.getElementById('go').onclick = submitAuth;
    document.getElementById('password').onkeydown = function (e) { if (e.key === 'Enter') submitAuth(); };
    document.getElementById('username').focus();
    function submitAuth() {
      var u = document.getElementById('username').value.trim(), p = document.getElementById('password').value;
      var err = document.getElementById('err'); err.style.display = 'none';
      api(signup ? '/api/signup' : '/api/login', { method: 'POST', body: { username: u, password: p } })
        .then(function (d) { state.user = d.user; renderApp(); loadFiles(); loadInvites(); })
        .catch(function (e) { err.textContent = e.message; err.style.display = 'block'; });
    }
  }
  function renderApp() {
    app.innerHTML = '<header>' + brand() + '<div class="right">' +
      '<button class="iconbtn" id="invbtn" title="คำเชิญ">' + ICON.userplus + '<span class="badge" id="invbadge"></span></button>' +
      '<div class="who">' + ICON.user + '<span>' + esc(state.user.username) + '</span></div>' +
      '<button class="iconbtn" id="logout" title="Sign out">' + ICON.logout + '</button></div></header>' +
      '<main><div class="bar"><h2>Files</h2><button class="btn small" id="new">' + ICON.plus + ' New file</button></div><div class="grid" id="grid"></div></main>';
    document.getElementById('logout').onclick = function () { api('/api/logout', { method: 'POST' }).then(function () { state.user = null; renderAuth('login'); }); };
    document.getElementById('new').onclick = function () { openModal(); };
    document.getElementById('invbtn').onclick = function () { openInvites(); };
  }
  function loadFiles() { api('/api/files').then(function (d) { state.files = d.files; renderFiles(); }).catch(function () { renderAuth('login'); }); }
  function loadInvites() {
    api('/api/invites').then(function (d) {
      state.invites = d.invites || [];
      var b = document.getElementById('invbadge');
      if (!b) return;
      if (state.invites.length) { b.textContent = state.invites.length; b.style.display = 'inline-flex'; } else b.style.display = 'none';
    }).catch(function () {});
  }
  function renderFiles() {
    var grid = document.getElementById('grid'); if (!grid) return;
    if (!state.files.length) { grid.innerHTML = '<div class="empty">' + ICON.file + '<div>No files yet</div><div style="margin-top:6px">Create your first script</div></div>'; return; }
    grid.innerHTML = state.files.map(function (f) {
      var isOwner = f.role === 'owner';
      var tag = isOwner ? '' : '<span class="tag">แชร์</span>';
      var del = isOwner ? '<button class="iconbtn rm" title="Delete">' + ICON.trash + '</button>' : '';
      return '<div class="file" data-id="' + esc(f.id) + '">' +
        '<div class="top"><div class="nm">' + ICON.file + '<span>' + esc(f.name) + '</span>' + tag + '</div>' +
        '<div class="meta">' + fmt(f.updated) + (isOwner ? '' : '<br>โดย ' + esc(f.ownerName)) + '</div></div>' +
        '<div class="raw"><span class="lbl">' + ICON.link + ' LOADER</span><input readonly value="' + esc(loader(f.rawUrl)) + '"><button class="iconbtn cp" title="Copy">' + ICON.copy + '</button></div>' +
        '<div class="actions"><button class="iconbtn ed" title="Edit">' + ICON.edit + '</button>' + del + '<button class="iconbtn more" title="More">' + ICON.more + '</button></div></div>';
    }).join('');
    var nodes = grid.querySelectorAll('.file');
    Array.prototype.forEach.call(nodes, function (node) {
      var id = node.getAttribute('data-id'), f = null;
      for (var k = 0; k < state.files.length; k++) if (state.files[k].id === id) f = state.files[k];
      node.querySelector('.cp').onclick = function () { var v = node.querySelector('.raw input').value; copyText(v); toast(v); };
      node.querySelector('.ed').onclick = function () { openModal(id); };
      if (node.querySelector('.rm')) node.querySelector('.rm').onclick = function () {
        if (!confirm('Delete this file? The raw link will stop working.')) return;
        api('/api/files/' + id, { method: 'DELETE' }).then(loadFiles).catch(function (e) { alert(e.message); });
      };
      node.querySelector('.more').onclick = function () { openMenu(id, f && f.role === 'owner'); };
    });
  }
  function openModal(id) {
    var editing = !!id;
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal">' +
      '<h3>' + (editing ? ICON.edit + ' แก้ไขไฟล์' : ICON.plus + ' สร้างไฟล์ใหม่') + '</h3>' +
      '<div class="body">' +
      '<div class="field"><label>' + ICON.file + ' ชื่อไฟล์</label><input class="input" id="fname" placeholder="myscript" spellcheck="false"></div>' +
      '<div class="field"><label>' + ICON.code + ' โค้ด</label><textarea class="input" id="fcode" placeholder="print(&quot;hello&quot;)"></textarea></div>' +
      '<div class="field"><label>' + ICON.file + ' อัปโหลดไฟล์</label><input class="input" type="file" id="ffile" accept=".lua,.txt,.js,.json,text/plain"></div>' +
      '<div class="hint">ลิงก์ raw คงเดิมหลังแก้ไข เอาไปใส่ใน executor ได้เลย</div></div>' +
      '<div class="foot"><button class="btn ghost" id="cancel">ยกเลิก</button><button class="btn" id="save">' + (editing ? 'บันทึก' : 'สร้าง') + '</button></div></div>';
    document.body.appendChild(overlay);
    var nameEl = overlay.querySelector('#fname'), codeEl = overlay.querySelector('#fcode');
    overlay.querySelector('#ffile').addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { codeEl.value = String(reader.result || ''); if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.[^.]+$/, ''); };
      reader.readAsText(file);
    });
    if (editing) api('/api/files/' + id).then(function (d) { nameEl.value = d.name; codeEl.value = d.code; }).catch(function (e) { alert(e.message); overlay.remove(); });
    else nameEl.focus();
    overlay.querySelector('#cancel').onclick = function () { overlay.remove(); };
    overlay.querySelector('#save').onclick = function () {
      api(editing ? '/api/files/' + id : '/api/files', { method: editing ? 'PUT' : 'POST', body: { name: nameEl.value.trim(), code: codeEl.value } })
        .then(function (d) { overlay.remove(); loadFiles(); toast(loader(d.rawUrl)); })
        .catch(function (e) { alert(e.message); });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openMenu(id, isOwner) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.more + ' ตัวเลือก</h3><div class="body">' +
      '<button class="btn ghost" id="m-info">' + ICON.info + ' ข้อมูล</button>' +
      (isOwner ? '<button class="btn ghost" id="m-invite">' + ICON.userplus + ' เชิญผู้ใช้คนอื่น</button>' : '') +
      '</div><div class="foot"><button class="btn ghost" id="m-close">ปิด</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#m-close').onclick = function () { overlay.remove(); };
    overlay.querySelector('#m-info').onclick = function () { overlay.remove(); openInfo(id); };
    if (overlay.querySelector('#m-invite')) overlay.querySelector('#m-invite').onclick = function () { overlay.remove(); openInvite(id); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openInfo(id) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.info + ' ข้อมูล</h3><div class="body" id="histbody"><div class="hint">กำลังโหลด...</div></div><div class="foot"><button class="btn ghost" id="ic">ปิด</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#ic').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    api('/api/files/' + id + '/history').then(function (d) {
      var h = (d.history || []).slice().reverse(), body = overlay.querySelector('#histbody');
      if (!h.length) { body.innerHTML = '<div class="hint">ยังไม่มีการอัปเดต</div>'; return; }
      body.innerHTML = h.map(function (e) {
        return '<div class="hist"><div class="hw">' + rel(e.ts) + ' · ' + fmt(e.ts) + '</div>' +
          '<div><span class="plus">+ ' + e.charsAdded + ' ตัวอักษร / + ' + e.linesAdded + ' บรรทัด</span><br>' +
          '<span class="minus">- ' + e.charsRemoved + ' ตัวอักษร / - ' + e.linesRemoved + ' บรรทัด</span></div></div>';
      }).join('');
    }).catch(function (e) { overlay.querySelector('#histbody').textContent = e.message; });
  }
  function openInvite(id) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.userplus + ' เชิญผู้ใช้</h3><div class="body">' +
      '<div class="field"><label>' + ICON.user + ' ชื่อผู้ใช้</label><input class="input" id="ivname" placeholder="username" spellcheck="false"></div>' +
      '<div class="hint">ผู้ถูกเชิญจะดูและแก้ไฟล์ได้ แต่ลบไม่ได้</div></div>' +
      '<div class="foot"><button class="btn ghost" id="ivcancel">ยกเลิก</button><button class="btn" id="ivsend">เชิญ</button></div></div>';
    document.body.appendChild(overlay);
    var inp = overlay.querySelector('#ivname'); inp.focus();
    overlay.querySelector('#ivcancel').onclick = function () { overlay.remove(); };
    overlay.querySelector('#ivsend').onclick = function () {
      api('/api/files/' + id + '/invite', { method: 'POST', body: { username: inp.value.trim() } })
        .then(function () { overlay.remove(); alert('ส่งคำเชิญแล้ว'); })
        .catch(function (e) { alert(e.message); });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openInvites() {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.userplus + ' คำเชิญ</h3><div class="body" id="invbody"></div><div class="foot"><button class="btn ghost" id="ivx">ปิด</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#ivx').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    renderInvites(overlay);
  }
  function renderInvites(overlay) {
    var body = overlay.querySelector('#invbody'); body.innerHTML = '<div class="hint">กำลังโหลด...</div>';
    api('/api/invites').then(function (d) {
      var list = d.invites || [];
      if (!list.length) { body.innerHTML = '<div class="hint">ไม่มีคำเชิญ</div>'; return; }
      body.innerHTML = list.map(function (it) {
        return '<div class="inv"><div><b>' + esc(it.name) + '</b><div class="hint">จาก ' + esc(it.ownerName) + '</div></div>' +
          '<div class="inva"><button class="btn small ok" data-id="' + esc(it.fileId) + '">' + ICON.check + '</button>' +
          '<button class="btn small ghost no" data-id="' + esc(it.fileId) + '">' + ICON.x + '</button></div></div>';
      }).join('');
      Array.prototype.forEach.call(body.querySelectorAll('.ok'), function (b) { b.onclick = function () { actInvite(b.getAttribute('data-id'), 'accept', overlay); }; });
      Array.prototype.forEach.call(body.querySelectorAll('.no'), function (b) { b.onclick = function () { actInvite(b.getAttribute('data-id'), 'decline', overlay); }; });
    }).catch(function (e) { body.textContent = e.message; });
  }
  function actInvite(fileId, action, overlay) {
    api('/api/invites/' + fileId + '/' + action, { method: 'POST' })
      .then(function () { loadInvites(); loadFiles(); renderInvites(overlay); })
      .catch(function (e) { alert(e.message); });
  }
  function boot() {
    api('/api/me').then(function (d) {
      state.user = d.user;
      if (state.user) { renderApp(); loadFiles(); loadInvites(); } else renderAuth('login');
    }).catch(function () { renderAuth('login'); });
  }
  boot();
})();
</script>
</body>
</html>`;

app.listen(PORT, function () {
  console.log(APP_NAME + ' listening on http://localhost:' + PORT);
});
