#!/usr/bin/env bash
# Package the website for hosting: copies web/ to dist/set-replay/ without the
# local-only bits (web/data/ = Python output for the dev server, serve.py).
# Upload dist/set-replay/ to any static host, at the root or in a sub-folder.
#
#   bash tools/build-site.sh                  → dist/set-replay/
#   bash tools/build-site.sh --zip            → also dist/set-replay.zip
#   bash tools/build-site.sh --head FILE      → insert FILE's HTML before </head> on
#                                               every page but prompt.html (e.g. your site's analytics tag);
#                                               SET_REPLAY_HEAD=FILE does the same
set -euo pipefail
HEAD_FILE="${SET_REPLAY_HEAD:-}"; ZIP=false
while [ $# -gt 0 ]; do
  case "$1" in
    --zip) ZIP=true ;;
    --head) HEAD_FILE="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -z "$HEAD_FILE" ] || HEAD_FILE="$(cd "$(dirname "$HEAD_FILE")" && pwd)/$(basename "$HEAD_FILE")"
[ -z "$HEAD_FILE" ] || [ -f "$HEAD_FILE" ] || { echo "--head: no such file $HEAD_FILE" >&2; exit 2; }
cd "$(dirname "$0")/.."
OUT=dist/set-replay
rm -rf "$OUT"
mkdir -p "$OUT"
# copy everything except dev-only files
tar -C web --exclude='./data' --exclude='./serve.py' --exclude='.DS_Store' --exclude='__pycache__' -cf - . | tar -C "$OUT" -xf -
for f in index.html set.html js/engine/pipeline.js models/discogs-effnet-bsdynamic-1.onnx helper/set-replay-helper.py og-image.png apple-touch-icon.png; do
  [ -f "$OUT/$f" ] || { echo "missing $f in the build" >&2; exit 1; }
done
if [ -n "$HEAD_FILE" ]; then
  for page in "$OUT"/*.html; do
    # prompt.html carries a prompt in its URL fragment; a head snippet (analytics) could record
    # the URL, and the page promises the prompt goes nowhere, so it gets none
    [ "$(basename "$page")" = prompt.html ] && continue
    python3 - "$page" "$HEAD_FILE" <<'PY'
import sys
page, snippet = sys.argv[1], open(sys.argv[2]).read().rstrip("\n") + "\n"
html = open(page).read()
assert "</head>" in html, page
open(page, "w").write(html.replace("</head>", snippet + "</head>", 1))
PY
  done
  echo "Added $(basename "$HEAD_FILE") to the <head> of every page"
fi
echo "Built $OUT ($(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l | tr -d ' ') files)"
if $ZIP; then
  (cd dist && rm -f set-replay.zip && zip -qr set-replay.zip set-replay)
  echo "Zipped dist/set-replay.zip ($(du -sh dist/set-replay.zip | cut -f1))"
fi
