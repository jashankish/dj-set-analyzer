#!/usr/bin/env python3
"""Checks the Set Replay helper's link rules (web/helper/set-replay-helper.py): only single
YouTube videos and SoundCloud tracks may be fetched. Needs no network and no yt-dlp.

    python3 tools/helper-test.py
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("helper", os.path.join(ROOT, "web/helper/set-replay-helper.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

OK = [
    "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    "https://youtube.com/watch?v=jNQXAC9IVRw&t=30",
    "https://m.youtube.com/watch?v=jNQXAC9IVRw",
    "https://music.youtube.com/watch?v=jNQXAC9IVRw",
    "https://youtu.be/jNQXAC9IVRw",
    "https://www.youtube.com/live/abcdefghijk",
    "https://soundcloud.com/ethmusic/lostin-powers-she-so-heavy",
    "https://on.soundcloud.com/AbC123",
]
REFUSED = [
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/@somechannel",
    "https://soundcloud.com/ethmusic",
    "https://soundcloud.com/ethmusic/sets/a-playlist",
    "https://vimeo.com/123",
    "https://www.youtube.com.evil.example/watch?v=abc",
    "https://evil.example/?u=https://youtube.com/watch?v=abc",
    "file:///etc/passwd",
    "ftp://youtube.com/watch?v=abc",
    "not a link",
]
fails = 0
for url in OK:
    if not helper.link_ok(url):
        fails += 1
        print(f"FAIL  should accept {url}")
for url in REFUSED:
    if helper.link_ok(url):
        fails += 1
        print(f"FAIL  should refuse {url}")
msgs = {
    "ERROR: [youtube] x: Sign in to confirm you're not a bot": "prove it isn't a bot",
    "ERROR: [youtube] x: Private video. Sign in if you've been granted access": "private",
    "ERROR: [youtube] x: Video unavailable": "isn't available",
}
for raw, want in msgs.items():
    got = helper.friendly(raw)
    if want not in got:
        fails += 1
        print(f"FAIL  friendly({raw!r}) = {got!r}")
total = len(OK) + len(REFUSED) + len(msgs)
print(f"{total - fails}/{total} helper checks passed")
sys.exit(1 if fails else 0)
