#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js LTS from https://nodejs.org/en/download, reopen Terminal, and try again.'
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo 'This scanner needs Node.js 22 or newer. Install the current Node.js LTS and try again.'
  exit 1
fi
echo 'Keep this window and Ollama open while scanning. Press Control-C here to stop the helper.'
if command -v open >/dev/null 2>&1; then
  (sleep 2; open 'http://localhost:8080/scanner-setup.html#check') &
fi
exec node local-tools/scan-recipe/serve-locally.mjs
