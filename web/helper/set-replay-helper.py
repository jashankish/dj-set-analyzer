#!/usr/bin/env python3
"""
Set Replay naming helper.

Lets the Set Replay website put real names on the tracks in your set. The
website can't ask Shazam itself (browsers block it), so this small program
does it from your computer:

  * it listens only on this computer (http://127.0.0.1:8789)
  * the website sends it short clips of the set, one at a time
  * it turns each clip into a Shazam fingerprint and asks Shazam what it is

Your recording never leaves your computer; only the fingerprints go to Shazam.

Run it with:   python3 set-replay-helper.py        (Windows: py set-replay-helper.py)
The first run installs what it needs into ~/.set-replay-helper (about a minute).
Stop it with Ctrl+C.

Options:  --port 8789   --origin https://your-site.example (only allow that site)
"""
import argparse
import json
import os
import subprocess
import sys
import time

VERSION = 1
HOME = os.path.join(os.path.expanduser("~"), ".set-replay-helper")
VENV = os.path.join(HOME, "venv")
# audioop left the standard library in Python 3.13; shazamio's pydub still imports it
REQUIREMENTS = ["shazamio==0.8.1", 'audioop-lts; python_version >= "3.13"']


# ---------------------------------------------------------------- first-run setup
# shazamio's compiled core crashes on Python 3.14, so the helper's private
# environment is built with a Python it is known to work on.
GOOD = [(3, 12), (3, 13), (3, 11), (3, 10), (3, 9)]


def venv_python():
    return os.path.join(VENV, "Scripts", "python.exe") if os.name == "nt" else os.path.join(VENV, "bin", "python")


def works(python):
    """Does shazamio import cleanly with this interpreter? (checked in a separate process)"""
    try:
        return subprocess.run([python, "-c", "import shazamio"], capture_output=True, timeout=120).returncode == 0
    except Exception:
        return False


def pick_base_python():
    import shutil
    if sys.version_info[:2] in GOOD:
        return sys.executable
    for major, minor in GOOD:
        exe = shutil.which(f"python{major}.{minor}")
        if exe:
            return exe
    if os.name == "nt" and shutil.which("py"):
        for major, minor in GOOD:
            r = subprocess.run(["py", f"-{major}.{minor}", "-c", "import sys; print(sys.executable)"], capture_output=True, text=True)
            if r.returncode == 0:
                return r.stdout.strip()
    return None


def ensure_dependencies():
    """Re-run this script inside a private environment where shazamio works."""
    if os.path.abspath(sys.prefix) == os.path.abspath(VENV):
        return  # already inside the helper's environment (checked before re-launching)
    if os.path.exists(venv_python()) and works(venv_python()):
        os.execv(venv_python(), [venv_python(), os.path.abspath(__file__), *sys.argv[1:]])
    base = pick_base_python()
    if not base:
        sys.exit("The helper needs Python 3.9 to 3.13 (the Shazam client doesn't run on newer Python yet).\n"
                 "Install Python 3.12 from https://www.python.org/downloads/ and run this again.")
    print(f"First run: setting up the helper in {HOME} (about a minute)…", flush=True)
    import shutil
    shutil.rmtree(VENV, ignore_errors=True)
    subprocess.run([base, "-m", "venv", VENV], check=True)
    print("Installing the Shazam client…", flush=True)
    subprocess.run([venv_python(), "-m", "pip", "install", "--quiet", "--disable-pip-version-check", *REQUIREMENTS], check=True)
    if not works(venv_python()):
        sys.exit(f"The Shazam client didn't start with {base}. Install Python 3.12 from https://www.python.org/downloads/, "
                 f"delete {HOME} and run this again.")
    os.execv(venv_python(), [venv_python(), os.path.abspath(__file__), *sys.argv[1:]])


# ---------------------------------------------------------------- Shazam
def track_meta(track):
    """The fields the Set Replay viewer shows (same as analyzer/identify.py)."""
    if not track:
        return None
    meta = {}
    for sec in track.get("sections", []):
        for m in sec.get("metadata", []) or []:
            meta[m.get("title", "").lower()] = m.get("text")
    images = track.get("images", {}) or {}
    apple = None
    for opt in (track.get("hub", {}) or {}).get("options", []) or []:
        for act in opt.get("actions", []) or []:
            if act.get("uri", "").startswith("https://music.apple.com"):
                apple = act["uri"]
    return {
        "id": str(track.get("key")), "title": track.get("title"), "artist": track.get("subtitle"),
        "genre": (track.get("genres") or {}).get("primary"), "album": meta.get("album"),
        "label": meta.get("label"), "released": meta.get("released"), "isrc": track.get("isrc"),
        "art": images.get("coverarthq") or images.get("coverart"),
        "shazam_url": track.get("url"), "apple_url": apple,
    }


class Identifier:
    """One Shazam request at a time, gently paced, with a timeout."""

    def __init__(self):
        import asyncio
        import threading
        from shazamio import Shazam
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, daemon=True).start()
        self.shazam = Shazam()
        self.lock = threading.Lock()
        self.last = 0.0
        self.asyncio = asyncio

    def identify(self, audio_bytes):
        with self.lock:
            wait = 0.6 - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            try:
                fut = self.asyncio.run_coroutine_threadsafe(
                    self.asyncio.wait_for(self.shazam.recognize(audio_bytes), timeout=25), self.loop)
                res = fut.result(timeout=30)
            finally:
                self.last = time.time()
        matches = res.get("matches") or []
        return {"track": track_meta(res.get("track")), "offset": matches[0].get("offset") if matches else None}


# ---------------------------------------------------------------- server
def serve(port, origin):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    ident = Identifier()
    stats = {"asked": 0, "named": 0}

    class Handler(BaseHTTPRequestHandler):
        def cors(self):
            req = self.headers.get("Origin")
            allow = req if origin in ("*", req) and req else (origin if origin != "*" else "*")
            self.send_header("Access-Control-Allow-Origin", allow)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Chrome's Private Network Access: a public https page talking to this computer
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

        def reply(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.end_headers()

        def do_GET(self):
            if self.path.split("?")[0] == "/health":
                return self.reply(200, {"ok": True, "name": "set-replay-helper", "version": VERSION, **stats})
            self.reply(404, {"error": "not found"})

        def do_POST(self):
            if self.path.split("?")[0] != "/identify":
                return self.reply(404, {"error": "not found"})
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 < n <= 8 * 1024 * 1024:
                return self.reply(413, {"error": "Send a short audio clip (up to 8 MB)."})
            data = self.rfile.read(n)
            try:
                out = ident.identify(data)
            except Exception as e:  # timeouts, rate limits, network
                return self.reply(502, {"error": f"Shazam didn't answer ({type(e).__name__}). It may be rate-limiting; try again later."})
            stats["asked"] += 1
            stats["named"] += 1 if out["track"] else 0
            if out["track"]:
                print(f"  ♪ {out['track']['artist']} – {out['track']['title']}", flush=True)
            self.reply(200, out)

        def log_message(self, fmt, *args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"\nSet Replay naming helper is running on http://127.0.0.1:{port}")
    print("Leave this window open and go back to the Set Replay page. Press Ctrl+C to stop.\n", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


def main():
    ap = argparse.ArgumentParser(description="Set Replay naming helper")
    ap.add_argument("--port", type=int, default=8789)
    ap.add_argument("--origin", default="*", help="only accept requests from this site (default: any)")
    args = ap.parse_args()
    ensure_dependencies()
    try:
        serve(args.port, args.origin)
    except OSError as e:
        sys.exit(f"Couldn't listen on port {args.port} ({e}). Is the helper already running?")


if __name__ == "__main__":
    main()
