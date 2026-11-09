#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

CYCLE="${WEB_CYCLE_SECONDS:-7200}"
PAUSE="${WEB_PAUSE_SECONDS:-5}"

if [ ! -f .env ]; then
  echo "ไม่พบ .env — สร้างก่อน: cp .env.example .env"
  exit 1
fi

if [ ! -d node_modules/express ]; then
  echo "[setup] npm install"
  npm install --no-audit --no-fund || exit 1
fi

for p in $(pgrep -f "node server.js" 2>/dev/null); do kill "$p" 2>/dev/null; done
sleep 1

fails=0
while true; do
  start=$(date +%s)
  echo "[$(date '+%F %T')] เริ่มเว็บ (รอบ ${CYCLE}s)" | tee -a server.log
  timeout "$CYCLE" node server.js 2>&1 | tee -a server.log
  rc=${PIPESTATUS[0]}
  took=$(( $(date +%s) - start ))
  if [ "$rc" -eq 124 ] || [ "$took" -ge "$CYCLE" ]; then
    echo "[$(date '+%F %T')] ครบรอบ — รีสตาร์ทใน ${PAUSE}s" | tee -a server.log
    fails=0
  elif [ "$took" -lt 10 ]; then
    fails=$(( fails + 1 ))
    echo "[$(date '+%F %T')] ออกเร็วผิดปกติ (${took}s) ครั้งที่ $fails" | tee -a server.log
    if [ "$fails" -ge 3 ]; then echo "หยุด: เว็บออก 3 ครั้งติด — เช็ก .env" | tee -a server.log; exit 1; fi
  else
    fails=0
  fi
  sleep "$PAUSE"
done
