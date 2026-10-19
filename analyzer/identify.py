"""
Track identification via Shazam's public recognition endpoint (shazamio).

No account or API key. Short clips are fingerprinted locally (shazamio_core)
and only the fingerprint is sent. Every probe is cached to disk, so an
interrupted run resumes and re-runs are free. Pass --offline to skip entirely;
the set is then segmented purely from the audio.
"""
import asyncio
import json
import os
import subprocess
import tempfile
import time


def _clip(audio, start, dur, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{dur:.2f}",
                    "-i", audio, "-ac", "1", "-ar", "16000", out], check=True)


def _meta(track):
    """Keep the fields the app shows."""
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
        "id": str(track.get("key")),
        "title": track.get("title"),
        "artist": track.get("subtitle"),
        "genre": (track.get("genres") or {}).get("primary"),
        "album": meta.get("album"),
        "label": meta.get("label"),
        "released": meta.get("released"),
        "isrc": track.get("isrc"),
        "art": images.get("coverarthq") or images.get("coverart"),
        "shazam_url": track.get("url"),
        "apple_url": apple,
    }


def probe_set(audio, duration, cache_path, step=24.0, clip=12.0, log=print):
    """Fingerprint a clip every `step` seconds. Returns a list of probe dicts."""
    from shazamio import Shazam

    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            cache = {float(k): v for k, v in json.load(f).items()}

    times = [round(t, 2) for t in _frange(4.0, duration - clip, step)]
    todo = [t for t in times if t not in cache]
    if todo:
        log(f"    shazam  {len(todo)} probes to send ({len(times) - len(todo)} cached)")

    async def run():
        shazam = Shazam()
        with tempfile.TemporaryDirectory() as tmp:
            for i, t in enumerate(todo):
                wav = os.path.join(tmp, "clip.wav")
                _clip(audio, t, clip, wav)
                res = None
                for attempt in range(4):
                    try:
                        res = await shazam.recognize(wav)
                        break
                    except Exception as e:  # network / rate limit: back off
                        wait = 2 ** attempt * 3
                        log(f"    shazam  {t:.0f}s: {type(e).__name__}, retry in {wait}s")
                        await asyncio.sleep(wait)
                if res is None:
                    continue  # leave uncached; a re-run will retry it
                matches = res.get("matches") or []
                cache[t] = {
                    "t": t, "dur": clip,
                    "track": _meta(res.get("track")),
                    "offset": matches[0].get("offset") if matches else None,
                }
                if (i + 1) % 10 == 0 or i == len(todo) - 1:
                    _save(cache, cache_path)
                    hit = sum(1 for v in cache.values() if v["track"])
                    log(f"    shazam  {i + 1}/{len(todo)}  ({hit} matched so far)")
                await asyncio.sleep(0.6)
        _save(cache, cache_path)

    if todo:
        asyncio.run(run())
    return [cache[t] for t in times if t in cache]


def _frange(a, b, s):
    t = a
    while t <= b:
        yield t
        t += s


def _save(cache, path):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({str(k): v for k, v in sorted(cache.items())}, f)
    os.replace(tmp, path)


def fetch_art(url, dest):
    """Download cover art once so the app works offline afterwards."""
    if os.path.exists(dest) or not url:
        return os.path.exists(dest)
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "dj-set-analyzer"})
        with urllib.request.urlopen(req, timeout=20) as r, open(dest, "wb") as f:
            f.write(r.read())
        time.sleep(0.1)
        return True
    except Exception:
        return False
