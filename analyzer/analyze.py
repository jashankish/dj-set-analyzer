#!/usr/bin/env python3
"""
Analyze a DJ set recording and write the data the web app reads.

  venv/bin/python analyzer/analyze.py "Recording 9.m4a"
  venv/bin/python analyzer/analyze.py --all              # every audio file in the project root
  venv/bin/python analyzer/analyze.py set.m4a --offline  # no Shazam lookups
  venv/bin/python analyzer/analyze.py set.m4a --bpm-range 160-190

Stages are checkpointed in output/<slug>/:
  features.npz   bands, beats, tempo, keys, EffNet activations/embeddings
  shazam.json    one cached probe every --step seconds
Re-running reuses them; --force recomputes features, --reprobe re-asks Shazam.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import features as FX  # noqa: E402
import identify  # noqa: E402
import music  # noqa: E402
import setlist  # noqa: E402

AUDIO_EXTS = (".m4a", ".mp3", ".wav", ".aac", ".ogg", ".flac", ".aiff", ".aif")
WEB_DATA = os.path.join(ROOT, "web", "data")


def log(msg):
    print(msg, flush=True)


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", os.path.splitext(os.path.basename(name))[0].lower()).strip("-")
    return s or "set"


# ---------------------------------------------------------------- stage 1: features
def extract(audio, out_dir, force=False):
    path = os.path.join(out_dir, "features.npz")
    if os.path.exists(path) and not force:
        log("  features   (cached)")
        z = np.load(path, allow_pickle=True)
        return {k: z[k] for k in z.files}
    T = time.time()
    log("  decoding")
    y44 = FX.decode(audio, 44100)
    y16 = FX.decode(audio, 16000)
    duration = len(y44) / 44100
    log(f"  3-band energy   ({duration / 60:.1f} min)")
    bands = FX.band_energy(y44, 44100, fps=setlist.FPS)
    log("  beats")
    beats = FX.rhythm(y44, log=log)
    log("  tempo windows")
    bpm_t, bpm_raw = FX.bpm_windows(y44)
    log("  keys")
    keys = FX.keys(y44)
    del y44
    log("  Discogs-EffNet styles + moods")
    emb_t, acts, emb, heads = FX.effnet(y16, log=log)
    data = {
        "duration": np.float64(duration),
        "beats": beats, "bpm_t": bpm_t, "bpm_raw": bpm_raw,
        "keys": np.array(keys, dtype=object),
        "emb_t": emb_t, "acts": acts, "emb": emb.astype(np.float16),
        **{"band_" + k: v for k, v in bands.items()},
        **{"head_" + k: v for k, v in heads.items()},
    }
    np.savez_compressed(path, **data)
    log(f"  features done in {time.time() - T:.0f}s")
    return data


# ---------------------------------------------------------------- tempo
def resolve_tempo(Z, classes, bpm_range=None):
    bpm_t, raw = Z["bpm_t"], Z["bpm_raw"].astype(np.float64)
    if bpm_range:
        lo, hi = bpm_range
        b = raw.copy()
        for _ in range(3):
            b = np.where(b < lo, b * 2, b)
            b = np.where(b >= hi, b / 2, b)
        return b, "range"
    # mean style activations around each tempo window
    acts = np.stack([Z["acts"][setlist._slice(Z["emb_t"], t - 10, t + 10)].mean(0)
                     if setlist._slice(Z["emb_t"], t - 10, t + 10).any() else Z["acts"].mean(0)
                     for t in bpm_t])
    b, _mult = music.resolve_octaves(raw, acts, classes)
    return b, "style-viterbi"


def resolve_beats(beats, bpm_t, bpm):
    """Make the beat grid agree with the resolved tempo (fill half-time grids)."""
    out = []
    for i in range(len(beats) - 1):
        a, b = beats[i], beats[i + 1]
        out.append(a)
        tb = np.interp((a + b) / 2, bpm_t, np.nan_to_num(bpm, nan=120))
        ratio = tb * (b - a) / 60
        if 1.7 < ratio < 2.3:
            out.append((a + b) / 2)
    if len(beats):
        out.append(beats[-1])
    return np.array(out)


# ---------------------------------------------------------------- export helpers
def _q(x, n=2):
    return [None if not np.isfinite(v) else round(float(v), n) for v in x]


def _wave(bands, span):
    """Bands in dB -> 0..99 ints, per-band normalized over the set, a little contrast."""
    out = {}
    a, b = int(span[0] * setlist.FPS), int(span[1] * setlist.FPS)
    for k in ("low", "mid", "high"):
        x = bands[k]
        lo, hi = np.percentile(x[a:b], 5), np.percentile(x[a:b], 99.7)
        v = np.clip((x - lo) / (hi - lo + 1e-9), 0, 1) ** 1.4
        out[k] = (v * 99).round().astype(int).tolist()
    return out


def _resample(t, v, step, duration):
    grid = np.arange(0, duration, step)
    return grid, np.interp(grid, t, v)


def build_payload(audio, slug, title, Z, probes, classes, bpm_range, probe_step):
    D = float(Z["duration"])
    bpm, tempo_method = resolve_tempo(Z, classes, bpm_range)
    span = setlist.music_span(Z["band_rms"], D)
    inside = setlist._slice(Z["bpm_t"], *span)
    if inside.any():  # smooth tempo misreadings within the set; its edges count as edges
        bpm = np.array(bpm, float)
        bpm[inside] = music.fill_tempo_blips(bpm[inside])
    # light smoothing so one bad window doesn't flicker
    bpm_s = setlist.median_filter(np.nan_to_num(bpm, nan=np.nanmedian(bpm)), size=5, mode="nearest")
    bands = {k[5:]: Z[k] for k in Z if k.startswith("band_")}
    heads = {k[5:]: Z[k] for k in Z if k.startswith("head_")}
    keys = [tuple(k) for k in Z["keys"]]
    if span != (0.0, D):
        log(f"  music runs {span[0] / 60:.1f}–{span[1] / 60:.1f} min of {D / 60:.1f}; the rest is treated as outside the set")
    F = {
        "duration": D, "span": span, "probes": probes, "probe_step": probe_step,
        "emb_t": Z["emb_t"], "emb": Z["emb"].astype(np.float32), "acts": Z["acts"],
        "heads": heads, "bands": bands, "bpm_t": Z["bpm_t"], "bpm": bpm_s, "keys": keys,
    }
    tracks, transitions, drops, nov, energy, (e_lo, e_hi) = setlist.build(F, classes, log=log)

    # art: cache locally so the app works offline
    art_dir = os.path.join(WEB_DATA, "art")
    os.makedirs(art_dir, exist_ok=True)
    for t in tracks:
        m = t.get("meta")
        if m and m.get("art"):
            fn = f"{m['id']}.jpg"
            if identify.fetch_art(m["art"], os.path.join(art_dir, fn)):
                m["art_local"] = f"data/art/{fn}"

    beats = resolve_beats(Z["beats"], Z["bpm_t"], bpm_s)

    # style stream: per 30 s window, tempo-aware style mix for the set's top styles
    step = 30.0
    grid = np.arange(0, D, step)
    rows = []
    for g in grid:
        m = setlist._slice(Z["emb_t"], g, g + step)
        acts = Z["acts"][m].mean(0) if m.any() else Z["acts"].mean(0)
        b = float(np.interp(g + step / 2, Z["bpm_t"], bpm_s))
        w = np.array([music.tempo_likelihood(c, b) for c in classes])
        p = acts * w
        rows.append(p / (p.sum() + 1e-9))
    rows = np.array(rows)
    total = rows.mean(0)
    top = list(np.argsort(-total)[:6])
    style_names = [classes[i].split("---")[-1] for i in top]
    style_v = [[round(float(r[i]), 4) for i in top] + [round(float(1 - r[top].sum()), 4)] for r in rows]

    # moods every 10 s
    mood_grid = np.arange(0, D, 10.0)
    moods = {k: _q(np.interp(mood_grid, Z["emb_t"], setlist._smooth(v, 8)), 3) for k, v in heads.items()}

    # key timeline (Camelot) every 10 s
    key_t = [k[0] for k in keys]
    key_codes = [music.camelot(k[1], k[2]) for k in keys]
    key_str = [round(float(k[3]), 2) for k in keys]

    # ------------------------------------------------ summary
    durs = np.array([t["end"] - t["start"] for t in tracks])
    tb = np.array([t["bpm"] or np.nan for t in tracks], float)
    ok = np.isfinite(tb)
    harmonic_known = [x for x in transitions if x["harmonic"]["compatible"] is not None]
    harmonic_ok = [x for x in harmonic_known if x["harmonic"]["compatible"] is True]
    types = {}
    for x in transitions:
        types[x["type"]] = types.get(x["type"], 0) + 1
    style_mass = {}
    for t in tracks:
        for s in t["styles"]:
            style_mass[s["style"]] = style_mass.get(s["style"], 0) + s["p"] * (t["end"] - t["start"])
    tot = sum(style_mass.values()) or 1
    e60 = setlist._smooth(energy, 60)
    voice = heads["voice_instrumental"]
    long_blend = max(transitions, key=lambda x: x["duration"]) if transitions else None
    summary = {
        "tracks": len(tracks),
        "identified": sum(1 for t in tracks if t["identified"]),
        "avg_track_s": round(float(durs.mean()), 1) if len(durs) else None,
        "bpm_avg": round(float(np.sum(tb[ok] * durs[ok]) / durs[ok].sum()), 1) if ok.any() else None,
        "bpm_min": round(float(tb[ok].min()), 1) if ok.any() else None,
        "bpm_max": round(float(tb[ok].max()), 1) if ok.any() else None,
        "tempo_method": tempo_method,
        "transitions": len(transitions),
        "avg_transition_s": round(float(np.mean([x["duration"] for x in transitions])), 1) if transitions else None,
        "avg_transition_bars": round(float(np.mean([x["bars"] for x in transitions if x["bars"]])), 1)
        if any(x["bars"] for x in transitions) else None,
        "transition_types": types,
        "harmonic_pct": round(100 * len(harmonic_ok) / len(harmonic_known)) if harmonic_known else None,
        "longest_blend": {"from": long_blend["from"], "to": long_blend["to"], "duration": long_blend["duration"]}
        if long_blend else None,
        "drops": len(drops),
        "peak_t": int(span[0] + np.argmax(e60[int(span[0]):int(span[1])])),
        "set_start": round(span[0], 1), "set_end": round(span[1], 1),
        "set_length": round(span[1] - span[0], 1),
        "vocal_pct": round(100 * float((voice[setlist._slice(Z["emb_t"], *span)] > 0.5).mean())),
        "styles": sorted(({"style": k, "share": round(v / tot, 3)} for k, v in style_mass.items()),
                         key=lambda s: -s["share"])[:8],
    }

    return {
        "version": 1,
        "slug": slug, "title": title, "file": os.path.basename(audio),
        "duration": round(D, 2),
        "analyzed_at": dt.datetime.now().isoformat(timespec="seconds"),
        "summary": summary,
        "tracks": tracks,
        "transitions": transitions,
        "drops": drops,
        "beats": _q(beats, 3),
        "curves": {
            "wave_fps": setlist.FPS, "wave": _wave(bands, span),
            "energy": {"step": 1, "v": _q(np.clip((energy - e_lo) / (e_hi - e_lo + 1e-9), 0, 1.1), 3)},
            "bpm": {"t": _q(Z["bpm_t"], 1), "v": _q(bpm_s, 1), "raw": _q(Z["bpm_raw"], 1)},
            "novelty": {"step": setlist.NOV_BIN, "v": _q(nov, 3)},
            "moods": {"step": 10, "v": moods},
            "styles": {"step": step, "names": style_names + ["Other"], "v": style_v},
            "keys": {"t": _q(key_t, 1), "v": key_codes, "strength": key_str},
        },
        "probes": [{"t": p["t"], "dur": p["dur"], "id": p["track"]["id"] if p["track"] else None}
                   for p in probes],
        "credits": {
            "beats_key_tempo": "Essentia (RhythmExtractor2013, PercivalBpmEstimator, KeyExtractor/edma)",
            "styles_moods": "Discogs-EffNet + classification heads (MTG, UPF), via ONNX Runtime",
            "identification": "Shazam via shazamio" if any(p["track"] for p in probes) else "none (offline)",
        },
    }


def write_manifest():
    sets_dir = os.path.join(WEB_DATA, "sets")
    items = []
    for fn in sorted(os.listdir(sets_dir)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(sets_dir, fn)) as f:
            d = json.load(f)
        items.append({"slug": d["slug"], "title": d["title"], "file": d["file"],
                      "duration": d["duration"], "tracks": d["summary"]["tracks"],
                      "identified": d["summary"]["identified"], "bpm_avg": d["summary"]["bpm_avg"],
                      "keys": [t["key"]["camelot"] if t["key"] else None for t in d["tracks"]],
                      "analyzed_at": d["analyzed_at"]})
    # natural sort so "Recording 9" comes before "Recording 10"
    items.sort(key=lambda x: [int(s) if s.isdigit() else s for s in re.split(r"(\d+)", x["file"].lower())])
    with open(os.path.join(WEB_DATA, "sets.json"), "w") as f:
        json.dump(items, f, indent=1)


def analyze(audio, args):
    slug = slugify(audio)
    out_dir = os.path.join(ROOT, "output", slug)
    os.makedirs(out_dir, exist_ok=True)
    # a --title is remembered, so later runs (e.g. --all) keep it
    meta_path = os.path.join(out_dir, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
    if args.title:
        meta["title"] = args.title
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=1)
    title = meta.get("title") or os.path.splitext(os.path.basename(audio))[0]
    log(f"\n▶ {os.path.basename(audio)}  →  {slug}")
    Z = extract(audio, out_dir, force=args.force)
    D = float(Z["duration"])
    classes = FX.style_classes()
    cache = os.path.join(out_dir, "shazam.json")
    if args.reprobe and os.path.exists(cache):
        os.remove(cache)
    if args.offline:
        probes = []
        if os.path.exists(cache):  # use whatever was cached earlier, but send nothing
            with open(cache) as f:
                probes = sorted(json.load(f).values(), key=lambda p: p["t"])
    else:
        log("  identifying tracks (Shazam)")
        span = setlist.music_span(Z["band_rms"], D)
        probes = identify.probe_set(audio, D, cache, step=args.step, span=span, log=log)
    bpm_range = tuple(float(x) for x in args.bpm_range.split("-")) if args.bpm_range else None
    payload = build_payload(audio, slug, title, Z, probes, classes, bpm_range, args.step)
    os.makedirs(os.path.join(WEB_DATA, "sets"), exist_ok=True)
    with open(os.path.join(WEB_DATA, "sets", f"{slug}.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    s = payload["summary"]
    log(f"  ✓ {s['tracks']} tracks ({s['identified']} identified), avg {s['bpm_avg']} BPM, "
        f"{s['transitions']} transitions, {s['drops']} drops")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio", nargs="*", help="audio file(s) of a DJ set")
    ap.add_argument("--all", action="store_true", help="analyze every audio file in the project root")
    ap.add_argument("--title", help="display title (single file only)")
    ap.add_argument("--offline", action="store_true", help="skip Shazam; segment from audio alone")
    ap.add_argument("--bpm-range", help="fold tempos into this range, e.g. 160-190 (default: auto)")
    ap.add_argument("--step", type=float, default=24.0, help="seconds between Shazam probes")
    ap.add_argument("--force", action="store_true", help="recompute audio features")
    ap.add_argument("--reprobe", action="store_true", help="discard cached Shazam results")
    args = ap.parse_args()
    files = list(args.audio)
    if args.all:
        files += [os.path.join(ROOT, f) for f in sorted(os.listdir(ROOT)) if f.lower().endswith(AUDIO_EXTS)]
    if not files:
        ap.error("give an audio file or --all")
    FX.ensure_models(log=log)
    for f in files:
        analyze(os.path.abspath(f), args)
    write_manifest()
    log("\nDone. Start the app with ./run.sh")


if __name__ == "__main__":
    main()
