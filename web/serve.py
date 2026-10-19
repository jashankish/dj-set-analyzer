#!/usr/bin/env python3
"""
Tiny static server for the DJ Set Analyzer web app.

Serves web/ and the set recordings from the project root at /audio/<file>,
with HTTP Range support so the browser can seek instantly within long sets.

Usage:  python3 serve.py [--port 8778]
"""
import argparse
import os
import re
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WEB_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(WEB_DIR)

AUDIO_EXTS = (".m4a", ".mp3", ".wav", ".aac", ".ogg", ".flac", ".aiff", ".aif")
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
CONTENT_TYPES = {
    ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac",
    ".ogg": "audio/ogg", ".flac": "audio/flac", ".aiff": "audio/aiff", ".aif": "audio/aiff",
}


def audio_path(name):
    """Only plain file names of audio files sitting in the project root."""
    name = os.path.basename(urllib.parse.unquote(name))
    path = os.path.join(ROOT_DIR, name)
    if name.lower().endswith(AUDIO_EXTS) and os.path.isfile(path):
        return path
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_GET(self):
        p = self.path.split("?")[0]
        if p.startswith("/audio/"):
            path = audio_path(p[len("/audio/"):])
            if not path:
                return self.send_error(404, "audio not found")
            return self.serve_audio(path)
        return super().do_GET()

    def serve_audio(self, path):
        ctype = CONTENT_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        size = os.path.getsize(path)
        start, end, status = 0, size - 1, 200
        m = RANGE_RE.match(self.headers.get("Range") or "")
        if m:
            g1, g2 = m.groups()
            if g1:
                start = int(g1)
                end = int(g2) if g2 else size - 1
            elif g2:  # suffix range: last N bytes
                start = max(0, size - int(g2))
            end = min(end, size - 1)
            status = 206
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                data = f.read(min(1024 * 256, remaining))
                if not data:
                    break
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(data)

    def log_message(self, fmt, *args):
        pass  # keep the console quiet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8778)
    args = ap.parse_args()
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    sets = [f for f in sorted(os.listdir(ROOT_DIR)) if f.lower().endswith(AUDIO_EXTS)]
    print(f"DJ Set Analyzer running at  http://localhost:{args.port}")
    print(f"  recordings: {', '.join(sets) or '(none in project root)'}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
