#!/usr/bin/env python3
"""
Self-test for the Python pipeline on the same synthetic set as the browser
engine's test (tools/synth.mjs): 128 BPM over A minor, then 140 BPM over D
minor, changing at 90 s. Keeps the two engines honest about agreeing.

  venv/bin/python tools/selftest_py.py      (needs node and ffmpeg on PATH)

Runs the pipeline's own stages (features -> setlist -> payload, no Shazam)
on a temporary copy and exits non-zero if a check fails.
"""
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analyzer"))
import analyze  # noqa: E402
import features as FX  # noqa: E402


def main():
    t0 = time.time()
    FX.ensure_models(log=lambda *a: None)
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "selftest.wav")
        subprocess.run(["node", os.path.join(ROOT, "tools", "synth.mjs"), wav, "44100"], check=True)
        Z = analyze.extract(wav, tmp, force=True)
        P = analyze.build_payload(wav, "selftest", "Self-test", Z, [], FX.style_classes(), None, 24.0)

    b = P["curves"]["bpm"]

    def bpm_at(t):
        i = min(range(len(b["t"])), key=lambda k: abs(b["t"][k] - t))
        return b["v"][i]

    def key_in(a, z):
        counts = {}
        for t, k in zip(P["curves"]["keys"]["t"], P["curves"]["keys"]["v"]):
            if a <= t <= z:
                counts[k] = counts.get(k, 0) + 1
        return max(counts, key=counts.get) if counts else None

    starts = [round(t["start"]) for t in P["tracks"][1:]]
    checks = [
        ("tempo at 45 s is 128 BPM", bpm_at(45), lambda v: v and abs(v - 128) <= 3),
        ("tempo at 135 s is 140 BPM", bpm_at(135), lambda v: v and abs(v - 140) <= 3),
        ("key in the first half is A minor (8A)", key_in(10, 80), lambda v: v == "8A"),
        ("key in the second half is D minor (7A)", key_in(100, 170), lambda v: v == "7A"),
        ("a track change within 20 s of 90 s", starts, lambda v: any(abs(s - 90) <= 20 for s in v)),
        ("setlist, transitions and curves are present",
         [len(P["tracks"]), len(P["transitions"]), len(P["curves"]["wave"]["low"])],
         lambda v: v[0] >= 2 and v[1] >= 1 and v[2] > 1000),
    ]
    failed = 0
    for name, value, ok in checks:
        good = bool(ok(value))
        failed += 0 if good else 1
        print(f"{'ok  ' if good else 'FAIL'}  {name}  (got {value})")
    print(f"{len(checks) - failed}/{len(checks)} checks passed in {time.time() - t0:.0f} s")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
