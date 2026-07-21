#!/usr/bin/env bash
# Enable systemd timers after .env is configured.
set -euo pipefail

APP_DIR="${T_EMPLOY_HOME:-/opt/t-employ}"
if [[ -f /etc/default/t-employ ]]; then
  # shellcheck disable=SC1091
  source /etc/default/t-employ
fi
APP_DIR="${T_EMPLOY_HOME:-$APP_DIR}"
APP_USER="${T_EMPLOY_USER:-ubuntu}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/oracle/install-timers.sh" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "Missing $APP_DIR/.env — copy env.example and fill secrets first." >&2
  exit 1
fi

if ! grep -qE '^AUTO_CRAWL_ENABLED=(true|1)' "$APP_DIR/.env"; then
  echo "Set AUTO_CRAWL_ENABLED=true in $APP_DIR/.env before enabling timers." >&2
  exit 1
fi

install -m 0755 "$APP_DIR/deploy/oracle/run-job.sh" /usr/local/bin/t-employ-run

UNIT_SRC="$APP_DIR/deploy/oracle/systemd"
for f in "$UNIT_SRC"/*.service "$UNIT_SRC"/*.timer; do
  base="$(basename "$f")"
  # Rewrite User/Group/WorkingDirectory for this host
  sed -e "s/^User=.*/User=${APP_USER}/" \
      -e "s/^Group=.*/Group=${APP_USER}/" \
      -e "s|^WorkingDirectory=.*|WorkingDirectory=${APP_DIR}|" \
      "$f" >"/etc/systemd/system/${base}"
done

systemctl daemon-reload

TIMERS=(
  t-employ-session.timer
  t-employ-talent.timer
  t-employ-pdf.timer
  t-employ-digest.timer
  t-employ-poll.timer
  t-employ-health.timer
)

for t in "${TIMERS[@]}"; do
  systemctl enable --now "$t"
done

systemctl list-timers 't-employ-*' --no-pager
echo "[install-timers] enabled: ${TIMERS[*]}"
