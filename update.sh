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

echo "[4/4] restart"
pkill -f "node server.js" 2>/dev/null || true
sleep 1
nohup node server.js >> server.log 2>&1 &
sleep 1
echo "running pid $!"
echo "log: $(pwd)/server.log"
