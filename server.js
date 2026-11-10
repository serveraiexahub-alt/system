'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  try {
    const fs = require('fs');
    const path = require('path');
    const p = file || path.join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t[0] === '#') continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'")) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (e) {}
}
loadEnvFile();

const { luaObfuscate } = require('./obf.js');
const { makeCaptcha } = require('./captcha.js');

const CHANGELOG = [
  {
    v: 'v1.9', date: '10 พ.ย. 2026',
    items: [
      'เพิ่มช่องดูประวัติการอัปเดตในเมนู',
      'เพิ่มการปรับสีธีม 7 สี',
      'สร้างไฟล์ต้องเลือกโฟลเดอร์ก่อน',
      'การมองเห็นปรับที่โฟลเดอร์เท่านั้น'
    ]
  },
  {
    v: 'v1.8', date: '10 พ.ย. 2026',
    items: [
      'เพิ่มความหนาของระบบปกปิดโค้ดอีกระดับ',
      'เพิ่มระบบตรวจสอบความถูกต้องของไฟล์',
      'ปรับราคาและสิทธิ์พรีเมียม'
    ]
  },
  {
    v: 'v1.7', date: '9 พ.ย. 2026',
    items: [
      'เพิ่มระดับปกปิดโค้ดสูงสุด (เฉพาะพรีเมียม)',
      'ปรับระบบความปลอดภัยของเว็บ',
      'เพิ่มระบบสำรองข้อมูลผ่าน Discord'
    ]
  },
  {
    v: 'v1.6', date: '8 พ.ย. 2026',
    items: [
      'เพิ่มระบบพรีเมียมและห้องสมัคร',
      'เพิ่มการแจ้งเตือนเมื่อมีสมาชิกใหม่'
    ]
  },
  {
    v: 'v1.5', date: '7 พ.ย. 2026',
    items: [
      'เพิ่มระบบปกปิดโค้ดแบบใหม่',
      'ปรับความเร็วของระบบ'
    ]
  }
];

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const APP_NAME = 'สกัด HUB';
const SESSION_DAYS = 30;
const MAX_CODE = 10 * 1024 * 1024;
const MAX_CODE_PREMIUM = Math.max(MAX_CODE, Number(process.env.MAX_CODE_PREMIUM) || 20 * 1024 * 1024);
const MAX_INPUT = 2 * 1024 * 1024;
const OBF_DAILY_LIMIT = Math.max(1, Number(process.env.OBF_DAILY_LIMIT) || 5);
const PREMIUM_DAILY_LIMIT = Math.max(1, Number(process.env.PREMIUM_DAILY_LIMIT) || 10);
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

app.disable('x-powered-by');
app.set('trust proxy', String(process.env.TRUST_PROXY || '1') !== '0');
app.use(express.json({ limit: '28mb' }));
app.use(function (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol);
  if (proto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  else if (process.env.FORCE_HTTPS === '1' && req.path.indexOf('/api/') !== 0) {
    return res.redirect(301, 'https://' + String(req.headers.host || '') + req.originalUrl);
  }
  if (req.path.indexOf('/api/') === 0) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }
  const m = req.method;
  if (m === 'POST' || m === 'PUT' || m === 'DELETE' || m === 'PATCH') {
    const origin = String(req.headers.origin || '');
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { host = ''; }
      const self = String(req.headers.host || '');
      if (!host || host !== self) {
        return res.status(403).json({ error: 'Cross-origin request blocked' });
      }
    }
    const ct = String(req.headers['content-type'] || '');
    if (req.path.indexOf('/api/') === 0 && ct && ct.indexOf('application/json') < 0) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
  }
  next();
});

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

function ensureDb() {
  db.users = db.users || {};
  db.files = db.files || {};
  db.folders = db.folders || {};
  db.follows = db.follows || {};
  db.favorites = db.favorites || {};
  db.signupLog = db.signupLog || [];
  db.ipReg = db.ipReg || {};
  db.fpReg = db.fpReg || {};
  db.vaults = db.vaults || {};
  db.pending = db.pending || {};
  db.lastNotifiedVersion = db.lastNotifiedVersion || '';
  Object.values(db.users).forEach(function (u) {
    if (typeof u.nick !== 'string') u.nick = '';
    if (typeof u.avatar !== 'string') u.avatar = '';
    if (typeof u.created !== 'number') u.created = Date.now();
  });
  Object.values(db.files).forEach(function (f) {
    if (f.visibility !== 'private') f.visibility = 'public';
    if (f.folder === undefined) f.folder = null;
    f.shares = f.shares || [];
    f.invites = f.invites || [];
    f.history = f.history || [];
  });
  Object.values(db.folders).forEach(function (f) {
    if (f.visibility !== 'private') f.visibility = 'public';
    f.shares = f.shares || [];
    f.files = f.files || [];
  });
  Object.keys(db.follows).forEach(function (k) { if (!Array.isArray(db.follows[k])) db.follows[k] = []; });
  Object.keys(db.favorites).forEach(function (k) { if (!Array.isArray(db.favorites[k])) db.favorites[k] = []; });
  try { save(); } catch (e) {}
}
ensureDb();

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

const BAD_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1, 'toString': 1, 'valueOf': 1, 'hasOwnProperty': 1 };
function ownGet(map, key) {
  if (!map || typeof key !== 'string' || !key) return undefined;
  if (BAD_KEYS[key]) return undefined;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}
function badKey(req, res, next) {
  const bad = Object.keys(req.params || {}).some(function (k) { return BAD_KEYS[req.params[k]]; });
  if (bad) return res.status(400).json({ error: 'Invalid id' });
  next();
}

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
  const u = ownGet(db.users, p.uid);
  return u ? { id: u.id, username: u.username, nick: u.nick || '', avatar: u.avatar || '' } : null;
}

function auth(req, res, next) {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = u;
  next();
}

function setSession(res, uid) {
  const token = sign({ uid: uid, exp: Date.now() + SESSION_DAYS * 86400000 });
  const secure = res.req && String(res.req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  res.setHeader('Set-Cookie', 'token=' + token + '; HttpOnly; SameSite=Lax; Path=/' +
    (secure ? '; Secure' : '') + '; Max-Age=' + (SESSION_DAYS * 86400));
}

const hits = {};
function limiter(req, res, next) {
  const ip = realIp(req);
  const now = Date.now();
  const win = 15 * 60 * 1000, max = 30;
  hits[ip] = (hits[ip] || []).filter(function (t) { return now - t < win; });
  if (hits[ip].length >= max) return res.status(429).json({ error: 'Too many attempts, try again later' });
  hits[ip].push(now);
  next();
}

const SIGNUP_IP_MAX = Math.max(1, Number(process.env.SIGNUP_IP_MAX) || 5);
const SIGNUP_FP_MAX = Math.max(1, Number(process.env.SIGNUP_FP_MAX) || 3);
const SIGNUP_WINDOW_H = Math.max(1, Number(process.env.SIGNUP_WINDOW_H) || 24);

const TRUST_PROXY = String(process.env.TRUST_PROXY || '1') !== '0';

function realIp(req) {
  if (TRUST_PROXY) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
    const xr = String(req.headers['x-real-ip'] || '').trim();
    if (xr) return xr;
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return String(req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
}

function clientIp(req) {
  return realIp(req);
}
function ipKey(ip) { return crypto.createHmac('sha256', SECRET).update(ip).digest('hex').slice(0, 32); }
function fpFromReq(req) {
  const raw = req.headers['x-client-fp'] || '';
  return raw ? crypto.createHmac('sha256', SECRET).update(String(raw)).digest('hex').slice(0, 32) : '';
}
function recentSignups(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const fp = fpFromReq(req);
  const dayAgo = now - SIGNUP_WINDOW_H * 3600 * 1000;
  const fromIp = (db.signupLog || []).filter(function (r) { return r.ip === ip && r.ts > dayAgo; }).length;
  const fromFp = fp ? (db.signupLog || []).filter(function (r) { return r.fp === fp && r.ts > dayAgo; }).length : 0;
  return { ip: ip, fp: fp, fromIp: fromIp, fromFp: fromFp };
}
function recordSignupDirect(ip, fp, uid) {
  db.signupLog = db.signupLog || [];
  db.signupLog.push({ ip: ip || '?', fp: fp || '', uid: uid, ts: Date.now() });
  if (db.signupLog.length > 5000) db.signupLog = db.signupLog.slice(-5000);
  db.ipReg = db.ipReg || {};
  db.ipReg[ipKey(ip || '?')] = Date.now();
  if (fp) { db.fpReg = db.fpReg || {}; db.fpReg[fp] = Date.now(); }
}

function recordSignup(req, uid) {
  const info = recentSignups(req);
  db.signupLog.push({ ip: info.ip, fp: info.fp, uid: uid, ts: Date.now() });
  if (db.signupLog.length > 5000) db.signupLog = db.signupLog.slice(-5000);
  db.ipReg[ipKey(info.ip)] = db.users[uid].created;
  if (info.fp) db.fpReg[info.fp] = db.users[uid].created;
}

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9ก-๙_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function rawUrl(req, fid) {
  const f = ownGet(db.files, fid);
  const slug = f && f.slug ? f.slug : slugify(f && f.name);
  const path = '/raw/' + (slug ? slug + '-' : '') + fid;
  const base = (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.headers.host + path;
  if (f && !isPub(f)) return base + '?k=' + rawKeyFor(f);
  return base;
}

function rawKeyFor(f) {
  if (!f.rawKey) f.rawKey = id(18);
  return f.rawKey;
}

function isPub(o) {
  if (!o) return true;
  if (o.folder) {
    const fo = ownGet(db.folders, o.folder);
    if (fo) return (fo.visibility || 'public') === 'public';
  }
  return (o.visibility || 'public') === 'public';
}

function fileVis(f) {
  if (f && f.folder) {
    const fo = ownGet(db.folders, f.folder);
    if (fo) return (fo.visibility || 'public') === 'public' ? 'public' : 'private';
  }
  return (f && f.visibility === 'private') ? 'private' : 'public';
}
function folderGuard(f, u) {
  if (!f.folder) return true;
  const fo = db.folders[f.folder];
  if (!fo) return true;
  return fo.owner === u.id || (fo.shares || []).indexOf(u.id) >= 0 || isPub(fo);
}
function canView(f, u) {
  if (f.owner === u.id) return true;
  if ((f.shares || []).indexOf(u.id) >= 0) return true;
  if (!isPub(f)) return false;
  return folderGuard(f, u);
}
function canEdit(f, u) { return f.owner === u.id || (f.shares || []).indexOf(u.id) >= 0; }
function canDelete(f, u) { return f.owner === u.id; }
function userByName(name) {
  const n = String(name || '').toLowerCase();
  for (const u of Object.values(db.users)) if (u.username === n) return u;
  return null;
}
const PREMIUM_FREE_LEVEL = Math.max(1, Math.min(6, Number(process.env.PREMIUM_FREE_LEVEL) || 3));
const PREMIUM_LEVELS = 6;

function isPremium(u) {
  if (!u) return false;
  return Number(u.premiumUntil || 0) > Date.now();
}

function premiumInfo(u) {
  const p = isPremium(u);
  return {
    premium: p,
    premiumUntil: p ? Number(u.premiumUntil) : 0,
    premiumPlan: p ? String(u.premiumPlan || '') : '',
    maxLevel: p ? PREMIUM_LEVELS : PREMIUM_FREE_LEVEL,
    dailyLimit: p ? PREMIUM_DAILY_LIMIT : OBF_DAILY_LIMIT
  };
}

function userPfx(u) {
  if (!u) return '?';
  return {
    id: u.id, username: u.username, nick: u.nick || '', avatar: u.avatar || '',
    premium: isPremium(u)
  };
}
function dispName(u) {
  if (!u) return '?';
  return u.nick || u.username;
}
function folderLastUpdated(fo) {
  let ts = fo.updated || fo.created || 0;
  (fo.files || []).forEach(function (fid) {
    const f = ownGet(db.files, fid);
    if (f && f.updated > ts) ts = f.updated;
  });
  return ts;
}
function favKey(u) { db.favorites[u.id] = db.favorites[u.id] || []; return db.favorites[u.id]; }
function isFav(u, type, fid) {
  return favKey(u).some(function (x) { return x.type === type && x.id === fid; });
}
function removeFileEverywhere(fid) {
  Object.values(db.folders).forEach(function (fo) {
    const i = (fo.files || []).indexOf(fid);
    if (i >= 0) fo.files.splice(i, 1);
  });
  Object.keys(db.favorites).forEach(function (k) {
    db.favorites[k] = db.favorites[k].filter(function (x) { return !(x.type === 'file' && x.id === fid); });
  });
}

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

const captchaStore = new Map();

function pruneCaptchas() {
  const now = Date.now();
  for (const [k, v] of captchaStore) if (v.exp < now) captchaStore.delete(k);
}

app.get('/api/captcha', function (req, res) {
  pruneCaptchas();
  const c = makeCaptcha({ digits: 4 });
  const cid = id(12);
  captchaStore.set(cid, { answer: c.answer, exp: Date.now() + 5 * 60 * 1000 });
  res.setHeader('Cache-Control', 'no-store');
  const out = { id: cid, image: 'data:image/png;base64,' + c.png.toString('base64') };
  if (process.env.CAPTCHA_DEBUG === '1') out.answer = c.answer;
  res.json(out);
});

function makeVerifyCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let body = '';
  for (let i = 0; i < 8; i++) body += A[Math.floor(Math.random() * A.length)];
  return 'HUB-' + body.slice(0, 4) + '-' + body.slice(4);
}

const DISCORD_GUILD = String(process.env.DISCORD_GUILD || '');
const DISCORD_INVITE = String(process.env.DISCORD_INVITE || 'https://discord.gg/WnB2wtHy5');
const BOT_SECRET = String(process.env.BOT_SECRET || '');
const REQUIRE_DISCORD = BOT_SECRET.length > 0;

app.post('/api/signup/begin', limiter, async function (req, res) {
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const captchaId = String(body.captchaId || '');
  const captchaAnswer = String(body.captcha || '').trim();

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-20 characters (a-z, 0-9, _)' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  for (const u of Object.values(db.users)) if (u.username === username) return res.status(409).json({ error: 'Username already taken' });

  const honey = String(body.website || body.hp || '').trim();
  if (honey) return res.status(400).json({ error: 'Request rejected' });
  if (TURNSTILE_ON) {
    const okT = await verifyTurnstile(body.turnstile, realIp(req));
    if (!okT) return res.status(400).json({ error: 'ยืนยันว่าไม่ใช่บอทไม่สำเร็จ ลองใหม่' });
  }

  const cap = captchaStore.get(captchaId);
  if (!cap || cap.exp < Date.now()) return res.status(400).json({ error: 'Captcha expired, reload it' });
  captchaStore.delete(captchaId);
  if (cap.answer !== captchaAnswer) return res.status(400).json({ error: 'Wrong captcha code' });

  const info = recentSignups(req);
  const hardIp = Math.max(SIGNUP_IP_MAX * 5, 25);
  const hardFp = Math.max(SIGNUP_FP_MAX * 5, 15);
  if (info.fromIp >= hardIp) return res.status(429).json({ error: 'This network created too many accounts today. Try again tomorrow.' });
  if (info.fp && info.fromFp >= hardFp) return res.status(429).json({ error: 'This device created too many accounts today. Try again tomorrow.' });

  const token = id(18);
  const code = makeVerifyCode();
  db.pending[token] = {
    token: token, username: username, hash: hash(password), code: code,
    created: Date.now(), verified: false, discordId: '', discordName: '',
    ip: info.ip, fp: info.fp
  };
  save();
  res.status(201).json({
    ok: true,
    token: token,
    code: code,
    discord: DISCORD_INVITE,
    requiresDiscord: REQUIRE_DISCORD,
    expiresIn: 15 * 60
  });
});

app.get('/api/signup/poll', limiter, function (req, res) {
  const token = String(req.query.t || '');
  const p = ownGet(db.pending || {}, token);
  if (!p) return res.status(404).json({ error: 'Pending signup not found' });
  if (Date.now() - p.created > 15 * 60 * 1000) {
    delete db.pending[token];
    save();
    return res.status(410).json({ error: 'Verification expired, start again' });
  }
  if (!p.verified) return res.json({ status: 'pending' });

  let uid = p.uid || null;
  if (!uid || !ownGet(db.users, uid)) {
    for (const k of Object.keys(db.users)) if (db.users[k].username === p.username) uid = k;
  }
  if (!uid) {
    uid = id(10);
    db.users[uid] = {
      id: uid, username: p.username, hash: p.hash, created: Date.now(),
      discordId: p.discordId || '', discordName: p.discordName || ''
    };
    recordSignupDirect(p.ip, p.fp, uid);
    notifyNewAccount({ username: p.username, discordId: p.discordId });
  }
  delete db.pending[token];
  save();
  setSession(res, uid);
  const uu = db.users[uid];
  res.json({ status: 'ok', user: { id: uid, username: uu.username, nick: uu.nick || '', avatar: uu.avatar || '' }, premium: premiumInfo(uu) });
});

const SIGNUP_NOTIFY_CHANNEL = String(process.env.SIGNUP_NOTIFY_CHANNEL || '1569170913281187960');

async function discordSend(channelId, payload) {
  const token = String(process.env.DISCORD_TOKEN || '');
  if (!token || !channelId) return false;
  try {
    const r = await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bot ' + token },
      body: JSON.stringify(payload)
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

function notifyNewAccount(u) {
  discordSend(SIGNUP_NOTIFY_CHANNEL, {
    embeds: [{
      title: '👤 สมัครบัญชีใหม่',
      color: 0x9b59b6,
      description: 'ชื่อผู้ใช้: **' + u.username + '**\n' +
        'Discord: ' + (u.discordId ? '<@' + u.discordId + '>' : 'ไม่ระบุ') + '\n' +
        'เวลา: <t:' + Math.floor(Date.now() / 1000) + ':F>',
      timestamp: new Date().toISOString()
    }]
  }).catch(function () {});
}

function botAuth(req, res) {
  if (!BOT_SECRET) { res.status(503).json({ error: 'Discord verification is not configured' }); return false; }
  const got = String(req.headers['x-bot-secret'] || '');
  const a = Buffer.from(got), b = Buffer.from(BOT_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

app.post('/api/discord/premium', function (req, res) {
  if (!botAuth(req, res)) return;
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const plan = String(body.plan || '1m');
  if (!username) return res.status(400).json({ error: 'username is required' });
  if (plan !== '1m' && plan !== '1y') return res.status(400).json({ error: 'plan must be 1m or 1y' });

  let uid = null;
  for (const k of Object.keys(db.users)) {
    if (db.users[k].username === username) { uid = k; break; }
  }
  if (!uid) return res.status(404).json({ error: 'ไม่พบชื่อผู้ใช้นี้ในเว็บ' });

  const u = db.users[uid];
  const days = plan === '1y' ? 365 : 30;
  const base = Math.max(Number(u.premiumUntil || 0), Date.now());
  u.premiumUntil = base + days * 24 * 60 * 60 * 1000;
  u.premiumPlan = plan;
  u.premiumUpdated = Date.now();
  u.premiumRole = true;
  u.premiumBy = String(body.staffName || body.staffId || '').slice(0, 80);
  u.premiumByDiscord = String(body.staffId || '').slice(0, 40);
  u.premiumGrantedAt = Date.now();
  save();
  res.json({
    ok: true, username: u.username, plan: plan, until: u.premiumUntil,
    discordId: String(u.discordId || ''), premium: isPremium(u), grantedBy: u.premiumBy || ''
  });
});

app.post('/api/discord/premium/status', function (req, res) {
  if (!botAuth(req, res)) return;
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  let uid = null;
  for (const k of Object.keys(db.users)) {
    if (db.users[k].username === username) { uid = k; break; }
  }
  if (!uid) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, username: username, premium: isPremium(db.users[uid]), until: Number(db.users[uid].premiumUntil || 0) });
});

app.get('/api/discord/premium/expiring', function (req, res) {
  if (!botAuth(req, res)) return;
  const now = Date.now();
  const out = [];
  for (const k of Object.keys(db.users)) {
    const u = db.users[k];
    if (!u.premiumRole) continue;
    if (Number(u.premiumUntil || 0) > now) continue;
    out.push({
      username: u.username,
      discordId: String(u.discordId || ''),
      until: Number(u.premiumUntil || 0),
      plan: String(u.premiumPlan || ''),
      grantedBy: String(u.premiumBy || ''),
      grantedById: String(u.premiumByDiscord || ''),
      grantedAt: Number(u.premiumGrantedAt || 0)
    });
    if (out.length >= 200) break;
  }
  res.json({ ok: true, users: out });
});

app.post('/api/discord/premium/cleared', function (req, res) {
  if (!botAuth(req, res)) return;
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  let uid = null;
  for (const k of Object.keys(db.users)) {
    if (db.users[k].username === username) { uid = k; break; }
  }
  if (!uid) return res.status(404).json({ error: 'not found' });
  db.users[uid].premiumRole = false;
  db.users[uid].premiumUntil = 0;
  save();
  res.json({ ok: true });
});

app.post('/api/discord/ai-key', function (req, res) {
  if (!botAuth(req, res)) return;
  const key = String((req.body || {}).key || '').trim();
  if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(key)) return res.status(400).json({ error: 'รูปแบบ API key ไม่ถูกต้อง (ต้องขึ้นต้น sk-)' });
  db.aiKey = key;
  save();
  res.json({ ok: true, masked: key.slice(0, 6) + '...' + key.slice(-4) });
});

app.get('/api/discord/ai-key', function (req, res) {
  if (!botAuth(req, res)) return;
  res.json({ ok: true, set: !!db.aiKey, masked: db.aiKey ? (db.aiKey.slice(0, 6) + '...' + db.aiKey.slice(-4)) : '' });
});

app.get('/api/discord/export', function (req, res) {
  if (!botAuth(req, res)) return;
  const payload = {
    ok: true,
    app: 'sakad-hub',
    version: 1,
    exportedAt: Date.now(),
    data: db
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sakad-hub-backup.json"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
});

app.post('/api/discord/import', function (req, res) {
  if (!botAuth(req, res)) return;
  const body = req.body || {};
  const incoming = body.data && typeof body.data === 'object' ? body.data : null;
  if (!incoming) return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง (ไม่พบ data)' });
  if (!incoming.users || !incoming.files) return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง (ไม่มี users/files)' });
  if (typeof incoming.users !== 'object' || typeof incoming.files !== 'object') {
    return res.status(400).json({ error: 'ไฟล์ไม่ถูกต้อง (รูปแบบผิด)' });
  }
  const backup = DATA_FILE + '.bak-' + Date.now();
  try {
    fs.copyFileSync(DATA_FILE, backup);
  } catch (e) {}
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(incoming));
  fs.renameSync(tmp, DATA_FILE);
  db = load();
  ensureDb();
  save();
  res.json({
    ok: true,
    users: Object.keys(db.users).length,
    files: Object.keys(db.files).length,
    backup: backup,
    exportedAt: Number(body.exportedAt || 0)
  });
});

app.post('/api/discord/verify', function (req, res) {
  if (!BOT_SECRET) return res.status(503).json({ error: 'Discord verification is not configured' });
  const got = String(req.headers['x-bot-secret'] || '');
  const a = Buffer.from(got), b = Buffer.from(BOT_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Forbidden' });

  const body = req.body || {};
  const code = String(body.code || '').trim().toUpperCase();
  const discordId = String(body.discordId || '').trim();
  const discordName = String(body.discordName || '').trim().slice(0, 64);
  const guildId = String(body.guildId || '').trim();
  if (!code || !discordId) return res.status(400).json({ error: 'code and discordId are required' });
  if (DISCORD_GUILD && guildId && guildId !== DISCORD_GUILD) return res.status(403).json({ error: 'Wrong server' });

  db.discordSeen = db.discordSeen || {};
  if (ownGet(db.discordSeen, discordId)) {
    return res.status(409).json({ error: 'Discord นี้เคยยืนยันบัญชีแล้ว (1 บัญชีต่อ 1 Discord)' });
  }

  let found = null, key = null;
  for (const k of Object.keys(db.pending || {})) {
    const p = db.pending[k];
    if (!p.verified && p.code === code) { found = p; key = k; break; }
  }
  if (!found) return res.status(404).json({ error: 'Invalid or already used code' });
  if (Date.now() - found.created > 15 * 60 * 1000) {
    delete db.pending[key];
    save();
    return res.status(410).json({ error: 'Code expired' });
  }
  for (const k of Object.keys(db.pending || {})) {
    const p = db.pending[k];
    if (!p.verified && p.discordId === discordId) { delete db.pending[k]; }
  }
  found.verified = true;
  found.discordId = discordId;
  found.discordName = discordName;
  found.verifiedAt = Date.now();
  db.discordSeen[discordId] = { username: found.username, at: Date.now() };

  let already = null;
  for (const k of Object.keys(db.users)) if (db.users[k].username === found.username) already = k;
  if (already) {
    found.uid = already;
    db.users[already].discordId = discordId;
  } else {
    const uidNew = id(10);
    db.users[uidNew] = {
      id: uidNew, username: found.username, hash: found.hash, created: Date.now(),
      discordId: discordId, discordName: discordName || ''
    };
    recordSignupDirect(found.ip, found.fp, uidNew);
    found.uid = uidNew;
    notifyNewAccount({ username: found.username, discordId: discordId });
  }
  save();
  res.json({ ok: true, username: found.username, created: !already });
});

app.post('/api/signup', limiter, function (req, res) {
  if (REQUIRE_DISCORD) {
    return res.status(400).json({ error: 'Use /api/signup/begin with captcha and Discord verification' });
  }
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-20 characters (a-z, 0-9, _)' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  for (const u of Object.values(db.users)) if (u.username === username) return res.status(409).json({ error: 'Username already taken' });

  const cap = captchaStore.get(String(body.captchaId || ''));
  if (!cap || cap.exp < Date.now()) return res.status(400).json({ error: 'Captcha expired, reload it' });
  captchaStore.delete(String(body.captchaId || ''));
  if (cap.answer !== String(body.captcha || '').trim()) return res.status(400).json({ error: 'Wrong captcha code' });

  const info = recentSignups(req);
  if (info.fromIp >= SIGNUP_IP_MAX) return res.status(429).json({ error: 'This network already created too many accounts today. Try again tomorrow.' });
  if (info.fp && info.fromFp >= SIGNUP_FP_MAX) return res.status(429).json({ error: 'This device already created too many accounts today. Try again tomorrow.' });
  const uid = id(10);
  db.users[uid] = { id: uid, username: username, hash: hash(password), created: Date.now() };
  recordSignup(req, uid);
  save();
  setSession(res, uid);
  res.status(201).json({ ok: true, user: { id: uid, username: username, nick: '', avatar: '' } });
});

const loginFails = new Map();
const LOGIN_MAX = Math.max(3, Number(process.env.LOGIN_MAX_FAILS) || 10);
const LOGIN_WINDOW = 15 * 60 * 1000;

function loginBlocked(key) {
  const rec = loginFails.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > LOGIN_WINDOW) { loginFails.delete(key); return false; }
  return rec.n >= LOGIN_MAX;
}
function loginFail(key) {
  const rec = loginFails.get(key);
  if (!rec || Date.now() - rec.first > LOGIN_WINDOW) loginFails.set(key, { n: 1, first: Date.now() });
  else rec.n++;
  if (loginFails.size > 5000) loginFails.clear();
}

app.post('/api/login', limiter, function (req, res) {
  const username = String((req.body || {}).username || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const lkey = username + '|' + realIp(req);
  if (loginBlocked(lkey)) return res.status(429).json({ error: 'ลองผิดหลายครั้งเกินไป รอ 15 นาทีแล้วลองใหม่' });
  let found = null;
  for (const u of Object.values(db.users)) if (u.username === username) found = u;
  if (!found || !verify(password, found.hash)) {
    loginFail(lkey);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  loginFails.delete(lkey);
  const ipNow = realIp(req);
  if (found.lastIp && found.lastIp !== ipNow) {
    discordSend(SIGNUP_NOTIFY_CHANNEL, {
      embeds: [{
        title: '🔐 เข้าสู่ระบบจากอุปกรณ์/IP ใหม่',
        color: 0xf1c40f,
        description: 'บัญชี: **' + found.username + '**\nIP ใหม่: `' + ipNow + '`\nIP เดิม: `' + found.lastIp + '`\nเวลา: <t:' + Math.floor(Date.now() / 1000) + ':F>'
      }]
    }).catch(function () {});
  }
  found.lastIp = ipNow;
  save();
  setSession(res, found.id);
  res.json({ ok: true, user: { id: found.id, username: found.username, nick: found.nick || '', avatar: found.avatar || '' } });
});

app.post('/api/logout', function (req, res) {
  res.setHeader('Set-Cookie', 'token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

const AI_MONTH_TOKENS = Number(process.env.AI_MONTH_TOKENS) || 250000;
const AI_MODELS = ['deepseek-chat', 'deepseek-reasoner'];

const AI_SYSTEM = [
  'You are a senior engineer assisting with a Roblox script hosting site.',
  'Answer in Thai unless the user writes English.',
  'When the user asks to fix or change code: analyse the whole file, then output ONLY the minimal changed lines or a small diff block, never the whole file again, to save tokens.',
  'Be direct, no filler, no disclaimers. If unsure about an API, say so instead of guessing.',
  'Code must be runnable Lua/Luau for Roblox. Keep answers compact.'
].join(' ');

function aiMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function aiQuota(uid) {
  db.aiUse = db.aiUse || {};
  const m = aiMonth();
  const rec = ownGet(db.aiUse, uid);
  if (!rec || rec.month !== m) return { month: m, used: 0, left: AI_MONTH_TOKENS };
  return { month: m, used: rec.tokens, left: Math.max(0, AI_MONTH_TOKENS - rec.tokens) };
}

function aiAdd(uid, tokens) {
  db.aiUse = db.aiUse || {};
  const m = aiMonth();
  const rec = ownGet(db.aiUse, uid);
  if (!rec || rec.month !== m) db.aiUse[uid] = { month: m, tokens: tokens };
  else db.aiUse[uid] = { month: m, tokens: rec.tokens + tokens };
  save();
}

app.get('/api/ai/status', auth, function (req, res) {
  const u = ownGet(db.users, req.user.id);
  const q = aiQuota(req.user.id);
  res.json({
    enabled: !!db.aiKey,
    premium: isPremium(u),
    models: AI_MODELS,
    used: q.used, left: q.left, limit: AI_MONTH_TOKENS, month: q.month
  });
});

app.post('/api/ai/chat', auth, async function (req, res) {
  const u = ownGet(db.users, req.user.id);
  if (!isPremium(u)) return res.status(403).json({ error: 'AI ใช้ได้เฉพาะพรีเมี่ยม' });
  if (!db.aiKey) return res.status(503).json({ error: 'ยังไม่ได้ติดตั้ง API key (ใช้ !APIAI ใน Discord)' });
  const q = aiQuota(req.user.id);
  if (q.left <= 0) return res.status(429).json({ error: 'โควต้า AI หมดแล้ว (250k token/เดือน)', left: 0 });

  const body = req.body || {};
  const model = AI_MODELS.indexOf(String(body.model)) >= 0 ? String(body.model) : AI_MODELS[0];
  const history = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const ctx = String(body.context || '').slice(0, 60000);

  const msgs = [{ role: 'system', content: AI_SYSTEM }];
  if (ctx) msgs.push({ role: 'system', content: 'ไฟล์/โฟลเดอร์ที่แนบมา:\n' + ctx });
  for (const m of history) {
    const role = m && m.role === 'assistant' ? 'assistant' : 'user';
    const content = String((m && m.content) || '').slice(0, 20000);
    if (content) msgs.push({ role: role, content: content });
  }
  if (msgs.length < 2) return res.status(400).json({ error: 'ไม่มีข้อความ' });

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + db.aiKey },
      body: JSON.stringify({ model: model, messages: msgs, temperature: 0.3, max_tokens: 2048, stream: false })
    });
    const d = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      const msg = (d && d.error && d.error.message) || ('HTTP ' + r.status);
      return res.status(502).json({ error: 'DeepSeek: ' + msg });
    }
    const out = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    const used = Number(d.usage && d.usage.total_tokens) || 0;
    if (used) aiAdd(req.user.id, used);
    const after = aiQuota(req.user.id);
    res.json({ ok: true, reply: out, tokens: used, left: after.left, limit: after.limit });
  } catch (e) {
    res.status(502).json({ error: 'เชื่อมต่อ DeepSeek ไม่ได้: ' + e.message });
  }
});

app.get('/api/stats', auth, function (req, res) {
  const users = Object.keys(db.users || {}).length;
  const files = Object.keys(db.files || {}).length;
  const folders = Object.keys(db.folders || {}).length;
  const publicFiles = Object.values(db.files || {}).filter(function (f) { return isPub(f); }).length;
  res.json({ users: users, files: files, folders: folders, publicFiles: publicFiles });
});

app.get('/api/me', function (req, res) {
  const u = userFromReq(req);
  if (!u) return res.json({ user: null, premium: null });
  res.json({ user: u, premium: premiumInfo(ownGet(db.users, u.id)) });
});

app.put('/api/profile', auth, function (req, res) {
  const u = ownGet(db.users, req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const body = req.body || {};
  if (body.nick !== undefined) {
    const n = String(body.nick).trim();
    if (n.length > 32) return res.status(400).json({ error: 'Nickname too long (max 32)' });
    u.nick = n;
  }
  if (body.avatar !== undefined) {
    const a = String(body.avatar).trim();
    if (a.length > 400000) return res.status(413).json({ error: 'Image too large (max 300 KB)' });
    if (a) {
      const bad = checkImageData(a);
      if (bad) return res.status(400).json({ error: bad });
    }
    u.avatar = a;
  }
  save();
  res.json({ ok: true, user: { id: u.id, username: u.username, nick: u.nick || '', avatar: u.avatar || '' } });
});

const IMG_MAGIC = {
  png: [0x89, 0x50, 0x4E, 0x47],
  jpg: [0xFF, 0xD8, 0xFF],
  gif: [0x47, 0x49, 0x46, 0x38],
  webp: [0x52, 0x49, 0x46, 0x46]
};

function checkImageData(dataUrl) {
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return 'Only PNG, JPEG, GIF or WebP are allowed';
  const kind = m[1] === 'jpg' || m[1] === 'jpeg' ? 'jpg' : m[1];
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return 'Invalid image data'; }
  if (buf.length < 12) return 'Image is corrupted';
  if (buf.length > 300 * 1024) return 'Image too large (max 300 KB)';
  const magic = IMG_MAGIC[kind];
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return 'File content does not match its type';
  }
  const head = buf.slice(0, 512).toString('latin1').toLowerCase();
  if (head.indexOf('<script') >= 0 || head.indexOf('<svg') >= 0 || head.indexOf('javascript:') >= 0) {
    return 'Suspicious image content rejected';
  }
  if (kind === 'webp') {
    if (buf.slice(8, 12).toString('ascii') !== 'WEBP') return 'Bad WebP header';
  }
  if (kind === 'gif') {
    const tail = buf.slice(Math.max(0, buf.length - 4096)).toString('latin1').toLowerCase();
    if (tail.indexOf('<script') >= 0) return 'Suspicious GIF content rejected';
  }
  return null;
}

function baseUrl(req) {
  return (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.headers.host;
}

app.get('/api/vault/:id', limiter, function (req, res) {
  const v = ownGet(db.vaults || {}, req.params.id);
  if (!v) return res.status(404).send('');
  if (String(req.query.k || '') !== v.token) return res.status(403).send('');
  if (Date.now() > v.expires) return res.status(410).send('');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  v.hits = (v.hits || 0) + 1;
  res.send(v.data);
});

function obfDayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function obfQuota(uid) {
  db.obfUse = db.obfUse || {};
  const today = obfDayKey();
  const limit = isPremium(ownGet(db.users, uid)) ? PREMIUM_DAILY_LIMIT : OBF_DAILY_LIMIT;
  const rec = ownGet(db.obfUse, uid);
  if (!rec || rec.day !== today) return { day: today, used: 0, left: limit, limit: limit };
  return { day: today, used: rec.n, left: Math.max(0, limit - rec.n), limit: limit };
}

function obfConsume(uid) {
  db.obfUse = db.obfUse || {};
  const today = obfDayKey();
  const rec = ownGet(db.obfUse, uid);
  if (!rec || rec.day !== today) db.obfUse[uid] = { day: today, n: 1 };
  else db.obfUse[uid] = { day: today, n: rec.n + 1 };
  save();
}

app.get('/api/obf/usage', auth, function (req, res) {
  const q = obfQuota(req.user.id);
  const u = ownGet(db.users, req.user.id);
  res.json({ used: q.used, left: q.left, limit: q.limit, day: q.day, premium: isPremium(u), maxLevel: isPremium(u) ? PREMIUM_LEVELS : PREMIUM_FREE_LEVEL });
});

app.post('/api/obfuscate', auth, function (req, res) {
  const body = req.body || {};
  const code = String(body.code == null ? '' : body.code);
  const fileName = String(body.name || '').trim();
  if (!code.trim()) return res.status(400).json({ error: 'Code is empty' });
  if (code.length > MAX_INPUT) return res.status(413).json({ error: 'Code too large (max 2 MB input)' });
  const me = ownGet(db.users, req.user.id);
  const prem = isPremium(me);
  const quota = obfQuota(req.user.id);
  if (quota.left <= 0) {
    return res.status(429).json({
      error: 'Daily limit reached (' + quota.limit + ' per day). Try again tomorrow.',
      left: 0, limit: quota.limit, premium: prem
    });
  }
  const level = Math.max(1, Math.min(6, Number(body.level) || 3));
  if (level > PREMIUM_FREE_LEVEL && !prem) {
    return res.status(403).json({
      error: 'ระดับ ' + level + ' ต้องใช้พรีเมียม (ฟรีใช้ได้ถึงระดับ ' + PREMIUM_FREE_LEVEL + ')',
      premiumRequired: true, maxLevel: PREMIUM_FREE_LEVEL, left: quota.left
    });
  }
  const remote = body.remote === true;
  let keyPair = null;
  let vaultId = null;
  let vaultToken = null;
  let vaultUrl = null;
  if (remote) {
    keyPair = { k1: 1 + Math.floor(Math.random() * 200), k2: Math.floor(Math.random() * 250) };
    vaultId = id(10);
    vaultToken = id(16).replace(/[^A-Za-z0-9]/g, '').slice(0, 22) || id(8);
    vaultUrl = baseUrl(req) + '/api/vault/' + vaultId + '?k=' + encodeURIComponent(vaultToken);
  }
  let out;
  try {
    out = luaObfuscate(code, {
      seed: Math.floor(Math.random() * 2147483646) + 1,
      level: level,
      remote: remote,
      remoteKey: keyPair,
      remoteUrl: vaultUrl
    });
  } catch (e) {
    return res.status(500).json({ error: 'Obfuscation failed: ' + e.message });
  }

  let finalCode = out.code;
  if (remote && out.vault && out.vault.length) {
    const token = vaultToken;
    const bytes = [];
    out.vault.forEach(function (str) {
      const len = str.length;
      bytes.push((len >> 8) & 255, len & 255);
      for (let i = 0; i < len; i++) bytes.push(str.charCodeAt(i) & 255);
    });
    const k1 = keyPair.k1, k2 = keyPair.k2;
    const enc = bytes.map(function (b, i) { return (b + (((i + 1) * k1 + k2) % 256)) % 256; });
    if (enc.length % 2) enc.push(0);
    const A = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let blob = '';
    for (let i = 0; i < enc.length; i += 2) {
      const v = enc[i] * 256 + enc[i + 1];
      blob += A[Math.floor(v / 3844)] + A[Math.floor((v % 3844) / 62)] + A[v % 62];
    }
    db.vaults = db.vaults || {};
    db.vaults[vaultId] = {
      id: vaultId, owner: req.user.id, token: token, data: blob,
      created: Date.now(), expires: Date.now() + 365 * 24 * 3600 * 1000, hits: 0
    };
    save();
  }

  obfConsume(req.user.id);
  const after = obfQuota(req.user.id);
  const obfLim = prem ? MAX_CODE_PREMIUM : MAX_CODE;
  if (finalCode.length > obfLim) {
    return res.status(413).json({ error: 'ผลลัพธ์เกิน ' + Math.floor(obfLim / 1048576) + ' MB — ลดระดับความยากลง', left: after.left });
  }
  const result = { ok: true, code: finalCode, stats: out.stats, level: level, remote: remote, left: after.left, limit: after.limit, premium: prem };
  if (body.save === true) {
    if (!fileName) return res.status(400).json({ error: 'File name is required to save' });
    if (fileName.length > MAX_NAME) return res.status(400).json({ error: 'File name too long' });
    const fid = id(8);
    const now = Date.now();
    const folder = body.folder && ownGet(db.folders, String(body.folder)) ? String(body.folder) : null;
    const vis = body.visibility === 'private' ? 'private' : 'public';
    const f = {
      id: fid, owner: req.user.id, name: fileName, code: finalCode,
      created: now, updated: now, shares: [], invites: [],
      history: [{ ts: now, charsAdded: finalCode.length, charsRemoved: 0, linesAdded: finalCode.split('\n').length, linesRemoved: 0, total: finalCode.length }],
      folder: folder, visibility: vis
    };
    if (folder) {
      const fo = ownGet(db.folders, folder);
      if (fo.owner === req.user.id) { fo.files = fo.files || []; if (fo.files.indexOf(fid) < 0) fo.files.push(fid); fo.updated = now; }
      else f.folder = null;
    }
    db.files[fid] = f;
    save();
    result.saved = { id: fid, name: fileName, rawUrl: rawUrl(req, fid) };
  }
  res.json(result);
});

app.get('/api/files', auth, function (req, res) {
  const u = req.user;
  const list = Object.values(db.files)
    .filter(function (f) { return f.owner === u.id || (f.shares || []).indexOf(u.id) >= 0; })
    .map(function (f) {
      const owner = ownGet(db.users, f.owner);
      return {
        id: f.id, name: f.name, created: f.created, updated: f.updated,
        rawUrl: rawUrl(req, f.id),
        role: f.owner === u.id ? 'owner' : 'editor',
        ownerName: dispName(owner),
        folder: f.folder || null,
        visibility: fileVis(f),
        fav: isFav(u, 'file', f.id)
      };
    })
    .sort(function (a, b) { return b.updated - a.updated; });
  res.json({ files: list });
});

function badText(t) {
  if (t.indexOf('\u0000') >= 0) return true;
  let ctrl = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return ctrl > Math.max(8, t.length * 0.02);
}

app.post('/api/files', auth, function (req, res) {
  const name = String((req.body || {}).name || '').trim();
  const code = String((req.body || {}).code || '');
  const lim = isPremium(ownGet(db.users, req.user.id)) ? MAX_CODE_PREMIUM : MAX_CODE;
  if (!name) return res.status(400).json({ error: 'File name is required' });
  if (badText(code)) return res.status(400).json({ error: 'File looks binary, only text scripts are allowed' });
  if (name.length > MAX_NAME) return res.status(400).json({ error: 'File name too long' });
  if (code.length > lim) return res.status(413).json({ error: 'ไฟล์ใหญ่เกิน ' + Math.floor(lim / 1048576) + ' MB' + (isPremium(ownGet(db.users, req.user.id)) ? '' : ' (พรีเมียมได้ถึง 20 MB)') });
  const fid = id(8);
  const now = Date.now();
  const folderRaw = String((req.body || {}).folder || '');
  const folderObj = folderRaw ? ownGet(db.folders, folderRaw) : null;
  if (!folderObj || folderObj.owner !== req.user.id) {
    return res.status(400).json({ error: 'ต้องเลือกโฟลเดอร์ก่อนสร้างไฟล์' });
  }
  const folder = folderRaw;
  const vis = 'public';
  const f = { id: fid, owner: req.user.id, name: name, slug: slugify(name), code: code,
    lockPage: req.body.lockPage !== false, deliver: (req.body.deliver === 'ready' ? 'ready' : 'raw'),
    created: now, updated: now, shares: [], invites: [], history: [], folder: folder, visibility: vis, rawKey: id(18) };
  if (folder) {
    const fo = db.folders[folder];
    if (fo.owner === req.user.id) { fo.files = fo.files || []; if (fo.files.indexOf(fid) < 0) fo.files.push(fid); fo.updated = now; }
    else f.folder = null;
  }
  pushHistory(f, { charsAdded: code.length, charsRemoved: 0, linesAdded: code ? code.split('\n').length : 0, linesRemoved: 0, total: code.length });
  db.files[fid] = f;
  save();
  res.status(201).json({ id: fid, name: name, rawUrl: rawUrl(req, fid) });
});

app.get('/api/files/:id', auth, badKey, function (req, res) {
  const f = ownGet(db.files, req.params.id);
  if (!f || !canView(f, req.user)) return res.status(404).json({ error: 'File not found' });
  res.json({ id: f.id, name: f.name, code: f.code, role: canDelete(f, req.user) ? 'owner' : 'editor', folder: f.folder || null, visibility: fileVis(f), ownerName: dispName(db.users[f.owner]), fav: isFav(req.user, 'file', f.id) });
});

app.put('/api/files/:id', auth, badKey, function (req, res) {
  const f = ownGet(db.files, req.params.id);
  if (!f || !canEdit(f, req.user)) return res.status(404).json({ error: 'File not found' });
  const body = req.body || {};
  const name = f.name;
  const code = body.code !== undefined ? String(body.code) : f.code;
  if (!name) return res.status(400).json({ error: 'File name is required' });
  if (name.length > MAX_NAME) return res.status(400).json({ error: 'File name too long' });
  const uLim = isPremium(ownGet(db.users, req.user.id)) ? MAX_CODE_PREMIUM : MAX_CODE;
  if (code.length > uLim) return res.status(413).json({ error: 'ไฟล์ใหญ่เกิน ' + Math.floor(uLim / 1048576) + ' MB' });
  if (body.code !== undefined && badText(code)) return res.status(400).json({ error: 'File looks binary, only text scripts are allowed' });
  if (body.code !== undefined) pushHistory(f, diffStat(f.code, code));
  f.code = code;
  if (!f.slug) f.slug = slugify(f.name);
  f.updated = Date.now();
  if (canDelete(f, req.user)) {
    if (req.body.folder !== undefined) {
      const nfRaw = String(req.body.folder || '');
      const nfObj = nfRaw ? ownGet(db.folders, nfRaw) : null;
      const nf = (nfObj && nfObj.owner === req.user.id) ? nfRaw : null;
      Object.values(db.folders).forEach(function (fo) {
        const i = (fo.files || []).indexOf(f.id);
        if (i >= 0) fo.files.splice(i, 1);
      });
      f.folder = null;
      if (nf && db.folders[nf].owner === req.user.id) {
        db.folders[nf].files = db.folders[nf].files || [];
        if (db.folders[nf].files.indexOf(f.id) < 0) db.folders[nf].files.push(f.id);
        db.folders[nf].updated = Date.now();
        f.folder = nf;
      }
    }
  }
  save();
  res.json({ ok: true, id: f.id, rawUrl: rawUrl(req, f.id) });
});

app.delete('/api/files/:id', auth, badKey, function (req, res) {
  const f = ownGet(db.files, req.params.id);
  if (!f || !canDelete(f, req.user)) return res.status(404).json({ error: 'File not found' });
  delete db.files[f.id];
  removeFileEverywhere(f.id);
  save();
  res.json({ ok: true });
});

app.get('/api/files/:id/history', auth, badKey, function (req, res) {
  const f = ownGet(db.files, req.params.id);
  if (!f || !canView(f, req.user)) return res.status(404).json({ error: 'File not found' });
  res.json({ history: f.history || [], name: f.name });
});

app.post('/api/files/:id/invite', auth, badKey, function (req, res) {
  const f = ownGet(db.files, req.params.id);
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
      const owner = ownGet(db.users, f.owner);
      out.push({ fileId: f.id, name: f.name, ownerName: dispName(owner) });
    }
  });
  res.json({ invites: out });
});

app.post('/api/invites/:fileId/accept', auth, badKey, function (req, res) {
  const f = ownGet(db.files, req.params.fileId);
  if (!f) return res.status(404).json({ error: 'File not found' });
  const i = (f.invites || []).indexOf(req.user.id);
  if (i < 0) return res.status(404).json({ error: 'Invite not found' });
  f.invites.splice(i, 1);
  f.shares = f.shares || [];
  if (f.shares.indexOf(req.user.id) < 0) f.shares.push(req.user.id);
  save();
  res.json({ ok: true });
});

app.post('/api/invites/:fileId/decline', auth, badKey, function (req, res) {
  const f = ownGet(db.files, req.params.fileId);
  if (!f) return res.status(404).json({ error: 'File not found' });
  const i = (f.invites || []).indexOf(req.user.id);
  if (i >= 0) { f.invites.splice(i, 1); save(); }
  res.json({ ok: true });
});

const MAX_FOLDER = 64;

function folderView(fo, req, u) {
  const owner = db.users[fo.owner];
  const ids = (fo.files || []).filter(function (fid) {
    const f = ownGet(db.files, fid);
    return f && canView(f, u);
  });
  const files = ids.map(function (fid) {
    const f = ownGet(db.files, fid);
    return { id: f.id, name: f.name, updated: f.updated, visibility: fileVis(f), folder: f.folder || null, ownerName: dispName(db.users[f.owner]), rawUrl: rawUrl(req, f.id), fav: isFav(u, 'file', f.id) };
  }).sort(function (a, b) { return b.updated - a.updated; });
  let last = fo.updated || fo.created || 0;
  ids.forEach(function (fid) { if (ownGet(db.files, fid).updated > last) last = ownGet(db.files, fid).updated; });
  return {
    id: fo.id, name: fo.name, created: fo.created, updated: last,
    visibility: fo.visibility || 'public',
    desc: fo.desc || '',
    avatar: fo.avatar || '',
    ownerName: dispName(owner),
    role: fo.owner === u.id ? 'owner' : 'viewer',
    count: ids.length,
    files: files,
    fav: isFav(u, 'folder', fo.id)
  };
}

function canViewFolder(fo, u) { return fo.owner === u.id || (fo.shares || []).indexOf(u.id) >= 0 || isPub(fo); }

app.get('/api/folders', auth, function (req, res) {
  const u = req.user;
  const list = Object.values(db.folders)
    .filter(function (fo) { return fo.owner === u.id || (fo.shares || []).indexOf(u.id) >= 0; })
    .map(function (fo) { return folderView(fo, req, u); })
    .sort(function (a, b) { return b.updated - a.updated; });
  res.json({ folders: list });
});

app.post('/api/folders', auth, function (req, res) {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'Folder name is required' });
  if (name.length > MAX_FOLDER) return res.status(400).json({ error: 'Folder name too long' });
  const now = Date.now();
  const fo = {
    id: id(8), owner: req.user.id, name: name, created: now, updated: now,
    files: [], shares: [], visibility: req.body.visibility === 'private' ? 'private' : 'public', desc: String(req.body.desc || '').slice(0, 300), avatar: String(req.body.avatar || '').slice(0, 400000)
  };
  if (Array.isArray(req.body.files)) {
    req.body.files.forEach(function (fid) {
      const f = ownGet(db.files, String(fid));
      if (f && f.owner === req.user.id && fo.files.indexOf(f.id) < 0) { fo.files.push(f.id); f.folder = fo.id; }
    });
  }
  db.folders[fo.id] = fo;
  save();
  res.status(201).json({ ok: true, id: fo.id, folder: folderView(fo, req, req.user) });
});

app.get('/api/folders/:id', auth, badKey, function (req, res) {
  const fo = ownGet(db.folders, req.params.id);
  if (!fo || !canViewFolder(fo, req.user)) return res.status(404).json({ error: 'Folder not found' });
  res.json({ folder: folderView(fo, req, req.user) });
});

app.put('/api/folders/:id', auth, badKey, function (req, res) {
  const fo = ownGet(db.folders, req.params.id);
  if (!fo || !canDelete(fo, req.user)) return res.status(404).json({ error: 'Folder not found' });
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    if (name.length > MAX_FOLDER) return res.status(400).json({ error: 'Folder name too long' });
    fo.name = name;
  }
  if (req.body.visibility === 'private' || req.body.visibility === 'public') fo.visibility = req.body.visibility;
  if (req.body.desc !== undefined) fo.desc = String(req.body.desc).slice(0, 300);
  if (req.body.avatar !== undefined) {
    const a = String(req.body.avatar).trim();
    if (a) { const bad = checkImageData(a); if (bad) return res.status(400).json({ error: bad }); }
    fo.avatar = a.slice(0, 400000);
  }
  if (Array.isArray(req.body.add)) {
    req.body.add.forEach(function (fid) {
      const f = ownGet(db.files, String(fid));
      if (f && f.owner === req.user.id && fo.files.indexOf(f.id) < 0) { fo.files.push(f.id); f.folder = fo.id; }
    });
  }
  if (Array.isArray(req.body.remove)) {
    req.body.remove.forEach(function (fid) {
      const i = fo.files.indexOf(String(fid));
      if (i >= 0) { fo.files.splice(i, 1); const f = ownGet(db.files, String(fid)); if (f && f.folder === fo.id) f.folder = null; }
    });
  }
  if (Array.isArray(req.body.files)) {
    fo.files.forEach(function (fid) { const f = ownGet(db.files, fid); if (f && f.folder === fo.id) f.folder = null; });
    fo.files = [];
    req.body.files.forEach(function (fid) {
      const f = ownGet(db.files, String(fid));
      if (f && f.owner === req.user.id && fo.files.indexOf(f.id) < 0) { fo.files.push(f.id); f.folder = fo.id; }
    });
  }
  fo.updated = Date.now();
  save();
  res.json({ ok: true, folder: folderView(fo, req, req.user) });
});

app.delete('/api/folders/:id', auth, badKey, function (req, res) {
  const fo = ownGet(db.folders, req.params.id);
  if (!fo || !canDelete(fo, req.user)) return res.status(404).json({ error: 'Folder not found' });
  (fo.files || []).forEach(function (fid) { const f = ownGet(db.files, fid); if (f && f.folder === fo.id) f.folder = null; });
  delete db.folders[fo.id];
  Object.keys(db.favorites).forEach(function (k) {
    db.favorites[k] = db.favorites[k].filter(function (x) { return !(x.type === 'folder' && x.id === fo.id); });
  });
  save();
  res.json({ ok: true });
});

app.get('/api/search', auth, function (req, res) {
  const u = req.user;
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ users: [], files: [], folders: [] });
  const users = Object.values(db.users)
    .filter(function (x) { return x.id !== u.id && (x.username.indexOf(q) >= 0 || String(x.nick || '').toLowerCase().indexOf(q) >= 0); })
    .slice(0, 20)
    .map(function (x) {
      const fol = db.follows[u.id] || [];
      return { id: x.id, username: x.username, nick: x.nick || '', avatar: x.avatar || '', following: fol.indexOf(x.id) >= 0 };
    });
  const files = Object.values(db.files)
    .filter(function (f) { return f.name.toLowerCase().indexOf(q) >= 0 && canView(f, u); })
    .slice(0, 40)
    .map(function (f) {
      return {
        id: f.id, name: f.name, updated: f.updated, visibility: fileVis(f),
        ownerName: dispName(db.users[f.owner]),
        rawUrl: rawUrl(req, f.id), fav: isFav(u, 'file', f.id),
        role: canDelete(f, u) ? 'owner' : ((f.shares || []).indexOf(u.id) >= 0 ? 'editor' : 'viewer'),
        folder: f.folder || null
      };
    });
  const folders = Object.values(db.folders)
    .filter(function (fo) { return fo.name.toLowerCase().indexOf(q) >= 0 && canViewFolder(fo, u); })
    .slice(0, 20)
    .map(function (fo) { return folderView(fo, req, u); });
  res.json({ users: users, files: files, folders: folders });
});

app.get('/api/users/:username', auth, function (req, res) {
  const u = req.user;
  const target = userByName(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const fol = db.follows[u.id] || [];
  const targetFol = db.follows[target.id] || [];
  const followers = Object.keys(db.follows).filter(function (k) { return (db.follows[k] || []).indexOf(target.id) >= 0; });
  const files = Object.values(db.files)
    .filter(function (f) { return f.owner === target.id && canView(f, u); })
    .map(function (f) {
      return {
        id: f.id, name: f.name, updated: f.updated, visibility: fileVis(f),
        ownerName: dispName(target), rawUrl: rawUrl(req, f.id), fav: isFav(u, 'file', f.id),
        role: canDelete(f, u) ? 'owner' : ((f.shares || []).indexOf(u.id) >= 0 ? 'editor' : 'viewer'),
        folder: f.folder || null
      };
    })
    .sort(function (a, b) { return b.updated - a.updated; });
  const folders = Object.values(db.folders)
    .filter(function (fo) { return fo.owner === target.id && canViewFolder(fo, u); })
    .map(function (fo) { return folderView(fo, req, u); })
    .sort(function (a, b) { return b.updated - a.updated; });
  res.json({
    user: { id: target.id, username: target.username, nick: target.nick || '', avatar: target.avatar || '', created: target.created },
    following: fol.indexOf(target.id) >= 0,
    isSelf: target.id === u.id,
    premium: isPremium(target),
    followers: followers.length,
    followingCount: targetFol.length,
    files: files, folders: folders
  });
});

app.post('/api/follow/:uid', auth, badKey, function (req, res) {
  const target = ownGet(db.users, req.params.uid);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'That is you' });
  db.follows[req.user.id] = db.follows[req.user.id] || [];
  if (db.follows[req.user.id].indexOf(target.id) < 0) db.follows[req.user.id].push(target.id);
  save();
  res.json({ ok: true, following: true });
});

app.delete('/api/follow/:uid', auth, badKey, function (req, res) {
  db.follows[req.user.id] = (db.follows[req.user.id] || []).filter(function (x) { return x !== req.params.uid; });
  save();
  res.json({ ok: true, following: false });
});

app.get('/api/following', auth, function (req, res) {
  const ids = db.follows[req.user.id] || [];
  const list = ids.map(function (x) { return db.users[x]; }).filter(Boolean).map(function (x) {
    return { id: x.id, username: x.username, nick: x.nick || '', avatar: x.avatar || '' };
  });
  res.json({ following: list });
});

app.get('/api/favorites', auth, function (req, res) {
  const u = req.user;
  const out = { files: [], folders: [] };
  favKey(u).forEach(function (x) {
    if (x.type === 'file') {
      const f = ownGet(db.files, x.id);
      if (f && canView(f, u)) out.files.push({
        id: f.id, name: f.name, updated: f.updated, visibility: fileVis(f),
        ownerName: dispName(db.users[f.owner]), rawUrl: rawUrl(req, f.id),
        fav: true, role: canDelete(f, u) ? 'owner' : 'editor'
      });
    } else if (x.type === 'folder') {
      const fo = ownGet(db.folders, x.id);
      if (fo && canViewFolder(fo, u)) out.folders.push(folderView(fo, req, u));
    }
  });
  out.files.sort(function (a, b) { return b.updated - a.updated; });
  out.folders.sort(function (a, b) { return b.updated - a.updated; });
  res.json(out);
});

app.post('/api/favorites', auth, function (req, res) {
  const type = req.body.type === 'folder' ? 'folder' : (req.body.type === 'file' ? 'file' : null);
  const fid = String(req.body.id || '');
  if (!type || !fid) return res.status(400).json({ error: 'type and id are required' });
  if (type === 'file') {
    const f = ownGet(db.files, fid);
    if (!f || !canView(f, req.user)) return res.status(404).json({ error: 'File not found' });
  } else {
    const fo = ownGet(db.folders, fid);
    if (!fo || !canViewFolder(fo, req.user)) return res.status(404).json({ error: 'Folder not found' });
  }
  const arr = favKey(req.user);
  const idx = arr.findIndex(function (x) { return x.type === type && x.id === fid; });
  let fav;
  if (idx >= 0) { arr.splice(idx, 1); fav = false; }
  else { arr.push({ type: type, id: fid, ts: Date.now() }); fav = true; }
  save();
  res.json({ ok: true, fav: fav });
});

app.get('/raw/:id', function (req, res) {
  const raw = String(req.params.id || '');
  let fid = raw;
  if (!ownGet(db.files, raw)) {
    for (let cut = raw.lastIndexOf('-'); cut >= 0; cut = raw.lastIndexOf('-', cut - 1)) {
      const cand = raw.slice(cut + 1);
      if (cand && ownGet(db.files, cand)) { fid = cand; break; }
    }
  }
  const f = ownGet(db.files, fid);
  if (!f) return res.status(404).send('Not found');
  if (!isPub(f)) {
    const key = String(req.query.k || '');
    let allowed = !!key && !!f.rawKey && key === f.rawKey;
    if (!allowed) {
      const who = userFromReq(req);
      if (who && canView(f, who)) allowed = true;
    }
    if (!allowed) return res.status(404).send('Not found');
  }
  const accept = String(req.headers.accept || '').toLowerCase();
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const isBrowser = f.lockPage !== false && accept.includes('text/html') && !ua.includes('roblox') && !ua.includes('httpget') && !ua.includes('wininet') && req.query.raw !== '1';
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

const PREMIUM_INVITE = String(process.env.PREMIUM_INVITE_URL || 'https://discord.gg/VwzEtWtd6B');
const UPDATE_NOTIFY_CHANNEL = String(process.env.UPDATE_NOTIFY_CHANNEL || '1569655232923832330');
const UPDATE_IMAGE_URL = String(process.env.UPDATE_IMAGE_URL || 'https://raw.githubusercontent.com/serveraiexahub-alt/system/main/assets/update.jpg');
const TURNSTILE_SITE = String(process.env.TURNSTILE_SITE_KEY || '');
const TURNSTILE_SECRET = String(process.env.TURNSTILE_SECRET || '');
const TURNSTILE_ON = TURNSTILE_SITE.length > 0 && TURNSTILE_SECRET.length > 0;

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_ON) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams();
    body.append('secret', TURNSTILE_SECRET);
    body.append('response', String(token));
    if (ip) body.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const d = await r.json().catch(function () { return {}; });
    return d && d.success === true;
  } catch (e) {
    return false;
  }
}
const PRICE_1M = Number(process.env.PRICE_1M) || 25;
const PRICE_1Y = Number(process.env.PRICE_1Y) || 220;

function latestVersion() {
  return CHANGELOG.length ? String(CHANGELOG[0].v) : '';
}

async function lastAnnouncedVersion() {
  const token = String(process.env.DISCORD_TOKEN || '');
  if (!token || !UPDATE_NOTIFY_CHANNEL) return '';
  try {
    const r = await fetch('https://discord.com/api/v10/channels/' + UPDATE_NOTIFY_CHANNEL + '/messages?limit=30', {
      headers: { 'Authorization': 'Bot ' + token }
    });
    if (!r.ok) return '';
    const msgs = await r.json();
    for (const m of msgs) {
      for (const e of (m.embeds || [])) {
        const t = String(e.title || '');
        const mm = /v(\d+(?:\.\d+)?)/.exec(t);
        if (mm && /อัปเดต/.test(t)) return mm[1];
      }
    }
  } catch (e) {}
  return '';
}

function bumpVersion(v) {
  const parts = String(v || '0').replace(/^v/, '').split('.');
  const major = Number(parts[0]) || 0;
  const minor = Number(parts[1]) || 0;
  return major + '.' + (minor + 1);
}

async function notifyUpdateIfNeeded() {
  const base = latestVersion();
  if (!base) return;
  const prev = await lastAnnouncedVersion();
  if (process.env.UPD_DEBUG === '1') console.log('[upd] base=' + base + ' prev=' + JSON.stringify(prev));
  let ver;
  if (!prev) {
    ver = base;
  } else {
    ver = 'v' + bumpVersion(prev.replace(/^v/, ''));
  }
  if (db.lastNotifiedVersion === ver) return;
  const top = CHANGELOG[0];
  const items = (top.items || []).map(function (x) { return '• ' + x; }).join('\n');
  const ok = await discordSend(UPDATE_NOTIFY_CHANNEL, {
    embeds: [{
      title: '🚀 อัปเดตเว็บ v' + String(ver).replace(/^v/, ''),
      color: 0x2ecc71,
      description: items + '\n\n_' + top.date + '_',
      image: { url: UPDATE_IMAGE_URL },
      footer: { text: 'สกัด HUB' },
      timestamp: new Date().toISOString()
    }]
  });
  if (ok) {
    db.lastNotifiedVersion = ver;
    save();
    console.log('แจ้งเตือนอัปเดตเว็บ: ' + ver);
  }
}

function renderPage() {
  return HTML
    .replace('__CHANGELOG_JSON__', JSON.stringify(CHANGELOG))
    .replace('__PREMIUM_INVITE__', PREMIUM_INVITE)
    .replace('__PRICE_1M__', String(PRICE_1M))
    .replace('__PRICE_1Y__', String(PRICE_1Y))
    .replace('__TURNSTILE_SITE__', TURNSTILE_SITE);
}

app.get('/', function (req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderPage());
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
html, body { height: 100%; }
body {
  background: #000; color: #fff; min-height: 100vh;
  display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.box { max-width: 560px; width: 100%; display: flex; flex-direction: column; align-items: center; }
.box img { width: 100%; max-width: 420px; height: auto; border-radius: 16px; border: 1px solid #222; display: block; }
h1 { margin-top: 26px; font-size: 20px; line-height: 1.6; letter-spacing: 1px; font-weight: 700; }
</style>
</head>
<body>
<div class="box">
<img src="https://files.catbox.moe/obsyq1.jpeg" alt="">
<h1>คุณมาผิดซอยแล้ว</h1>
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
body { background: var(--bg); color: var(--fg); font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; background-image: url('https://i.ibb.co/mVfk18DZ/Messenger-creation-3-EEB72-A5-F43-E-4-BEC-9-AD2-F2-CF1-C824-EAA.gif'); background-size: cover; background-position: center; background-attachment: fixed; background-repeat: no-repeat; }
body::before { content: ''; position: fixed; inset: 0; background: rgba(0,0,0,.86); z-index: -1; pointer-events: none; }
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
header .who { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13px; min-width: 0; overflow: hidden; }
header .who span:not(.avat) { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header .who .crown { flex: 0 0 auto; width: 16px; height: 16px; margin-left: 2px; display: inline-block; vertical-align: middle; overflow: visible; }
header .right { min-width: 0; }
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
.ditem { display: flex; flex-wrap: nowrap; align-items: center; gap: 10px; width: 100%; background: transparent; border: 1px solid transparent; color: var(--fg); border-radius: 9px; padding: 11px 12px; font-size: 13px; text-align: left; }
.ditem:hover { border-color: var(--line2); background: var(--bg2); }
.ditem > svg { flex: 0 0 auto; width: 18px; height: 18px; }
.ditem > svg.crown { width: 16px; height: 16px; }
.ditem .dbadge { margin-left: auto; background: var(--fg); color: #000; border-radius: 9px; font-size: 10px; padding: 1px 7px; font-weight: 700; }
.dlang { flex-direction: column; align-items: stretch; gap: 8px; }
.dlang > span { font-size: 11px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; }
.langs { display: flex; gap: 8px; }
.langs button { flex: 1; background: transparent; border: 1px solid var(--line2); color: var(--fg); border-radius: 8px; padding: 8px; font-size: 12px; }
.langs button.on { background: var(--fg); color: #000; border-color: var(--fg); font-weight: 700; }
.nav { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 16px; scrollbar-width: none; }
.nav::-webkit-scrollbar { display: none; }
.nav button { flex: 0 0 auto; background: transparent; border: 1px solid var(--line2); color: var(--muted); border-radius: 999px; padding: 7px 14px; font-size: 12px; letter-spacing: .5px; }
.nav button.on { background: var(--fg); color: #000; border-color: var(--fg); font-weight: 700; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
.bar .baract { display: flex; gap: 8px; flex: 0 0 auto; }
.searchwrap { margin-bottom: 16px; }
.sres .rs { margin-bottom: 10px; }
.uchip { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 11px; padding: 11px 13px; margin-bottom: 8px; }
.uchip .un { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 13px; }
.uchip .un .i { color: var(--muted); }
.folder .nm .i { color: #ffd166; }
.star { color: #ffd166; }
.fsec { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin: 20px 0 10px; }
.fsec:first-child { margin-top: 0; }
.hit { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 11px; padding: 11px 13px; margin-bottom: 8px; }
.hit .hn { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; word-break: break-all; }
.hit .hm { color: var(--muted); font-size: 11px; }
.chk { display: flex; align-items: center; gap: 9px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 9px; margin-bottom: 7px; font-size: 12px; cursor: pointer; }
.chk input { accent-color: #fff; width: 15px; height: 15px; }
.chk .cc { margin-left: auto; color: var(--muted); font-size: 10px; letter-spacing: 1px; }
.pfhead { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.pfhead .i { width: 26px; height: 26px; }
.pfhead .pn { font-weight: 700; letter-spacing: 1px; font-size: 16px; word-break: break-all; }
.searchtop { position: relative; margin-bottom: 14px; }
.searchtop .si { width: 100%; background: var(--bg2); border: 1px solid var(--line2); color: var(--fg); border-radius: 10px; padding: 11px 12px 11px 38px; font-family: inherit; font-size: 13px; }
.searchtop .si:focus { outline: none; border-color: var(--fg); }
.searchtop .sic { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); display: flex; pointer-events: none; }
.searchtop .sic .i { width: 16px; height: 16px; }
.toastwrap { position: fixed; left: 50%; transform: translateX(-50%); bottom: 22px; z-index: 95; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.toastmsg { background: var(--fg); color: #000; border-radius: 9px; padding: 9px 15px; font-size: 12px; font-weight: 700; max-width: 80vw; animation: toastin .18s ease; }
.toastmsg.bad { background: #ffb9b9; }
@keyframes toastin { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.avat { width: 30px; height: 30px; border-radius: 50%; overflow: hidden; border: 1px solid var(--line2); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; background: var(--bg2); }
.avat img { width: 100%; height: 100%; object-fit: cover; display: block; }
.avat.big { width: 58px; height: 58px; }
.avat.sm { width: 22px; height: 22px; }
.who .avat { width: 24px; height: 24px; }
.seg { display: flex; background: var(--bg2); border: 1px solid var(--line2); border-radius: 10px; padding: 3px; gap: 3px; }
.seg button { flex: 1; background: transparent; border: 0; color: var(--muted); border-radius: 7px; padding: 9px 6px; font-size: 12px; font-family: inherit; }
.seg button.on { background: var(--fg); color: #000; font-weight: 700; }
.pick { position: relative; }
.pick .pkbtn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--bg2); border: 1px solid var(--line2); color: var(--fg); border-radius: 9px; padding: 11px 12px; font-family: inherit; font-size: 13px; text-align: left; }
.pick .pkbtn .pkl { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pick .pkbtn .pkl span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick .pklist { position: absolute; left: 0; right: 0; top: calc(100% + 6px); background: var(--panel); border: 1px solid var(--line2); border-radius: 10px; padding: 6px; z-index: 8; max-height: 210px; overflow: auto; box-shadow: 0 12px 30px rgba(0,0,0,.6); }
.pick .pkitem { width: 100%; display: flex; align-items: center; gap: 8px; background: transparent; border: 0; color: var(--fg); border-radius: 7px; padding: 9px 10px; font-size: 12px; font-family: inherit; text-align: left; }
.pick .pkitem:hover { background: var(--bg2); }
.pick .pkitem.on { background: var(--fg); color: #000; font-weight: 700; }
.dprof { display: flex; align-items: center; gap: 11px; padding: 2px 4px 16px; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
.dprof .dpn { font-weight: 700; font-size: 14px; word-break: break-all; }
.dprof .dpu { color: var(--muted); font-size: 11px; word-break: break-all; }
.avpick { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
.supbox { background: var(--bg2); border: 1px solid var(--line2); border-radius: 11px; padding: 14px; }
.suprow { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.suplbl { color: var(--muted); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
.supphone { display: flex; align-items: center; gap: 8px; font-size: 15px; letter-spacing: 1px; }
.supme { color: var(--muted); font-size: 12px; margin-bottom: 12px; }
.supme b { color: var(--fg); }
.board { display: flex; flex-direction: column; gap: 6px; }
.brow { display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 9px; padding: 9px 11px; }
.brow.me { border-color: var(--fg); }
.brank { width: 30px; flex: 0 0 auto; font-size: 12px; color: var(--muted); font-weight: 700; }
.medal { display: inline-flex; align-items: center; justify-content: center; width: 21px; height: 21px; border-radius: 50%; font-size: 11px; color: #000; font-weight: 800; }
.medal.m1 { background: #ffd166; }
.medal.m2 { background: #d7d7d7; }
.medal.m3 { background: #d9a066; }
.bname { flex: 1; display: flex; align-items: center; gap: 7px; font-size: 13px; min-width: 0; }
.bname span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bamt { font-size: 12px; font-weight: 700; flex: 0 0 auto; }
.obfgrid { display: flex; flex-direction: column; gap: 10px; }
.obfout { width: 100%; min-height: 180px; max-height: 300px; background: var(--bg2); border: 1px solid var(--line2); color: var(--fg); border-radius: 9px; padding: 11px 12px; font-family: inherit; font-size: 11px; line-height: 1.5; white-space: pre; overflow: auto; margin: 0; }
.obfrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.obfrow .obflbl { color: var(--muted); font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
.obfstat { color: var(--muted); font-size: 11px; }
.obfopts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.obfopts .chk { margin: 0; padding: 8px 10px; font-size: 11px; }
.monoarea { min-height: 140px; }
.hpwrap { position: absolute; left: -9999px; top: -9999px; width: 1px; height: 1px; overflow: hidden; }
.capbox { display: flex; align-items: center; gap: 10px; }
.capbox img { height: 64px; width: 190px; border-radius: 8px; border: 1px solid var(--line2); background: #f4f4f4; }
.verifycode { font-family: ui-monospace, monospace; font-size: 22px; font-weight: 800; letter-spacing: 2px; background: var(--bg2); border: 1px dashed var(--line2); border-radius: 10px; padding: 16px; text-align: center; margin: 10px 0 12px; word-break: break-all; }
.accrow { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; background: var(--bg2); border: 1px solid var(--line2); border-radius: 8px; margin-top: 8px; font-size: 13px; }
.acclab { color: var(--muted); }
#aiorb { position: fixed; width: 60px; height: 60px; border-radius: 50%; border: 2px solid var(--fg); background: var(--panel); padding: 0; overflow: hidden; z-index: 200; cursor: grab; box-shadow: 0 6px 22px rgba(0,0,0,.55); touch-action: none; }
#aiorb img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
#aiorb:active { cursor: grabbing; }
#aipanel { position: fixed; right: 16px; bottom: 90px; width: min(420px, 92vw); height: min(560px, 76vh); background: var(--panel); border: 1px solid var(--line2); border-radius: 14px; z-index: 201; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.6); }
.aihead { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line2); font-size: 13px; }
.aihead b { flex: 1; }
.aisel { background: var(--bg2); color: var(--fg); border: 1px solid var(--line2); border-radius: 7px; padding: 4px 6px; font-family: inherit; font-size: 11px; }
.aibody { flex: 1; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.aimsg pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12.5px; }
.aimsg.me { align-self: flex-end; background: var(--fg); color: var(--bg); border-radius: 12px 12px 4px 12px; padding: 8px 11px; max-width: 88%; }
.aimsg.bot { align-self: flex-start; background: var(--bg2); border: 1px solid var(--line2); border-radius: 12px 12px 12px 4px; padding: 8px 11px; max-width: 92%; }
.aibar { display: flex; align-items: flex-end; gap: 6px; padding: 8px; border-top: 1px solid var(--line2); }
.aiinput { flex: 1; background: var(--bg2); color: var(--fg); border: 1px solid var(--line2); border-radius: 9px; padding: 8px; font-family: inherit; font-size: 12.5px; resize: none; }
.aictx { font-size: 10px; color: var(--muted); }
.aifoot { padding: 4px 10px 8px; font-size: 10px; color: var(--muted); }
.aimodal { max-height: 55vh; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.folderpage { max-width: 900px; margin: 0 auto; padding: 18px; }
.fphead { display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--line2); border-radius: 14px; background: var(--bg2); margin-bottom: 12px; }
.fpav { width: 46px; height: 46px; border-radius: 12px; background: var(--panel); display: flex; align-items: center; justify-content: center; overflow: hidden; flex: 0 0 auto; }
.fpav img { width: 100%; height: 100%; object-fit: cover; }
.fpav svg { width: 22px; height: 22px; color: #ffd166; }
.fpinfo { flex: 1; min-width: 0; }
.fpname { font-size: 15px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fpsub { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
.fpdesc { font-size: 12.5px; color: var(--muted); margin: 0 4px 12px; }
.statrow { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--line2); border-radius: 10px; background: var(--bg2); margin-bottom: 8px; }
.statrow svg { width: 18px; height: 18px; flex: 0 0 auto; color: var(--muted); }
.statlab { flex: 1; font-size: 12.5px; color: var(--muted); }
.statnum { font-size: 15px; }
.perklist { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 4px; }
.perkrow { display: flex; align-items: center; gap: 9px; font-size: 12.5px; line-height: 1.2; }
.perkrow svg { width: 15px; height: 15px; flex: 0 0 auto; color: var(--fg); }
.planbox { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border: 1px solid var(--line2); border-radius: 10px; background: var(--bg2); margin-bottom: 8px; }
.planhead { font-size: 13px; font-weight: 700; }
.planprice { font-size: 15px; font-weight: 800; color: var(--fg); }
.themegrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.themebtn { display: flex; align-items: center; gap: 9px; padding: 11px 12px; background: var(--bg2); border: 1px solid var(--line2); border-radius: 10px; color: var(--fg); font-family: inherit; font-size: 13px; }
.themebtn:hover { border-color: var(--fg); }
.themebtn.on { border-color: var(--fg); box-shadow: inset 0 0 0 1px var(--fg); font-weight: 700; }
.dotswatch { width: 14px; height: 14px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.updbody { max-height: 60vh; overflow: auto; }
.updbox { border: 1px solid var(--line2); border-radius: 10px; padding: 10px 12px; margin-bottom: 9px; background: var(--bg2); }
.updhead { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; font-size: 13px; }
.upddate { color: var(--muted); font-size: 11px; }
.updnew { display: inline-block; margin-left: 7px; padding: 1px 7px; border-radius: 999px; background: var(--fg); color: var(--bg); font-size: 9px; font-weight: 800; vertical-align: 1px; }
.updlist { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.7; }
.verifywait { margin-top: 14px; color: var(--muted); font-size: 12px; text-align: center; }
.crown { color: #f1c40f; width: 16px; height: 16px; vertical-align: middle; margin-left: 4px; display: inline-block; flex: 0 0 auto; overflow: visible; }
.dpn .crown { margin-left: 3px; }
.lvlbtn.locked { opacity: 0.55; }
.lvlrow { display: flex; gap: 7px; }
.lvlbtn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 9px 4px; background: var(--bg2); border: 1px solid var(--line2); color: var(--muted); border-radius: 10px; font-family: inherit; font-size: 11px; transition: all .12s; }
.lvlbtn:hover { border-color: var(--fg); color: var(--fg); }
.lvlbtn.on { background: var(--fg); color: #000; border-color: var(--fg); font-weight: 800; }
.lvlbtn span { line-height: 1; }
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
    menu: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>',
    search: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
    folder: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    star: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
    starfill: '<svg class="i" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
    eye: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    eyeoff: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
    back: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>',
    chev: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    camera: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
    chart: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path></svg>',
    palette: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="8.5" cy="9.5" r="1.2" fill="currentColor"></circle><circle cx="15.5" cy="9.5" r="1.2" fill="currentColor"></circle><circle cx="12" cy="15" r="1.2" fill="currentColor"></circle></svg>',
    crown: '<svg class="i crown" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" overflow="visible"><path d="M2 18.2h20V21H2v-2.8zM2 16.2L5.6 6.4l4.9 4.1L12 3l1.5 7.5 4.9-4.1L22 16.2H2z"/></svg>',
    shield: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    settings: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
    refresh: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
    heart: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
    trophy: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"></path></svg>',
    copy2: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
  };
  var T = {
    th: { sub_login:'เข้าสู่ระบบบัญชีของคุณ', sub_signup:'สร้างบัญชีของคุณ', username:'ชื่อผู้ใช้', password:'รหัสผ่าน', login:'เข้าสู่ระบบ', signup:'สร้างบัญชี', have_account:'มีบัญชีแล้ว?', no_account:'ยังไม่มีบัญชี?', files:'ไฟล์', new_file:'สร้างไฟล์', edit_file:'แก้ไขไฟล์', create_file:'สร้างไฟล์ใหม่', file_name:'ชื่อไฟล์', code:'โค้ด', upload_file:'อัปโหลดไฟล์', choose_file:'เลือกไฟล์', no_file:'ยังไม่ได้เลือกไฟล์', cancel:'ยกเลิก', save:'บันทึก', create:'สร้าง', raw_hint:'ลิงก์ raw คงเดิมหลังแก้ไข เอาไปใส่ใน executor ได้เลย', shared:'แชร์', by:'โดย', options:'ตัวเลือก', info:'ข้อมูล', invite_others:'เชิญผู้ใช้คนอื่น', close:'ปิด', loading:'กำลังโหลด...', no_updates:'ยังไม่มีการอัปเดต', chars:'ตัวอักษร', lines:'บรรทัด', invite_user:'เชิญผู้ใช้', invite_hint:'ผู้ถูกเชิญจะดูและแก้ไฟล์ได้ แต่ลบไม่ได้', invite:'เชิญ', invited_sent:'ส่งคำเชิญแล้ว', invites:'คำเชิญ', no_invites:'ไม่มีคำเชิญ', from:'จาก', no_files:'ยังไม่มีไฟล์', create_first:'สร้าง script แรกของคุณ', signout:'ออกบัญชี', account:'บัญชี', language:'เปลี่ยนภาษา', discord:'ดิสคอร์ด', edit:'แก้ไข', delete:'ลบ', copy:'คัดลอก', ago_sec:'วินาทีที่แล้ว', ago_min:'นาทีที่แล้ว', ago_hour:'ชั่วโมงที่แล้ว', ago_day:'วันที่แล้ว', nav_files:'ไฟล์', nav_search:'ค้นหา', nav_folders:'โฟลเดอร์', nav_fav:'รายการโปรด', search_ph:'ค้นหาผู้ใช้ / ไฟล์ / โฟลเดอร์', search_hint:'พิมพ์อย่างน้อย 1 ตัวอักษร', res_users:'ผู้ใช้', res_files:'ไฟล์', res_folders:'โฟลเดอร์', follow:'ติดตาม', following:'ติดตามอยู่', unfollow:'เลิกติดตาม', followers:'ผู้ติดตาม', following_n:'กำลังติดตาม', add_fav:'เพิ่มรายการโปรด', rm_fav:'เอาออกจากรายการโปรด', new_folder:'สร้างโฟลเดอร์', folder_name:'ชื่อโฟลเดอร์', no_folders:'ยังไม่มีโฟลเดอร์', no_fav:'ยังไม่มีรายการโปรด', public:'สาธารณะ', private:'ส่วนตัว', vis_public:'ให้คนอื่นเห็น', vis_private:'เห็นคนเดียว', pick_files:'เลือกไฟล์ในโฟลเดอร์', select_files:'เลือกไฟล์', save_folder:'บันทึกโฟลเดอร์', empty_folder:'โฟลเดอร์ว่าง', files_n:'ไฟล์', my_files:'ไฟล์ของฉัน', open:'เปิด', none:'ไม่มี', view_profile:'ดูโปรไฟล์', folder_created:'สร้างโฟลเดอร์แล้ว', add_to_folder:'โฟลเดอร์', move:'ย้าย', no_folder:'ไม่ใส่โฟลเดอร์', updated_at:'อัปเดตล่าสุด', visibility:'การมองเห็น', edit_profile:'แก้ไขโปรไฟล์', nickname:'ชื่อเล่น', change_photo:'เปลี่ยนรูป', remove_photo:'ลบรูป', profile_saved:'บันทึกโปรไฟล์แล้ว', saved:'บันทึกแล้ว', confirm_title:'ยืนยัน', yes:'ใช่', no:'ไม่', choose:'เลือก', delete_confirm:'ลบอันนี้?', folder_here:'โฟลเดอร์', pick_placeholder:'เลือก…', followers_t:'ผู้ติดตาม', following_t:'กำลังติดตาม', toggle_vis:'การมองเห็น', public_hint:'คนอื่นค้นหาเจอ', private_hint:'เห็นคนเดียว', updates:'อัปเดต', theme:'ปรับสีธีม', latest:'ล่าสุด', premium_signup:'สมัครพรีเมี่ยม', stats:'สถิติเว็บ', open_folder_first:'เปิดโฟลเดอร์ก่อน แล้วสร้างไฟล์ข้างใน', folder_desc:'โปรไฟล์โฟลเดอร์', folder_desc_ph:'คำอธิบายสั้นๆ', folder_pic:'รูปโฟลเดอร์', folder_pic_set:'ตั้งรูปแล้ว', img_too_big:'รูปใหญ่เกิน 300KB', in_folder:'จะถูกสร้างในโฟลเดอร์นี้', stat_users:'บัญชีที่สมัครแล้ว', stat_files:'ไฟล์ที่สร้างแล้ว', stat_folders:'โฟลเดอร์', stat_public:'ไฟล์สาธารณะ', premium_active:'คุณเป็นพรีเมี่ยมอยู่แล้ว 👑', plan_1m:'พรีเมี่ยม 1 เดือน', plan_1y:'พรีเมี่ยม 1 ปี', baht:'บาท', best_value:'คุ้มสุด', premium_perks:'สิทธิพิเศษ', perk_lv:'ใช้ปกปิดโค้ดได้ทุกระดับ 1-6', perk_times:'ปกปิดได้ 10 ครั้ง/วัน (ฟรี 5 ครั้ง)', perk_crown:'ไอคอนมงกุฎหลังชื่อ', perk_size:'สร้างไฟล์ได้สูงสุด 20 MB', premium_buy_hint:'ซื้อผ่าน Discord — กดปุ่มด้านล่างเพื่อเข้ากลุ่ม', my_folders:'โฟลเดอร์ของฉัน', ai_attach:'แนบไฟล์/โฟลเดอร์', raw_lock_q:'ล็อกหน้าลิงก์ raw?', raw_lock_yes:'ล็อก (เห็นหน้า "คุณมาผิดซอยแล้ว")', deliver_q:'ต้องการอะไรจากการสร้างไฟล์', deliver_raw:'แค่ลิงก์ raw', deliver_ready:'พร้อมรันใน Roblox', ai_ph:'ถาม AI...', ai_send:'ส่ง', ai_empty:'เริ่มคุยกับ AI ได้เลย', ai_left:'โควต้า AI', ai_nokey:'ยังไม่ได้ติดตั้ง API key', ai_ctx_on:'แนบแล้ว', create_folder_first:'สร้างโฟลเดอร์ก่อน แล้วไฟล์จะอยู่ข้างใน', premium_join:'ไปสมัครใน Discord', folder_required:'โฟลเดอร์ (จำเป็น)', folder_vis_hint:'การมองเห็นปรับที่โฟลเดอร์เท่านั้น', folder_required_toast:'ต้องเลือกโฟลเดอร์ก่อนสร้างไฟล์', captcha:'ยืนยันตัวตน', captcha_ph:'ใส่เลข 4 หลัก', captcha_hint:'พิมพ์เลขในรูป (ติดกัน)', verify_title:'ยืนยันบัญชีผ่าน Discord', verify_steps:'กดลิงก์เข้ากลุ่ม Discord → กดปุ่ม ยืนยันบัญชี → ใส่รหัสข้างบน → ระบบจะสมัครให้อัตโนมัติ', verify_join:'เข้ากลุ่ม Discord', verify_waiting:'รอการยืนยัน... (อย่าปิดหน้านี้)', verify_expired:'หมดเวลา — เริ่มสมัครใหม่', save_acc_title:'บันทึกบัญชีไหม?', save_acc_hint:'จำรหัสผ่านไว้ด้วย — ถ้าลืมจะเข้าสู่ระบบไม่ได้', save_acc_copy:'คัดลอก', save_acc_dl:'ดาวน์โหลด .txt', save_acc_file_title:'บัญชี สกัด HUB', save_acc_file_note:'เก็บไฟล์นี้ไว้ให้ดี อย่าให้ใครเห็น', obf:'ปกปิดโค้ด Lua', obf_title:'Lua Obfuscator', obf_input:'โค้ด Lua', obf_input_ph:'วางโค้ด Lua ที่นี่ หรือกดอัปโหลดไฟล์', obf_pick:'อัปโหลดไฟล์', obf_no_file:'ยังไม่ได้เลือกไฟล์', obf_run:'ปกปิด', obf_running:'กำลังปกปิด...', obf_output:'ผลลัพธ์', obf_copy:'คัดลอกผลลัพธ์', obf_save:'สร้างไฟล์จากผลลัพธ์', obf_name:'ชื่อไฟล์', obf_name_ph:'obfuscated', obf_options:'ตัวเลือก', obf_opt_rename:'เปลี่ยนชื่อตัวแปร', obf_opt_strings:'เข้ารหัสสตริง', obf_opt_numbers:'แปลงตัวเลข', obf_opt_junk:'ใส่โค้ดหลอก', obf_opt_wrap:'ห่อด้วย loader', obf_opt_hide:'ซ่อน error', obf_done:'ปกปิดเสร็จแล้ว', obf_empty:'ใส่โค้ดก่อน', obf_saved:'สร้างไฟล์แล้ว', obf_stats:'ผลลัพธ์', obf_strong:'โหมดแน่นหนา', obf_clear:'ล้าง', obf_level:'ระดับความยาก', obf_lv1:'1 · เบา', obf_lv2:'2 · กลาง', obf_lv3:'3 · หนัก', obf_lv4:'4 · โหด', obf_lv5:'5 · สุดโหด', obf_lv1_hint:'เร็วสุด ไฟล์เล็ก แต่แกะง่าย', obf_lv2_hint:'สมดุล ไฟล์กลางๆ', obf_lv3_hint:'แนะนำ — แกะยาก ไฟล์ใหญ่ขึ้น', obf_lv4_hint:'โหด 3 ชั้น + ขยะเยอะ (พรีเมียม)', obf_lv5_hint:'สุดโหด — แปลงเป็น bytecode VM (พรีเมียม)', obf_lv6_hint:'โหดสุด — VM + 3 ชั้น + ขยะ 40 เท่า (พรีเมียม · ไฟล์ใหญ่)', obf_remote:'เก็บตัวแปรไว้บนเว็บ', obf_remote_on:'เปิด (สคริปต์จะดึงค่าตอนรัน)', obf_edit:'แก้ไขไฟล์', obf_updated:'อัปเดตไฟล์แล้ว', obf_left:'เหลือ', obf_limit:'ใช้ครบ 5 ครั้ง/วันแล้ว', obf_copy_blocked:'โหมดเก็บตัวแปรบนเว็บ — คัดลอกไม่ได้ ต้องสร้างหรือแก้ไขไฟล์', obf_premium_lv:'ระดับ 4-6 ต้องใช้พรีเมียม 👑' },
    en: { sub_login:'Sign in to your account', sub_signup:'Create your account', username:'Username', password:'Password', login:'Sign in', signup:'Create account', have_account:'Already have an account?', no_account:'No account?', files:'Files', new_file:'New file', edit_file:'Edit file', create_file:'New file', file_name:'File name', code:'Code', upload_file:'Upload file', choose_file:'Choose file', no_file:'No file selected', cancel:'Cancel', save:'Save', create:'Create', raw_hint:'The raw link stays the same after editing. Paste it into your executor.', shared:'Shared', by:'by', options:'Options', info:'Info', invite_others:'Invite others', close:'Close', loading:'Loading...', no_updates:'No updates yet', chars:'chars', lines:'lines', invite_user:'Invite user', invite_hint:'Invited users can view and edit the file, but cannot delete it', invite:'Invite', invited_sent:'Invitation sent', invites:'Invites', no_invites:'No invitations', from:'from', no_files:'No files yet', create_first:'Create your first script', signout:'Sign out', account:'Account', language:'Language', discord:'Discord', edit:'Edit', delete:'Delete', copy:'Copy', ago_sec:'s ago', ago_min:'m ago', ago_hour:'h ago', ago_day:'d ago', nav_files:'Files', nav_search:'Find', nav_folders:'Folders', nav_fav:'Favorites', search_ph:'Search users / files / folders', search_hint:'Type at least 1 character', res_users:'Users', res_files:'Files', res_folders:'Folders', follow:'Follow', following:'Following', unfollow:'Unfollow', followers:'followers', following_n:'following', add_fav:'Favorite', rm_fav:'Unfavorite', new_folder:'New folder', folder_name:'Folder name', no_folders:'No folders yet', no_fav:'No favorites yet', public:'Public', private:'Only me', vis_public:'Visible to others', vis_private:'Only me', pick_files:'Files in folder', select_files:'Select files', save_folder:'Save folder', empty_folder:'Folder is empty', files_n:'files', my_files:'My files', open:'Open', none:'none', view_profile:'View profile', folder_created:'Folder created', add_to_folder:'Folder', move:'Move', no_folder:'No folder', updated_at:'Last updated', visibility:'Visibility', edit_profile:'Edit profile', nickname:'Nickname', change_photo:'Change photo', remove_photo:'Remove photo', profile_saved:'Profile saved', saved:'Saved', confirm_title:'Confirm', yes:'Yes', no:'No', choose:'Choose', delete_confirm:'Delete this?', folder_here:'Folder', pick_placeholder:'Select…', followers_t:'followers', following_t:'following', toggle_vis:'Visibility', public_hint:'Anyone can find it', private_hint:'Only you can see it', updates:'Updates', theme:'Theme color', latest:'NEW', premium_signup:'Get premium', stats:'Site stats', open_folder_first:'Open a folder first, then create the file inside', folder_desc:'Folder profile', folder_desc_ph:'Short description', folder_pic:'Folder picture', folder_pic_set:'Picture set', img_too_big:'Image larger than 300KB', in_folder:'Will be created in this folder', stat_users:'Accounts created', stat_files:'Files created', stat_folders:'Folders', stat_public:'Public files', premium_active:'You already have premium 👑', plan_1m:'Premium 1 month', plan_1y:'Premium 1 year', baht:'THB', best_value:'Best value', premium_perks:'Benefits', perk_lv:'Protect code at every level 1-6', perk_times:'10 protections per day (free: 5)', perk_crown:'Crown next to your name', perk_size:'Files up to 20 MB', premium_buy_hint:'Purchase through Discord — press the button below to join', my_folders:'My folders', ai_attach:'Attach file/folder', raw_lock_q:'Lock the raw page?', raw_lock_yes:'Lock (show the wrong-alley page)', deliver_q:'What do you want from this file', deliver_raw:'Raw link only', deliver_ready:'Ready to run in Roblox', ai_ph:'Ask the AI...', ai_send:'Send', ai_empty:'Start chatting with the AI', ai_left:'AI quota', ai_nokey:'API key not installed', ai_ctx_on:'attached', create_folder_first:'Create a folder first, files live inside it', premium_join:'Join Discord', folder_required:'Folder (required)', folder_vis_hint:'Visibility is set on the folder', folder_required_toast:'Pick a folder before creating a file', captcha:'Verification', captcha_ph:'Enter 4 digits', captcha_hint:'Type the digits shown in the image', verify_title:'Verify via Discord', verify_steps:'Join the Discord → press the verify button → enter the code above → your account is created automatically', verify_join:'Join Discord', verify_waiting:'Waiting for verification... (keep this page open)', verify_expired:'Expired — start again', save_acc_title:'Save your account?', save_acc_hint:'Remember your password — you cannot log in without it', save_acc_copy:'Copy', save_acc_dl:'Download .txt', save_acc_file_title:'Sakad HUB account', save_acc_file_note:'Keep this file safe, do not share it', obf:'Protect Lua code', obf_title:'Lua Obfuscator', obf_input:'Lua code', obf_input_ph:'Paste Lua code here, or upload a file', obf_pick:'Upload file', obf_no_file:'No file selected', obf_run:'Protect', obf_running:'Protecting...', obf_output:'Output', obf_copy:'Copy output', obf_save:'Create file from output', obf_name:'File name', obf_name_ph:'obfuscated', obf_options:'Options', obf_opt_rename:'Rename variables', obf_opt_strings:'Encrypt strings', obf_opt_numbers:'Transform numbers', obf_opt_junk:'Insert decoy code', obf_opt_wrap:'Wrap in loader', obf_opt_hide:'Hide errors', obf_done:'Done', obf_empty:'Enter code first', obf_saved:'File created', obf_stats:'Result', obf_strong:'Strong mode', obf_clear:'Clear', obf_level:'Difficulty', obf_lv1:'1 · Light', obf_lv2:'2 · Medium', obf_lv3:'3 · Heavy', obf_lv4:'4 · Brutal', obf_lv5:'5 · Insane', obf_lv1_hint:'Fastest, smallest file, easy to crack', obf_lv2_hint:'Balanced, medium size', obf_lv3_hint:'Recommended — hard to crack', obf_lv4_hint:'Brutal: 3 layers + heavy junk', obf_lv5_hint:'Insane — compiles to a bytecode VM (no loadstring of your code)', obf_lv6_hint:'Max — VM + 3 pack layers + 40x junk (very large file)', obf_remote:'Remote variables', obf_remote_on:'Enable (script fetches values at runtime)', obf_edit:'Edit file', obf_updated:'File updated', obf_left:'Left', obf_limit:'Daily limit reached (5/day)', obf_copy_blocked:'Remote mode — copying disabled, use create or edit file', obf_premium_lv:'Levels 4-6 require premium 👑' }
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
  var state = { user: null, files: [], invites: [], folders: [], fav: { files: [], folders: [] }, search: null, q: '', timer: null, following: [], tab: 'folders', fp: '' };
  function makeFp() {
    try {
      var k = 'fp';
      var v = localStorage.getItem(k);
      if (v && v.length >= 16) return v;
      var buf = new Uint8Array(16);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
      else for (var i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
      var hex = '';
      for (var j = 0; j < buf.length; j++) hex += ('0' + buf[j].toString(16)).slice(-2);
      localStorage.setItem(k, hex);
      return hex;
    } catch (e) { return ''; }
  }
  state.fp = makeFp();
  state.maxLevel = 3;
  state.dailyLimit = 5;
  function brand() { return '<div class="brand"><div class="logo"><img src="https://files.catbox.moe/okwlyx.png" alt=""></div><h1>สกัด HUB</h1></div>'; }
  function renderAuth(mode) {
    var signup = mode === 'signup';
    app.innerHTML = '<div class="auth-wrap"><div class="card">' + brand() +
      '<div class="sub">' + t(signup ? 'sub_signup' : 'sub_login') + '</div>' +
      '<div class="err" id="err"></div>' +
      '<div class="field"><label>' + ICON.user + ' ' + t('username') + '</label><input class="input" id="username" autocomplete="username" spellcheck="false"></div>' +
      '<div class="field"><label>' + ICON.lock + ' ' + t('password') + '</label><input class="input" id="password" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></div>' +
      (signup ? '<div class="hpwrap"><label>Website</label><input class="input" id="hpfield" name="website" tabindex="-1" autocomplete="off"></div>' +
        '<div class="field"><label>' + ICON.shield + ' ' + t('captcha') + '</label>' +
        '<div class="capbox"><img id="capimg" alt="" src=""><button class="iconbtn" id="capreload" title="reload">' + ICON.refresh + '</button></div>' +
        '<input class="input" id="capanswer" placeholder="' + t('captcha_ph') + '" inputmode="numeric" maxlength="4" style="margin-top:8px" spellcheck="false">' +
        '<div class="hint">' + t('captcha_hint') + '</div></div>' +
        '<div id="tsbox" style="margin:10px 0"></div>' : '') +
      '<button class="btn" id="go">' + t(signup ? 'signup' : 'login') + '</button>' +
      '<div class="switch">' + (signup ? t('have_account') + ' <a href="#" id="sw">' + t('login') + '</a>' : t('no_account') + ' <a href="#" id="sw">' + t('signup') + '</a>') + '</div></div></div>';

    var capId = '';
    if (signup) {
      loadCaptcha();
      if (TURNSTILE_SITE) {
        if (!window.turnstile) {
          var sc = document.createElement('script');
          sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
          sc.async = true; sc.defer = true;
          document.head.appendChild(sc);
        }
        var tries = 0;
        (function mountTs() {
          if (window.turnstile) {
            try { window.turnstile.render('#tsbox', { sitekey: TURNSTILE_SITE }); } catch (e) {}
          } else if (tries++ < 40) setTimeout(mountTs, 250);
        })();
      }
    }

    document.getElementById('sw').onclick = function (e) { e.preventDefault(); renderAuth(signup ? 'login' : 'signup'); };
    document.getElementById('go').onclick = submitAuth;
    document.getElementById('password').onkeydown = function (e) { if (e.key === 'Enter') submitAuth(); };
    if (signup) {
      document.getElementById('capreload').onclick = loadCaptcha;
      document.getElementById('capanswer').onkeydown = function (e) { if (e.key === 'Enter') submitAuth(); };
    }
    document.getElementById('username').focus();

    function loadCaptcha() {
      var img = document.getElementById('capimg');
      if (!img) return;
      img.removeAttribute('src');
      api('/api/captcha').then(function (d) {
        capId = d.id;
        img.src = d.image;
      }).catch(function (e) { toast(e.message, true); });
    }

    function submitAuth() {
      var u = document.getElementById('username').value.trim(), p = document.getElementById('password').value;
      var err = document.getElementById('err'); err.style.display = 'none';
      var hdrs = { 'Content-Type': 'application/json' };
      if (signup && state.fp) hdrs['X-Client-FP'] = state.fp;
      if (!signup) {
        fetch('/api/login', { method: 'POST', headers: hdrs, body: JSON.stringify({ username: u, password: p }) })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }); })
          .then(function (d) { state.user = d.user; renderApp(); loadAll(); })
          .catch(function (e) { err.textContent = e.message; err.style.display = 'block'; });
        return;
      }
      state.lastPw = p;
      var cap = document.getElementById('capanswer').value.trim();
      if (!cap) { err.textContent = t('captcha_ph'); err.style.display = 'block'; return; }
      var tsToken = '';
      try { tsToken = (window.turnstile && window.turnstile.getResponse && window.turnstile.getResponse()) || ''; } catch (e) {}
      var hpVal = (document.getElementById('hpfield') || {}).value || '';
      fetch('/api/signup/begin', { method: 'POST', headers: hdrs, body: JSON.stringify({ username: u, password: p, captchaId: capId, captcha: cap, turnstile: tsToken, website: hpVal }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }); })
        .then(function (d) { showVerify(d); })
        .catch(function (e) {
          err.textContent = e.message; err.style.display = 'block';
          loadCaptcha();
          var a = document.getElementById('capanswer'); if (a) a.value = '';
        });
    }

    function showVerify(d) {
      var card = document.querySelector('.card');
      card.innerHTML = brand() +
        '<div class="sub">' + t('verify_title') + '</div>' +
        '<div class="verifycode" id="vcode">' + esc(d.code) + '</div>' +
        '<button class="btn ghost small" id="vcopy">' + ICON.copy + ' ' + t('copy') + '</button>' +
        '<div class="hint" style="margin-top:14px">' + t('verify_steps') + '</div>' +
        '<a class="btn" style="margin-top:12px" href="' + esc(d.discord) + '" target="_blank" rel="noopener">' + ICON.link + ' ' + t('verify_join') + '</a>' +
        '<div class="verifywait" id="vwait">' + t('verify_waiting') + '</div>';
      var copyBtn = document.getElementById('vcopy');
      copyBtn.onclick = function () { copyText(d.code); toast(t('copy')); };
      var started = Date.now();
      var timer = setInterval(function () {
        if (Date.now() - started > 15 * 60 * 1000) {
          clearInterval(timer);
          var w = document.getElementById('vwait');
          if (w) w.textContent = t('verify_expired');
          return;
        }
        api('/api/signup/poll?t=' + encodeURIComponent(d.token)).then(function (r) {
          if (r.status === 'ok') {
            clearInterval(timer);
            state.user = r.user;
            api('/api/me').then(function (me) {
              if (me && me.premium) { state.maxLevel = me.premium.maxLevel; state.user.premium = me.premium.premium; }
            }).catch(function () {}).then(function () {
              renderApp(); loadAll();
              askSaveAccount(state.user, d.code);
            });
          }
        }).catch(function () {});
      }, 2500);
    }
  }

  function askSaveAccount(user, code) {
    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.user + ' ' + t('save_acc_title') + '</h3>' +
      '<div class="body">' +
      '<div class="hint" style="margin-top:0">' + t('save_acc_hint') + '</div>' +
      '<div class="accrow"><span class="acclab">' + t('username') + '</span><b id="sau">' + esc(user.username) + '</b></div>' +
      '<div class="accrow"><span class="acclab">' + t('password') + '</span><b id="sap">' + esc(state.lastPw || '********') + '</b></div>' +
      '</div><div class="foot">' +
      '<button class="btn ghost" id="sano">' + t('no') + '</button>' +
      '<button class="btn" id="sayes">' + ICON.copy + ' ' + t('save_acc_copy') + '</button>' +
      '<button class="btn" id="sadl">' + ICON.file + ' ' + t('save_acc_dl') + '</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#sano').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#sayes').onclick = function () {
      copyText(user.username + '\\n' + (state.lastPw || ''));
      toast(t('saved'));
    };
    overlay.querySelector('#sadl').onclick = function () {
      var txt = t('save_acc_file_title') + '\\n' + t('username') + ': ' + user.username + '\\n' +
        t('password') + ': ' + (state.lastPw || '') + '\\n' + t('save_acc_file_note');
      var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sakad-hub-' + user.username + '.txt';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast(t('saved'));
    };
  }

  function toast(msg, bad) {
    var wrap = document.querySelector('.toastwrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toastwrap'; document.body.appendChild(wrap); }
    var el = document.createElement('div');
    el.className = 'toastmsg' + (bad ? ' bad' : '');
    el.textContent = String(msg);
    wrap.appendChild(el);
    setTimeout(function () { el.remove(); if (wrap && !wrap.children.length) wrap.remove(); }, 2600);
  }
  function emptyBox(icon, a, b) { return '<div class="empty">' + icon + '<div>' + a + '</div>' + (b ? '<div style="margin-top:6px">' + b + '</div>' : '') + '</div>'; }
  function avat(u, cls) {
    var c = 'avat' + (cls ? ' ' + cls : '');
    if (u && u.avatar) return '<span class="' + c + '"><img src="' + esc(u.avatar) + '" alt=""></span>';
    return '<span class="' + c + '">' + ICON.user + '</span>';
  }
  function renderApp() {
    setTimeout(mountAiOrb, 80);
    var me = state.user;
    app.innerHTML = '<header>' + brand() + '<div class="right">' +
      '<div class="who">' + avat(me) + '<span>' + esc(me.nick || me.username) + '</span></div>' +
      '<button class="iconbtn" id="menu" title="' + t('account') + '">' + ICON.menu + '<span class="menubadge" id="menubadge"></span></button>' +
      '</div></header>' +
      '<main><div class="searchtop">' + '<span class="sic">' + ICON.search + '</span>' +
      '<input class="si" id="gsq" placeholder="' + t('search_ph') + '" spellcheck="false" value="' + esc(state.q) + '"></div>' +
      '<div class="nav" id="nav"></div><div id="view"></div></main>';
    document.getElementById('menu').onclick = openDrawer;
    var gs = document.getElementById('gsq');
    gs.oninput = function () {
      state.q = gs.value.trim();
      clearTimeout(state.timer);
      if (!state.q) { state.search = null; renderView(); return; }
      state.timer = setTimeout(runSearch, 240);
    };
    gs.onkeydown = function (e) { if (e.key === 'Enter') { clearTimeout(state.timer); runSearch(); } };
    renderNav();
    renderView();
    loadInvites();
  }
  function renderNav() {
    var nav = document.getElementById('nav'); if (!nav) return;
    var items = [['folders', ICON.folder, t('nav_folders')]];
    nav.innerHTML = items.map(function (it) {
      return '<button data-tab="' + it[0] + '" class="' + (state.tab === it[0] && !state.q ? 'on' : '') + '">' + it[1] + ' ' + it[2] + '</button>';
    }).join('');
    Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) {
      b.onclick = function () {
        state.tab = b.getAttribute('data-tab'); state.q = ''; state.search = null;
        var gs = document.getElementById('gsq'); if (gs) gs.value = '';
        renderNav(); renderView();
      };
    });
  }
  function renderView() {
    var v = document.getElementById('view'); if (!v) return;
    if (state.q) return renderSearch();
    return renderFolders();
  }
  function picker(id, opts, cur, ph) {
    var c = null;
    for (var i = 0; i < opts.length; i++) if (opts[i].value === cur) c = opts[i];
    var label = c ? c.label : (ph || t('pick_placeholder'));
    return '<div class="pick" id="' + id + '"><button type="button" class="pkbtn"><span class="pkl">' +
      (c && c.icon ? c.icon : '') + '<span class="pklabel">' + esc(label) + '</span></span>' + ICON.chev + '</button>' +
      '<div class="pklist" style="display:none" data-val="' + esc(cur == null ? '' : cur) + '">' +
      opts.map(function (o) {
        return '<button type="button" class="pkitem' + (o.value === cur ? ' on' : '') + '" data-value="' + esc(o.value) + '">' +
          (o.icon || '') + '<span>' + esc(o.label) + '</span></button>';
      }).join('') + '</div></div>';
  }
  function bindPicker(root, id, onChange) {
    var wrap = root.querySelector('#' + id); if (!wrap) return;
    var btn = wrap.querySelector('.pkbtn'), list = wrap.querySelector('.pklist');
    btn.onclick = function (e) {
      e.stopPropagation();
      var open = list.style.display !== 'none';
      Array.prototype.forEach.call(document.querySelectorAll('.pklist'), function (l) { l.style.display = 'none'; });
      list.style.display = open ? 'none' : 'block';
    };
    Array.prototype.forEach.call(list.querySelectorAll('.pkitem'), function (it) {
      it.onclick = function (e) {
        e.stopPropagation();
        list.setAttribute('data-val', it.getAttribute('data-value'));
        list.querySelectorAll('.pkitem').forEach(function (x) { x.classList.remove('on'); });
        it.classList.add('on');
        var lbl = wrap.querySelector('.pklabel');
        if (lbl) lbl.textContent = it.textContent.trim();
        list.style.display = 'none';
        if (onChange) onChange(it.getAttribute('data-value'));
      };
    });
  }
  function pickerVal(root, id) { var w = root.querySelector('#' + id); var l = w && w.querySelector('.pklist'); return l ? l.getAttribute('data-val') : ''; }
  document.addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.pklist'), function (l) { l.style.display = 'none'; });
  });
  function confirmBox(title, msg, onYes) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.info + ' ' + esc(title) + '</h3><div class="body">' +
      '<div class="hint" style="margin:0 0 6px">' + esc(msg) + '</div></div>' +
      '<div class="foot"><button class="btn ghost" id="cno">' + t('no') + '</button><button class="btn" id="cyes">' + t('yes') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#cno').onclick = function () { overlay.remove(); };
    overlay.querySelector('#cyes').onclick = function () { overlay.remove(); onYes(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function favBtn(type, id, on) {
    return '<button class="iconbtn fv' + (on ? ' on' : '') + '" data-type="' + type + '" data-id="' + esc(id) + '" title="' + (on ? t('rm_fav') : t('add_fav')) + '">' + (on ? ICON.starfill : ICON.star) + '</button>';
  }
  function fileCard(f) {
    var isOwner = f.role === 'owner';
    var tags = '';
    if (f.role === 'editor') tags = '<span class="tag">' + t('shared') + '</span>';
    else if (f.role === 'viewer') tags = '<span class="tag">' + t('public') + '</span>';
    if (f.visibility === 'private') tags += '<span class="tag">' + t('private') + '</span>';
    var ed = (isOwner || f.role === 'editor') ? '<button class="iconbtn ed" title="' + t('edit') + '">' + ICON.edit + '</button>' : '';
    return '<div class="file" data-id="' + esc(f.id) + '">' +
      '<div class="top"><div class="nm">' + ICON.file + '<span>' + esc(f.name) + '</span>' + tags + '</div>' +
      '<div class="meta">' + rel(f.updated) + (isOwner ? '' : '<br>' + t('by') + ' ' + esc(f.ownerName)) + '</div></div>' +
      '<div class="raw"><span class="lbl">' + ICON.link + ' LOADER</span><input readonly value="' + esc(loader(f.rawUrl || '')) + '"><button class="iconbtn cp" title="' + t('copy') + '">' + ICON.copy + '</button></div>' +
      '<div class="actions">' + ed + favBtn('file', f.id, f.fav) + '<button class="iconbtn more" title="' + t('options') + '">' + ICON.more + '</button></div></div>';
  }
  function folderCard(fo) {
    var tag = fo.visibility === 'private' ? '<span class="tag">' + t('private') + '</span>' : '';
    return '<div class="file folder" data-id="' + esc(fo.id) + '">' +
      '<div class="top"><div class="nm">' + ICON.folder + '<span>' + esc(fo.name) + '</span>' + tag + '</div>' +
      '<div class="meta">' + fo.count + ' ' + t('files_n') + '<br>' + rel(fo.updated) + '</div></div>' +
      '<div class="hint" style="margin:0 0 12px">' + t('by') + ' ' + esc(fo.ownerName) + ' · ' + fmt(fo.updated) + '</div>' +
      '<div class="actions"><button class="iconbtn op" title="' + t('open') + '">' + ICON.eye + '</button>' + favBtn('folder', fo.id, fo.fav) + '<button class="iconbtn more" title="' + t('options') + '">' + ICON.more + '</button></div></div>';
  }
  function bindFiles(scope, list) {
    Array.prototype.forEach.call(scope.querySelectorAll('.file'), function (node) {
      var kid = node.getAttribute('data-id'), f = null;
      for (var k = 0; k < list.length; k++) if (list[k].id === kid) f = list[k];
      if (!f) return;
      var cp = node.querySelector('.cp'); if (cp) cp.onclick = function () { copyText(node.querySelector('.raw input').value); toast(t('copy')); };
      var ed = node.querySelector('.ed'); if (ed) ed.onclick = function () { openModal(f.id); };
      var fv = node.querySelector('.fv'); if (fv) fv.onclick = function () { toggleFav('file', f.id, fv); };
      var more = node.querySelector('.more'); if (more) more.onclick = function () { openFileMenu(f); };
    });
  }
  function bindFolders(scope, list) {
    Array.prototype.forEach.call(scope.querySelectorAll('.file'), function (node) {
      var kid = node.getAttribute('data-id'), fo = null;
      for (var k = 0; k < list.length; k++) if (list[k].id === kid) fo = list[k];
      if (!fo) return;
      var op = node.querySelector('.op'); if (op) op.onclick = function () { openFolderPage(fo.id); };
      var fv = node.querySelector('.fv'); if (fv) fv.onclick = function () { toggleFav('folder', fo.id, fv); };
      var more = node.querySelector('.more'); if (more) more.onclick = function () { openFolderMenu(fo); };
    });
  }
  function toggleFav(type, id, btn) {
    api('/api/favorites', { method: 'POST', body: { type: type, id: id } }).then(function (d) {
      if (btn) { if (d.fav) btn.classList.add('on'); else btn.classList.remove('on'); btn.innerHTML = d.fav ? ICON.starfill : ICON.star; }
      loadFavorites(); loadFiles(); loadFolders();
    }).catch(function (e) { toast(e.message, true); });
  }
  function loadAll() { loadFiles(); loadFolders(); loadFavorites(); loadInvites(); }
  function loadFiles() { return api('/api/files').then(function (d) { state.files = d.files || []; if (!state.q && state.tab === 'files') renderView(); }).catch(function () { renderAuth('login'); }); }
  function loadFolders() { return api('/api/folders').then(function (d) { state.folders = d.folders || []; if (!state.q && state.tab === 'folders') renderView(); }).catch(function () {}); }
  function loadFavorites() { return api('/api/favorites').then(function (d) { state.fav = { files: d.files || [], folders: d.folders || [] }; }).catch(function () {}); }
  function loadInvites() {
    api('/api/invites').then(function (d) {
      state.invites = d.invites || [];
      var b = document.getElementById('menubadge');
      if (b) b.style.display = state.invites.length ? 'block' : 'none';
    }).catch(function () {});
  }
  function renderFiles() {
    var v = document.getElementById('view');
    v.innerHTML = '<div class="bar"><h2>' + t('my_folders') + '</h2><div class="baract">' +
      '<button class="btn small" id="newfolder">' + ICON.folder + ' ' + t('new_folder') + '</button></div></div>' +
      '<div class="grid" id="grid"></div>';
    var grid = document.getElementById('grid');
    document.getElementById('newfolder').onclick = function () { openFolderModal(); };
    if (!state.folders.length) { grid.innerHTML = emptyBox(ICON.folder, t('no_folders'), t('create_folder_first')); return; }
    grid.innerHTML = state.folders.map(folderCard).join('');
    bindFolders(grid, state.folders);
  }
  function runSearch() {
    var q = state.q;
    if (!q) { state.search = null; renderView(); return; }
    api('/api/search?q=' + encodeURIComponent(q)).then(function (d) {
      if (state.q !== q) return;
      state.search = d;
      if (state.q) renderSearch();
    }).catch(function (e) { toast(e.message, true); });
  }
  function renderSearch() {
    var v = document.getElementById('view');
    v.innerHTML = '<div class="sres" id="sres"></div>';
    var box = document.getElementById('sres');
    var d = state.search;
    if (!d) { box.innerHTML = '<div class="hint" style="margin:0">' + t('loading') + '</div>'; return; }
    if (!d.users.length && !d.files.length && !d.folders.length) { box.innerHTML = emptyBox(ICON.search, t('none'), ''); return; }
    var html = '';
    if (d.users.length) {
      html += '<div class="fsec">' + t('res_users') + '</div>';
      html += d.users.map(function (u) {
        return '<div class="uchip" data-name="' + esc(u.username) + '">' + avat(u) +
          '<div class="un"><span>' + esc(u.nick || u.username) + '</span>' +
          (u.nick ? '<span class="hint" style="margin:0">@' + esc(u.username) + '</span>' : '') + '</div>' +
          '<button class="btn small ' + (u.following ? 'ghost' : '') + ' fol" data-on="' + (u.following ? '1' : '0') + '" data-uid="' + esc(u.id) + '">' + (u.following ? ICON.check + ' ' + t('following') : ICON.userplus + ' ' + t('follow')) + '</button></div>';
      }).join('');
    }
    if (d.folders.length) {
      html += '<div class="fsec">' + t('res_folders') + '</div>';
      html += '<div class="grid" id="sfolders">' + d.folders.map(folderCard).join('') + '</div>';
    }
    if (d.files.length) {
      html += '<div class="fsec">' + t('res_files') + '</div>';
      html += '<div class="grid" id="sfiles">' + d.files.map(fileCard).join('') + '</div>';
    }
    box.innerHTML = html;
    if (d.folders.length) bindFolders(document.getElementById('sfolders'), d.folders);
    if (d.files.length) bindFiles(document.getElementById('sfiles'), d.files);
    Array.prototype.forEach.call(box.querySelectorAll('.uchip'), function (chip) {
      chip.onclick = function (e) {
        if (e.target.closest && e.target.closest('.fol')) return;
        openProfile(chip.getAttribute('data-name'));
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll('.fol'), function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var uid = b.getAttribute('data-uid');
        var wasOn = b.getAttribute('data-on') === '1';
        api('/api/follow/' + uid, { method: wasOn ? 'DELETE' : 'POST' }).then(function () {
          b.setAttribute('data-on', wasOn ? '0' : '1');
          b.className = 'btn small ' + (wasOn ? '' : 'ghost') + ' fol';
          b.innerHTML = wasOn ? ICON.userplus + ' ' + t('follow') : ICON.check + ' ' + t('following');
          loadFollowing();
        }).catch(function (er) { toast(er.message, true); });
      };
    });
  }
  function loadFollowing() { api('/api/following').then(function (d) { state.following = d.following || []; }).catch(function () {}); }
  function renderFolders() {
    var v = document.getElementById('view');
    v.innerHTML = '<div class="bar"><h2>' + t('nav_folders') + '</h2><div class="baract">' +
      '<button class="btn small" id="newfolder">' + ICON.folder + ' ' + t('new_folder') + '</button></div></div><div class="grid" id="fgrid"></div>';
    document.getElementById('newfolder').onclick = function () { openFolderModal(); };
    var grid = document.getElementById('fgrid');
    if (!state.folders.length) { grid.innerHTML = emptyBox(ICON.folder, t('no_folders'), t('new_folder')); return; }
    grid.innerHTML = state.folders.map(folderCard).join('');
    bindFolders(grid, state.folders);
  }
  function renderFavModal() {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.star + ' ' + t('nav_fav') + '</h3><div class="body" id="favbody">' +
      '<div class="hint">' + t('loading') + '</div></div>' +
      '<div class="foot"><button class="btn ghost" id="fvc">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#fvc').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    api('/api/favorites').then(function (d) {
      state.fav = { files: d.files || [], folders: d.folders || [] };
      var fl = state.fav.files, fo = state.fav.folders, body = overlay.querySelector('#favbody');
      if (!fl.length && !fo.length) { body.innerHTML = '<div class="hint" style="margin:0">' + t('no_fav') + '</div>'; return; }
      var html = '';
      if (fo.length) html += '<div class="fsec">' + t('res_folders') + '</div><div class="grid" id="ffav">' + fo.map(folderCard).join('') + '</div>';
      if (fl.length) html += '<div class="fsec">' + t('res_files') + '</div><div class="grid" id="gfav">' + fl.map(fileCard).join('') + '</div>';
      body.innerHTML = html;
      if (fo.length) bindFolders(document.getElementById('ffav'), fo);
      if (fl.length) bindFiles(document.getElementById('gfav'), fl);
      Array.prototype.forEach.call(body.querySelectorAll('.fv'), function (b) {
        var prev = b.onclick;
        b.onclick = function () {
          api('/api/favorites', { method: 'POST', body: { type: b.getAttribute('data-type'), id: b.getAttribute('data-id') } })
            .then(function () { overlay.remove(); renderFavModal(); loadFiles(); loadFolders(); })
            .catch(function (e) { toast(e.message, true); });
        };
      });
    }).catch(function (e) { toast(e.message, true); });
  }
  function openFolderView(fo) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    var list = fo.files || [];
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.folder + ' ' + esc(fo.name) + '</h3><div class="body">' +
      '<div class="hint" style="margin:0 0 12px">' + t('by') + ' ' + esc(fo.ownerName) + ' · ' + t('updated_at') + ' ' + fmt(fo.updated) + '</div>' +
      (list.length ? list.map(function (f) {
        return '<div class="hit"><div class="hn">' + ICON.file + '<span>' + esc(f.name) + '</span></div>' +
          '<div class="actions"><button class="iconbtn cpf" data-raw="' + esc(f.rawUrl || '') + '" title="' + t('copy') + '">' + ICON.copy + '</button>' +
          favBtn('file', f.id, f.fav) + '</div></div>';
      }).join('') : '<div class="hint">' + t('empty_folder') + '</div>') +
      '</div><div class="foot"><button class="btn ghost" id="fx">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#fx').onclick = function () { overlay.remove(); };
    Array.prototype.forEach.call(overlay.querySelectorAll('.cpf'), function (b) {
      b.onclick = function () { copyText(loader(b.getAttribute('data-raw'))); toast(t('copy')); };
    });
    Array.prototype.forEach.call(overlay.querySelectorAll('.fv'), function (b) {
      b.onclick = function () { toggleFav('file', b.getAttribute('data-id'), b); };
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openFileMenu(f) {
    if (!f) return;
    var owner = f.role === 'owner';
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.more + ' ' + esc(f.name) + '</h3><div class="body">' +
      '<button class="btn ghost" id="m-info">' + ICON.info + ' ' + t('info') + '</button>' +
      '<button class="btn ghost" id="m-fav">' + (f.fav ? ICON.starfill : ICON.star) + ' ' + (f.fav ? t('rm_fav') : t('add_fav')) + '</button>' +
      (owner ? '<button class="btn ghost" id="m-invite">' + ICON.userplus + ' ' + t('invite_others') + '</button>' : '') +
      (owner ? '<button class="btn ghost" id="m-move">' + ICON.folder + ' ' + t('add_to_folder') + '</button>' : '') +
      (owner ? '<button class="btn ghost" id="m-del">' + ICON.trash + ' ' + t('delete') + '</button>' : '') +
      '</div><div class="foot"><button class="btn ghost" id="m-close">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#m-close').onclick = function () { overlay.remove(); };
    overlay.querySelector('#m-info').onclick = function () { overlay.remove(); openInfo(f.id); };
    overlay.querySelector('#m-fav').onclick = function () {
      api('/api/favorites', { method: 'POST', body: { type: 'file', id: f.id } }).then(function () { overlay.remove(); loadFavorites(); loadFiles(); }).catch(function (e) { toast(e.message, true); });
    };
    if (overlay.querySelector('#m-invite')) overlay.querySelector('#m-invite').onclick = function () { overlay.remove(); openInvite(f.id); };
    if (overlay.querySelector('#m-move')) overlay.querySelector('#m-move').onclick = function () { overlay.remove(); openMove(f); };
    if (overlay.querySelector('#m-del')) overlay.querySelector('#m-del').onclick = function () {
      overlay.remove();
      confirmBox(t('confirm_title'), t('delete_confirm'), function () {
        api('/api/files/' + f.id, { method: 'DELETE' }).then(function () { loadFiles(); loadFavorites(); loadFolders(); }).catch(function (e) { toast(e.message, true); });
      });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openFolderMenu(fo) {
    if (!fo) return;
    var owner = fo.role === 'owner';
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.folder + ' ' + esc(fo.name) + '</h3><div class="body">' +
      '<div class="hint" style="margin:0 0 12px">' + t('updated_at') + ': ' + fmt(fo.updated) + '</div>' +
      '<button class="btn ghost" id="f-open">' + ICON.eye + ' ' + t('open') + '</button>' +
      '<button class="btn ghost" id="f-fav">' + (fo.fav ? ICON.starfill : ICON.star) + ' ' + (fo.fav ? t('rm_fav') : t('add_fav')) + '</button>' +
      (owner ? '<button class="btn ghost" id="f-edit">' + ICON.edit + ' ' + t('pick_files') + '</button>' : '') +
      (owner ? '<button class="btn ghost" id="f-vis">' + (fo.visibility === 'private' ? ICON.eyeoff : ICON.eye) + ' ' + t('toggle_vis') + ': ' + (fo.visibility === 'private' ? t('vis_private') : t('vis_public')) + '</button>' : '') +
      (owner ? '<button class="btn ghost" id="f-del">' + ICON.trash + ' ' + t('delete') + '</button>' : '') +
      '</div><div class="foot"><button class="btn ghost" id="f-close">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#f-close').onclick = function () { overlay.remove(); };
    overlay.querySelector('#f-open').onclick = function () { overlay.remove(); openFolderView(fo); };
    overlay.querySelector('#f-fav').onclick = function () {
      api('/api/favorites', { method: 'POST', body: { type: 'folder', id: fo.id } }).then(function () { overlay.remove(); loadFavorites(); loadFolders(); }).catch(function (e) { toast(e.message, true); });
    };
    if (overlay.querySelector('#f-edit')) overlay.querySelector('#f-edit').onclick = function () { overlay.remove(); openFolderModal(fo); };
    if (overlay.querySelector('#f-vis')) overlay.querySelector('#f-vis').onclick = function () {
      var nv = fo.visibility === 'private' ? 'public' : 'private';
      api('/api/folders/' + fo.id, { method: 'PUT', body: { visibility: nv } }).then(function () { overlay.remove(); loadFolders(); toast(t('saved')); }).catch(function (e) { toast(e.message, true); });
    };
    if (overlay.querySelector('#f-del')) overlay.querySelector('#f-del').onclick = function () {
      overlay.remove();
      confirmBox(t('confirm_title'), t('delete_confirm'), function () {
        api('/api/folders/' + fo.id, { method: 'DELETE' }).then(function () { loadFolders(); loadFiles(); loadFavorites(); }).catch(function (e) { toast(e.message, true); });
      });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openMove(f) {
    var opts = [{ value: '', label: t('no_folder') }];
    state.folders.filter(function (fo) { return fo.role === 'owner'; }).forEach(function (fo) {
      opts.push({ value: fo.id, label: fo.name, icon: ICON.folder });
    });
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.folder + ' ' + t('add_to_folder') + '</h3><div class="body">' +
      '<div class="field" style="margin:0">' + picker('mvpick', opts, f.folder || '', t('no_folder')) + '</div>' +
      '</div><div class="foot"><button class="btn ghost" id="mvc">' + t('cancel') + '</button><button class="btn" id="mvs">' + t('move') + '</button></div></div>';
    document.body.appendChild(overlay);
    bindPicker(overlay, 'mvpick');
    overlay.querySelector('#mvc').onclick = function () { overlay.remove(); };
    overlay.querySelector('#mvs').onclick = function () {
      var target = pickerVal(overlay, 'mvpick');
      api('/api/files/' + f.id, { method: 'PUT', body: { folder: target || null } })
        .then(function () { overlay.remove(); loadFiles(); loadFolders(); toast(t('saved')); }).catch(function (e) { toast(e.message, true); });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openFolderModal(fo) {
    var editing = !!fo;
    var visOpts = [{ value: 'public', label: t('vis_public'), icon: ICON.eye }, { value: 'private', label: t('vis_private'), icon: ICON.eyeoff }];
    var sel = [];
    if (editing && fo.files) fo.files.forEach(function (f) { sel.push(f.id); });
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal"><h3>' + (editing ? ICON.edit + ' ' + t('pick_files') : ICON.folder + ' ' + t('new_folder')) + '</h3><div class="body">' +
      '<div class="field"><label>' + ICON.folder + ' ' + t('folder_name') + '</label><input class="input" id="foname" placeholder="myfolder" spellcheck="false" value="' + (editing ? esc(fo.name) : '') + '"></div>' +
      '<div class="field"><label>' + ICON.eye + ' ' + t('visibility') + '</label>' + picker('fovispick', visOpts, editing ? fo.visibility : 'public', t('pick_placeholder')) + '<div class="hint" id="fovishint">' + (editing && fo.visibility === 'private' ? t('private_hint') : t('public_hint')) + '</div></div>' +
      '<div class="field"><label>' + ICON.file + ' ' + t('folder_desc') + '</label><input class="input" id="fodesc" maxlength="300" placeholder="' + t('folder_desc_ph') + '" value="' + (editing ? esc(fo.desc || '') : '') + '"></div>' +
      '<div class="field"><label>' + ICON.camera + ' ' + t('folder_pic') + '</label>' +
      '<button class="btn ghost" id="foavpick" type="button">' + ICON.camera + ' ' + t('change_photo') + '</button>' +
      '<input type="file" id="foavfile" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none">' +
      '<div class="hint" id="foavname">' + (editing && fo.avatar ? t('folder_pic_set') : t('no_file')) + '</div></div>' +
      '<div class="field"><label>' + ICON.file + ' ' + t('select_files') + '</label><div id="fofiles"><div class="hint">' + t('loading') + '</div></div></div>' +
      '</div><div class="foot"><button class="btn ghost" id="foc">' + t('cancel') + '</button><button class="btn" id="fos">' + (editing ? t('save') : t('create')) + '</button></div></div>';
    document.body.appendChild(overlay);
    bindPicker(overlay, 'fovispick', function (v) {
      var h = overlay.querySelector('#fovishint'); if (h) h.textContent = v === 'private' ? t('private_hint') : t('public_hint');
    });
    var nameEl = overlay.querySelector('#foname');
    api('/api/files').then(function (d) {
      var my = (d.files || []).filter(function (f) { return f.role === 'owner'; });
      var box = overlay.querySelector('#fofiles');
      if (!my.length) { box.innerHTML = '<div class="hint">' + t('no_files') + '</div>'; return; }
      box.innerHTML = my.map(function (f) {
        var on = sel.indexOf(f.id) >= 0;
        return '<label class="chk"><input type="checkbox" value="' + esc(f.id) + '"' + (on ? ' checked' : '') + '> ' + ICON.file + ' ' + esc(f.name) + '<span class="cc">' + rel(f.updated) + '</span></label>';
      }).join('');
    }).catch(function (e) { overlay.querySelector('#fofiles').innerHTML = '<div class="hint">' + esc(e.message) + '</div>'; });
    if (!editing) nameEl.focus();
    overlay.querySelector('#foc').onclick = function () { overlay.remove(); };
    var foAv = editing ? (fo.avatar || '') : '';
    var foAvBtn = overlay.querySelector('#foavpick'), foAvFile = overlay.querySelector('#foavfile');
    if (foAvBtn) foAvBtn.onclick = function () { foAvFile.click(); };
    if (foAvFile) foAvFile.addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      if (file.size > 300 * 1024) { toast(t('img_too_big'), true); return; }
      var rd = new FileReader();
      rd.onload = function () {
        foAv = String(rd.result || '');
        var el = overlay.querySelector('#foavname');
        if (el) el.textContent = file.name;
      };
      rd.readAsDataURL(file);
    });
    overlay.querySelector('#fos').onclick = function () {
      var picks = [];
      Array.prototype.forEach.call(overlay.querySelectorAll('#fofiles input:checked'), function (c) { picks.push(c.value); });
      var body = { name: nameEl.value.trim(), files: picks, visibility: pickerVal(overlay, 'fovispick') || 'public', desc: (overlay.querySelector('#fodesc') || {}).value || '', avatar: foAv };
      api(editing ? '/api/folders/' + fo.id : '/api/folders', { method: editing ? 'PUT' : 'POST', body: body })
        .then(function () { overlay.remove(); loadFolders(); loadFiles(); toast(t('saved')); }).catch(function (e) { toast(e.message, true); });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function openFolderPage(foId) {
    var fo = state.folders.filter(function (x) { return x.id === foId; })[0];
    if (!fo) { toast(t('none'), true); return; }
    api('/api/folders/' + foId).then(function (d) {
      var f = d.folder || fo;
      var files = (f.files || []);
      app.innerHTML = '<div class="folderpage">' +
        '<div class="fphead">' +
        '<button class="iconbtn" id="fpback">' + ICON.back + '</button>' +
        '<div class="fpav">' + (f.avatar ? '<img src="' + esc(f.avatar) + '" alt="">' : ICON.folder) + '</div>' +
        '<div class="fpinfo"><div class="fpname">' + esc(f.name) + (f.visibility === 'private' ? ' <span class="tag">' + t('private') + '</span>' : '') + '</div>' +
        '<div class="fpsub">' + files.length + ' ' + t('files_n') + '</div></div>' +
        '<button class="btn small" id="fpnew">' + ICON.plus + ' ' + t('new_file') + '</button>' +
        '<button class="btn ghost small" id="fpedit">' + ICON.edit + '</button>' +
        '</div>' +
        (f.desc ? '<div class="fpdesc">' + esc(f.desc) + '</div>' : '') +
        '<div class="grid" id="fpgrid"></div></div>';
      var grid = document.getElementById('fpgrid');
      if (!files.length) grid.innerHTML = '<div class="empty">' + ICON.folder + '<p>' + t('empty_folder') + '</p></div>';
      else { grid.innerHTML = files.map(fileCard).join(''); bindFiles(grid, files); }
      document.getElementById('fpback').onclick = function () { renderApp(); loadAll(); };
      document.getElementById('fpnew').onclick = function () { openModal(null, foId); };
      document.getElementById('fpedit').onclick = function () { openFolderModal(f); };
    }).catch(function (e) { toast(e.message, true); });
  }

  function openModal(id, presetFolder) {
    var editing = !!id;
    var visOpts = [{ value: 'public', label: t('vis_public'), icon: ICON.eye }, { value: 'private', label: t('vis_private'), icon: ICON.eyeoff }];
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal">' +
      '<h3>' + (editing ? ICON.edit + ' ' + t('edit_file') : ICON.plus + ' ' + t('create_file')) + '</h3>' +
      '<div class="body">' +
      '<div class="field"><label>' + ICON.file + ' ' + t('file_name') + '</label><input class="input" id="fname" placeholder="myscript" spellcheck="false"></div>' +
      '<div class="field"><label>' + ICON.folder + ' ' + t('folder_required') + '</label>' +
      (presetFolder ? '<div class="hint" style="margin:0">' + t('in_folder') + '</div>' :
        picker('ffolderpick', [{ value: '', label: t('pick_placeholder') }], '', t('pick_placeholder')) + '<div class="hint">' + t('folder_vis_hint') + '</div>') + '</div>' +
      '<div class="field"><label>' + ICON.code + ' ' + t('code') + '</label><textarea class="input" id="fcode" placeholder="print(&quot;hello&quot;)"></textarea></div>' +
      '<div class="field"><label>' + ICON.file + ' ' + t('upload_file') + '</label>' +
      '<button class="btn ghost uploadbtn" id="fpick" type="button">' + ICON.file + ' ' + t('choose_file') + '</button>' +
      '<input type="file" id="ffile" accept=".lua,.txt,.js,.json,text/plain" style="display:none">' +
      '<div class="hint" id="ffname">' + t('no_file') + '</div></div>' +
      (editing ? '' : ('<div class="field"><label>' + ICON.eye + ' ' + t('raw_lock_q') + '</label>' +
        '<label class="chk"><input type="checkbox" id="flock" checked> ' + t('raw_lock_yes') + '</label></div>' +
        '<div class="field"><label>' + ICON.link + ' ' + t('deliver_q') + '</label>' + picker('fdeliverpick', [
          { value: 'raw', label: t('deliver_raw'), icon: ICON.link },
          { value: 'ready', label: t('deliver_ready'), icon: ICON.code }
        ], 'raw', t('pick_placeholder')) + '</div>')) +
      '<div class="hint">' + t('raw_hint') + '</div></div>' +
      '<div class="foot"><button class="btn ghost" id="cancel">' + t('cancel') + '</button><button class="btn" id="save">' + (editing ? t('save') : t('create')) + '</button></div></div>';
    document.body.appendChild(overlay);
    var nameEl = overlay.querySelector('#fname'), codeEl = overlay.querySelector('#fcode');
    if (!presetFolder) bindPicker(overlay, 'ffolderpick');
    if (!editing) bindPicker(overlay, 'fdeliverpick');
    var foOpts = [];
    state.folders.filter(function (x) { return x.role === 'owner'; }).forEach(function (fo) { foOpts.push({ value: fo.id, label: fo.name, icon: ICON.folder }); });
    var fw = overlay.querySelector('#ffolderpick .pklist');
    if (fw) {
      fw.innerHTML = foOpts.map(function (o) {
        return '<button type="button" class="pkitem" data-value="' + esc(o.value) + '">' + (o.icon || '') + '<span>' + esc(o.label) + '</span></button>';
      }).join('');
      bindPicker(overlay, 'ffolderpick');
    }
    overlay.querySelector('#fpick').onclick = function () { overlay.querySelector('#ffile').click(); };
    overlay.querySelector('#ffile').addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      overlay.querySelector('#ffname').textContent = file.name;
      var reader = new FileReader();
      reader.onload = function () { codeEl.value = String(reader.result || ''); if (!nameEl.value.trim()) nameEl.value = file.name.replace(/\.[^.]+$/, ''); };
      reader.readAsText(file);
    });
    if (editing) api('/api/files/' + id).then(function (d) {
      nameEl.value = d.name; codeEl.value = d.code;
      var fl = overlay.querySelector('#ffolderpick .pklist');
      if (fl) { fl.setAttribute('data-val', d.folder || ''); var lb2 = overlay.querySelector('#ffolderpick .pklabel'); if (lb2) { var found = foOpts.filter(function (o) { return o.value === (d.folder || ''); })[0]; lb2.textContent = found ? found.label : t('no_folder'); } }
    }).catch(function (e) { toast(e.message, true); overlay.remove(); });
    else nameEl.focus();
    overlay.querySelector('#cancel').onclick = function () { overlay.remove(); };
    overlay.querySelector('#save').onclick = function () {
      var folderId = presetFolder || pickerVal(overlay, 'ffolderpick') || '';
      if (!folderId) { toast(t('folder_required_toast'), true); return; }
      var body = { name: nameEl.value.trim(), code: codeEl.value, folder: folderId };
      if (!editing) {
        var lk = overlay.querySelector('#flock');
        body.lockPage = lk ? !!lk.checked : true;
        body.deliver = pickerVal(overlay, 'fdeliverpick') || 'raw';
      }
      api(editing ? '/api/files/' + id : '/api/files', { method: editing ? 'PUT' : 'POST', body: body })
        .then(function () { overlay.remove(); loadFiles(); loadFolders(); toast(t('saved')); })
        .catch(function (e) { toast(e.message, true); });
    };
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
  function openProfile(name) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.user + ' ' + esc(name) + '</h3><div class="body" id="pfbody"><div class="hint">' + t('loading') + '</div></div><div class="foot"><button class="btn ghost" id="pfc">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#pfc').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    api('/api/users/' + encodeURIComponent(name)).then(function (d) {
      var body = overlay.querySelector('#pfbody');
      var head = '<div class="pfhead">' + avat(d.user, 'big') + '<div><div class="pn">' + esc(d.user.nick || d.user.username) + (d.premium ? ' ' + ICON.crown : '') + '</div>' +
        (d.user.nick ? '<div class="hint" style="margin:0">@' + esc(d.user.username) + '</div>' : '') +
        '<div class="hint" style="margin:0">' + d.followers + ' ' + t('followers_t') + ' · ' + d.followingCount + ' ' + t('following_t') + '</div></div></div>';
      var act = '';
      if (d.isSelf) act = '<button class="btn" id="pfedit">' + ICON.edit + ' ' + t('edit_profile') + '</button>';
      else act = '<button class="btn ' + (d.following ? 'ghost' : '') + ' folp" data-uid="' + esc(d.user.id) + '">' + (d.following ? ICON.check + ' ' + t('following') : ICON.userplus + ' ' + t('follow')) + '</button>';
      var html = head + act;
      if (d.files.length) html += '<div class="fsec">' + t('res_files') + '</div><div class="grid" id="pfiles">' + d.files.map(fileCard).join('') + '</div>';
      if (d.folders.length) html += '<div class="fsec">' + t('res_folders') + '</div><div class="grid" id="pfol">' + d.folders.map(folderCard).join('') + '</div>';
      if (!d.files.length && !d.folders.length) html += '<div class="hint">' + t('none') + '</div>';
      body.innerHTML = html;
      if (d.files.length) bindFiles(document.getElementById('pfiles'), d.files);
      if (d.folders.length) bindFolders(document.getElementById('pfol'), d.folders);
      var fb = body.querySelector('.folp');
      if (fb) fb.onclick = function () {
        api('/api/follow/' + fb.getAttribute('data-uid'), { method: d.following ? 'DELETE' : 'POST' }).then(function () { overlay.remove(); openProfile(name); loadFollowing(); }).catch(function (e) { toast(e.message, true); });
      };
      var pe = body.querySelector('#pfedit');
      if (pe) pe.onclick = function () { overlay.remove(); openEditProfile(); };
    }).catch(function (e) { overlay.querySelector('#pfbody').textContent = e.message; });
  }
  function openEditProfile() {
    var me = state.user || {};
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.user + ' ' + t('edit_profile') + '</h3><div class="body">' +
      '<div class="avpick"><span id="avprev">' + avat(me, 'big') + '</span>' +
      '<div style="display:flex;flex-direction:column;gap:7px;flex:1"><button class="btn ghost" id="avpick" type="button">' + ICON.camera + ' ' + t('change_photo') + '</button>' +
      '<button class="btn ghost" id="avrm" type="button">' + ICON.x + ' ' + t('remove_photo') + '</button></div></div>' +
      '<input type="file" id="avfile" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none">' +
      '<div class="field" style="margin-top:14px"><label>' + ICON.user + ' ' + t('nickname') + '</label><input class="input" id="pfnick" maxlength="32" placeholder="' + t('nickname') + '" spellcheck="false" value="' + esc(me.nick || '') + '"></div>' +
      '<div class="hint">@' + esc(me.username || '') + '</div>' +
      '</div><div class="foot"><button class="btn ghost" id="pfcancel">' + t('cancel') + '</button><button class="btn" id="pfsave">' + t('save') + '</button></div></div>';
    document.body.appendChild(overlay);
    var pending = me.avatar || '';
    var prev = overlay.querySelector('#avprev');
    function paintPreview() { prev.innerHTML = avat({ avatar: pending }, 'big'); }
    overlay.querySelector('#avpick').onclick = function () { overlay.querySelector('#avfile').click(); };
    overlay.querySelector('#avfile').addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      if (file.size > 300 * 1024) { toast(t('change_photo') + ': 300KB', true); return; }
      var reader = new FileReader();
      reader.onload = function () { pending = String(reader.result || ''); paintPreview(); };
      reader.readAsDataURL(file);
    });
    overlay.querySelector('#avrm').onclick = function () { pending = ''; paintPreview(); };
    overlay.querySelector('#pfcancel').onclick = function () { overlay.remove(); };
    overlay.querySelector('#pfsave').onclick = function () {
      var nick = overlay.querySelector('#pfnick').value.trim();
      api('/api/profile', { method: 'PUT', body: { nick: nick, avatar: pending } }).then(function (d) {
        state.user = d.user;
        overlay.remove();
        if (document.getElementById('menu')) {
          var who = document.querySelector('header .who');
          if (who) who.innerHTML = avat(state.user) + '<span>' + esc(state.user.nick || state.user.username) + '</span>';
        }
        toast(t('profile_saved'));
      }).catch(function (e) { toast(e.message, true); });
    };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }
  function lvlIcon(n) {
    var bars = '';
    for (var i = 1; i <= 5; i++) {
      var hh = 3 + i * 2;
      var on = i <= n;
      bars += '<rect x="' + ((i - 1) * 4) + '" y="' + (13 - hh) + '" width="2.6" height="' + hh +
        '" rx="1" fill="' + (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1"></rect>';
    }
    return '<svg viewBox="0 0 20 14" width="17" height="12" style="flex:0 0 auto">' + bars + '</svg>';
  }
  function mountAiOrb() {
    if (!state.user || !state.user.premium) {
      var old = document.getElementById('aiorb'); if (old) old.remove();
      var oldp = document.getElementById('aipanel'); if (oldp) oldp.remove();
      return;
    }
    if (document.getElementById('aiorb')) return;
    var orb = document.createElement('button');
    orb.id = 'aiorb';
    orb.type = 'button';
    orb.title = 'AI';
    orb.innerHTML = '<img src="https://files.catbox.moe/okwlyx.png" alt="">';
    var pos = { x: null, y: null };
    try { var sv = JSON.parse(localStorage.getItem('aiOrbPos') || 'null'); if (sv) pos = sv; } catch (e) {}
    orb.style.left = (pos.x === null ? (window.innerWidth - 92) : pos.x) + 'px';
    orb.style.top = (pos.y === null ? (window.innerHeight - 130) : pos.y) + 'px';
    document.body.appendChild(orb);

    var drag = null;
    function startDrag(e) {
      var p = e.touches ? e.touches[0] : e;
      drag = { dx: p.clientX - orb.offsetLeft, dy: p.clientY - orb.offsetTop, moved: false };
      e.preventDefault();
    }
    function moveDrag(e) {
      if (!drag) return;
      var p = e.touches ? e.touches[0] : e;
      var nx = Math.max(8, Math.min(window.innerWidth - 72, p.clientX - drag.dx));
      var ny = Math.max(8, Math.min(window.innerHeight - 72, p.clientY - drag.dy));
      if (Math.abs(nx - orb.offsetLeft) > 3 || Math.abs(ny - orb.offsetTop) > 3) drag.moved = true;
      orb.style.left = nx + 'px';
      orb.style.top = ny + 'px';
      e.preventDefault();
    }
    var lastToggle = 0;
    function toggleAi() {
      var now = Date.now();
      if (now - lastToggle < 400) return;
      lastToggle = now;
      openAi();
    }
    function endDrag() {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      try { localStorage.setItem('aiOrbPos', JSON.stringify({ x: orb.offsetLeft, y: orb.offsetTop })); } catch (e) {}
      if (!moved) toggleAi();
    }
    orb.addEventListener('click', function (e) {
      e.preventDefault();
      if (drag && drag.moved) return;
      toggleAi();
    });
    orb.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('mouseup', endDrag);
    orb.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', moveDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
  }

  var aiState = { messages: [], model: 'deepseek-chat', context: '', left: 0, limit: 0 };

  function openAi() {
    var ex = document.getElementById('aipanel');
    if (ex) { ex.remove(); return; }
    var panel = document.createElement('div');
    panel.id = 'aipanel';
    panel.innerHTML = '<div class="aihead"><b>🤖 AI (DeepSeek)</b>' +
      '<select id="aimodel" class="aisel"><option value="deepseek-chat">deepseek-chat</option><option value="deepseek-reasoner">deepseek-reasoner</option></select>' +
      '<button class="iconbtn" id="aiclose">' + ICON.x + '</button></div>' +
      '<div class="aibody" id="aibody"></div>' +
      '<div class="aibar"><button class="iconbtn" id="aifile" title="' + t('ai_attach') + '">' + ICON.file + '</button>' +
      '<span class="aictx" id="aictx"></span>' +
      '<textarea class="aiinput" id="aiinput" rows="2" placeholder="' + t('ai_ph') + '"></textarea>' +
      '<button class="btn small" id="aisend">' + t('ai_send') + '</button></div>' +
      '<div class="aifoot" id="aifoot"></div>';
    panel.style.zIndex = '9999';
    document.body.appendChild(panel);
    var body = panel.querySelector('#aibody');
    panel.querySelector('#aiclose').onclick = function () { panel.remove(); };
    panel.querySelector('#aimodel').value = aiState.model;
    panel.querySelector('#aimodel').onchange = function (e) { aiState.model = e.target.value; };
    panel.querySelector('#aifile').onclick = attachForAi;
    function paint() {
      body.innerHTML = aiState.messages.map(function (m) {
        return '<div class="aimsg ' + (m.role === 'assistant' ? 'bot' : 'me') + '"><pre>' + esc(m.content) + '</pre></div>';
      }).join('') || '<div class="hint" style="margin:10px">' + t('ai_empty') + '</div>';
      body.scrollTop = body.scrollHeight;
      var f = panel.querySelector('#aifoot');
      if (f) f.textContent = t('ai_left') + ' ' + aiState.left.toLocaleString() + ' / ' + aiState.limit.toLocaleString();
    }
    api('/api/ai/status').then(function (d) {
      aiState.left = d.left; aiState.limit = d.limit;
      if (!d.enabled) body.innerHTML = '<div class="hint" style="margin:10px">' + t('ai_nokey') + '</div>';
      paint();
    }).catch(function () { paint(); });
    paint();
    function send() {
      var ta = panel.querySelector('#aiinput');
      var text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      aiState.messages.push({ role: 'user', content: text });
      paint();
      api('/api/ai/chat', { method: 'POST', body: { model: aiState.model, messages: aiState.messages, context: aiState.context } })
        .then(function (d) {
          aiState.messages.push({ role: 'assistant', content: d.reply });
          aiState.left = d.left;
          paint();
        })
        .catch(function (e) {
          aiState.messages.push({ role: 'assistant', content: '⚠️ ' + e.message });
          paint();
        });
    }
    panel.querySelector('#aisend').onclick = send;
    panel.querySelector('#aiinput').onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };
    paint();
  }

  function attachForAi() {
    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    var files = state.files || [];
    var folders = (state.folders || []).filter(function (f) { return f.role === 'owner'; });
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.file + ' ' + t('ai_attach') + '</h3>' +
      '<div class="body aimodal">' +
      '<div class="fsec">' + t('res_files') + '</div>' +
      (files.length ? files.map(function (f) { return '<button class="btn ghost aifile" data-id="' + esc(f.id) + '">' + ICON.file + ' ' + esc(f.name) + '</button>'; }).join('') : '<div class="hint">' + t('no_files') + '</div>') +
      '<div class="fsec">' + t('res_folders') + '</div>' +
      (folders.length ? folders.map(function (f) { return '<button class="btn ghost aifold" data-id="' + esc(f.id) + '">' + ICON.folder + ' ' + esc(f.name) + '</button>'; }).join('') : '<div class="hint">' + t('no_folders') + '</div>') +
      '</div><div class="foot"><button class="btn ghost" id="aicancel">' + t('cancel') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#aicancel').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    Array.prototype.forEach.call(overlay.querySelectorAll('.aifile'), function (b) {
      b.onclick = function () {
        api('/api/files/' + b.getAttribute('data-id')).then(function (d) {
          aiState.context += '\\n--- ไฟล์: ' + d.name + ' ---\\n' + d.code;
          var c = document.getElementById('aictx'); if (c) c.textContent = t('ai_ctx_on');
          overlay.remove();
        }).catch(function (e) { toast(e.message, true); });
      };
    });
    Array.prototype.forEach.call(overlay.querySelectorAll('.aifold'), function (b) {
      b.onclick = function () {
        api('/api/folders/' + b.getAttribute('data-id')).then(function (d) {
          var list = (d.folder.files || []);
          var out = [];
          var i = 0;
          (function next() {
            if (i >= list.length) {
              aiState.context += '\\n--- โฟลเดอร์: ' + d.folder.name + ' ---\\n' + out.join('\\n');
              var c = document.getElementById('aictx'); if (c) c.textContent = t('ai_ctx_on');
              overlay.remove();
              return;
            }
            api('/api/files/' + list[i].id).then(function (f) {
              out.push('### ' + f.name + '\\n' + f.code);
              i++; next();
            }).catch(function () { i++; next(); });
          })();
        }).catch(function (e) { toast(e.message, true); });
      };
    });
  }

  function openStats() {
    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.chart + ' ' + t('stats') + '</h3>' +
      '<div class="body" id="stbody"><div class="hint">' + t('loading') + '</div></div>' +
      '<div class="foot"><button class="btn ghost" id="stclose">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#stclose').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    api('/api/stats').then(function (d) {
      var rows = [
        [ICON.user, t('stat_users'), d.users],
        [ICON.file, t('stat_files'), d.files],
        [ICON.folder, t('stat_folders'), d.folders],
        [ICON.eye, t('stat_public'), d.publicFiles]
      ];
      overlay.querySelector('#stbody').innerHTML = rows.map(function (r) {
        return '<div class="statrow">' + r[0] + '<span class="statlab">' + esc(r[1]) + '</span><b class="statnum">' + r[2] + '</b></div>';
      }).join('');
    }).catch(function (e) { overlay.querySelector('#stbody').textContent = e.message; });
  }

  function openPremium() {
    var me = state.user || {};
    var isPrem = !!me.premium;
    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.crown + ' ' + t('premium_signup') + '</h3>' +
      '<div class="body">' +
      (isPrem ? '<div class="hint" style="margin:0 0 10px">' + t('premium_active') + '</div>' : '') +
      '<div class="planbox"><div class="planhead">' + t('plan_1m') + '</div><div class="planprice">' + PRICE_1M + ' ' + t('baht') + '</div></div>' +
      '<div class="planbox"><div class="planhead">' + t('plan_1y') + ' <span class="updnew">' + t('best_value') + '</span></div><div class="planprice">' + PRICE_1Y + ' ' + t('baht') + '</div></div>' +
      '<div class="fsec">' + t('premium_perks') + '</div>' +
      '<div class="perklist">' +
      [t('perk_lv'), t('perk_times'), t('perk_crown'), t('perk_size')].map(function (x) {
        return '<div class="perkrow">' + ICON.check + '<span>' + x + '</span></div>';
      }).join('') +
      '</div>' +
      '<div class="hint">' + t('premium_buy_hint') + '</div>' +
      '</div><div class="foot">' +
      '<button class="btn ghost" id="pclose">' + t('close') + '</button>' +
      '<a class="btn" href="' + esc(PREMIUM_INVITE) + '" target="_blank" rel="noopener">' + ICON.discord + ' ' + t('premium_join') + '</a>' +
      '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#pclose').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  var THEMES = [
    { id: 'mono',   name: 'ดำ-ขาว',   fg: '#f5f5f5', bg: '#000000', bg2: '#0a0a0a', line2: '#2a2a2a', muted: '#8a8a8a' },
    { id: 'red',    name: 'แดง',      fg: '#ff5c5c', bg: '#0a0000', bg2: '#140505', line2: '#3a1414', muted: '#9c6b6b' },
    { id: 'orange', name: 'ส้ม',      fg: '#ffa64d', bg: '#0a0600', bg2: '#140d03', line2: '#3a2a12', muted: '#a08462' },
    { id: 'green',  name: 'เขียว',    fg: '#4ade80', bg: '#000a04', bg2: '#03140a', line2: '#123a22', muted: '#6b9c7d' },
    { id: 'cyan',   name: 'ฟ้า',      fg: '#38d6f5', bg: '#00070a', bg2: '#031014', line2: '#12363a', muted: '#629aa0' },
    { id: 'blue',   name: 'น้ำเงิน',  fg: '#6b8dff', bg: '#00030a', bg2: '#030814', line2: '#12203a', muted: '#6b7ca0' },
    { id: 'purple', name: 'ม่วง',     fg: '#c084fc', bg: '#06000a', bg2: '#0c0314', line2: '#2a123a', muted: '#8f6ba0' }
  ];

  function applyTheme(id) {
    var th = THEMES.filter(function (x) { return x.id === id; })[0] || THEMES[0];
    var r = document.documentElement.style;
    r.setProperty('--fg', th.fg);
    r.setProperty('--bg', th.bg);
    r.setProperty('--bg2', th.bg2);
    r.setProperty('--line2', th.line2);
    r.setProperty('--muted', th.muted);
    try { localStorage.setItem('theme', th.id); } catch (e) {}
    state.theme = th.id;
  }

  function loadTheme() {
    var id = 'mono';
    try { id = localStorage.getItem('theme') || 'mono'; } catch (e) {}
    applyTheme(id);
  }

  function openTheme() {
    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.palette + ' ' + t('theme') + '</h3>' +
      '<div class="body"><div class="themegrid">' +
      THEMES.map(function (th) {
        var on = (state.theme || 'mono') === th.id;
        return '<button type="button" class="themebtn' + (on ? ' on' : '') + '" data-theme="' + th.id + '">' +
          '<span class="dotswatch" style="background:' + th.fg + '"></span><span>' + esc(th.name) + '</span></button>';
      }).join('') +
      '</div></div><div class="foot"><button class="btn ghost" id="thclose">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    Array.prototype.forEach.call(overlay.querySelectorAll('.themebtn'), function (b) {
      b.onclick = function () {
        applyTheme(b.getAttribute('data-theme'));
        Array.prototype.forEach.call(overlay.querySelectorAll('.themebtn'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        toast(t('saved'));
      };
    });
    overlay.querySelector('#thclose').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  var CHANGELOG = __CHANGELOG_JSON__;
  var PREMIUM_INVITE = '__PREMIUM_INVITE__';
  var PRICE_1M = __PRICE_1M__;
  var PRICE_1Y = __PRICE_1Y__;
  var TURNSTILE_SITE = '__TURNSTILE_SITE__';

  function openUpdates() {
    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    var rows = CHANGELOG.map(function (c) {
      var latest = c === CHANGELOG[0] ? '<span class="updnew">' + t('latest') + '</span>' : '';
      return '<div class="updbox"><div class="updhead"><b>' + esc(c.v) + latest + '</b><span class="upddate">' + esc(c.date) + '</span></div>' +
        '<ul class="updlist">' + c.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.info + ' ' + t('updates') + '</h3>' +
      '<div class="body updbody">' + rows + '</div>' +
      '<div class="foot"><button class="btn ghost" id="updclose">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#updclose').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  function openObfuscator() {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal"><h3>' + ICON.lock + ' ' + t('obf_title') + '</h3><div class="body">' +
      '<div class="field"><label>' + ICON.code + ' ' + t('obf_input') + '</label>' +
      '<textarea class="input monoarea" id="obfin" placeholder="' + t('obf_input_ph') + '" spellcheck="false"></textarea>' +
      '<div class="obfrow" style="margin-top:8px"><button class="btn ghost small" id="obfpick" type="button">' + ICON.file + ' ' + t('obf_pick') + '</button>' +
      '<span class="obfstat" id="obffname">' + t('obf_no_file') + '</span></div>' +
      '<input type="file" id="obffile" accept=".lua,.txt,text/plain" style="display:none"></div>' +
      '<div class="field"><label>' + ICON.shield + ' ' + t('obf_level') + '</label>' +
      '<div class="lvlrow" id="obflvrow">' +
      [1, 2, 3, 4, 5, 6].map(function (n) {
        var locked = n > (state.maxLevel || 3);
        return '<button type="button" class="lvlbtn' + (n === 3 ? ' on' : '') + (locked ? ' locked' : '') + '" data-lv="' + n + '">' +
          (locked ? ICON.lock : lvlIcon(n)) + '<span>' + n + '</span></button>';
      }).join('') + '</div>' +
      '<div class="hint" id="obflvhint">' + t('obf_lv3_hint') + '</div></div>' +
      '<div class="field"><label>' + ICON.settings + ' ' + t('obf_remote') + '</label>' +
      '<label class="chk"><input type="checkbox" id="obfRemote"> ' + t('obf_remote_on') + '</label></div>' +
      '<div class="obfrow"><span class="obfstat" id="obfstat"></span><span class="obfstat" id="obfquota"></span></div>' +
      '<div class="obfrow"><span></span>' +
      '<div style="display:flex;gap:8px"><button class="btn ghost small" id="obfclear">' + t('obf_clear') + '</button>' +
      '<button class="btn small" id="obfrun">' + ICON.lock + ' ' + t('obf_run') + '</button></div></div>' +
      '<div class="field" style="margin-top:14px"><label>' + ICON.file + ' ' + t('obf_output') + '</label>' +
      '<pre class="obfout" id="obfout">' + t('none') + '</pre>' +
      '<div class="obfrow" style="margin-top:8px"><button class="btn ghost small" id="obfcopy">' + ICON.copy + ' ' + t('obf_copy') + '</button>' +
      '<button class="btn ghost small" id="obfsavebtn">' + ICON.plus + ' ' + t('obf_save') + '</button>' +
      '<button class="btn ghost small" id="obfeditbtn">' + ICON.edit + ' ' + t('obf_edit') + '</button></div></div>' +
      '</div><div class="foot"><button class="btn ghost" id="obfclose">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#obfclose').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    var quotaLeft = -1;
    var quotaEl = overlay.querySelector('#obfquota');
    var runBtn = overlay.querySelector('#obfrun');
    function paintQuota(left, limit) {
      quotaLeft = left;
      if (!quotaEl) return;
      quotaEl.textContent = left < 0 ? '' : (state.user && state.user.premium ? '👑 ' : '') + t('obf_left') + ' ' + left + '/' + limit;
      if (left === 0) {
        runBtn.disabled = true;
        runBtn.style.opacity = '0.4';
        runBtn.style.cursor = 'not-allowed';
      } else {
        runBtn.disabled = false;
        runBtn.style.opacity = '1';
        runBtn.style.cursor = 'pointer';
      }
    }
    api('/api/obf/usage').then(function (d) { paintQuota(d.left, d.limit); }).catch(function () {});
    var level = 3;
    function setLevel(n) {
      level = n;
      Array.prototype.forEach.call(overlay.querySelectorAll('.lvlbtn'), function (b) {
        if (Number(b.getAttribute('data-lv')) === n) b.classList.add('on');
        else b.classList.remove('on');
      });
      var h = overlay.querySelector('#obflvhint');
      var m = { '1': 'obf_lv1_hint', '2': 'obf_lv2_hint', '3': 'obf_lv3_hint', '4': 'obf_lv4_hint', '5': 'obf_lv5_hint', '6': 'obf_lv6_hint' };
      if (h) h.textContent = t(m[String(n)] || 'obf_lv3_hint');
    }
    Array.prototype.forEach.call(overlay.querySelectorAll('.lvlbtn'), function (b) {
      b.onclick = function () {
        var n = Number(b.getAttribute('data-lv'));
        if (n > (state.maxLevel || 2)) { toast(t('obf_premium_lv'), true); return; }
        setLevel(n);
      };
    });
    setLevel(3);
    var inEl = overlay.querySelector('#obfin');
    var outEl = overlay.querySelector('#obfout');
    var statEl = overlay.querySelector('#obfstat');
    var fnameEl = overlay.querySelector('#obffname');
    var last = '';
    overlay.querySelector('#obfpick').onclick = function () { overlay.querySelector('#obffile').click(); };
    overlay.querySelector('#obffile').addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      fnameEl.textContent = file.name;
      var reader = new FileReader();
      reader.onload = function () { inEl.value = String(reader.result || ''); };
      reader.readAsText(file);
    });
    overlay.querySelector('#obfclear').onclick = function () {
      inEl.value = ''; outEl.textContent = t('none'); statEl.textContent = ''; last = ''; fnameEl.textContent = t('obf_no_file');
    };
    overlay.querySelector('#obfeditbtn').onclick = function () {
      if (!last) { toast(t('obf_empty'), true); return; }
      openEditTarget(last);
    };
    var remoteEl = overlay.querySelector('#obfRemote');
    var copyBtn = overlay.querySelector('#obfcopy');
    function syncRemote() {
      var on = remoteEl.checked;
      copyBtn.disabled = on;
      copyBtn.style.opacity = on ? '0.35' : '1';
      copyBtn.style.cursor = on ? 'not-allowed' : 'pointer';
      copyBtn.title = on ? t('obf_copy_blocked') : '';
    }
    remoteEl.onchange = syncRemote;
    syncRemote();
    overlay.querySelector('#obfrun').onclick = function () {
      var code = inEl.value;
      if (!code.trim()) { toast(t('obf_empty'), true); return; }
      if (quotaLeft === 0) { toast(t('obf_limit'), true); return; }
      var btn = overlay.querySelector('#obfrun');
      btn.disabled = true; statEl.textContent = t('obf_running');
      api('/api/obfuscate', { method: 'POST', body: {
        code: code,
        level: level,
        remote: overlay.querySelector('#obfRemote').checked
      } }).then(function (d) {
        last = d.code;
        outEl.textContent = d.code;
        statEl.textContent = t('obf_stats') + ': ' + d.stats.original + ' -> ' + d.stats.output + ' B · L' + (d.level || 3) + (d.remote ? ' · remote' : '') + ' · ' + (d.stats.decoys || 0) + ' decoy';
        toast(t('obf_done'));
        if (typeof d.left === 'number') paintQuota(d.left, d.limit || 5);
      }).catch(function (e) { toast(e.message, true); statEl.textContent = ''; })
        .then(function () { if (quotaLeft !== 0) btn.disabled = false; });
    };
    overlay.querySelector('#obfcopy').onclick = function () {
      if (remoteEl.checked) { toast(t('obf_copy_blocked'), true); return; }
      if (!last) { toast(t('obf_empty'), true); return; }
      copyText(last); toast(t('copy'));
    };
    overlay.querySelector('#obfsavebtn').onclick = function () {
      if (!last) { toast(t('obf_empty'), true); return; }
      var suggested = (fnameEl.textContent !== t('obf_no_file') ? fnameEl.textContent.replace(/\.[^.]+$/, '') : 'obfuscated');
      var overlay2 = document.createElement('div'); overlay2.className = 'overlay';
      overlay2.innerHTML = '<div class="modal smallm"><h3>' + ICON.file + ' ' + t('obf_save') + '</h3><div class="body">' +
        '<div class="field"><label>' + ICON.file + ' ' + t('obf_name') + '</label><input class="input" id="obfname" placeholder="' + t('obf_name_ph') + '" spellcheck="false" value="' + esc(suggested) + '"></div>' +
        '</div><div class="foot"><button class="btn ghost" id="obfsc">' + t('cancel') + '</button><button class="btn" id="obfss">' + t('create') + '</button></div></div>';
      document.body.appendChild(overlay2);
      overlay2.querySelector('#obfsc').onclick = function () { overlay2.remove(); };
      overlay2.querySelector('#obfname').focus();
      overlay2.querySelector('#obfss').onclick = function () {
        var nm = overlay2.querySelector('#obfname').value.trim();
        if (!nm) { toast(t('obf_name'), true); return; }
        api('/api/obfuscate', { method: 'POST', body: {
          code: inEl.value, name: nm, save: true,
          level: level,
          remote: overlay.querySelector('#obfRemote').checked
        } }).then(function (d) {
          overlay2.remove();
          toast(t('obf_saved'));
          loadFiles(); loadFolders();
        }).catch(function (e) { toast(e.message, true); });
      };
      overlay2.addEventListener('click', function (e) { if (e.target === overlay2) overlay2.remove(); });
    };
  }
  function openEditTarget(code) {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.edit + ' ' + t('obf_edit') + '</h3><div class="body" id="obfeditbody">' +
      '<div class="hint">' + t('loading') + '</div></div>' +
      '<div class="foot"><button class="btn ghost" id="obfedc">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#obfedc').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    api('/api/files').then(function (d) {
      var mine = (d.files || []).filter(function (f) { return f.role === 'owner'; });
      var body = overlay.querySelector('#obfeditbody');
      if (!mine.length) { body.innerHTML = '<div class="hint" style="margin:0">' + t('no_files') + '</div>'; return; }
      body.innerHTML = mine.map(function (f) {
        return '<div class="hit"><div class="hn">' + ICON.file + '<span>' + esc(f.name) + '</span></div>' +
          '<button class="iconbtn obfpickfile" data-id="' + esc(f.id) + '" data-name="' + esc(f.name) + '" title="' + t('obf_edit') + '">' + ICON.edit + '</button></div>';
      }).join('');
      Array.prototype.forEach.call(body.querySelectorAll('.obfpickfile'), function (b) {
        b.onclick = function () {
          var fid = b.getAttribute('data-id');
          var fname = b.getAttribute('data-name');
          api('/api/files/' + fid, { method: 'PUT', body: { code: code } }).then(function () {
            overlay.remove();
            toast(t('obf_updated'));
            loadFiles(); loadFolders();
          }).catch(function (e) { toast(e.message, true); });
        };
      });
    }).catch(function (e) { overlay.querySelector('#obfeditbody').textContent = e.message; });
  }

  function openFollowing() {
    var overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div class="modal smallm"><h3>' + ICON.userplus + ' ' + t('following_t') + '</h3><div class="body" id="folbody"><div class="hint">' + t('loading') + '</div></div><div class="foot"><button class="btn ghost" id="folc">' + t('close') + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#folc').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    api('/api/following').then(function (d) {
      var list = d.following || [], body = overlay.querySelector('#folbody');
      if (!list.length) { body.innerHTML = '<div class="hint" style="margin:0">' + t('none') + '</div>'; return; }
      body.innerHTML = list.map(function (u) {
        return '<div class="uchip" data-name="' + esc(u.username) + '">' + avat(u) +
          '<div class="un"><span>' + esc(u.nick || u.username) + '</span></div>' +
          '<button class="btn small ghost unfol" data-uid="' + esc(u.id) + '">' + ICON.x + ' ' + t('unfollow') + '</button></div>';
      }).join('');
      Array.prototype.forEach.call(body.querySelectorAll('.uchip'), function (chip) {
        chip.onclick = function (e) { if (e.target.closest && e.target.closest('.unfol')) return; overlay.remove(); openProfile(chip.getAttribute('data-name')); };
      });
      Array.prototype.forEach.call(body.querySelectorAll('.unfol'), function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          api('/api/follow/' + b.getAttribute('data-uid'), { method: 'DELETE' }).then(function () { overlay.remove(); openFollowing(); }).catch(function (er) { toast(er.message, true); });
        };
      });
    }).catch(function (e) { overlay.querySelector('#folbody').textContent = e.message; });
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
        .then(function () { overlay.remove(); toast(t('invited_sent')); })
        .catch(function (e) { toast(e.message, true); });
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
      .catch(function (e) { toast(e.message, true); });
  }
  function openDrawer() {
    var me = state.user || {};
    var overlay = document.createElement('div'); overlay.className = 'drawer-overlay';
    overlay.innerHTML = '<aside class="drawer">' +
      '<div class="dhead"><div class="logo"><img src="https://files.catbox.moe/okwlyx.png" alt=""></div><div><div class="dname">สกัด HUB</div><div class="duser">' + esc(me.username) + '</div></div></div>' +
      '<div class="dprof">' + avat(me, 'big') + '<div><div class="dpn">' + esc(me.nick || me.username) + (me.premium ? ' ' + ICON.crown : '') + '</div><div class="dpu">@' + esc(me.username) + '</div></div></div>' +
      '<button class="ditem" id="d-prof">' + ICON.user + ' ' + t('view_profile') + '</button>' +
      '<button class="ditem" id="d-edit">' + ICON.edit + ' ' + t('edit_profile') + '</button>' +
      '<button class="ditem" id="d-obf">' + ICON.code + ' ' + t('obf') + '</button>' +
      '<button class="ditem" id="d-update">' + ICON.info + ' ' + t('updates') + '</button>' +
      '<button class="ditem" id="d-theme">' + ICON.palette + ' ' + t('theme') + '</button>' +
      '<button class="ditem" id="d-prem">' + ICON.crown + ' ' + t('premium_signup') + '</button>' +
      '<button class="ditem" id="d-stats">' + ICON.chart + ' ' + t('stats') + '</button>' +
      '<button class="ditem" id="d-fav">' + ICON.star + ' ' + t('nav_fav') + '</button>' +
      '<button class="ditem" id="d-fol">' + ICON.userplus + ' ' + t('following_t') + '</button>' +
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
    overlay.querySelector('#d-prof').onclick = function () { overlay.remove(); openProfile(state.user.username); };
    overlay.querySelector('#d-edit').onclick = function () { overlay.remove(); openEditProfile(); };
    overlay.querySelector('#d-obf').onclick = function () { overlay.remove(); openObfuscator(); };
    overlay.querySelector('#d-update').onclick = function () { overlay.remove(); openUpdates(); };
    overlay.querySelector('#d-theme').onclick = function () { overlay.remove(); openTheme(); };
    overlay.querySelector('#d-prem').onclick = function () { overlay.remove(); openPremium(); };
    overlay.querySelector('#d-stats').onclick = function () { overlay.remove(); openStats(); };
    overlay.querySelector('#d-fav').onclick = function () { overlay.remove(); renderFavModal(); };
    overlay.querySelector('#d-fol').onclick = function () { overlay.remove(); openFollowing(); };
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
    loadTheme();
    api('/api/me').then(function (d) {
      state.user = d.user;
      if (d.premium) {
        state.maxLevel = d.premium.maxLevel;
        state.dailyLimit = d.premium.dailyLimit;
        state.user.premium = d.premium.premium;
      }
      if (state.user) { renderApp(); loadAll(); loadFollowing(); }
      else renderAuth('login');
    }).catch(function () { renderAuth('login'); });
  }
  boot();
})();
</script>
</body>
</html>`;
app.use(function (err, req, res, next) {
  console.error('unhandled:', err && err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
});

app.listen(PORT, function () {
  console.log(APP_NAME + ' listening on http://localhost:' + PORT);
  setTimeout(function () { notifyUpdateIfNeeded().catch(function () {}); }, 3000);
});
