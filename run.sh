#!/usr/bin/env bash
# Launch the DJ Set Analyzer web app.
set -e
cd "$(dirname "$0")"
PORT="${1:-8778}"
PY="venv/bin/python"
[ -x "$PY" ] || PY="python3"
echo "Starting DJ Set Analyzer on http://localhost:${PORT}"
exec "$PY" web/serve.py --port "$PORT"
