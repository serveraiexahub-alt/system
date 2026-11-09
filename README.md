# สกัด HUB — system

เว็บโฮสต์สคริปต์ Lua + ระบบสมาชิก + Lua Obfuscator + ยืนยันตัวตนผ่าน Discord

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `server.js` | เว็บ + REST API ทั้งหมด |
| `obf.js` | เครื่องมือปกปิดโค้ด Lua (3 scheme, หลายชั้น, โค้ดขยะ) |
| `captcha.js` | สร้างรูป captcha 4 หลัก (PNG) |
| `bot.js` | บอท Discord (ยืนยันตัวตน + ต้อนรับ/ลาก่อน + กันสแปม) |
| `update.sh` | อัปเดตจาก git + restart |

## ติดตั้ง

```bash
npm install
cp .env.example .env
nano .env          # ใส่ค่าให้ครบ
```

ทั้ง `server.js` และ `bot.js` จะอ่าน `.env` ให้อัตโนมัติ (ไม่ต้อง export ทีละตัว)

## ตัวแปรสภาพแวดล้อม (สำคัญ)

```bash
PORT=3000
DATA_FILE=./data.json

SECRET=<hex สุ่ม 32 ไบต์>          # ถ้าไม่ตั้ง จะสุ่มใหม่ทุก restart = ผู้ใช้หลุดหมด
TRUST_PROXY=1                      # อยู่หลัง Cloudflare = 1

SIGNUP_IP_MAX=5                    # จำนวนบัญชีต่อ IP ต่อวัน
SIGNUP_FP_MAX=3                    # จำนวนบัญชีต่อเครื่องต่อวัน
SIGNUP_WINDOW_H=24

OBF_DAILY_LIMIT=5                  # จำนวนครั้งที่ปกปิดโค้ดได้ต่อวัน

# Discord
BOT_SECRET=<สตริงลับ>              # ต้องตรงกับฝั่งบอท (ถ้าไม่ตั้ง = ปิดการยืนยัน)
DISCORD_GUILD=                     # (ไม่บังคับ) จำกัดเฉพาะเซิร์ฟเวอร์นี้
DISCORD_INVITE=https://discord.gg/WnB2wtHy5
```

`CAPTCHA_DEBUG=1` สำหรับทดสอบเท่านั้น (คืนคำตอบ captcha มาด้วย) — **ห้ามเปิดบน production**

## รันเว็บ

```bash
node server.js
```

## รันบอท Discord

```bash
npm run bot
```

บอทอ่านค่า `DISCORD_TOKEN`, `BOT_SECRET`, `WEB_URL`, `DISCORD_CHANNEL_ID` จาก `.env`

ต้องตั้งค่าเพิ่ม:

```bash
export DISCORD_TOKEN=<token บอท>
export BOT_SECRET=<ต้องตรงกับฝั่งเว็บ>
export WEB_URL=https://โดเมนของคุณ
export DISCORD_CHANNEL_ID=1568954728388501524
```

บอททำ 4 อย่าง:

1. **ยืนยันตัวตนในเซิร์ฟเวอร์** — ปุ่มในห้อง `VERIFY_CHANNEL` → ส่งรูปรหัส 5 หลัก → ถูกต้องได้ยศ `VERIFIED_ROLE_ID`
2. **ยืนยันบัญชีเว็บ** — ปุ่มในห้อง `WEB_VERIFY_CHANNEL` → ใส่รหัส `HUB-XXXX-XXXX` → สร้างบัญชีบนเว็บให้
3. **ต้อนรับ/ลาก่อน** — ส่ง embed + GIF ลงห้อง `WELCOME_CHANNEL` / `LEAVE_CHANNEL`
4. **กันสแปม/ยิงกลุ่ม** — สแปม 3 ข้อความใน 1 วิ = timeout 10 นาที, ยิงข้อความเดิม 3 ห้อง = เตะ

ทั้งสองปุ่มเป็น **persistent** — ค้นหาในห้องก่อน ถ้ามีอยู่แล้วจะใช้ของเดิมไม่ส่งซ้ำ

⚠️ ต้องเปิดใน Discord Developer Portal → Bot → Privileged Gateway Intents:
`SERVER MEMBERS` และ `MESSAGE CONTENT` ไม่งั้นบอทจะออนไลน์ไม่ขึ้น

## วิธีสมัคร

1. กรอกชื่อผู้ใช้/รหัสผ่าน + **เลข captcha 4 หลักจากรูป**
2. ระบบออก **รหัสยืนยัน** เช่น `HUB-AB12-CD34` (อายุ 15 นาที)
3. กดเข้ากลุ่ม Discord → กดปุ่ม **ยืนยันบัญชี** → ใส่รหัส
4. บอทตรวจแล้ว บัญชีถูกสร้างให้อัตโนมัติ (หน้าเว็บรออยู่แล้ว)

## อัปเดต

```bash
./update.sh
```

## แก้ปัญหาบอท

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `Unknown interaction (10062)` | ตอบ interaction ไม่ทัน 3 วิ หรือ **รันบอทซ้ำ 2 ตัว** | ปิดตัวเก่าให้หมด `pgrep -af "node bot.js"` แล้วรันใหม่ตัวเดียว |
| บอทตายเงียบๆ หลังกดปุ่ม | error ไม่ถูกจับ (รุ่นเก่า) | อัปเดตแล้ว — บอทจับ error ทั้งหมดและไม่ตาย |
| `another bot instance is already running` | มีบอทตัวเก่าค้าง | `kill <pid>` ตามที่แจ้ง แล้วรันใหม่ |
| ปุ่มกดแล้วไม่ตอบ | บอทออฟไลน์ | `tmux attach -t hub` หรือเช็ค log |

บอทสร้างไฟล์ `bot.lock` กันการรันซ้ำ (ลบเองเมื่อปิด)

## พรีเมียม

| สิทธิ | ฟรี | พรีเมียม 👑 |
|---|---|---|
| ระดับปกปิดโค้ด | 1-2 | 1-5 |
| จำนวนครั้ง/วัน | 5 | 10 |

ให้พรีเมียมผ่านห้อง Discord (ช่อง `PREMIUM_CHANNEL`):
เปิดห้อง → กรอกชื่อบัญชีเว็บ → เลือก 1 เดือน / 1 ปี → พนักงานกด **ยืนยันให้พรีเมียม** → กด **ปิดห้อง**

API สำหรับบอท (ต้องมี `x-bot-secret`):
```
POST /api/discord/premium  { username, plan: "1m" | "1y" }
POST /api/discord/premium/status  { username }
```

## การยืนยันตัวตน

- Discord 1 บัญชี ยืนยันได้ **ครั้งเดียว** (กันบัญชีปลอม)
- แจ้งเตือนคนสมัครใหม่ไปที่ช่อง `SIGNUP_NOTIFY_CHANNEL`

## แก้ปัญหา captcha

ถ้ากรอกเลขถูกแต่ไม่ผ่าน ให้เช็คว่าเวอร์ชัน `captcha.js` เป็นตัวที่รับ `value`
(บั๊กเก่า: รูปสุ่มเลขเองแต่ไปเทียบกับอีกรหัสหนึ่ง — แก้แล้ว)

## ยศพรีเมียม

- ตอนให้พรีเมียม บอทจะให้ยศ `PREMIUM_ROLE_ID` กับ Discord ที่ผูกกับบัญชีนั้น
- บอทเช็คทุก 5 นาที ถ้าพรีเมียมหมดอายุ → ถอดยศ + ตั้ง `premiumUntil=0` อัตโนมัติ

API ที่บอทใช้:
```
GET  /api/discord/premium/expiring   -> รายชื่อที่หมดอายุแล้ว
POST /api/discord/premium/cleared    -> ยืนยันว่าถอดยศแล้ว
```

## อีโมจิ

ตั้งได้ใน `.env` (`EMOJI_VERIFY`, `EMOJI_PREMIUM`, `EMOJI_LV`, `EMOJI_TIMES`, `EMOJI_CROWN`)
รูปแบบ `<:ชื่อ:id>` — ถ้าไม่ตั้งจะใช้ค่าเริ่มต้น
