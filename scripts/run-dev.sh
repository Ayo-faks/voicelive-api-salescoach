#!/usr/bin/env bash
# run-dev.sh — start the Pathfinder/VoiceLive local dev stack (backend + frontend)
# with the correct env so the model-backed assistant + voice are actually enabled.
#
# Usage:
#   scripts/run-dev.sh            # start backend (:8000) and frontend (:5173)
#   scripts/run-dev.sh backend    # backend only
#   scripts/run-dev.sh frontend   # frontend only
#   scripts/run-dev.sh stop       # stop both
#   scripts/run-dev.sh status     # show health of both
#
# Why this script exists:
#   PATHFINDER_ASSISTANT_LLM_ENABLED and PATHFINDER_VOICE_ENABLED do NOT live in
#   .env. If the backend is started without them, ModelAssistantProvider is never
#   constructed and the assistant silently falls back to the deterministic template
#   ("Start with your current focus topic ...") in BOTH text and voice. This script
#   always injects them so that regression can't happen.

set -euo pipefail

# --- paths -------------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
ENV_FILE="$ROOT/.env"
VENV_PY="/home/ayoola/sen/.venv/bin/python"
LOG_DIR="${TMPDIR:-/tmp}"
BE_LOG="$LOG_DIR/pf_backend.log"
FE_LOG="$LOG_DIR/pf_frontend.log"
BACKEND_PORT=8000
FRONTEND_PORT=5173

# --- helpers -----------------------------------------------------------------
log() { printf '\033[36m[run-dev]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[run-dev]\033[0m %s\n' "$*" >&2; }

free_port() { fuser -k "${1}/tcp" 2>/dev/null || true; }

wait_http() { # url, tries
  local url="$1" tries="${2:-20}" code
  for _ in $(seq 1 "$tries"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    [ "$code" = "200" ] && { echo "$code"; return 0; }
    sleep 1
  done
  echo "$code"; return 1
}

start_backend() {
  [ -f "$ENV_FILE" ] || { err "missing $ENV_FILE"; exit 1; }
  log "stopping anything on :$BACKEND_PORT"
  free_port "$BACKEND_PORT"
  sleep 1
  log "starting backend (model + voice ENABLED) -> $BE_LOG"
  (
    cd "$BACKEND_DIR"
    # Capture any caller-provided dev-identity overrides BEFORE sourcing .env,
    # so that .env's (therapist) identity does not clobber this learner runner.
    _caller_role="${LOCAL_DEV_USER_ROLE:-}"
    _caller_uid="${LOCAL_DEV_USER_ID:-}"
    _caller_name="${LOCAL_DEV_USER_NAME:-}"
    _caller_email="${LOCAL_DEV_USER_EMAIL:-}"
    set -a; . "$ENV_FILE"; set +a
    # Critical flags that are intentionally NOT in .env:
    export PATHFINDER_ASSISTANT_LLM_ENABLED=1
    export PATHFINDER_VOICE_ENABLED=1
    export PATHFINDER_VOICELIVE_ENABLED=true
    # Learner-onboarding routes (weekly-stats, careers, onboarding) must match
    # the frontend's VITE_PATHFINDER_LEARNER_ONBOARDING_ENABLED=true below,
    # otherwise the home stats/actionable-stats surfaces 404.
    export PATHFINDER_LEARNER_ONBOARDING_ENABLED=true
    # Dense (semantic) RAG stage so the tutor grounds on misspelled / phonetic
    # queries (e.g. "homsteasis" -> homeostasis) instead of deferring. Opt-in
    # by design; uses the same Azure OpenAI creds as chat, embedding deployment
    # text-embedding-3-small (calibrated threshold lives in rag.py).
    export PATHFINDER_RAG_EMBEDDINGS_ENABLED=true
    # Text tutor model override — gpt-5.4-mini answers ~3x faster than gpt-4o
    # under the tutor's JSON envelope (see docs/session-2026-06-10-*). Voice
    # paths still use MODEL_DEPLOYMENT_NAME.
    export PATHFINDER_ASSISTANT_MODEL_DEPLOYMENT=gpt-5.4-mini
    # Local dev identity / storage (caller shell override wins, else learner):
    export LOCAL_DEV_AUTH=true
    export LOCAL_DEV_USER_ROLE="${_caller_role:-learner}"
    export LOCAL_DEV_USER_ID="${_caller_uid:-local-dev-learner}"
    export LOCAL_DEV_USER_NAME="${_caller_name:-Local Learner}"
    export LOCAL_DEV_USER_EMAIL="${_caller_email:-learner@localhost}"
    export DATABASE_BACKEND="${DATABASE_BACKEND:-sqlite}"
    export HOST=0.0.0.0 PORT="$BACKEND_PORT" PYTHONUNBUFFERED=1
    nohup "$VENV_PY" -m src.app
  ) > "$BE_LOG" 2>&1 &
  log "backend pid $!"
  local code; code="$(wait_http "http://127.0.0.1:$BACKEND_PORT/home" 20 || true)"
  if [ "$code" = "200" ]; then log "backend healthy (200)"; else err "backend not healthy (got $code) — tail $BE_LOG:"; tail -n 20 "$BE_LOG" >&2 || true; fi
}

start_frontend() {
  [ -d "$FRONTEND_DIR/node_modules" ] || { log "installing frontend deps"; (cd "$FRONTEND_DIR" && npm install); }
  log "stopping anything on :$FRONTEND_PORT"
  free_port "$FRONTEND_PORT"
  sleep 1
  log "starting frontend (vite, proxies /api+/ws -> :$BACKEND_PORT) -> $FE_LOG"
  ( cd "$FRONTEND_DIR" && \
    VITE_PATHFINDER_LEARNER_ONBOARDING_ENABLED=true \
    VITE_PATHFINDER_GOAL_INTAKE_ENABLED=true \
    VITE_PATHFINDER_HOME_CHIPS_ENABLED=true \
    VITE_PATHFINDER_ACTIONABLE_STATS_ENABLED=true \
    VITE_PATHFINDER_VOICE_ENTRY_CARD_ENABLED=true \
    nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" ) > "$FE_LOG" 2>&1 &
  log "frontend pid $!"
  local code; code="$(wait_http "http://127.0.0.1:$FRONTEND_PORT/" 30 || true)"
  if [ "$code" = "200" ]; then log "frontend healthy (200) -> http://localhost:$FRONTEND_PORT"; else err "frontend not healthy (got $code) — tail $FE_LOG:"; tail -n 20 "$FE_LOG" >&2 || true; fi
}

stop_all() {
  log "stopping backend + frontend"
  free_port "$BACKEND_PORT"
  free_port "$FRONTEND_PORT"
  pkill -f 'src.app' 2>/dev/null || true
  log "stopped"
}

status() {
  local be fe
  be="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$BACKEND_PORT/home" 2>/dev/null || echo 000)"
  fe="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FRONTEND_PORT/" 2>/dev/null || echo 000)"
  printf 'backend  :%s -> %s\nfrontend :%s -> %s\n' "$BACKEND_PORT" "$be" "$FRONTEND_PORT" "$fe"
  # Quick provider sanity check (should be grounded=True, not the template):
  if [ "$be" = "200" ]; then
    # Flag-gated route check: 404 here means the backend was started WITHOUT
    # PATHFINDER_LEARNER_ONBOARDING_ENABLED (home stats silently vanish).
    local ws
    ws="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$BACKEND_PORT/api/learning/weekly-stats" 2>/dev/null || echo 000)"
    if [ "$ws" = "404" ]; then
      err "weekly-stats 404 — backend is missing PATHFINDER_LEARNER_ONBOARDING_ENABLED; restart it with: bash scripts/run-dev.sh backend"
    else
      log "weekly-stats route OK ($ws) — learner-onboarding flag active"
    fi
    log "assistant smoke test (expect a real grounded answer, not a template):"
    curl -s -X POST "http://127.0.0.1:$BACKEND_PORT/api/learning/assistant/ask" \
      -H 'Content-Type: application/json' -b 'pf_dev=1' \
      -d '{"question":"What is photosynthesis?"}' \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  grounded=",d.get("grounded"),"| answer=",(d.get("answer") or "")[:120])' 2>/dev/null || true
  fi
}

# --- dispatch ----------------------------------------------------------------
case "${1:-all}" in
  all)      start_backend; start_frontend; status ;;
  backend)  start_backend ;;
  frontend) start_frontend ;;
  stop)     stop_all ;;
  status)   status ;;
  *) err "unknown command '$1' (use: all|backend|frontend|stop|status)"; exit 2 ;;
esac
