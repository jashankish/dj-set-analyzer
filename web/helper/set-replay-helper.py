#!/usr/bin/env python3
"""
Set Replay helper.

Does two things the Set Replay website can't do from inside a browser:

  * names the tracks in your set: the website sends it short clips, one at a
    time, and it asks Shazam what each one is (only a fingerprint is sent)
  * fetches a set from a YouTube or SoundCloud link (with yt-dlp), so the
    website can analyze its audio as if you had dropped in the file

It listens only on this computer (http://127.0.0.1:8789). Your recordings,
and audio it fetches, stay on this computer. Fetch only what you have the
right to download; YouTube's and SoundCloud's terms apply.

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

VERSION = 2          # 2: fetches YouTube / SoundCloud links
HOME = os.path.join(os.path.expanduser("~"), ".set-replay-helper")
VENV = os.path.join(HOME, "venv")
FETCHED = os.path.join(HOME, "fetched")         # audio fetched from links, deleted once the page has it
# audioop left the standard library in Python 3.13; shazamio's pydub still imports it
# yt-dlp isn't pinned: YouTube changes often and old versions stop working (it's updated every few days)
REQUIREMENTS = ["shazamio==0.8.1", 'audioop-lts; python_version >= "3.13"', "yt-dlp"]
YTDLP_STAMP = os.path.join(HOME, "yt-dlp-updated")
YTDLP_EVERY = 3 * 24 * 3600


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


def ensure_ytdlp():
    """Helpers set up before links existed don't have yt-dlp yet; old copies stop working as
    YouTube changes, so it's updated in the background every few days."""
    import threading
    pip = [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--upgrade", "yt-dlp"]
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        print("Installing yt-dlp (for YouTube and SoundCloud links)…", flush=True)
        if subprocess.run(pip).returncode == 0:
            open(YTDLP_STAMP, "w").close()
        return
    try:
        stale = time.time() - os.path.getmtime(YTDLP_STAMP) > YTDLP_EVERY
    except OSError:
        stale = True
    if stale:
        def update():
            if subprocess.run(pip, capture_output=True).returncode == 0:
                open(YTDLP_STAMP, "w").close()
        threading.Thread(target=update, daemon=True).start()


# ---------------------------------------------------------------- links (YouTube, SoundCloud)
import re
import shutil
import threading
import uuid
from urllib.parse import urlparse

LINK_HOSTS = re.compile(r"^(?:(?:www|m|music)\.youtube\.com|youtu\.be|(?:www|m|on)\.soundcloud\.com|soundcloud\.com|youtube\.com)$", re.I)
MAX_HOURS = 6
# m4a/AAC first: every browser decodes it, even without ffmpeg's container fix-up
FORMAT = "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio[ext=webm]/bestaudio[acodec=mp3]/bestaudio"


def link_ok(url):
    """Only single videos and tracks on YouTube and SoundCloud: the helper isn't a general
    downloader, and a playlist would be listed in full before anything could refuse it."""
    from urllib.parse import parse_qs
    try:
        u = urlparse(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not LINK_HOSTS.match(host):
        return False
    parts = [p for p in u.path.split("/") if p]
    if "soundcloud" in host:
        return "sets" not in parts and len(parts) >= (1 if host.startswith("on.") else 2)
    if host == "youtu.be":
        return len(parts) == 1
    return bool(parse_qs(u.query).get("v")) or (len(parts) == 2 and parts[0] in ("live", "shorts", "embed"))


def friendly(msg):
    m = str(msg)
    if "Sign in to confirm" in m and "bot" in m:
        return "YouTube is asking this computer to prove it isn't a bot. Open the video in your browser once, then try again; or update the helper."
    if "Private video" in m or "private" in m.lower():
        return "This video or track is private."
    if "Sign in" in m or ("age" in m.lower() and "restrict" in m.lower()):
        return "This video needs a signed-in YouTube account (age-restricted or members-only), so the helper can't fetch it."
    if "unavailable" in m.lower() or "404" in m:
        return "That video or track isn't available (removed, blocked in your country, or the link is wrong)."
    if "geo" in m.lower():
        return "That isn't available in your country."
    return "Couldn't fetch it: " + m.replace("ERROR: ", "").split("\n")[0][:200]


class Fetcher:
    """One fetch at a time, each in its own folder; the page polls for progress, then takes the file."""

    def __init__(self):
        shutil.rmtree(FETCHED, ignore_errors=True)
        os.makedirs(FETCHED, exist_ok=True)
        self.jobs = {}
        self.lock = threading.Lock()

    def start(self, url):
        jid = uuid.uuid4().hex[:12]
        job = {"id": jid, "url": url, "state": "queued", "pct": 0.0, "title": None, "uploader": None,
               "duration": None, "service": "soundcloud" if "soundcloud" in url.lower() else "youtube",
               "error": None, "path": None, "ext": None, "cancel": False, "made": time.time()}
        self.jobs[jid] = job
        threading.Thread(target=self.run, args=(job,), daemon=True).start()
        return job

    def run(self, job):
        from yt_dlp import YoutubeDL
        folder = os.path.join(FETCHED, job["id"])
        os.makedirs(folder, exist_ok=True)

        def hook(d):
            if job["cancel"]:
                raise Exception("Stopped")
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                if total:
                    job["pct"] = min(0.99, (d.get("downloaded_bytes") or 0) / total)
                elif d.get("fragment_count"):
                    job["pct"] = min(0.99, (d.get("fragment_index") or 0) / d["fragment_count"])

        opts = {"format": FORMAT, "noplaylist": True, "quiet": True, "no_warnings": True, "noprogress": True,
                "fixup": "never", "outtmpl": os.path.join(folder, "audio.%(ext)s"), "progress_hooks": [hook],
                "concurrent_fragment_downloads": 4, "retries": 3, "socket_timeout": 30}
        with self.lock:   # one at a time
            try:
                job["state"] = "info"
                with YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(job["url"], download=False)
                    if info.get("_type") == "playlist" or info.get("entries"):
                        raise ValueError("That's a playlist. Paste the link of a single video or track.")
                    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
                        raise ValueError("That's a live stream. Fetch it once it has finished and been saved.")
                    if (info.get("duration") or 0) > MAX_HOURS * 3600:
                        raise ValueError(f"That's longer than {MAX_HOURS} hours, more than a browser can analyze.")
                    job.update(title=info.get("title"), uploader=info.get("uploader") or info.get("channel"),
                               duration=info.get("duration"), state="downloading")
                    print(f"  ↓ {job['title']} ({job['service']})", flush=True)
                    ydl.process_ie_result(info, download=True)
                files = [f for f in os.listdir(folder) if f.startswith("audio.") and not f.endswith(".part")]
                if not files:
                    raise ValueError("The download finished without any audio.")
                job.update(path=os.path.join(folder, files[0]), ext=files[0].rsplit(".", 1)[-1], pct=1.0, state="ready")
            except Exception as e:  # yt-dlp's DownloadError, our checks, a cancel
                job["state"] = "error"
                job["error"] = "Stopped." if job["cancel"] else str(e) if isinstance(e, ValueError) else friendly(e)
                shutil.rmtree(folder, ignore_errors=True)
        self.tidy()

    def tidy(self):
        """Forget jobs (and their files) after half an hour."""
        for jid, j in list(self.jobs.items()):
            if time.time() - j["made"] > 1800:
                shutil.rmtree(os.path.join(FETCHED, jid), ignore_errors=True)
                self.jobs.pop(jid, None)

    def status(self, jid):
        j = self.jobs.get(jid)
        return j and {k: j[k] for k in ("id", "state", "pct", "title", "uploader", "duration", "service", "error", "ext")}

    def done(self, jid):
        """The page has the file: delete it a minute from now."""
        def later():
            time.sleep(60)
            shutil.rmtree(os.path.join(FETCHED, jid), ignore_errors=True)
            self.jobs.pop(jid, None)
        threading.Thread(target=later, daemon=True).start()


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
    fetcher = Fetcher()
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
            path = self.path.split("?")[0]
            if path == "/health":
                return self.reply(200, {"ok": True, "name": "set-replay-helper", "version": VERSION, "fetch": True, **stats})
            m = re.match(r"^/fetch/([0-9a-f]{12})(/audio)?$", path)
            if m:
                st = fetcher.status(m.group(1))
                if not st:
                    return self.reply(404, {"error": "No such fetch (the helper may have restarted)."})
                if not m.group(2):
                    return self.reply(200, st)
                job = fetcher.jobs[m.group(1)]
                if job["state"] != "ready":
                    return self.reply(409, {"error": "Not ready yet."})
                size = os.path.getsize(job["path"])
                self.send_response(200)
                self.cors()
                self.send_header("Content-Type", {"m4a": "audio/mp4", "mp4": "audio/mp4", "webm": "audio/webm", "mp3": "audio/mpeg", "opus": "audio/ogg"}.get(job["ext"], "application/octet-stream"))
                self.send_header("Content-Length", str(size))
                self.end_headers()
                with open(job["path"], "rb") as f:
                    shutil.copyfileobj(f, self.wfile, 1 << 20)
                fetcher.done(m.group(1))
                return
            self.reply(404, {"error": "not found"})

        def do_POST(self):
            path = self.path.split("?")[0]
            if path == "/fetch":
                try:
                    body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 4096)) or b"{}")
                except ValueError:
                    body = {}
                url = str(body.get("url") or "").strip()
                if not link_ok(url):
                    return self.reply(400, {"error": "Paste the link of a single YouTube video or SoundCloud track (not a playlist, set or channel)."})
                return self.reply(200, fetcher.status(fetcher.start(url)["id"]))
            m = re.match(r"^/fetch/([0-9a-f]{12})/cancel$", path)
            if m:
                if m.group(1) in fetcher.jobs:
                    fetcher.jobs[m.group(1)]["cancel"] = True
                return self.reply(200, {"ok": True})
            if path != "/identify":
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
    print(f"\nSet Replay helper is running on http://127.0.0.1:{port} (track names, and YouTube / SoundCloud links)")
    print("Leave this window open and go back to the Set Replay page. Press Ctrl+C to stop.\n", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


def main():
    ap = argparse.ArgumentParser(description="Set Replay helper: Shazam track names, and YouTube / SoundCloud links")
    ap.add_argument("--port", type=int, default=8789)
    ap.add_argument("--origin", default="*", help="only accept requests from this site (default: any)")
    args = ap.parse_args()
    ensure_dependencies()
    ensure_ytdlp()
    try:
        serve(args.port, args.origin)
    except OSError as e:
        sys.exit(f"Couldn't listen on port {args.port} ({e}). Is the helper already running?")


if __name__ == "__main__":
    main()
