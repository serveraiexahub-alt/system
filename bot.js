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
  const cap = makeCaptcha({ digits: code.length });
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
      .setTitle('🔑 ยืนยันรหัส')
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
      new ButtonBuilder().setCustomId('hub_verify_button').setLabel('ยืนยันรหัส').setStyle(ButtonStyle.Primary)
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
}
client.once('clientReady', onReady);

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

client.login(TOKEN);
