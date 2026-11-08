'use strict';
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

const {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN || '';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1568954728388501524';
const WEB_URL = (process.env.WEB_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const BOT_SECRET = process.env.BOT_SECRET || '';
const BUTTON_ID = 'hub_verify_button';
const MODAL_ID = 'hub_verify_modal';
const STATE_FILE = path.join(__dirname, 'bot-state.json');

if (!TOKEN) { console.error('missing DISCORD_TOKEN'); process.exit(1); }
if (!BOT_SECRET) { console.error('missing BOT_SECRET (must match the web server)'); process.exit(1); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { return { messageId: null }; }
}
function saveState(st) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); } catch (e) {}
}
let state = loadState();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

function panelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('ยืนยันบัญชี สกัด HUB')
    .setDescription('กดปุ่มด้านล่างแล้วใส่รหัสที่เว็บให้มา\n\nตัวอย่างรหัส: `HUB-AB12-CD34`')
    .setColor(0x000000)
    .setFooter({ text: 'ห้ามแชร์รหัสให้คนอื่น · รหัสใช้ได้ครั้งเดียว' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_ID)
      .setLabel('ยืนยันบัญชี')
      .setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

async function ensurePanel() {
  const channel = await client.channels.fetch(CHANNEL_ID).catch(function () { return null; });
  if (!channel) { console.error('channel not found: ' + CHANNEL_ID); return; }
  if (state.messageId) {
    const msg = await channel.messages.fetch(state.messageId).catch(function () { return null; });
    if (msg) {
      await msg.edit(panelPayload()).catch(function () {});
      console.log('panel updated: ' + state.messageId);
      return;
    }
  }
  const sent = await channel.send(panelPayload());
  state.messageId = sent.id;
  saveState(state);
  console.log('panel sent: ' + sent.id);
}

let booted = false;
async function onReady() {
  if (booted) return;
  booted = true;
  console.log('logged in as ' + client.user.tag);
  await ensurePanel();
}
client.once('clientReady', onReady);
client.once('ready', onReady);

client.on('interactionCreate', async function (interaction) {
  try {
    if (interaction.isButton() && interaction.customId === BUTTON_ID) {
      const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle('ยืนยันบัญชี');
      const input = new TextInputBuilder()
        .setCustomId('code')
        .setLabel('ใส่รหัสจากเว็บ (HUB-XXXX-XXXX)')
        .setStyle(TextInputStyle.Short)
        .setMinLength(6)
        .setMaxLength(24)
        .setRequired(true)
        .setPlaceholder('HUB-AB12-CD34');
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
      await interaction.deferReply({ ephemeral: true });
      const code = String(interaction.fields.getTextInputValue('code') || '').trim().toUpperCase();
      const res = await fetch(WEB_URL + '/api/discord/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-secret': BOT_SECRET },
        body: JSON.stringify({
          code: code,
          discordId: interaction.user.id,
          discordName: interaction.user.username,
          guildId: interaction.guildId || ''
        })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        return interaction.editReply({ content: 'ยืนยันไม่สำเร็จ: ' + (data.error || 'unknown error') });
      }
      return interaction.editReply({ content: 'ยืนยันสำเร็จ! บัญชี "' + data.username + '" ถูกสร้างแล้ว — กลับไปที่เว็บได้เลย' });
    }
  } catch (e) {
    console.error('interaction error', e);
    if (interaction.deferred || interaction.replied) {
      interaction.editReply({ content: 'เกิดข้อผิดพลาด ลองใหม่' }).catch(function () {});
    }
  }
});

client.login(TOKEN);
