#!/usr/bin/env bash
# Deploy / start groupAppControl on the target VM.
# Run from the groupAppControl directory ON 172.16.239.236:
#   cd ~/apps/groupAppControl && bash deploy_remote.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PARENT="$(cd "$ROOT/.." && pwd)"
PORT="${PORT:-5178}"
PID_FILE="${ROOT}/.groupAppControl.pid"
LOG_FILE="${ROOT}/.groupAppControl.log"
MOD_NAME="$(basename "$ROOT")"

cd "$PARENT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  old="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old}" ]] && kill -0 "$old" 2>/dev/null; then
    echo "Stopping old process pid=$old"
    kill "$old" 2>/dev/null || true
    sleep 0.5
  fi
fi

if command -v lsof >/dev/null 2>&1; then
  lsof -ti ":$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
fi

chmod +x "$ROOT/deploy_remote.sh" 2>/dev/null || true
# Prefer uv-managed Python 3.12 when available (system python may be too old)
PYBIN="python3"
if command -v uv >/dev/null 2>&1; then
  UV_PY="$(uv python find 3.12 2>/dev/null || true)"
  if [[ -n "${UV_PY}" ]]; then
    PYBIN="$UV_PY"
  fi
fi
export PATH="${HOME}/.local/bin:${PATH}"
nohup "$PYBIN" -u -m "$MOD_NAME" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 0.8

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
IP="${IP:-172.16.239.236}"

echo "groupAppControl started pid=$(cat "$PID_FILE")"
echo "  local:  http://127.0.0.1:${PORT}/"
echo "  lan:    http://${IP}:${PORT}/"
echo "  log:    $LOG_FILE"
curl -fsS "http://127.0.0.1:${PORT}/api/health" || echo "(health check failed — see log)"
echo
