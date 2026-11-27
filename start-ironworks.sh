#!/usr/bin/env bash
# Starts Ironworks on Linux (and macOS) and opens it in your browser.
# Run it with:  bash start-ironworks.sh     Press Ctrl+C to stop.
# On the first run it calls setup.sh to install everything.
set -euo pipefail
cd "$(dirname "$0")"

venv() { if [ -d .venv ] && [ ! -x .venv/bin/python ]; then echo ".venv-linux"; else echo ".venv"; fi; }
VENV="$(venv)"
if [ ! -x "$VENV/bin/python" ] || [ ! -f web/dist/index.html ]; then
  echo "First run: installing what the app needs ..."
  bash setup.sh
  VENV="$(venv)"
fi

URL="http://127.0.0.1:${WB_PORT:-8080}"
open_browser() {
  sleep 2
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$URL" || true
  else echo "Open $URL in your browser."; fi
}
open_browser &
exec "$VENV/bin/python" -m server
