'use strict';
const zlib = require('zlib');

const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function randInt(n) { return Math.floor(Math.random() * n); }

function makeCaptcha(opts) {
  const o = Object.assign({ width: 190, height: 64, digits: 4 }, opts || {});
  const W = o.width, H = o.height;
  const rgb = Buffer.alloc(W * H * 3);

  const bg = 238 + randInt(12);
  for (let i = 0; i < W * H; i++) {
    const v = Math.max(0, Math.min(255, bg - randInt(22)));
    rgb[i * 3] = v;
    rgb[i * 3 + 1] = v;
    rgb[i * 3 + 2] = v;
  }

  function px(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
  }

  const answer = [];
  for (let d = 0; d < o.digits; d++) answer.push(randInt(10));
  const answerStr = answer.join('');

  const scale = 5 + randInt(2);
  const startX = 12 + randInt(6);
  const step = Math.floor((W - startX * 2) / o.digits);

  for (let d = 0; d < o.digits; d++) {
    const glyph = FONT[String(answer[d])];
    const baseX = startX + d * step + randInt(6) - 3;
    const baseY = 8 + randInt(10);
    const shear = (Math.random() * 0.5 - 0.25);
    const color = [
      30 + randInt(110),
      30 + randInt(110),
      30 + randInt(110)
    ];
    for (let gy = 0; gy < glyph.length; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== '1') continue;
        const ox = Math.round(gx * scale + gy * shear * scale);
        const oy = gy * scale;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            px(baseX + ox + sx, baseY + oy + sy, color[0], color[1], color[2]);
          }
        }
      }
    }
  }

  for (let i = 0; i < 7; i++) {
    const c = [60 + randInt(120), 60 + randInt(120), 60 + randInt(120)];
    let x1 = randInt(W), y1 = randInt(H), x2 = randInt(W), y2 = randInt(H);
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) || 1;
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x1 + (x2 - x1) * s / steps);
      const y = Math.round(y1 + (y2 - y1) * s / steps);
      px(x, y, c[0], c[1], c[2]);
      px(x + 1, y, c[0], c[1], c[2]);
    }
  }

  for (let i = 0; i < 420; i++) {
    const v = 90 + randInt(110);
    px(randInt(W), randInt(H), v, v, v);
  }

  for (let i = 0; i < 60; i++) {
    const v = 20 + randInt(120);
    px(randInt(W), randInt(H), v, v, v);
  }

  const amp = 2.2 + Math.random() * 1.6;
  const lam = 26 + randInt(18);
  const shift = Math.random() * Math.PI * 2;
  const warped = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const dx = Math.round(amp * Math.sin((y / lam) * Math.PI * 2 + shift));
    for (let x = 0; x < W; x++) {
      const sx = Math.max(0, Math.min(W - 1, x - dx));
      const si = (y * W + sx) * 3;
      const di = (y * W + x) * 3;
      warped[di] = rgb[si];
      warped[di + 1] = rgb[si + 1];
      warped[di + 2] = rgb[si + 2];
    }
  }

  return { png: encodePNG(W, H, warped), answer: answerStr };
}

module.exports = { makeCaptcha: makeCaptcha, encodePNG: encodePNG };
