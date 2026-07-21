#!/usr/bin/env bash
# TBELL Employ — npm job wrapper for systemd
# usage: t-employ-run poll:applicants
#        t-employ-run session:refresh -- jobkorea
set -euo pipefail

if [[ -f /etc/default/t-employ ]]; then
  # shellcheck disable=SC1091
  source /etc/default/t-employ
fi

APP_DIR="${T_EMPLOY_HOME:-/opt/t-employ}"
LOG_DIR="${T_EMPLOY_LOG:-/var/log/t-employ}"
mkdir -p "$LOG_DIR"

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "[run-job] missing $APP_DIR/.env" >&2
  exit 1
fi

export PATH="/usr/local/bin:${APP_DIR}/node_modules/.bin:${PATH}"
if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${HOME}/.nvm/nvm.sh"
fi

JOB="${1:-}"
if [[ -z "$JOB" ]]; then
  echo "usage: t-employ-run <npm-script> [args...]" >&2
  exit 2
fi
shift || true

STAMP="$(date '+%Y%m%d')"
SAFE_JOB="${JOB//[:\/]/_}"
LOG_FILE="${LOG_DIR}/${SAFE_JOB}-${STAMP}.log"

echo "==== $(date -Iseconds) start: npm run ${JOB} $* ====" | tee -a "$LOG_FILE"
set +e
npm run "$JOB" -- "$@" >>"$LOG_FILE" 2>&1
CODE=$?
set -e
echo "==== $(date -Iseconds) end (exit=${CODE}) ====" | tee -a "$LOG_FILE"
exit "$CODE"
