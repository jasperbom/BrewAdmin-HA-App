#!/bin/bash
# SessionStart hook — installs frontend deps so `npm run build` works in
# Claude Code on the web sessions. Idempotent: skips install when
# node_modules already exists.
set -euo pipefail

# Only run inside the Claude Code remote sandbox. Local dev environments
# manage their own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

if [ ! -f package.json ]; then
  exit 0
fi

if [ -d node_modules ] && [ -d node_modules/react ] && [ -d node_modules/xlsx ]; then
  echo "[session-start] node_modules already present — skipping npm install"
  exit 0
fi

if [ ! -f vendor/xlsx-0.20.3.tgz ]; then
  echo "[session-start] WARNING: vendor/xlsx-0.20.3.tgz is missing — npm install will fail." >&2
  echo "[session-start] Download it from https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz and commit to vendor/." >&2
fi

echo "[session-start] Installing npm dependencies…"
npm install --no-audit --no-fund --no-progress
echo "[session-start] Done."
