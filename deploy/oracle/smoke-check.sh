#!/usr/bin/env bash
# Quick health check after bootstrap / timer install.
set -euo pipefail

if [[ -f /etc/default/t-employ ]]; then
  # shellcheck disable=SC1091
  source /etc/default/t-employ
fi
APP_DIR="${T_EMPLOY_HOME:-/opt/t-employ}"
APP_USER="${T_EMPLOY_USER:-ubuntu}"
LOG_DIR="${T_EMPLOY_LOG:-/var/log/t-employ}"

echo "== host =="
uname -a
timedatectl | head -n 5 || true
node -v
echo "APP_DIR=$APP_DIR USER=$APP_USER"

echo "== files =="
test -f "$APP_DIR/.env" && echo "ok .env" || echo "MISSING .env"
test -x /usr/local/bin/t-employ-run && echo "ok t-employ-run" || echo "MISSING t-employ-run"
test -d "$APP_DIR/node_modules/playwright" && echo "ok playwright" || echo "MISSING playwright"

echo "== timers =="
systemctl list-timers 't-employ-*' --no-pager || true

echo "== one-shot poll (limit 5) =="
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm run poll:applicants -- --limit 5" || {
  echo "poll failed (session may need refresh)" >&2
  echo "Try: sudo -u $APP_USER bash -lc 'cd $APP_DIR && npm run session:refresh -- jobkorea'" >&2
  exit 1
}

echo "== recent logs =="
ls -lt "$LOG_DIR" 2>/dev/null | head -n 10 || true
echo "[smoke-check] ok"
