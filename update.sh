#!/usr/bin/env bash
# อัปเดตเว็บจาก GitHub แล้วรีสตาร์ทเว็บ + บอททันที (คำสั่งเดียวจบ)
set -u
cd "$(dirname "$0")"

PORT="$(grep -E '^PORT=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' ')"
PORT="${PORT:-3000}"

if [ ! -d .git ]; then
  echo "ไม่ใช่ git repo — รันในโฟลเดอร์ ~/system"
  exit 1
fi

echo "[1/5] ดึงข้อมูลจาก GitHub"
if ! git fetch --all --quiet; then
  echo "ดึงไม่สำเร็จ — เช็กเน็ต / token ใน .git-credentials"
  exit 1
fi

if ! git diff --quiet || [ -n "$(git status --porcelain)" ]; then
  echo "      พบไฟล์แก้ในเครื่อง — สำรองไว้ก่อน"
  git stash push --quiet -u -m "auto-backup-$(date +%s)" || true
fi

echo "[2/5] อัปเดตโค้ดเป็น origin/main"
BEFORE="$(git rev-parse --short HEAD)"
git reset --hard origin/main --quiet
AFTER="$(git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "      ไม่มีอะไรใหม่ (ยังอยู่ที่ $AFTER)"
else
  echo "      $BEFORE -> $AFTER"
  git --no-pager log --oneline "$BEFORE..$AFTER" | head -10 | sed 's/^/      · /'
fi

echo "[3/5] ตรวจ dependencies"
if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm install --no-audit --no-fund || { echo "npm install ล้มเหลว"; exit 1; }
else
  echo "      ไม่ต้องติดตั้งเพิ่ม"
fi

echo "[4/5] หยุดของเก่า"
pkill -f "run-web.sh" 2>/dev/null || true
pkill -f "run-bot.sh" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
pkill -f "node bot.js" 2>/dev/null || true
rm -f bot.lock
sleep 2

echo "[5/5] เปิดเว็บ + บอท"
setsid nohup ./run-web.sh > /dev/null 2>&1 < /dev/null &
setsid nohup ./run-bot.sh > /dev/null 2>&1 < /dev/null &

WEB_OK="ไม่ขึ้น"
for _ in $(seq 1 20); do
  sleep 1
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then WEB_OK="เปิดแล้ว (port $PORT)"; break; fi
done

BOT_OK="ไม่ขึ้น"
for _ in $(seq 1 15); do
  if pgrep -f "node bot.js" > /dev/null 2>&1; then BOT_OK="เปิดแล้ว"; break; fi
  sleep 1
done

echo
echo "────────── สรุป ──────────"
echo "เว็บ : $WEB_OK"
echo "บอท : $BOT_OK"
echo "โค้ด : $AFTER"
echo "log  : $(pwd)/server.log · $(pwd)/bot.log"
echo "──────────────────────────"
[ "$WEB_OK" = "ไม่ขึ้น" ] && echo "⚠️ เว็บไม่ขึ้น — ดู: tail -30 server.log"
[ "$BOT_OK" = "ไม่ขึ้น" ] && echo "⚠️ บอทไม่ขึ้น — ดู: tail -30 bot.log"
exit 0
