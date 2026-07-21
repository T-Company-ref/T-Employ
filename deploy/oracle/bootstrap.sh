#!/usr/bin/env bash
# TBELL Employ — Oracle Ubuntu ARM bootstrap
# Run as root (or sudo) on a fresh Ampere A1 VM:
#   curl -fsSL ... | sudo bash
#   or: sudo bash deploy/oracle/bootstrap.sh
#
# Env overrides:
#   T_EMPLOY_HOME=/opt/t-employ
#   T_EMPLOY_REPO=https://github.com/ORG/T-Employ.git
#   T_EMPLOY_BRANCH=main
#   T_EMPLOY_USER=ubuntu
set -euo pipefail

APP_DIR="${T_EMPLOY_HOME:-/opt/t-employ}"
REPO_URL="${T_EMPLOY_REPO:-}"
BRANCH="${T_EMPLOY_BRANCH:-main}"
APP_USER="${T_EMPLOY_USER:-ubuntu}"
LOG_DIR="${T_EMPLOY_LOG:-/var/log/t-employ}"
NODE_MAJOR="${T_EMPLOY_NODE:-20}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/oracle/bootstrap.sh" >&2
  exit 1
fi

echo "[bootstrap] user=${APP_USER} dir=${APP_DIR} node=${NODE_MAJOR}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git gnupg build-essential \
  fonts-liberation fonts-noto-cjk \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
  tzdata

# Asia/Seoul
timedatectl set-timezone Asia/Seoul || true

# Node.js 20.x
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

id -u "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" "$LOG_DIR"
chown -R "$APP_USER:$APP_USER" "$LOG_DIR"

# App source
if [[ -d "$APP_DIR/.git" ]]; then
  echo "[bootstrap] pull existing repo"
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all --prune
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || true
elif [[ -n "$REPO_URL" ]]; then
  echo "[bootstrap] clone $REPO_URL"
  rm -rf "$APP_DIR"
  sudo -u "$APP_USER" git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
elif [[ -f "$(dirname "$0")/../../package.json" ]]; then
  # Running from a checked-out tree copied onto the VM
  SRC="$(cd "$(dirname "$0")/../.." && pwd)"
  echo "[bootstrap] sync from local tree $SRC"
  mkdir -p "$APP_DIR"
  rsync -a --delete \
    --exclude node_modules --exclude .sessions --exclude data --exclude artifacts \
    --exclude .env --exclude screenshots \
    "$SRC/" "$APP_DIR/"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
else
  echo "[bootstrap] Set T_EMPLOY_REPO=https://github.com/.../T-Employ.git or copy the repo first." >&2
  exit 1
fi

# Dependencies
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm ci || npm install"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npx playwright install chromium"
# System deps for chromium (may no-op if already installed)
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npx playwright install-deps chromium" || true

# .env
if [[ ! -f "$APP_DIR/.env" ]]; then
  if [[ -f "$APP_DIR/deploy/oracle/env.example" ]]; then
    cp "$APP_DIR/deploy/oracle/env.example" "$APP_DIR/.env"
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
    echo "[bootstrap] created $APP_DIR/.env from env.example — EDIT SECRETS before enabling timers"
  else
    echo "[bootstrap] WARNING: no .env — create before running jobs" >&2
  fi
fi

# Sessions dir
sudo -u "$APP_USER" mkdir -p "$APP_DIR/.sessions"

# Wrapper
install -m 0755 "$APP_DIR/deploy/oracle/run-job.sh" /usr/local/bin/t-employ-run
# Patch default home into a tiny env file for systemd
cat >/etc/default/t-employ <<EOF
T_EMPLOY_HOME=$APP_DIR
T_EMPLOY_LOG=$LOG_DIR
T_EMPLOY_USER=$APP_USER
EOF

# systemd units
UNIT_SRC="$APP_DIR/deploy/oracle/systemd"
if [[ -d "$UNIT_SRC" ]]; then
  cp "$UNIT_SRC"/*.service /etc/systemd/system/
  cp "$UNIT_SRC"/*.timer /etc/systemd/system/
  systemctl daemon-reload
  echo "[bootstrap] systemd units installed (not enabled yet)"
  echo "  Enable after editing .env:"
  echo "    sudo bash $APP_DIR/deploy/oracle/install-timers.sh"
fi

echo "[bootstrap] done."
echo "Next:"
echo "  1) nano $APP_DIR/.env"
echo "  2) sudo -u $APP_USER bash -lc 'cd $APP_DIR && npm run session:refresh -- jobkorea'"
echo "  3) sudo bash $APP_DIR/deploy/oracle/install-timers.sh"
echo "  4) sudo bash $APP_DIR/deploy/oracle/smoke-check.sh"
