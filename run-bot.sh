#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ไม่พบ .env — สร้างก่อน: cp .env.example .env"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ไม่พบ node — ติดตั้งก่อน: pkg install nodejs-lts"
  exit 1
fi

for p in $(pgrep -f "node bot.js" 2>/dev/null); do
  kill "$p" 2>/dev/null
done
sleep 1
rm -f bot.lock

if [ ! -d node_modules/discord.js ]; then
  echo "[setup] npm install"
  npm install --no-audit --no-fund || exit 1
fi

CYCLE="${BOT_CYCLE_SECONDS:-7200}"
PAUSE="${BOT_PAUSE_SECONDS:-5}"

fails=0
while true; do
  start=$(date +%s)
  echo "[$(date '+%F %T')] เริ่มบอท (รอบ ${CYCLE}s)" | tee -a bot.log
  timeout "$CYCLE" node bot.js 2>&1 | tee -a bot.log
  rc=${PIPESTATUS[0]}
  end=$(date +%s)
  took=$(( end - start ))
  if [ "$rc" -eq 124 ] || [ "$took" -ge "$CYCLE" ]; then
    fails=0
  elif [ "$took" -lt 10 ]; then
    fails=$(( fails + 1 ))
    echo "[$(date '+%F %T')] บอทออกเร็วผิดปกติ (${took}s) ครั้งที่ $fails" | tee -a bot.log
    if [ "$fails" -ge 3 ]; then
      echo "หยุด: บอทออก 3 ครั้งติดกัน — เช็ก DISCORD_TOKEN ใน .env" | tee -a bot.log
      exit 1
    fi
  else
    fails=0
  fi
  echo "[$(date '+%F %T')] รีสตาร์ทบอทใน ${PAUSE}s..." | tee -a bot.log
  sleep "$PAUSE"
done
