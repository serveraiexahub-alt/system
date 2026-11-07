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
.menubadge { position: absolute; top: -4px; right: -4px; width: 9px; height: 9px; border-radius: 50%; background: var(--fg); display: none; }
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
.uploadbtn { margin-bottom: 6px; }
.hist { border-bottom: 1px solid var(--line); padding: 10px 0; font-size: 12px; }
.hist .hw { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
.hist .plus { color: #b9ffb9; }
.hist .minus { color: #ffb9b9; }
.inv { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line); padding: 12px 0; }
.inv .inva { display: flex; gap: 8px; flex: 0 0 auto; }
.drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 60; display: flex; justify-content: flex-end; }
.drawer { width: 290px; max-width: 84vw; background: var(--panel); border-left: 1px solid var(--line2); height: 100%; padding: 20px 16px; display: flex; flex-direction: column; gap: 6px; animation: slidein .18s ease; }
@keyframes slidein { from { transform: translateX(100%); } to { transform: translateX(0); } }
.dhead { display: flex; align-items: center; gap: 10px; padding-bottom: 16px; margin-bottom: 8px; border-bottom: 1px solid var(--line); }
.dhead .logo { width: 38px; height: 38px; border: 1px solid var(--fg); border-radius: 9px; overflow: hidden; flex: 0 0 auto; }
.dhead .logo img { width: 100%; height: 100%; object-fit: cover; }
.dhead .dname { font-weight: 700; letter-spacing: 1px; }
.dhead .duser { color: var(--muted); font-size: 12px; word-break: break-all; }
.ditem { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; border: 1px solid transparent; color: var(--fg); border-radius: 9px; padding: 11px 12px; font-size: 13px; text-align: left; }
.ditem:hover { border-color: var(--line2); background: var(--bg2); }
.ditem .dbadge { margin-left: auto; background: var(--fg); color: #000; border-radius: 9px; font-size: 10px; padding: 1px 7px; font-weight: 700; }
.dlang { flex-direction: column; align-items: stretch; gap: 8px; }
.dlang > span { font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; }
.langs { display: flex; gap: 8px; }
.langs button { flex: 1; background: transparent; border: 1px solid var(--line2); color: var(--fg); border-radius: 8px; padding: 8px; font-size: 12px; }
.langs button.on { background: var(--fg); color: #000; border-color: var(--fg); font-weight: 700; }
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
    x: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    menu: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>'
  };
  var T = {
    th: { sub_login:'เข้าสู่ระบบบัญชีของคุณ', sub_signup:'สร้างบัญชีของคุณ', username:'ชื่อผู้ใช้', password:'รหัสผ่าน', login:'เข้าสู่ระบบ', signup:'สร้างบัญชี', have_account:'มีบัญชีแล้ว?', no_account:'ยังไม่มีบัญชี?', files:'ไฟล์', new_file:'สร้างไฟล์', edit_file:'แก้ไขไฟล์', create_file:'สร้างไฟล์ใหม่', file_name:'ชื่อไฟล์', code:'โค้ด', upload_file:'อัปโหลดไฟล์', choose_file:'เลือกไฟล์', no_file:'ยังไม่ได้เลือกไฟล์', cancel:'ยกเลิก', save:'บันทึก', create:'สร้าง', raw_hint:'ลิงก์ raw คงเดิมหลังแก้ไข เอาไปใส่ใน executor ได้เลย', shared:'แชร์', by:'โดย', options:'ตัวเลือก', info:'ข้อมูล', invite_others:'เชิญผู้ใช้คนอื่น', close:'ปิด', loading:'กำลังโหลด...', no_updates:'ยังไม่มีการอัปเดต', chars:'ตัวอักษร', lines:'บรรทัด', invite_user:'เชิญผู้ใช้', invite_hint:'ผู้ถูกเชิญจะดูและแก้ไฟล์ได้ แต่ลบไม่ได้', invite:'เชิญ', invited_sent:'ส่งคำเชิญแล้ว', invites:'คำเชิญ', no_invites:'ไม่มีคำเชิญ', from:'จาก', no_files:'ยังไม่มีไฟล์', create_first:'สร้าง script แรกของคุณ', signout:'ออกบัญชี', account:'บัญชี', language:'เปลี่ยนภาษา', discord:'ดิสคอร์ด', edit:'แก้ไข', delete:'ลบ', copy:'คัดลอก', ago_sec:'วินาทีที่แล้ว', ago_min:'นาทีที่แล้ว', ago_hour:'ชั่วโมงที่แล้ว', ago_day:'วันที่แล้ว' },
    en: { sub_login:'Sign in to your account', sub_signup:'Create your account', username:'Username', password:'Password', login:'Sign in', signup:'Create account', have_account:'Already have an account?', no_account:'No account?', files:'Files', new_file:'New file', edit_file:'Edit file', create_file:'New file', file_name:'File name', code:'Code', upload_file:'Upload file', choose_file:'Choose file', no_file:'No file selected', cancel:'Cancel', save:'Save', create:'Create', raw_hint:'The raw link stays the same after editing. Paste it into your executor.', shared:'Shared', by:'by', options:'Options', info:'Info', invite_others:'Invite others', close:'Close', loading:'Loading...', no_updates:'No updates yet', chars:'chars', lines:'lines', invite_user:'Invite user', invite_hint:'Invited users can view and edit the file, but cannot delete it', invite:'Invite', invited_sent:'Invitation sent', invites:'Invites', no_invites:'No invitations', from:'from', no_files:'No files yet', create_first:'Create your first script', signout:'Sign out', account:'Account', language:'Language', discord:'Discord', edit:'Edit', delete:'Delete', copy:'Copy', ago_sec:'s ago', ago_min:'m ago', ago_hour:'h ago', ago_day:'d ago' }
  };
  var LANG = localStorage.getItem('lang') || 'th';
  function t(k) { var d = T[LANG] || T.th; return d[k] != null ? d[k] : (T.th[k] != null ? T.th[k] : k); }
  function setLang(l) { LANG = l; try { localStorage.setItem('lang', l); } catch (e) {} closeOverlays(); boot(); }
  function closeOverlays() { var o = document.querySelectorAll('.overlay,.drawer-overlay'); Array.prototype.forEach.call(o, function (n) { n.remove(); }); }
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
    if (s < 60) return s + ' ' + t('ago_sec');
    var m = Math.floor(s / 60); if (m < 60) return m + ' ' + t('ago_min');
    var h = Math.floor(m / 60); if (h < 24) return h + ' ' + t('ago_hour');
    var d = Math.floor(h / 24); if (d < 30) return d + ' ' + t('ago_day');
    return fmt(ts);
  }
  var state = { user: null, files: [], invites: [] };
  function brand() { return '<div class="brand"><div class="logo"><img src="https://files.catbox.moe/okwlyx.png" alt=""></div><h1>สกัด HUB</h1></div>'; }
  function renderAuth(mode) {
    var signup = mode === 'signup';
    app.innerHTML = '<div class="auth-wrap"><div class="card">' + brand() +
      '<div class="sub">' + t(signup ? 'sub_signup' : 'sub_login') + '</div>' +
      '<div class="err" id="err"></div>' +
      '<div class="field"><label>' + ICON.user + ' ' + t('username') + '</label><input class="input" id="username" autocomplete="username" spellcheck="false"></div>' +
      '<div class="field"><label>' + ICON.lock + ' ' + t('password') + '</label><input class="input" id="password" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></div>' +
      '<button class="btn" id="go">' + t(signup ? 'signup' : 'login') + '</button>' +
      '<div class="switch">' + (signup ? t('have_account') + ' <a href="#" id="sw">' + t('login') + '</a>' : t('no_account') + ' <a href="#" id="sw">' + t('signup') + '</a>') + '</div></div></div>';
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
      '<div class="who">' + ICON.user + '<span>' + esc(state.user.username) + '</span></div>' +
      '<button class="iconbtn" id="menu" title="' + t('account') + '">' + ICON.menu + '<span class="menubadge" id="menubadge"></span></button>' +
      '</div></header>' +
      '<main><div class="bar"><h2>' + t('files') + '</h2><button class="btn small" id="new">' + ICON.plus + ' ' + t('new_file') + '</button></div><div class="grid" id="grid"></div></main>';
    document.getElementById('menu').onclick = function () { openDrawer(); };
    document.getElementById('new').onclick = function () { openModal(); };
  }
  function loadFiles() { api('/api/files').then(function (d) { state.files = d.files; renderFiles(); }).catch(function () { renderAuth('login'); }); }
  function loadInvites() {
    api('/api/invites').then(function (d) {
      state.invites = d.invites || [];
      var b = document.getElementById('menubadge');
      if (b) b.style.display = state.invites.length ? 'block' : 'none';
    }).catch(function () {});
  }
  function renderFiles() {
    var grid = document.getElementById('grid'); if (!grid) return;
    if (!state.files.length) { grid.innerHTML = '<div class="empty">' + ICON.file + '<div>' + t('no_files') + '</div><div style="margin-top:6px">' + t('create_first') + '</div></div>'; return; }
    grid.innerHTML = state.files.map(function (f) {
      var isOwner = f.role === 'owner';
      var tag = isOwner ? '' : '<span class="tag">' + t('shared') + '</span>';
      var del = isOwner ? '<button class="iconbtn rm" title="' + t('delete') + '">' + ICON.trash + '</button>' : '';
      return '<div class="file" data-id="' + esc(f.id) + '">' +
        '<div class="top"><div class="nm">' + ICON.file + '<span>' + esc(f.name) + '</span>' + tag + '</div>' +
        '<div class="meta">' + fmt(f.updated) + (isOwner ? '' : '<br>' + t('by') + ' ' + esc(f.ownerName)) + '</div></div>' +
        '<div class="raw"><span class="lbl">' + ICON.link + ' LOADER</span><input readonly value="' + esc(loader(f.rawUrl)) + '"><button class="iconbtn cp" title="' + t('copy') + '">' + ICON.copy + '</button></div>' +
        '<div class="actions"><button class="iconbtn ed" title="' + t('edit') + '">' + ICON.edit + '</button>' + del + '<button class="iconbtn more" title="' + t('options') + '">' + ICON.more + '</button></div></div>';
    }).join('');
    var nodes = grid.querySelectorAll('.file');
    Array.prototype.forEach.call(nodes, function (node) {
      var id = node.getAttribute('data-id'), f = null;
      for (var k = 0; k < state.files.length; k++) if (state.files[k].id === id) f = state.files[k];
      node.querySelector('.cp').onclick = function () { copyText(node.querySelector('.raw input').value); };
      node.querySelector('.ed').onclick = function () { openModal(id); };
      if (node.querySelector('.rm')) node.querySelector('.rm').onclick = function () {
        if (!confirm(t('delete') + '?')) return;
        api('/api/files/' + id, { method: 'DELETE' }).then(loadFiles).catch(function (e) { alert(e.message); });
      };
      node.querySelector('.more').onclick = function () { openMenu(id, f && f.role === 'owner'); };
    });
  }
  function openModal(id) {
    var editing = !!id;
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal">' +
      '<h3>' + (editing ? ICON.edit + ' ' + t('edit_file') : ICON.plus + ' ' + t('create_file')) + '</h3>' +
      '<div class="body">' +
      '<div class="field"><label>' + ICON.file + ' ' + t('file_name') + '</label><input class="input" id="fname" placeholder="myscript" spellcheck="false"></div>' +
      '<div class="field"><label>' + ICON.code + ' ' + t('code') + '</label><textarea class="input" id="fcode" placeholder="print(&quot;hello&quot;)"></textarea></div>' +
      '<div class="field"><label>' + ICON.file + ' ' + t('upload_file') + '</label>' +
      '<button class="btn ghost uploadbtn" id="fpick" type="button">' + ICON.file + ' ' + t('choose_file') + '</button>' +
      '<input type="file" id="ffile" accept=".lua,.txt,.js,.json,text/plain" style="display:none">' +
      '<div class="hint" id="ffname">' + t('no_file') + '</div></div>' +
      '<div class="hint">' + t('raw_hint') + '</div></div>' +
      '<div class="foot"><button class="btn ghost" id="cancel">' + t('cancel') + '</button><button class="btn" id="save">' + (editing ? t('save') : t('create')) + '</button></div></div>';
    document.body.appendChild(overlay);
    var nameEl = overlay.querySelector('#fname'), codeEl = overlay.querySelector('#fcode');
    overlay.querySelector('#fpick').onclick = function () { overlay.querySelector('#ffile').click(); };
    overlay.querySelector('#ffile').addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      overlay.querySelector('#ffname').textContent = file.name;
      var reader = new FileReader();
      reader.onload = function () { codeEl.value = String(reader.result || ''); if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.[^.]+$/, ''); };
      reader.readAsText(file);
    });
    if (editing) api('/api/files/' + id).then(function (d) { nameEl.value = d.name; codeEl.value = d.code; }).catch(function (e) { alert(e.message); overlay.remove(); });
    else nameEl.focus();
    overlay.querySelector('#cancel').onclick = function () { overlay.remove(); };
    overlay.querySelector('#save').onclick = function () {
      api(editing ? '/api/files/' + id : '/api/files', { method: editing ? 'PUT' : 'POST', body: { name: nameEl.value.trim(), code: codeEl.value } })
        .then(function () { overlay.remove(); loadFiles(); })
        .catch(function (e) { alert(e.message); });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openMenu(id, isOwner) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.more + ' ' + t('options') + '</h3><div class="body">' +
      '<button class="btn ghost" id="m-info">' + ICON.info + ' ' + t('info') + '</button>' +
      (isOwner ? '<button class="btn ghost" id="m-invite">' + ICON.userplus + ' ' + t('invite_others') + '</button>' : '') +
      '</div><div class="foot"><button class="btn ghost" id="m-close">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#m-close').onclick = function () { overlay.remove(); };
    overlay.querySelector('#m-info').onclick = function () { overlay.remove(); openInfo(id); };
    if (overlay.querySelector('#m-invite')) overlay.querySelector('#m-invite').onclick = function () { overlay.remove(); openInvite(id); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openInfo(id) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.info + ' ' + t('info') + '</h3><div class="body" id="histbody"><div class="hint">' + t('loading') + '</div></div><div class="foot"><button class="btn ghost" id="ic">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#ic').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    api('/api/files/' + id + '/history').then(function (d) {
      var h = (d.history || []).slice().reverse(), body = overlay.querySelector('#histbody');
      if (!h.length) { body.innerHTML = '<div class="hint">' + t('no_updates') + '</div>'; return; }
      body.innerHTML = h.map(function (e) {
        return '<div class="hist"><div class="hw">' + rel(e.ts) + ' · ' + fmt(e.ts) + '</div>' +
          '<div><span class="plus">+ ' + e.charsAdded + ' ' + t('chars') + ' / + ' + e.linesAdded + ' ' + t('lines') + '</span><br>' +
          '<span class="minus">- ' + e.charsRemoved + ' ' + t('chars') + ' / - ' + e.linesRemoved + ' ' + t('lines') + '</span></div></div>';
      }).join('');
    }).catch(function (e) { overlay.querySelector('#histbody').textContent = e.message; });
  }
  function openInvite(id) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.userplus + ' ' + t('invite_user') + '</h3><div class="body">' +
      '<div class="field"><label>' + ICON.user + ' ' + t('username') + '</label><input class="input" id="ivname" placeholder="username" spellcheck="false"></div>' +
      '<div class="hint">' + t('invite_hint') + '</div></div>' +
      '<div class="foot"><button class="btn ghost" id="ivcancel">' + t('cancel') + '</button><button class="btn" id="ivsend">' + t('invite') + '</button></div></div>';
    document.body.appendChild(overlay);
    var inp = overlay.querySelector('#ivname'); inp.focus();
    overlay.querySelector('#ivcancel').onclick = function () { overlay.remove(); };
    overlay.querySelector('#ivsend').onclick = function () {
      api('/api/files/' + id + '/invite', { method: 'POST', body: { username: inp.value.trim() } })
        .then(function () { overlay.remove(); alert(t('invited_sent')); })
        .catch(function (e) { alert(e.message); });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openInvites() {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.userplus + ' ' + t('invites') + '</h3><div class="body" id="invbody"></div><div class="foot"><button class="btn ghost" id="ivx">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#ivx').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    renderInvites(overlay);
  }
  function renderInvites(overlay) {
    var body = overlay.querySelector('#invbody'); body.innerHTML = '<div class="hint">' + t('loading') + '</div>';
    api('/api/invites').then(function (d) {
      var list = d.invites || [];
      if (!list.length) { body.innerHTML = '<div class="hint">' + t('no_invites') + '</div>'; return; }
      body.innerHTML = list.map(function (it) {
        return '<div class="inv"><div><b>' + esc(it.name) + '</b><div class="hint">' + t('from') + ' ' + esc(it.ownerName) + '</div></div>' +
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
  function openDrawer() {
    var overlay = document.createElement('div'); overlay.className = 'drawer-overlay';
    overlay.innerHTML = '<aside class="drawer">' +
      '<div class="dhead"><div class="logo"><img src="https://files.catbox.moe/okwlyx.png" alt=""></div><div><div class="dname">สกัด HUB</div><div class="duser">' + esc(state.user.username) + '</div></div></div>' +
      '<button class="ditem" id="d-inv">' + ICON.userplus + ' ' + t('invites') + '<span class="dbadge" id="dbadge">' + state.invites.length + '</span></button>' +
      '<div class="ditem dlang"><span>' + t('language') + '</span><div class="langs">' +
      '<button data-lang="th" class="' + (LANG === 'th' ? 'on' : '') + '">ไทย</button>' +
      '<button data-lang="en" class="' + (LANG === 'en' ? 'on' : '') + '">EN</button>' +
      '</div></div>' +
      '<a class="ditem" href="https://discord.gg/tgVTJ9veXk" target="_blank" rel="noopener">' + ICON.link + ' ' + t('discord') + '</a>' +
      '<button class="ditem" id="d-out">' + ICON.logout + ' ' + t('signout') + '</button>' +
      '</aside>';
    document.body.appendChild(overlay);
    var db = overlay.querySelector('#dbadge'); if (db && !state.invites.length) db.style.display = 'none';
    overlay.querySelector('#d-inv').onclick = function () { overlay.remove(); openInvites(); };
    overlay.querySelector('#d-out').onclick = function () {
      api('/api/logout', { method: 'POST' }).then(function () { overlay.remove(); state.user = null; renderAuth('login'); });
    };
    Array.prototype.forEach.call(overlay.querySelectorAll('.langs button'), function (b) {
      b.onclick = function () { setLang(b.getAttribute('data-lang')); };
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
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
