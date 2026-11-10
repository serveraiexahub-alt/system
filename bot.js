'use strict';
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  try {
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

const {
  Client, GatewayIntentBits, EmbedBuilder, Partials, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder, MessageFlags, PermissionsBitField
} = require('discord.js');
const { makeCaptcha } = require('./captcha.js');

const TOKEN = process.env.DISCORD_TOKEN || '';
const WEB_URL = (process.env.WEB_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const BOT_SECRET = process.env.BOT_SECRET || '';

const WELCOME_CHANNEL = process.env.WELCOME_CHANNEL || '1434841953752580156';
const LEAVE_CHANNEL = process.env.LEAVE_CHANNEL || '1565262077713584270';
const VERIFY_CHANNEL = process.env.VERIFY_CHANNEL || '1566290265117958154';
const VERIFY_LOG = process.env.VERIFY_LOG || '1566290267059920958';
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || '1565267740019920966';
const WEB_VERIFY_CHANNEL = process.env.WEB_VERIFY_CHANNEL || '1568954728388501524';

const WELCOME_GIF = process.env.WELCOME_GIF || 'https://cdn.discordapp.com/attachments/1458606026847817772/1565270076960276570/how-to-make-gif-for-discord-4.gif';
const LEAVE_GIF = process.env.LEAVE_GIF || 'https://cdn.discordapp.com/attachments/1458606026847817772/1565271048147042385/walter-white.gif';
const VERIFY_IMG = process.env.VERIFY_IMG || 'https://cdn.discordapp.com/attachments/1458606026847817772/1565273294037581854/images.png';
const CODE_GIF_FILE = path.join(__dirname, 'assets', 'verify-code.gif');
const PREMIUM_CHANNEL = process.env.PREMIUM_CHANNEL || '1569171285974585445';
const PREMIUM_IMG_FILE = path.join(__dirname, 'assets', 'premium.jpg');
const STAFF_ROLES = String(process.env.STAFF_ROLES || '1568617536038248579,1565637911829811290,1407171324144783402,1568617785347543171')
  .split(',').map(function (x) { return x.trim(); }).filter(Boolean);
const PREMIUM_STATE = path.join(__dirname, 'premium-state.json');
const PREMIUM_ROLE_ID = process.env.PREMIUM_ROLE_ID || '1569204641298915358';
const PAY_TRUEMONEY_IMG = path.join(__dirname, 'assets', 'qr-truemoney.jpg');
const PAY_BANK_IMG = path.join(__dirname, 'assets', 'qr-bank.jpg');
const CALL_COOLDOWN = 30 * 1000;
const EMOJI_VERIFY = process.env.EMOJI_VERIFY || '<:emoji_22:1569203851104493682>';
const EMOJI_PREMIUM = process.env.EMOJI_PREMIUM || '<:emoji_19:1569202032009551912>';
const EMOJI_LV = process.env.EMOJI_LV || '<:emoji_18:1569201995204530276>';
const EMOJI_TIMES = process.env.EMOJI_TIMES || '<:emoji_20:1569202137454477443>';
const EMOJI_CROWN = process.env.EMOJI_CROWN || '<:emoji_21:1569202166948831262>';
const EMOJI_1M = process.env.EMOJI_1M || '<:emoji_24:1569340565290483752>';
const EMOJI_1Y = process.env.EMOJI_1Y || '<:emoji_23:1569340427667116193>';
const PRICE_1M = Number(process.env.PRICE_1M) || 25;
const PRICE_1Y = Number(process.env.PRICE_1Y) || 220;
const EMOJI_VERIFY_ID = (String(EMOJI_VERIFY).match(/:(\d+)>/) || [])[1] || '';
const EMOJI_PREMIUM_ID = (String(EMOJI_PREMIUM).match(/:(\d+)>/) || [])[1] || '';
const EMOJI_1M_ID = (String(EMOJI_1M).match(/:(\d+)>/) || [])[1] || '';
const EMOJI_1Y_ID = (String(EMOJI_1Y).match(/:(\d+)>/) || [])[1] || '';
const CODE_GIF_URL = process.env.CODE_GIF_URL || 'https://cdn.discordapp.com/attachments/1568081274344570880/1569137031509057657/image0.gif';

const PURPLE = 0x9b59b6;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;

const CODE_LENGTH = Math.max(4, Math.min(6, Number(process.env.CAPTCHA_DIGITS) || 5));
const CODE_TTL = 5 * 60 * 1000;
const MAX_TRIES = 3;

const SPAM_COUNT = 3;
const SPAM_WINDOW = 1000;
const SPAM_TIMEOUT = 10 * 60 * 1000;
const RAID_CHANNELS = 3;
const RAID_WINDOW = 60 * 1000;

if (!TOKEN) { console.error('missing DISCORD_TOKEN'); process.exit(1); }

const LOCK_FILE = path.join(__dirname, 'bot.lock');
try {
  const oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
  if (oldPid && oldPid !== process.pid) {
    try {
      process.kill(oldPid, 0);
      console.error('another bot instance is already running (pid ' + oldPid + '). kill it first.');
      process.exit(1);
    } catch (e) {}
  }
} catch (e) {}
try { fs.writeFileSync(LOCK_FILE, String(process.pid)); } catch (e) {}

function removeLock() {
  try {
    if (parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10) === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch (e) {}
}
process.on('exit', removeLock);
process.on('SIGINT', function () { removeLock(); process.exit(0); });
process.on('SIGTERM', function () { removeLock(); process.exit(0); });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember]
});

process.on('unhandledRejection', function (e) {
  console.error('unhandledRejection:', (e && (e.message || e.code)) || e);
});
process.on('uncaughtException', function (e) {
  console.error('uncaughtException:', (e && (e.message || e.code)) || e);
});
client.on('error', function (e) { console.error('client error:', (e && e.message) || e); });
client.on('shardError', function (e) { console.error('shard error:', (e && e.message) || e); });

const seenInteractions = new Map();
function freshInteraction(id) {
  const now = Date.now();
  if (seenInteractions.has(id)) return false;
  seenInteractions.set(id, now);
  if (seenInteractions.size > 800) {
    for (const [k, t] of seenInteractions) if (now - t > 180000) seenInteractions.delete(k);
  }
  return true;
}
function isExpired(err) {
  return err && (err.code === 10062 || err.code === 40060 || err.status === 404);
}

const pending = new Map();

function makeCode() {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function buildCaptchaPayload(code) {
  const cap = makeCaptcha({ digits: code.length, value: code });
  const file = new AttachmentBuilder(cap.png, { name: 'captcha.png' });
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle('🔐 กรอกรหัสที่เห็นในรูป')
    .setDescription(
      'ดูตัวเลข **' + code.length + ' หลัก** ในรูป แล้วกดปุ่ม **📝 กรอกรหัส** ✨\n' +
      '⏳ รหัสมีอายุ 5 นาที | ✍️ ผิดได้ ' + MAX_TRIES + ' ครั้ง\n' +
      'มองไม่ชัด? กด **🔄 เปลี่ยนรหัส** ได้เลย'
    )
    .setImage('attachment://captcha.png');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('captcha_enter').setLabel('กรอกรหัส').setEmoji('📝').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('captcha_refresh').setLabel('เปลี่ยนรหัส').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], files: [file], attachments: [] };
}

async function grantRole(interaction) {
  if (!VERIFIED_ROLE_ID) return '';
  const member = interaction.member;
  if (!member || !member.roles) return '\n⚠️ ไม่พบข้อมูลสมาชิก';
  try {
    await member.roles.add(VERIFIED_ROLE_ID);
    return '';
  } catch (e) {
    console.error('role add failed:', e.message);
    return '\n⚠️ ให้ยศไม่สำเร็จ (เช็ก Manage Roles / ลำดับยศบอท)';
  }
}

async function sendVerifyLog(interaction, label) {
  const ch = await client.channels.fetch(VERIFY_LOG).catch(function () { return null; });
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle('✅ ยืนยันตัวตนสำเร็จ')
    .setDescription('💚 ' + interaction.user + ' (**' + interaction.user.tag + '**) ' + label + ' 🎉')
    .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
  await ch.send({ embeds: [embed] }).catch(function () {});
}

async function findPanel(channel, customId) {
  const recent = await channel.messages.fetch({ limit: 50 });
  return recent.find(function (m) {
    return m.components.some(function (r) {
      return r.components.some(function (c) { return c.customId === customId; });
    });
  }) || null;
}

async function syncPanel(channel, customId, payload) {
  const existing = await findPanel(channel, customId);
  if (!existing) {
    await channel.send(payload);
    return 'sent';
  }
  if (existing.author.id === client.user.id) {
    await existing.edit(payload).catch(function () {});
    return 'edited';
  }
  await existing.delete().catch(function () {});
  await channel.send(payload);
  return 'replaced';
}

function codeGifFile() {
  try {
    if (fs.existsSync(CODE_GIF_FILE)) {
      return new AttachmentBuilder(fs.readFileSync(CODE_GIF_FILE), { name: 'verify-code.gif' });
    }
  } catch (e) {}
  return null;
}

let roomState = {};
try { roomState = JSON.parse(fs.readFileSync(PREMIUM_STATE, 'utf8')) || {}; } catch (e) { roomState = {}; }
function saveRoomState() {
  try { fs.writeFileSync(PREMIUM_STATE, JSON.stringify(roomState, null, 2)); } catch (e) {}
}

function isRoomOwner(member, channelId) {
  const st = roomState[channelId];
  return !!(st && member && st.owner === member.id);
}

function canUseRoom(member, channelId, staffOnly) {
  if (isStaff(member)) return true;
  if (staffOnly) return false;
  return isRoomOwner(member, channelId);
}

function isStaff(member) {
  if (!member || !member.roles) return false;
  if (member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return STAFF_ROLES.some(function (r) { return member.roles.cache.has(r); });
}

async function webPremium(username, plan, staff) {
  const res = await fetch(WEB_URL + '/api/discord/premium', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET },
    body: JSON.stringify({
      username: username, plan: plan,
      staffId: (staff && staff.id) || '',
      staffName: (staff && staff.tag) || ''
    })
  });
  const data = await res.json().catch(function () { return {}; });
  return { ok: res.ok, data: data };
}

function roomPayload(channelId) {
  const st = roomState[channelId] || {};
  const embed = new EmbedBuilder()
    .setTitle(EMOJI_PREMIUM + ' ห้องสมัครพรีเมียม')
    .setColor(0xf1c40f)
    .setDescription(
      '**ชื่อบัญชีเว็บ:** ' + (st.username ? '`' + st.username + '`' : 'ยังไม่ได้กรอก') + '\n' +
      '**แพ็กเกจ:** ' + (st.plan === '1y' ? (EMOJI_1Y + ' 1 ปี · ' + PRICE_1Y + ' บาท') : (st.plan === '1m' ? (EMOJI_1M + ' 1 เดือน · ' + PRICE_1M + ' บาท') : 'ยังไม่ได้เลือก')) + '\n\n' +
      '**ราคา**\n' + EMOJI_1M + ' 1 เดือน — ' + PRICE_1M + ' บาท\n' + EMOJI_1Y + ' 1 ปี — ' + PRICE_1Y + ' บาท\n\n' +
      'ขั้นตอน: กรอกชื่อบัญชีเว็บ → เลือกช่องทางจ่ายเงิน → พนักงานเลือกแพ็กเกจ → พนักงานกด **ยืนยันให้พรีเมียม**'
    )
    .setFooter({ text: 'ปิดห้องได้เมื่อให้พรีเมียมเสร็จ' });
  const b1 = new ButtonBuilder().setCustomId('prem_user').setLabel('กรอกชื่อบัญชี').setEmoji('👤').setStyle(ButtonStyle.Primary);
  const b2 = new ButtonBuilder().setCustomId('prem_1m').setLabel('1 เดือน · ' + PRICE_1M + ' บาท').setStyle(ButtonStyle.Secondary);
  const b3 = new ButtonBuilder().setCustomId('prem_1y').setLabel('1 ปี · ' + PRICE_1Y + ' บาท').setStyle(ButtonStyle.Secondary);
  if (EMOJI_1M_ID) b2.setEmoji(EMOJI_1M_ID);
  if (EMOJI_1Y_ID) b3.setEmoji(EMOJI_1Y_ID);
  const row1 = new ActionRowBuilder().addComponents(b1, b2, b3);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prem_apply').setLabel('ยืนยันให้พรีเมียม').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('prem_close').setLabel('ปิดห้อง').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prem_pay_tm').setLabel('จ่ายผ่าน TrueMoney').setEmoji('📱').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('prem_pay_bank').setLabel('จ่ายผ่านธนาคาร').setEmoji('🏦').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('prem_call').setLabel('เรียกพนักงาน').setEmoji('🔔').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row1, row2, row3] };
}

async function ensurePremiumPanel() {
  try {
    const channel = await client.channels.fetch(PREMIUM_CHANNEL).catch(function () { return null; });
    if (!channel) { console.log('❌ ไม่พบช่องสมัครพรีเมียม'); return; }
    let file = null;
    try {
      if (fs.existsSync(PREMIUM_IMG_FILE)) file = new AttachmentBuilder(fs.readFileSync(PREMIUM_IMG_FILE), { name: 'premium.jpg' });
    } catch (e) {}
    const embed = new EmbedBuilder()
      .setTitle(EMOJI_PREMIUM + ' สมัครพรีเมียม')
      .setColor(0xf1c40f)
      .setDescription(
        '**สิทธิพิเศษ**\n' +
        EMOJI_LV + ' ใช้ปกปิดโค้ดได้ทุกระดับ 1-6\n' +
        EMOJI_TIMES + ' ปกปิดได้ 10 ครั้ง/วัน (ฟรี 5 ครั้ง)\n' +
        EMOJI_CROWN + ' ไอคอนมงกุฎหลังชื่อ\n\n' +
        '**ราคา**\n' +
        EMOJI_1M + ' 1 เดือน — **' + PRICE_1M + ' บาท**\n' +
        EMOJI_1Y + ' 1 ปี — **' + PRICE_1Y + ' บาท**\n\n' +
        'กดปุ่มด้านล่างเพื่อเปิดห้องสมัคร'
      );
    if (file) embed.setImage('attachment://premium.jpg');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prem_open').setLabel('เปิดห้องสมัครพรีเมียม').setEmoji(EMOJI_PREMIUM_ID || '💎').setStyle(ButtonStyle.Success)
    );
    const payload = { embeds: [embed], components: [row] };
    if (file) payload.files = [file];
    const r = await syncPanel(channel, 'prem_open', payload);
    console.log('✅ แผงพรีเมียม: ' + r);
  } catch (err) {
    console.error('❌ สร้างแผงพรีเมียมไม่สำเร็จ:', err.message);
  }
}

async function openPremiumRoom(interaction) {
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: 'ใช้ได้ในเซิร์ฟเวอร์เท่านั้น', flags: MessageFlags.Ephemeral });
  const overwrites = [
    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
  ];
  for (const rid of STAFF_ROLES) {
    overwrites.push({ id: rid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  }
  const ch = await guild.channels.create({
    name: 'พรีเมียม-' + interaction.user.username.slice(0, 20),
    type: 0,
    parent: interaction.channel.parentId || null,
    permissionOverwrites: overwrites
  });
  roomState[ch.id] = { owner: interaction.user.id, username: '', plan: '', created: Date.now() };
  saveRoomState();
  await ch.send(roomPayload(ch.id));
  return interaction.reply({ content: 'เปิดห้องแล้ว: ' + ch, flags: MessageFlags.Ephemeral });
}

async function ensureVerifyPanel() {
  try {
    const channel = await client.channels.fetch(VERIFY_CHANNEL).catch(function () { return null; });
    if (!channel) { console.log('❌ ไม่พบช่องยืนยันตัว'); return; }
    const embed = new EmbedBuilder()
      .setColor(GREEN)
      .setTitle('✅ ยืนยันตัวตน')
      .setDescription('💚 กดปุ่มด้านล่างเพื่อยืนยันตัวตน\nบอทจะส่ง **รูปรหัส** มาให้ แล้วคุณกรอกรหัสให้ถูกต้อง 🔢\nเพื่อป้องกันบอทและบัญชีปลอม 🤖🚫')
      .setImage(VERIFY_IMG)
      .setFooter({ text: 'กดปุ่มเพื่อเริ่มยืนยัน' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify_start').setLabel('ยืนยันตัวตน').setEmoji('✅').setStyle(ButtonStyle.Success)
    );
    const r1 = await syncPanel(channel, 'verify_start', { embeds: [embed], components: [row] });
    console.log('✅ แผงยืนยันตัว: ' + r1);
  } catch (err) {
    console.error('❌ สร้างปุ่มยืนยันไม่สำเร็จ:', err.message);
  }
}

async function ensureWebPanel() {
  try {
    const channel = await client.channels.fetch(WEB_VERIFY_CHANNEL).catch(function () { return null; });
    if (!channel) { console.log('❌ ไม่พบช่องยืนยันบัญชีเว็บ'); return; }
    const gif = codeGifFile();
    const embed = new EmbedBuilder()
      .setTitle(EMOJI_VERIFY + ' ยืนยันรหัส')
      .setDescription(
        'กดปุ่มด้านล่างแล้วใส่รหัสที่เว็บให้มา\n\n' +
        'ตัวอย่างรหัส: `HUB-AB12-CD34`\n' +
        'ห้ามแชร์รหัสให้คนอื่น · รหัสใช้ได้ครั้งเดียว'
      )
      .setColor(0x000000)
      .setFooter({ text: 'ยืนยันรหัสจากเว็บเพื่อสร้างบัญชี' });
    if (gif) embed.setImage('attachment://verify-code.gif');
    else embed.setImage(CODE_GIF_URL);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('hub_verify_button').setLabel('ยืนยันรหัส').setStyle(ButtonStyle.Primary) .setEmoji(EMOJI_VERIFY_ID)
    );
    const payload = { embeds: [embed], components: [row] };
    if (gif) payload.files = [gif];
    const r = await syncPanel(channel, 'hub_verify_button', payload);
    console.log('✅ แผงยืนยันรหัส: ' + r);
  } catch (err) {
    console.error('❌ สร้างแผงยืนยันรหัสไม่สำเร็จ:', err.message);
  }
}

let booted = false;
async function onReady() {
  if (booted) return;
  booted = true;
  console.log('✅ บอทออนไลน์แล้ว: ' + client.user.tag);
  await ensureVerifyPanel();
  await ensureWebPanel();
  await ensurePremiumPanel();
}
client.once('clientReady', onReady);

const BACKUP_CHANNEL = process.env.BACKUP_CHANNEL || VERIFY_LOG;

function isOwnerOrStaff(member) {
  if (!member) return false;
  if (member.guild && member.id === member.guild.ownerId) return true;
  if (member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return STAFF_ROLES.some(function (r) { return member.roles.cache.has(r); });
}

async function exportAll(message) {
  await message.reply({ content: '⏳ กำลังดึงข้อมูล...' }).catch(function () {});
  try {
    const res = await fetch(WEB_URL + '/api/discord/export', { headers: { 'x-bot-secret': BOT_SECRET } });
    if (!res.ok) {
      const t = await res.text().catch(function () { return ''; });
      return message.channel.send({ content: 'ดึงข้อมูลไม่สำเร็จ: ' + (t.slice(0, 200) || res.status) });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = new AttachmentBuilder(buf, { name: 'sakad-hub-backup-' + stamp + '.json' });
    let botState = null;
    try { botState = fs.readFileSync(path.join(__dirname, 'bot-state.json'), 'utf8'); } catch (e) {}
    let premState = null;
    try { premState = fs.readFileSync(PREMIUM_STATE, 'utf8'); } catch (e) {}
    const extra = [];
    if (botState) extra.push(new AttachmentBuilder(Buffer.from(botState), { name: 'bot-state.json' }));
    if (premState) extra.push(new AttachmentBuilder(Buffer.from(premState), { name: 'premium-state.json' }));
    await message.channel.send({
      content: '📦 ข้อมูลสำรอง (' + (buf.length / 1024).toFixed(1) + ' KB) โดย ' + message.author,
      files: [file].concat(extra)
    });
  } catch (e) {
    await message.channel.send({ content: 'ผิดพลาด: ' + e.message }).catch(function () {});
  }
}

async function importAll(message) {
  const target = message.reference ? await message.channel.messages.fetch(message.reference.messageId).catch(function () { return null; }) : null;
  const src = target || message;
  const att = src.attachments.first();
  if (!att) return message.reply({ content: 'ต้องแนบไฟล์ .json มาด้วย (หรือตอบกลับข้อความที่มีไฟล์)' });
  if (!/\.json$/i.test(att.name || '')) return message.reply({ content: 'รองรับเฉพาะไฟล์ .json' });
  if (att.size > 40 * 1024 * 1024) return message.reply({ content: 'ไฟล์ใหญ่เกิน 40MB' });

  await message.reply({ content: '⏳ กำลังนำเข้าข้อมูล...' }).catch(function () {});
  try {
    const dl = await fetch(att.url);
    if (!dl.ok) return message.channel.send({ content: 'ดาวน์โหลดไฟล์ไม่สำเร็จ' });
    const text = await dl.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return message.channel.send({ content: 'ไฟล์ JSON เสีย' }); }
    const res = await fetch(WEB_URL + '/api/discord/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET },
      body: JSON.stringify(parsed)
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) return message.channel.send({ content: 'นำเข้าไม่สำเร็จ: ' + (data.error || res.status) });
    await message.channel.send({
      content: '✅ นำเข้าสำเร็จ — ผู้ใช้ ' + data.users + ' คน, ไฟล์ ' + data.files + ' รายการ\nสำรองข้อมูลเดิมไว้ที่ `' + data.backup + '`'
    });
  } catch (e) {
    await message.channel.send({ content: 'ผิดพลาด: ' + e.message }).catch(function () {});
  }
}

client.on('messageCreate', async function (message) {
  try {
    if (!message.guild || message.author.bot) return;
    const content = (message.content || '').trim();
    if (!content.startsWith('!')) return;
    const cmd = content.replace(/^!+/, '').split(/\s+/)[0];
    if (cmd !== 'เซฟข้อมูลทั้งหมด' && cmd !== 'อัปข้อมูล') return;
    if (!isOwnerOrStaff(message.member)) {
      return message.reply({ content: 'เฉพาะพนักงานเท่านั้น' }).catch(function () {});
    }
    if (cmd === 'เซฟข้อมูลทั้งหมด') return await exportAll(message);
    if (cmd === 'อัปข้อมูล') return await importAll(message);
  } catch (e) {
    console.error('command error:', e.message);
  }
});

client.on('interactionCreate', async function (interaction) {
  if (!interaction.isRepliable()) return;
  if (!freshInteraction(interaction.id)) return;
  try {
    if (interaction.isButton() && interaction.customId === 'verify_start') {
      if (VERIFIED_ROLE_ID && interaction.member && interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
        return interaction.reply({ content: '✅ คุณยืนยันตัวตนไปแล้วนะ 💚', flags: MessageFlags.Ephemeral });
      }
      const code = makeCode();
      pending.set(interaction.user.id, { code: code, expires: Date.now() + CODE_TTL, tries: 0 });
      return interaction.reply(Object.assign(buildCaptchaPayload(code), { flags: MessageFlags.Ephemeral }));
    }

    if (interaction.isButton() && interaction.customId === 'captcha_refresh') {
      const code = makeCode();
      pending.set(interaction.user.id, { code: code, expires: Date.now() + CODE_TTL, tries: 0 });
      return interaction.update(buildCaptchaPayload(code));
    }

    if (interaction.isButton() && interaction.customId === 'captcha_enter') {
      const data = pending.get(interaction.user.id);
      if (!data || Date.now() > data.expires) {
        pending.delete(interaction.user.id);
        return interaction.reply({
          content: '⌛ รหัสหมดอายุหรือไม่พบรหัส กรุณากดปุ่ม **ยืนยันตัวตน** ใหม่อีกครั้งนะ',
          flags: MessageFlags.Ephemeral
        });
      }
      const modal = new ModalBuilder().setCustomId('captcha_modal').setTitle('กรอกรหัสยืนยัน');
      const input = new TextInputBuilder()
        .setCustomId('captcha_input')
        .setLabel('พิมพ์ตัวเลข ' + CODE_LENGTH + ' หลักในรูป')
        .setStyle(TextInputStyle.Short)
        .setMinLength(CODE_LENGTH)
        .setMaxLength(CODE_LENGTH)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      if (interaction.replied || interaction.deferred) return;
      try {
        await interaction.showModal(modal);
      } catch (e) {
        if (!isExpired(e)) console.error('showModal failed:', e.message || e.code);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'captcha_modal') {
      const data = pending.get(interaction.user.id);
      if (!data || Date.now() > data.expires) {
        pending.delete(interaction.user.id);
        return interaction.reply({ content: '⌛ รหัสหมดอายุ กรุณากดปุ่ม **ยืนยันตัวตน** ใหม่อีกครั้งนะ', flags: MessageFlags.Ephemeral });
      }
      const typed = interaction.fields.getTextInputValue('captcha_input').trim();
      if (typed !== data.code) {
        data.tries++;
        if (data.tries >= MAX_TRIES) {
          pending.delete(interaction.user.id);
          return interaction.reply({
            content: '❌ กรอกผิดครบ ' + MAX_TRIES + ' ครั้งแล้ว กรุณากดปุ่ม **ยืนยันตัวตน** เพื่อขอรหัสใหม่',
            flags: MessageFlags.Ephemeral
          });
        }
        return interaction.reply({
          content: '❌ รหัสไม่ถูกต้อง เหลืออีก **' + (MAX_TRIES - data.tries) + '** ครั้ง ลองกด 📝 กรอกรหัส อีกครั้งนะ',
          flags: MessageFlags.Ephemeral
        });
      }
      pending.delete(interaction.user.id);
      const note = await grantRole(interaction);
      await interaction.reply({
        content: '🎉 ยืนยันตัวตนสำเร็จ! คุณได้รับยศ <@&' + VERIFIED_ROLE_ID + '> แล้ว 💚' + note,
        flags: MessageFlags.Ephemeral
      }).catch(function () {});
      await sendVerifyLog(interaction, 'ยืนยันตัวตนสำเร็จแล้ว!');
      return;
    }

    if (interaction.isButton() && interaction.customId === 'hub_verify_button') {
      const modal = new ModalBuilder().setCustomId('hub_verify_modal').setTitle('ยืนยันบัญชี');
      const input = new TextInputBuilder()
        .setCustomId('code')
        .setLabel('ใส่รหัสจากเว็บ (HUB-XXXX-XXXX)')
        .setStyle(TextInputStyle.Short)
        .setMinLength(6)
        .setMaxLength(24)
        .setRequired(true)
        .setPlaceholder('HUB-AB12-CD34');
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      if (interaction.replied || interaction.deferred) return;
      try {
        await interaction.showModal(modal);
      } catch (e) {
        if (!isExpired(e)) console.error('showModal failed:', e.message || e.code);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'hub_verify_modal') {
      if (interaction.replied || interaction.deferred) return;
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (e) {
        if (isExpired(e)) return;
        throw e;
      }
      const code = String(interaction.fields.getTextInputValue('code') || '').trim().toUpperCase();
      let res, data;
      try {
        res = await fetch(WEB_URL + '/api/discord/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET },
          body: JSON.stringify({
            code: code,
            discordId: interaction.user.id,
            discordName: interaction.user.username,
            guildId: interaction.guildId || ''
          })
        });
        data = await res.json().catch(function () { return {}; });
      } catch (e) {
        await interaction.editReply({ content: 'เชื่อมต่อเว็บไม่ได้: ' + e.message }).catch(function () {});
        return;
      }
      if (!res.ok) {
        await interaction.editReply({ content: 'ยืนยันไม่สำเร็จ: ' + (data.error || 'unknown error') }).catch(function () {});
        return;
      }
      const note = await grantRole(interaction);
      await interaction.editReply({
        content: 'ยืนยันสำเร็จ! บัญชี "' + data.username + '" ถูกสร้างแล้ว — กลับไปที่เว็บได้เลย 💚' + note
      }).catch(function () {});
      await sendVerifyLog(interaction, 'ยืนยันบัญชีเว็บสำเร็จ (ชื่อ "' + data.username + '")');
      return;
    }
    if (interaction.isButton() && interaction.customId === 'prem_open') {
      return await openPremiumRoom(interaction);
    }

    if (interaction.isButton() && interaction.customId === 'prem_user') {
      if (!canUseRoom(interaction.member, interaction.channelId, false)) {
        return interaction.reply({ content: 'เฉพาะเจ้าของห้องหรือพนักงานเท่านั้น', flags: MessageFlags.Ephemeral });
      }
      const modal = new ModalBuilder().setCustomId('prem_user_modal').setTitle('ชื่อบัญชีเว็บ');
      const input = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('ชื่อผู้ใช้บนเว็บ (a-z 0-9 _)')
        .setStyle(TextInputStyle.Short)
        .setMinLength(3)
        .setMaxLength(20)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      if (interaction.replied || interaction.deferred) return;
      try { await interaction.showModal(modal); } catch (e) { if (!isExpired(e)) console.error(e.message); }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'prem_user_modal') {
      if (!canUseRoom(interaction.member, interaction.channelId, false)) {
        return interaction.reply({ content: 'เฉพาะเจ้าของห้องหรือพนักงานเท่านั้น', flags: MessageFlags.Ephemeral });
      }
      const st = roomState[interaction.channelId];
      if (!st) return interaction.reply({ content: 'ไม่พบข้อมูลห้องนี้', flags: MessageFlags.Ephemeral });
      st.username = interaction.fields.getTextInputValue('username').trim().toLowerCase();
      saveRoomState();
      await interaction.update(roomPayload(interaction.channelId)).catch(function () {});
      return;
    }

    if (interaction.isButton() && (interaction.customId === 'prem_1m' || interaction.customId === 'prem_1y')) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: 'เฉพาะพนักงานเท่านั้นที่เลือกแพ็กเกจได้', flags: MessageFlags.Ephemeral });
      }
      const st = roomState[interaction.channelId];
      if (!st) return interaction.reply({ content: 'ไม่พบข้อมูลห้องนี้', flags: MessageFlags.Ephemeral });
      st.plan = interaction.customId === 'prem_1y' ? '1y' : '1m';
      saveRoomState();
      await interaction.update(roomPayload(interaction.channelId)).catch(function () {});
      return;
    }

    if (interaction.isButton() && interaction.customId === 'prem_apply') {
      const st = roomState[interaction.channelId];
      if (!st) return interaction.reply({ content: 'ไม่พบข้อมูลห้องนี้', flags: MessageFlags.Ephemeral });
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: 'เฉพาะพนักงานเท่านั้น', flags: MessageFlags.Ephemeral });
      }
      if (!st.username) return interaction.reply({ content: 'ยังไม่ได้กรอกชื่อบัญชี', flags: MessageFlags.Ephemeral });
      if (!st.plan) return interaction.reply({ content: 'ยังไม่ได้เลือกแพ็กเกจ', flags: MessageFlags.Ephemeral });
      await interaction.deferReply();
      const r = await webPremium(st.username, st.plan, interaction.user);
      if (!r.ok) {
        return interaction.editReply({ content: 'ให้พรีเมียมไม่สำเร็จ: ' + (r.data.error || 'unknown') });
      }
      const untilTs = Math.floor(Number(r.data.until || 0) / 1000);
      let roleNote = '';
      const targetId = String(r.data.discordId || '') || (st.owner !== interaction.user.id ? '' : interaction.user.id);
      if (PREMIUM_ROLE_ID && targetId) {
        try {
          const m = await interaction.guild.members.fetch(targetId);
          await m.roles.add(PREMIUM_ROLE_ID);
          roleNote = '\n' + EMOJI_CROWN + ' ให้ยศ <@&' + PREMIUM_ROLE_ID + '> แล้ว';
        } catch (e) {
          console.error('premium role failed:', e.message);
          roleNote = '\n⚠️ ให้ยศไม่สำเร็จ (เช็ก Manage Roles / ลำดับยศบอท)';
        }
      } else if (PREMIUM_ROLE_ID) {
        roleNote = '\n⚠️ บัญชีนี้ยังไม่ผูก Discord จึงยังให้ยศไม่ได้';
      }
      await interaction.editReply({
        content: EMOJI_PREMIUM + ' ให้พรีเมียม **' + st.username + '** แพ็กเกจ ' + (st.plan === '1y' ? '1 ปี' : '1 เดือน') +
          ' แล้ว\nหมดอายุ <t:' + untilTs + ':F>' + roleNote
      });
      const logCh = await client.channels.fetch(VERIFY_LOG).catch(function () { return null; });
      if (logCh) {
        await logCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(EMOJI_PREMIUM + ' ให้พรีเมียม')
            .setDescription(
              '**ผู้รับ:** `' + st.username + '`' + (r.data.discordId ? ' (<@' + r.data.discordId + '>)' : '') + '\n' +
              '**แพ็กเกจ:** ' + (st.plan === '1y' ? '1 ปี' : '1 เดือน') + '\n' +
              '**หมดอายุ:** <t:' + untilTs + ':F>\n' +
              '**พนักงาน:** ' + interaction.user + ' (`' + interaction.user.tag + '`)'
            )
            .setTimestamp()]
        }).catch(function () {});
      }
      st.done = true;
      saveRoomState();
      return;
    }

    if (interaction.isButton() && (interaction.customId === 'prem_pay_tm' || interaction.customId === 'prem_pay_bank')) {
      const isTm = interaction.customId === 'prem_pay_tm';
      let file = null;
      try {
        const p = isTm ? PAY_TRUEMONEY_IMG : PAY_BANK_IMG;
        if (fs.existsSync(p)) file = new AttachmentBuilder(fs.readFileSync(p), { name: isTm ? 'truemoney-qr.jpg' : 'bank-qr.jpg' });
      } catch (e) {}
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(isTm ? '📱 จ่ายผ่าน TrueMoney' : '🏦 จ่ายผ่านธนาคาร')
        .setDescription(
          'สแกน QR ด้านล่างเพื่อชำระเงิน\n' +
          '• 1 เดือน — **' + PRICE_1M + ' บาท**\n' +
          '• 1 ปี — **' + PRICE_1Y + ' บาท**\n\n' +
          'โอนเสร็จแล้วส่งสลิปในห้องนี้ แล้วแจ้งพนักงาน'
        );
      if (file) embed.setImage('attachment://' + (isTm ? 'truemoney-qr.jpg' : 'bank-qr.jpg'));
      const payload = { embeds: [embed] };
      if (file) payload.files = [file];
      return interaction.reply(payload);
    }

    if (interaction.isButton() && interaction.customId === 'prem_call') {
      const st = roomState[interaction.channelId];
      if (!st) return interaction.reply({ content: 'ไม่พบข้อมูลห้องนี้', flags: MessageFlags.Ephemeral });
      const now = Date.now();
      const last = st.lastCall || 0;
      if (now - last < CALL_COOLDOWN) {
        const wait = Math.ceil((CALL_COOLDOWN - (now - last)) / 1000);
        return interaction.reply({ content: 'เรียกพนักงานไปแล้ว รออีก ' + wait + ' วินาที', flags: MessageFlags.Ephemeral });
      }
      st.lastCall = now;
      saveRoomState();
      const ping = STAFF_ROLES.map(function (r) { return '<@&' + r + '>'; }).join(' ');
      await interaction.reply({ content: '🔔 ' + ping + ' — มีลูกค้าเรียกที่ห้องนี้ (' + interaction.user + ')' });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'prem_close') {
      const st = roomState[interaction.channelId];
      const allowed = isStaff(interaction.member) || (st && st.owner === interaction.user.id);
      if (!allowed) return interaction.reply({ content: 'เฉพาะพนักงานหรือเจ้าของห้องเท่านั้น', flags: MessageFlags.Ephemeral });
      await interaction.reply({ content: '🔒 ปิดห้องใน 3 วินาที...' }).catch(function () {});
      setTimeout(function () {
        delete roomState[interaction.channelId];
        saveRoomState();
        interaction.channel.delete().catch(function () {});
      }, 3000);
      return;
    }

  } catch (e) {
    if (!isExpired(e)) console.error('interaction error:', e.message || e.code);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '⚠️ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะ' }).catch(function () {});
      } else {
        await interaction.reply({ content: '⚠️ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะ', flags: MessageFlags.Ephemeral }).catch(function () {});
      }
    } catch (x) {}
  }
});

const recentTimes = new Map();
const dupTracker = new Map();

function isExempt(member) {
  if (!member) return true;
  if (member.user.bot) return true;
  if (member.id === member.guild.ownerId) return true;
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function msgKey(message) {
  const text = (message.content || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const files = [...message.attachments.values()].map(function (a) { return a.name + ':' + a.size; }).join('|');
  return text + (files ? '#' + files : '');
}

async function deleteMany(msgs) {
  for (const m of msgs) await m.delete().catch(function () {});
}

async function notice(channel, text) {
  const sent = await channel.send({ embeds: [new EmbedBuilder().setColor(RED).setDescription(text)] }).catch(function () { return null; });
  if (sent) setTimeout(function () { sent.delete().catch(function () {}); }, 8000);
}

client.on('messageCreate', async function (message) {
  try {
    if (!message.guild || message.author.bot) return;
    const member = message.member;
    if (isExempt(member)) return;

    const uid = message.author.id;
    const now = Date.now();
    const key = msgKey(message);

    if (key) {
      let d = dupTracker.get(uid);
      if (!d || d.key !== key || now - d.last > RAID_WINDOW) {
        d = { key: key, channels: new Set(), msgs: [], last: now };
        dupTracker.set(uid, d);
      }
      d.channels.add(message.channel.id);
      d.msgs.push(message);
      d.last = now;

      if (d.channels.size >= RAID_CHANNELS) {
        const toDelete = [...d.msgs];
        const chCount = d.channels.size;
        dupTracker.delete(uid);
        recentTimes.delete(uid);
        await deleteMany(toDelete);
        if (member.kickable) {
          await member.kick('ส่งข้อความซ้ำในหลายช่อง (ป้องกันบอทยิงกลุ่ม)').catch(function () {});
          console.log('🥾 เตะ ' + message.author.tag + ' (ส่งซ้ำ ' + chCount + ' ช่อง)');
        }
        return;
      }
    }

    let list = recentTimes.get(uid) || [];
    list.push({ time: now, msg: message });
    list = list.filter(function (x) { return now - x.time <= SPAM_WINDOW; });
    recentTimes.set(uid, list);

    if (list.length >= SPAM_COUNT) {
      const toDelete = list.map(function (x) { return x.msg; });
      recentTimes.delete(uid);
      await deleteMany(toDelete);
      if (member.moderatable) {
        await member.timeout(SPAM_TIMEOUT, 'สแปมข้อความถี่เกินไป').catch(function (e) {
          console.log('⚠️ timeout ไม่สำเร็จ:', e.message);
        });
      }
      await notice(message.channel, '🚫 ' + message.author + ' สแปมข้อความถี่เกินไป โดนลบข้อความและปิดปาก ' + (SPAM_TIMEOUT / 60000) + ' นาที');
    }
  } catch (err) {
    console.error('❌ ระบบป้องกันผิดพลาด:', err.message);
  }
});

setInterval(function () {
  const now = Date.now();
  for (const [uid, d] of dupTracker) if (now - d.last > RAID_WINDOW) dupTracker.delete(uid);
  for (const [uid, l] of recentTimes) if (!l.length || now - l[l.length - 1].time > 5000) recentTimes.delete(uid);
  for (const [uid, p] of pending) if (Date.now() > p.expires + 60000) pending.delete(uid);
}, 60 * 1000);

client.on('guildMemberAdd', async function (member) {
  try {
    const channel = await member.guild.channels.fetch(WELCOME_CHANNEL).catch(function () { return null; });
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle('🎉 ยินดีต้อนรับสู่กลุ่ม! 🎉')
      .setDescription(
        '💜 สวัสดี ' + member + '!\n' +
        'ขอแสดงความยินดีที่ได้เข้าร่วมกับเรา ✨\n' +
        'คุณเป็นสมาชิกคนที่ **' + member.guild.memberCount + '** ของ **' + member.guild.name + '** 🥳'
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setImage(WELCOME_GIF)
      .setFooter({ text: 'ขอให้สนุกนะ 💜' })
      .setTimestamp();
    await channel.send({ content: String(member), embeds: [embed] });
  } catch (err) {
    console.error('❌ ส่งข้อความต้อนรับไม่สำเร็จ:', err.message);
  }
});

client.on('guildMemberRemove', async function (member) {
  try {
    const channel = await member.guild.channels.fetch(LEAVE_CHANNEL).catch(function () { return null; });
    if (!channel) return;
    const name = member.user ? member.user.tag : 'สมาชิกคนหนึ่ง';
    const embed = new EmbedBuilder()
      .setColor(PURPLE)
      .setTitle('👋 มีคนออกจากกลุ่มไปแล้ว')
      .setDescription(
        '😢 **' + name + '** ได้ออกจากกลุ่มไปแล้ว\n' +
        'ลาก่อนนะ ขอให้โชคดี 💜\n' +
        'ตอนนี้เหลือสมาชิก **' + member.guild.memberCount + '** คน'
      )
      .setImage(LEAVE_GIF)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ ส่งข้อความคนออกไม่สำเร็จ:', err.message);
  }
});

async function checkExpiredPremium() {
  try {
    const res = await fetch(WEB_URL + '/api/discord/premium/expiring', {
      method: 'GET',
      headers: { 'x-bot-secret': BOT_SECRET }
    });
    if (!res.ok) return;
    const data = await res.json().catch(function () { return {}; });
    const list = data.users || [];
    if (!list.length) return;
    const guild = client.guilds.cache.first();
    if (!guild) return;
    for (const item of list) {
      try {
        if (item.discordId && PREMIUM_ROLE_ID) {
          const m = await guild.members.fetch(item.discordId).catch(function () { return null; });
          if (m) await m.roles.remove(PREMIUM_ROLE_ID).catch(function () {});
        }
        await fetch(WEB_URL + '/api/discord/premium/cleared', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET },
          body: JSON.stringify({ username: item.username })
        }).catch(function () {});
        console.log('⌛ ปลดพรีเมียม: ' + item.username);
        const logCh = await client.channels.fetch(VERIFY_LOG).catch(function () { return null; });
        if (logCh) {
          const untilTs = Math.floor(Number(item.until || 0) / 1000);
          const grantedTs = Math.floor(Number(item.grantedAt || 0) / 1000);
          await logCh.send({
            embeds: [new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle('⌛ ปลดพรีเมียม (หมดอายุ)')
              .setDescription(
                '**ผู้ใช้:** `' + item.username + '`' + (item.discordId ? ' (<@' + item.discordId + '>)' : '') + '\n' +
                '**แพ็กเกจเดิม:** ' + (item.plan === '1y' ? '1 ปี' : (item.plan === '1m' ? '1 เดือน' : '-')) + '\n' +
                (untilTs ? '**หมดอายุเมื่อ:** <t:' + untilTs + ':F>\n' : '') +
                '**ให้โดยพนักงาน:** ' + (item.grantedBy ? item.grantedBy : 'ไม่ทราบ') + '\n' +
                (grantedTs ? '**ให้เมื่อ:** <t:' + grantedTs + ':F>' : '')
              )
              .setTimestamp()]
          }).catch(function () {});
        }
      } catch (e) {
        console.error('expire failed:', item.username, e.message);
      }
    }
  } catch (e) {
    console.error('expire check failed:', e.message);
  }
}

setInterval(checkExpiredPremium, 5 * 60 * 1000);

client.login(TOKEN);
