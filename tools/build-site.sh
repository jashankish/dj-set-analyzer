#!/usr/bin/env bash
# Package the website for hosting: copies web/ to dist/set-replay/ without the
# local-only bits (web/data/ = Python output for the dev server, serve.py).
# Upload dist/set-replay/ to any static host, at the root or in a sub-folder.
#
#   bash tools/build-site.sh            → dist/set-replay/
#   bash tools/build-site.sh --zip      → also dist/set-replay.zip
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=dist/set-replay
rm -rf "$OUT"
mkdir -p "$OUT"
# copy everything except dev-only files
tar -C web --exclude='./data' --exclude='./serve.py' --exclude='.DS_Store' --exclude='__pycache__' -cf - . | tar -C "$OUT" -xf -
for f in index.html set.html js/engine/pipeline.js models/discogs-effnet-bsdynamic-1.onnx helper/set-replay-helper.py; do
  [ -f "$OUT/$f" ] || { echo "missing $f in the build" >&2; exit 1; }
done
echo "Built $OUT ($(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l | tr -d ' ') files)"
if [ "${1:-}" = "--zip" ]; then
  (cd dist && rm -f set-replay.zip && zip -qr set-replay.zip set-replay)
  echo "Zipped dist/set-replay.zip ($(du -sh dist/set-replay.zip | cut -f1))"
fi
