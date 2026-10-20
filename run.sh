#!/usr/bin/env bash
# Serve the Set Replay website locally (also shows sets from the Python pipeline).
set -e
cd "$(dirname "$0")"
PORT="${1:-8778}"
PY="venv/bin/python"
[ -x "$PY" ] || PY="python3"
echo "Starting Set Replay on http://localhost:${PORT}"
exec "$PY" web/serve.py --port "$PORT"
