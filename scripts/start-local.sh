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

echo "🚀 Starting backend with PUBLIC_APP_URL=$PUBLIC_APP_URL"
cd "$REPO_DIR/backend"
exec "$PYTHON_BIN" -m src.app