#!/usr/bin/env python3
"""
Turn analyzed sets into the bundled demos the hosted site shows.

  venv/bin/python tools/make_demos.py recording-9:worship-part-1 recording-10:worship-part-2

Reads web/data/sets/<slug>.json (written by analyzer/analyze.py), writes
web/demo/<demo>.json and web/demo/index.json. Locally cached cover art is
dropped in favor of the original art URL, and no audio is bundled unless you
pass --audio <demo>=<url> (e.g. a file on your own CDN).
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pairs", nargs="+", help="source-slug:demo-slug")
    ap.add_argument("--audio", action="append", default=[], help="demo-slug=URL of its audio")
    args = ap.parse_args()
    audio = dict(a.split("=", 1) for a in args.audio)
    os.makedirs(os.path.join(WEB, "demo"), exist_ok=True)
    index = []
    for pair in args.pairs:
        src, demo = pair.split(":")
        with open(os.path.join(WEB, "data", "sets", f"{src}.json")) as f:
            d = json.load(f)
        d["slug"], d["source"] = demo, "demo"
        for t in d["tracks"]:
            if t.get("meta"):
                t["meta"].pop("art_local", None)
        with open(os.path.join(WEB, "demo", f"{demo}.json"), "w") as f:
            json.dump(d, f, separators=(",", ":"))
        s = d["summary"]
        index.append({
            "slug": demo, "title": d["title"], "duration": d["duration"], "set_length": s["set_length"],
            "tracks": s["tracks"], "identified": s["identified"], "bpm_avg": s["bpm_avg"],
            "harmonic_pct": s["harmonic_pct"],
            "keys": [t["key"]["camelot"] if t["key"] else None for t in d["tracks"]],
            "segs": [[t["start"], t["end"], t["key"]["camelot"] if t["key"] else None] for t in d["tracks"]],
            "audio": audio.get(demo),
        })
        print(f"  {demo}: {s['tracks']} tracks, {os.path.getsize(os.path.join(WEB, 'demo', demo + '.json')) // 1024} KB")
    with open(os.path.join(WEB, "demo", "index.json"), "w") as f:
        json.dump(index, f, indent=1)


if __name__ == "__main__":
    main()
