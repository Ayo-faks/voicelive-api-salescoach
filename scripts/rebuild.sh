#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🧹 Cleaning previous build..."
rm -rf "$REPO_DIR/frontend/static" "$REPO_DIR/backend/static"

cd "$REPO_DIR/frontend"

echo "🔨 Building React app..."
npm run build

echo "📋 Copying build to backend static folder..."
cd "$REPO_DIR"
mkdir -p backend/static
cp -r frontend/static/* backend/static/

exec "$SCRIPT_DIR/start-local.sh"