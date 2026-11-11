#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d .git ]; then
  echo "not a git repo"
  exit 1
fi

echo "[1/4] fetch"
git fetch --all --quiet

if ! git diff --quiet; then
  echo "local changes found -> backup + reset"
  git stash push --quiet -m "auto-backup-$(date +%s)" || true
fi

echo "[2/4] reset to origin/main"
git reset --hard origin/main --quiet

if [ ! -d node_modules ]; then
  echo "[3/4] npm install"
  npm install --no-audit --no-fund
else
  echo "[3/4] node_modules ok"
fi

echo "[4/4] restart web + bot"
pkill -f "run-web.sh" 2>/dev/null || true
pkill -f "run-bot.sh" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
pkill -f "node bot.js" 2>/dev/null || true
rm -f bot.lock
sleep 1
nohup ./run-web.sh >> server.log 2>&1 &
nohup ./run-bot.sh >> bot.log 2>&1 &
sleep 3
echo "เว็บ: $(pgrep -f 'node server.js' >/dev/null && echo 'เปิดแล้ว' || echo 'ยังไม่ขึ้น — เช็ก server.log')"
echo "บอท: $(pgrep -f 'node bot.js' >/dev/null && echo 'เปิดแล้ว' || echo 'ยังไม่ขึ้น — เช็ก bot.log')"
echo "log: $(pwd)/server.log · $(pwd)/bot.log"
