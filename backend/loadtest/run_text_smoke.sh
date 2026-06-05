#!/usr/bin/env bash
# Hermetic k6 smoke for the Pathfinder Learn text-tutor journey.
#
# Starts the local real-socket learning server, waits for it to listen, runs the
# k6 script in SMOKE mode (1 VU / 5s with SLO thresholds), then tears the server
# down. Exits with k6's exit code so a breached SLO fails CI.
#
# Usage: backend/loadtest/run_text_smoke.sh   (run from repo root or backend/)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "${HERE}/.." && pwd)"
PYTHON="${PYTHON:-python}"
PORT="${PORT:-8788}"
HOST="${HOST:-127.0.0.1}"
BASE_URL="http://${HOST}:${PORT}"

cd "${BACKEND}"

if ! command -v k6 >/dev/null 2>&1; then
  echo "[skip] k6 not installed; install from https://k6.io/docs/get-started/installation/" >&2
  exit 0
fi

echo "[smoke] starting learning server on ${BASE_URL}" >&2
PYTHONPATH=. "${PYTHON}" loadtest/serve_learning_routes.py --host "${HOST}" --port "${PORT}" &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" >/dev/null 2>&1 || true
  wait "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT

# Wait up to ~10s for the diagnostic/start route to accept connections.
for _ in $(seq 1 50); do
  if curl -sf -o /dev/null -X POST "${BASE_URL}/api/learning/diagnostic/start" \
      -H 'Content-Type: application/json' \
      -d '{"synthetic":true,"operator":"smoke","student_id":"smoke-probe"}'; then
    break
  fi
  sleep 0.2
done

echo "[smoke] running k6 (SMOKE=1)" >&2
SMOKE=1 BASE_URL="${BASE_URL}" OPERATOR="${OPERATOR:-smoke}" \
  k6 run loadtest/learning_tutor.js
