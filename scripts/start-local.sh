#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_STATIC_DIR="$REPO_DIR/backend/static"
FRONTEND_STATIC_DIR="$REPO_DIR/frontend/static"

if [[ -n "${VIRTUAL_ENV:-}" && -x "$VIRTUAL_ENV/bin/python" ]]; then
  PYTHON_BIN="$VIRTUAL_ENV/bin/python"
elif [[ -x "/home/ayoola/sen/.venv/bin/python" ]]; then
  PYTHON_BIN="/home/ayoola/sen/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
else
  PYTHON_BIN="$(command -v python)"
fi

sync_frontend_build() {
  mkdir -p "$BACKEND_STATIC_DIR"
  rm -rf "$BACKEND_STATIC_DIR"/*
  cp -r "$FRONTEND_STATIC_DIR"/* "$BACKEND_STATIC_DIR"/
}

if [[ -f "$FRONTEND_STATIC_DIR/index.html" ]]; then
  echo "📋 Syncing frontend/static into backend/static..."
  sync_frontend_build
elif [[ ! -f "$BACKEND_STATIC_DIR/index.html" ]]; then
  echo "🔨 No built frontend bundle found. Building frontend once for local backend serving..."
  pushd "$REPO_DIR/frontend" >/dev/null
  if [[ ! -d node_modules ]]; then
    npm install --legacy-peer-deps
  fi
  npm run build
  popd >/dev/null
  sync_frontend_build
fi

export PUBLIC_APP_URL="${PUBLIC_APP_URL:-http://127.0.0.1:5173}"
export LOCAL_DEV_AUTH="${LOCAL_DEV_AUTH:-true}"
export INSIGHTS_VOICE_MODE="${INSIGHTS_VOICE_MODE:-full_duplex}"
export VOICE_AGENT_FULLSCREEN_ENABLED="${VOICE_AGENT_FULLSCREEN_ENABLED:-true}"
export LOCAL_DEV_USER_ROLE="${LOCAL_DEV_USER_ROLE:-therapist}"
case "$LOCAL_DEV_USER_ROLE" in
  learner|kid|student)
    DEFAULT_LOCAL_DEV_USER_ID="dev-learner-001"
    DEFAULT_LOCAL_DEV_USER_NAME="Dev Learner"
    DEFAULT_LOCAL_DEV_USER_EMAIL="learner@localhost"
    ;;
  admin)
    DEFAULT_LOCAL_DEV_USER_ID="dev-admin-001"
    DEFAULT_LOCAL_DEV_USER_NAME="Dev Admin"
    DEFAULT_LOCAL_DEV_USER_EMAIL="admin@localhost"
    ;;
  teacher)
    DEFAULT_LOCAL_DEV_USER_ID="dev-teacher-001"
    DEFAULT_LOCAL_DEV_USER_NAME="Dev Teacher"
    DEFAULT_LOCAL_DEV_USER_EMAIL="teacher@localhost"
    ;;
  parent)
    DEFAULT_LOCAL_DEV_USER_ID="dev-parent-001"
    DEFAULT_LOCAL_DEV_USER_NAME="Dev Parent"
    DEFAULT_LOCAL_DEV_USER_EMAIL="parent@localhost"
    ;;
  *)
    DEFAULT_LOCAL_DEV_USER_ID="dev-therapist-001"
    DEFAULT_LOCAL_DEV_USER_NAME="Dev Therapist"
    DEFAULT_LOCAL_DEV_USER_EMAIL="dev@localhost"
    ;;
esac
export LOCAL_DEV_USER_ID="${LOCAL_DEV_USER_ID:-$DEFAULT_LOCAL_DEV_USER_ID}"
export LOCAL_DEV_USER_NAME="${LOCAL_DEV_USER_NAME:-$DEFAULT_LOCAL_DEV_USER_NAME}"
export LOCAL_DEV_USER_EMAIL="${LOCAL_DEV_USER_EMAIL:-$DEFAULT_LOCAL_DEV_USER_EMAIL}"
export LOCAL_DEV_USER_PROVIDER="${LOCAL_DEV_USER_PROVIDER:-local-dev}"

echo "🚀 Starting backend with PUBLIC_APP_URL=$PUBLIC_APP_URL and LOCAL_DEV_AUTH=$LOCAL_DEV_AUTH"
cd "$REPO_DIR/backend"
exec env \
  -u IDENTITY_ENDPOINT \
  -u WEBSITE_HOSTNAME \
  -u WEBSITE_SITE_NAME \
  -u CONTAINER_APP_NAME \
  -u CONTAINER_APP_REVISION \
  -u CONTAINER_APP_ENV_DNS_SUFFIX \
  "$PYTHON_BIN" -m src.app