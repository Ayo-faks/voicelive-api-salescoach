#!/usr/bin/env bash
# Hermetic k6 smoke for the Pathfinder Learn voice frame broker.
#
# Starts the local real-socket voice broker server, waits for it to listen, runs
# the k6 WS script in SMOKE mode (1 VU / 5s with SLO thresholds), then tears the
# server down. Exits with k6's exit code so a breached SLO fails CI.
#
# Set FIXTURE_BRAIN=1 to isolate pure transport (connect/auth/frame-relay) cost.
#
# Usage: backend/loadtest/run_voice_smoke.sh   (run from repo root or backend/)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "${HERE}/.." && pwd)"
PYTHON="${PYTHON:-python}"
PORT="${PORT:-8789}"
HOST="${HOST:-127.0.0.1}"
BASE_URL="http://${HOST}:${PORT}"

cd "${BACKEND}"

if ! command -v k6 >/dev/null 2>&1; then
  echo "[skip] k6 not installed; install from https://k6.io/docs/get-started/installation/" >&2
  exit 0
fi

SERVER_ARGS=(--host "${HOST}" --port "${PORT}")
# The hermetic voice gate measures TRANSPORT (connect/auth/frame-relay), not the
# model brain (which is the same prose planner already covered by the text smoke
# and is model-bound). Default to the fixture brain so turn_rtt_ms is an honest
# transport number; set FIXTURE_BRAIN=0 to wire the real brain deliberately.
if [[ "${FIXTURE_BRAIN:-1}" == "1" ]]; then
  SERVER_ARGS+=(--fixture-brain)
  echo "[smoke] voice broker using fixture (transport-only) brain" >&2
fi

echo "[smoke] starting voice broker on ${BASE_URL}" >&2
PYTHONPATH=. "${PYTHON}" loadtest/serve_learning_voice.py "${SERVER_ARGS[@]}" &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" >/dev/null 2>&1 || true
  wait "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT

# Wait up to ~10s for the HTTP port to accept connections (the WS upgrade lives
# on the same port). A 404/426 on GET still means the listener is up.
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "${BASE_URL}/ws/learning-voice"; then
    break
  fi
  sleep 0.2
done

echo "[smoke] running k6 (SMOKE=1)" >&2
SMOKE=1 BASE_URL="${BASE_URL}" OPERATOR="${OPERATOR:-smoke}" \
  k6 run loadtest/learning_voice.js
