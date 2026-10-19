#!/usr/bin/env python3
"""
Score audio-only track segmentation against Shazam-anchored setlists.

  venv/bin/python tools/tune_segmentation.py recording-9 recording-10

For each set it needs output/<slug>/features.npz and web/data/sets/<slug>.json
(analysed with Shazam). The Shazam-anchored track starts act as ground truth.
It sweeps the audio-only rule (novelty prominence and shortest track) and a
few novelty variants, then prints F1 (a boundary counts if it falls within
20 s of a true one).

Findings on the two bundled sets (Oct 2026), about 30 true boundaries:
  embeddings, kernel half-width 12 (current)   F1 0.61 at prominence 0.4-0.5, min 75 s
  narrower or wider kernels (8/16/20/28)        worse (0.44-0.58)
  log style activations instead of embeddings   worse (0.55)
  embeddings + key-change novelty               0.56-0.64, not monotonic in the weight,
                                                so noise rather than a real gain
Re-run this when more labelled sets exist before changing the defaults in
analyzer/setlist.py and web/js/engine/setlist.js.
"""
import json
import os
import sys

import numpy as np
from scipy.ndimage import uniform_filter1d

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "analyzer"))
import music  # noqa: E402
import setlist as SL  # noqa: E402

CAMELOT = [f"{n}{m}" for n in range(1, 13) for m in "AB"]


def load(slug):
    Z = dict(np.load(os.path.join(ROOT, "output", slug, "features.npz"), allow_pickle=True))
    with open(os.path.join(ROOT, "web", "data", "sets", f"{slug}.json")) as f:
        d = json.load(f)
    span = (d["summary"]["set_start"], d["summary"]["set_end"])
    return Z, span, [t["start"] for t in d["tracks"][1:]]


def foote(X, t, duration, half):
    old, SL.NOV_HALF = SL.NOV_HALF, half
    try:
        return SL.novelty(t, X, duration)
    finally:
        SL.NOV_HALF = old


def key_novelty(Z, half):
    t = np.array([k[0] for k in Z["keys"]], float)
    X = np.zeros((len(t), 24), np.float32)
    for i, k in enumerate(Z["keys"]):
        X[i, CAMELOT.index(music.camelot(k[1], k[2]))] = k[3]
    return foote(uniform_filter1d(X, 3, axis=0), t, float(Z["duration"]), half)


def bounds(nov, span, prom, min_len):
    chosen = []
    for t, p in SL._peaks_in(nov, span[0] + min_len, span[1] - min_len, min_dist=min_len, prominence=0.05):
        if p >= prom and all(abs(t - c) >= min_len for c in chosen):
            chosen.append(t)
    return sorted(chosen)


def f1(found, truth, tol=20):
    prec = sum(any(abs(t - x) <= tol for t in truth) for x in found) / max(1, len(found))
    rec = sum(any(abs(t - x) <= tol for x in found) for t in truth) / max(1, len(truth))
    return 2 * prec * rec / max(1e-9, prec + rec)


def main():
    slugs = sys.argv[1:] or ["recording-9", "recording-10"]
    sets = [load(s) for s in slugs]

    def score(name, make):
        novs = [make(Z) for Z, _, _ in sets]
        grid = [(np.mean([f1(bounds(n, sp, p, m), tr) for n, (_, sp, tr) in zip(novs, sets)]), p, m)
                for p in (0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6) for m in (60, 75, 90)]
        best = max(grid, key=lambda g: g[0])
        cur = np.mean([f1(bounds(n, sp, SL.AUDIO_ONLY_PROM, SL.AUDIO_ONLY_MIN), tr) for n, (_, sp, tr) in zip(novs, sets)])
        print(f"{name:36s} best F1 {best[0]:.3f} (prominence {best[1]}, min {best[2]} s)   current rule: {cur:.3f}")

    emb = lambda Z: Z["emb"].astype(np.float32)  # noqa: E731
    dur = lambda Z: float(Z["duration"])  # noqa: E731
    for half in (12, 8, 16, 20):
        score(f"embeddings, half-width {half}", lambda Z, h=half: foote(emb(Z), Z["emb_t"], dur(Z), h))
    score("log style activations", lambda Z: foote(np.log(Z["acts"] + 1e-4).astype(np.float32), Z["emb_t"], dur(Z), 12))
    for w in (0.25, 0.5, 1.0):
        def fused(Z, w=w):
            a, b = foote(emb(Z), Z["emb_t"], dur(Z), 12), key_novelty(Z, 12)
            n = min(len(a), len(b))
            out = (a[:n] + w * b[:n]) / (1 + w)
            return out / (np.percentile(out, 99.5) + 1e-9)
        score(f"embeddings + key change (w={w})", fused)


if __name__ == "__main__":
    main()
