"""
Turn low-level features + Shazam probes into a setlist: tracks, transitions,
drops and set-wide curves.

Track boundaries come from two sources that complement each other:
  * Shazam runs: consecutive probes matching the same track. The match offset
    (where in the original track the clip sits) also tells us when the DJ
    actually brought the track in.
  * Novelty: a Foote checkerboard kernel over the EffNet-embedding
    self-similarity matrix. It peaks where the music changes character, which
    places swaps precisely and finds tracks Shazam could not name.
"""
import re

import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import find_peaks

import music

NOV_BIN = 2.0         # seconds per novelty bin
NOV_HALF = 12         # kernel half-width in bins (24 s each side)
MIN_TRACK = 60.0      # shortest stretch we will call a separate track
FPS = 8               # band-energy frames per second
AUDIO_ONLY_MIN = 75.0  # shortest track when there's no identification at all
AUDIO_ONLY_PROM = 0.4  # novelty prominence needed to call a track change then


# ---------------------------------------------------------------- novelty
def novelty(emb_t, emb, duration):
    nb = int(np.ceil(duration / NOV_BIN))
    idx = np.clip((emb_t / NOV_BIN).astype(int), 0, nb - 1)
    E = np.zeros((nb, emb.shape[1]), np.float32)
    cnt = np.zeros(nb)
    np.add.at(E, idx, emb)
    np.add.at(cnt, idx, 1)
    # fill empty bins from neighbors
    for i in range(nb):
        if cnt[i] == 0 and i > 0:
            E[i] = E[i - 1]
            cnt[i] = 1
    E /= np.linalg.norm(E, axis=1, keepdims=True) + 1e-9
    S = E @ E.T
    L = NOV_HALF
    g = np.exp(-0.5 * (np.linspace(-1.5, 1.5, 2 * L)) ** 2)
    K = np.outer(g, g) * np.outer(np.r_[-np.ones(L), np.ones(L)], np.r_[-np.ones(L), np.ones(L)])
    K /= np.abs(K).sum()
    Sp = np.pad(S, L, mode="edge")
    nov = np.array([(K * Sp[i:i + 2 * L, i:i + 2 * L]).sum() for i in range(nb)])
    nov = np.maximum(nov, 0)
    nov /= np.percentile(nov, 99.5) + 1e-9
    return np.clip(nov, 0, 1.2)


def _nov_at(nov, t):
    return nov[int(np.clip(t / NOV_BIN, 0, len(nov) - 1))]


def _peaks_in(nov, a, b, min_dist=MIN_TRACK, prominence=0.12):
    lo, hi = int(max(0, a) / NOV_BIN), int(min(len(nov) * NOV_BIN, b) / NOV_BIN)
    if hi - lo < 3:
        return []
    pk, prop = find_peaks(nov[lo:hi], prominence=prominence, distance=max(1, int(min_dist / NOV_BIN / 2)))
    order = np.argsort(-prop["prominences"])
    return [((lo + pk[i]) * NOV_BIN + NOV_BIN / 2, float(prop["prominences"][i])) for i in order]


# ---------------------------------------------------------------- Shazam runs
_EDIT = re.compile(r"\s*[\(\[](?:feat\.?|ft\.?|featuring)[^\)\]]*[\)\]]"
                   r"|\s*[\(\[](?:extended|original|radio|club|album)(?: mix| edit| version)?[\)\]]", re.I)


def song_key(track):
    """Same song, different release (Extended Mix, feat. credit) -> same key."""
    title = _EDIT.sub("", track.get("title") or "").strip().lower()
    artist = (track.get("artist") or "").split("&")[0].split(",")[0].strip().lower()
    return f"{artist}|{title}"


def shazam_runs(probes):
    """Group consecutive matching probes into runs (one per played track)."""
    hits = [p for p in probes if p.get("track")]
    runs = []
    for p in hits:
        tid = song_key(p["track"])
        if runs and runs[-1]["id"] == tid:
            runs[-1]["probes"].append(p)
        else:
            runs.append({"id": tid, "probes": [p]})
    # drop single stray matches sandwiched inside another track (A x A)
    changed = True
    while changed:
        changed = False
        for i in range(1, len(runs) - 1):
            if len(runs[i]["probes"]) == 1 and runs[i - 1]["id"] == runs[i + 1]["id"]:
                runs[i - 1]["probes"] += runs[i + 1]["probes"]
                del runs[i:i + 2]
                changed = True
                break
    for r in runs:
        ps = r["probes"]
        r["first"] = ps[0]["t"]
        r["last"] = ps[-1]["t"] + ps[-1]["dur"]
        r["meta"] = ps[0]["track"]
        starts = [p["t"] - p["offset"] for p in ps if p.get("offset") is not None]
        r["start_est"] = float(np.median(starts)) if starts else None
        r["linear"] = bool(starts and (max(starts) - min(starts)) < 20)
    return runs


# ---------------------------------------------------------------- segmentation
def segment(duration, probes, nov, step):
    """Return an ordered list of track stubs with dominant spans [s, e].

    Walk the gaps between consecutive anchors (set start, each Shazam run, set
    end). Every gap gets k boundaries from novelty peaks:
      run -> run   : k >= 1, holding k-1 unnamed tracks
      start -> run : k >= 0 unnamed tracks before the first ID (likewise run -> end)
    so the track count is always len(boundaries) + 1.
    """
    runs = shazam_runs(probes)
    if not runs:
        # audio only: split on clear changes in sound, tracks at least 75 s
        # (tuned against the Shazam-anchored setlists of the bundled sets)
        chosen = []
        for t, prom in _peaks_in(nov, AUDIO_ONLY_MIN, duration - AUDIO_ONLY_MIN, min_dist=AUDIO_ONLY_MIN, prominence=0.05):
            if prom >= AUDIO_ONLY_PROM and all(abs(t - c) >= AUDIO_ONLY_MIN for c in chosen):
                chosen.append(t)
        edges = [0.0] + sorted(chosen) + [duration]
        return [{"s": edges[k], "e": edges[k + 1], "run": None} for k in range(len(edges) - 1)]
    anchors = [None] + runs + [None]           # None = set edge
    boundaries, order = [], []
    for i in range(len(anchors) - 1):
        a, b = anchors[i], anchors[i + 1]
        left = a["last"] if a else 0.0
        right = b["first"] if b else duration
        span = right - left
        long_gap = span >= 180.0
        chosen = []
        if a is not None and b is not None:
            # B cannot take over before it started playing (Shazam match offset)
            floor = left - step * 0.5
            if b["start_est"] is not None and left - step < b["start_est"] < right:
                floor = b["start_est"] - 6
            lo = int(max(0, floor) / NOV_BIN)
            hi = max(lo + 1, int((right + step * 0.5) / NOV_BIN))
            main = (lo + int(np.argmax(nov[lo:hi + 1]))) * NOV_BIN + NOV_BIN / 2
            chosen = [main]
            if long_gap:  # room for unnamed tracks between A and B
                for t, prom in _peaks_in(nov, left - step * 0.5, main - MIN_TRACK):
                    if prom >= 0.25 and all(abs(t - c) >= MIN_TRACK for c in chosen):
                        chosen.append(t)
        elif a is None and b is not None and b["start_est"] is not None and b["start_est"] >= MIN_TRACK * 0.75:
            # something else played before the first ID started
            lo = int((b["start_est"] - 6) / NOV_BIN)
            hi = max(lo + 1, int((right + step * 0.5) / NOV_BIN))
            chosen = [(lo + int(np.argmax(nov[lo:hi + 1]))) * NOV_BIN + NOV_BIN / 2]
            for t, prom in _peaks_in(nov, MIN_TRACK, chosen[0] - MIN_TRACK):
                if prom >= 0.25 and all(abs(t - c) >= MIN_TRACK for c in chosen):
                    chosen.append(t)
        elif a is None and b is not None and b["start_est"] is not None:
            pass  # the first ID was playing from (nearly) the start
        elif span >= MIN_TRACK + step:
            # stretch before the first / after the last ID: unnamed tracks only on clear changes
            for t, prom in _peaks_in(nov, left, right):
                if (a is None and t < MIN_TRACK) or (b is None and duration - t < MIN_TRACK):
                    continue
                if (b is not None and right - t < 6) or (a is not None and t - left < 6):
                    continue
                if prom >= 0.22 and all(abs(t - c) >= MIN_TRACK for c in chosen):
                    chosen.append(t)
        chosen.sort()
        if a is not None:
            order.append(a)
        n_unknown = len(chosen) - 1 if (a is not None and b is not None) else len(chosen)
        if a is None and b is None:
            n_unknown = len(chosen) + 1
        order += [None] * n_unknown
        boundaries += chosen
    edges = [0.0] + sorted(boundaries) + [duration]
    return [{"s": edges[k], "e": edges[k + 1], "run": run} for k, run in enumerate(order)]


# ---------------------------------------------------------------- where the music is
def music_span(rms_db, duration, win=10.0, gap=0.2):
    """[start, end] of the set itself, trimming silence the phone kept recording.

    A 10 s window counts as music when it is within 20 dB of the set's loud
    level. The set ends at the first point where the next two minutes are
    mostly quiet AND under `gap` of everything after it is music (so a
    breakdown or a pause mid-set doesn't end it); the start mirrors that.
    """
    n = int(duration // win)
    if n < 12:
        return 0.0, duration
    step = int(win * FPS)
    w = np.array([np.median(rms_db[i * step:(i + 1) * step]) for i in range(n)])
    active = w > np.percentile(w, 90) - 20
    k = int(120 / win)
    end = duration
    for i in range(n - k):
        if active[i:i + k].mean() <= 0.2 and active[i:].mean() < gap:
            end = i * win
            break
    start = 0.0
    for i in range(n - 1, k, -1):
        if active[i - k:i].mean() <= 0.2 and active[:i].mean() < gap:
            start = i * win
            break
    if end - start < 120:
        return 0.0, duration
    return float(start), float(min(duration, end + win))


# ---------------------------------------------------------------- helpers
def _slice(t, a, b):
    return (t >= a) & (t <= b)


def _smooth(x, n):
    return uniform_filter1d(x.astype(np.float64), size=max(1, n), mode="nearest")


def _norm01(x, lo_p=3, hi_p=99.5):
    lo, hi = np.nanpercentile(x, lo_p), np.nanpercentile(x, hi_p)
    return np.clip((x - lo) / (hi - lo + 1e-9), 0, 1)


# ---------------------------------------------------------------- the whole thing
def build(F, classes, log=print):
    D_rec = F["duration"]
    s0, D = F["span"]
    nov = novelty(F["emb_t"], F["emb"], D_rec)
    step = F.get("probe_step", 24.0)
    probes = [p for p in F["probes"] if s0 - p["dur"] <= p["t"] < D]
    stubs = segment(D, probes, nov[:int(np.ceil(D / NOV_BIN))], step)
    stubs[0]["s"] = max(stubs[0]["s"], s0) if stubs[0]["e"] > s0 + MIN_TRACK else stubs[0]["s"]
    log(f"    setlist {len(stubs)} tracks between {s0 / 60:.1f} and {D / 60:.1f} min")

    bands = F["bands"]
    bt = np.arange(len(bands["rms"])) / FPS
    low1 = _smooth(bands["low"], FPS)
    rms1 = _smooth(bands["rms"], FPS)
    low2 = _smooth(bands["low"], FPS * 2)

    # set-wide energy curve (0..1) at 1 Hz: loudness, brightness, party, aggression
    sec = np.arange(0, int(D_rec))
    loud = np.interp(sec, bt, _smooth(_norm01(bands["rms"]), FPS * 4))
    bright = np.interp(sec, bt, _smooth(_norm01(bands["high"]), FPS * 4))
    party = np.interp(sec, F["emb_t"], _smooth(F["heads"]["mood_party"], 10))
    aggr = np.interp(sec, F["emb_t"], _smooth(F["heads"]["mood_aggressive"], 10))
    energy = _smooth(0.5 * loud + 0.2 * bright + 0.15 * party + 0.15 * aggr, 8)
    in_set = energy[int(s0):int(D)]
    e_lo, e_hi = np.percentile(in_set, 2), np.percentile(in_set, 99.5)

    bpm_t, bpm = F["bpm_t"], F["bpm"]
    kt = np.array([k[0] for k in F["keys"]])

    def track_metrics(s, e):
        a, b = (s + 8, e - 8) if e - s > 40 else (s, e)
        m = _slice(bpm_t, a, b)
        tb = float(np.nanmedian(bpm[m])) if m.any() and np.isfinite(bpm[m]).any() else None
        votes = {}
        for (t, k, sc, st) in F["keys"]:
            if a <= t <= b:
                c = music.camelot(k, sc)
                votes.setdefault(c, [0.0, k, sc])
                votes[c][0] += st
        if votes:
            cam, (w, k, sc) = max(votes.items(), key=lambda kv: kv[1][0])
            kconf = w / sum(v[0] for v in votes.values())
            key = {"camelot": cam, "name": music.key_name(k, sc), "confidence": round(kconf, 2)}
        else:
            key = None
        me = _slice(F["emb_t"], a, b)
        acts = F["acts"][me].mean(0) if me.any() else F["acts"].mean(0)
        moods = {k: round(float(v[me].mean()), 3) if me.any() else None for k, v in F["heads"].items()}
        es_ = energy[int(a):max(int(a) + 1, int(b))]
        lvl = float(np.clip((es_.mean() - e_lo) / (e_hi - e_lo + 1e-9), 0, 1))
        spark = np.interp(np.linspace(s, e, 48), sec, energy)
        return {
            "bpm": round(tb, 1) if tb else None,
            "key": key,
            "styles": music.fuse_styles(acts, classes, tb),
            "moods": moods,
            "energy": round(1 + 9 * lvl, 1),
            "loudness_db": round(float(rms1[_slice(bt, a, b)].mean()), 1),
            "spark": [round(float((v - e_lo) / (e_hi - e_lo + 1e-9)), 3) for v in spark],
        }

    tracks = []
    for i, st in enumerate(stubs):
        run = st["run"]
        meta = run["meta"] if run else None
        m = track_metrics(st["s"], st["e"])
        n_in = sum(1 for p in probes if st["s"] <= p["t"] + p["dur"] / 2 <= st["e"])
        n_hit = len(run["probes"]) if run else 0
        tracks.append({
            "n": i + 1,
            "start": round(st["s"], 2), "end": round(st["e"], 2),
            "title": meta["title"] if meta else None,
            "artist": meta["artist"] if meta else None,
            "identified": bool(meta),
            "meta": meta,
            "id_confidence": round(n_hit / max(1, n_in), 2) if meta else 0,
            "shazam_hits": n_hit,
            "start_est": round(run["start_est"], 1) if run and run["start_est"] is not None else None,
            "played_linear": run["linear"] if run else None,
            **m,
        })

    # ------------------------------------------------ transitions
    transitions = []
    for i in range(len(tracks) - 1):
        A, B = tracks[i], tracks[i + 1]
        swap = B["start"]
        # how far left/right the change spreads on the novelty curve
        pv = _nov_at(nov, swap)
        lo_lim = A["start"] + 5
        hi_lim = B["end"] - 5
        t = swap
        while t - NOV_BIN > lo_lim and _nov_at(nov, t - NOV_BIN) > 0.5 * pv and swap - t < 48:
            t -= NOV_BIN
        mix_in = t
        t = swap
        while t + NOV_BIN < hi_lim and _nov_at(nov, t + NOV_BIN) > 0.5 * pv and t - swap < 48:
            t += NOV_BIN
        mix_out = t
        # Shazam offset tells us when B actually started playing
        if B["start_est"] is not None and swap - 150 <= B["start_est"] <= swap:
            mix_in = max(lo_lim, B["start_est"])
        mix_in = min(mix_in, swap - 1)
        mix_out = max(mix_out, swap + 1)
        dur = mix_out - mix_in
        bb = np.nanmean([x for x in (A["bpm"], B["bpm"]) if x]) if (A["bpm"] or B["bpm"]) else None
        bars = dur * bb / 240 if bb else None

        # low band (2 s smoothing) before / around / after the swap tells the DJ move
        lp = low2[_slice(bt, swap - 24, swap - 8)]
        la = low2[_slice(bt, swap - 6, swap + 6)]
        lq = low2[_slice(bt, swap + 8, swap + 24)]
        pre_low = float(np.median(lp)) if lp.size else float(np.median(low2))
        post_low = float(np.median(lq)) if lq.size else pre_low
        low_min = float(la.min()) if la.size else pre_low
        low_dip = min(pre_low, post_low) - low_min
        win = _slice(bt, swap - 16, swap + 16)
        quiet_s = _longest_run(low2[win] < min(pre_low, post_low) - 10) / FPS
        pre_rms = float(np.median(rms1[_slice(bt, swap - 24, swap - 8)]))
        post_rms = float(np.median(rms1[_slice(bt, swap + 8, swap + 24)]))
        peak_rms = float(np.percentile(rms1[_slice(bt, swap - 4, swap + 8)], 90))

        if dur < 8:
            kind = "Cut"
        elif post_low < pre_low - 12:
            kind = "Into breakdown"
        elif pre_low < post_low - 12:
            kind = "Drop swap"
        elif quiet_s >= 6:
            kind = "Breakdown drop"
        elif low_dip >= 8:
            kind = "Bass swap"
        elif peak_rms > max(pre_rms, post_rms) + 2.5:
            kind = "Double drop"
        elif bars and bars >= 32:
            kind = "Long blend"
        else:
            kind = "Blend"
        breakdown_s = quiet_s

        rel = music.harmonic_relation(A["key"]["camelot"] if A["key"] else None,
                                      B["key"]["camelot"] if B["key"] else None)
        sa = {s["style"]: s["p"] for s in A["styles"]}
        sb = {s["style"]: s["p"] for s in B["styles"]}
        overlap = sum(min(sa.get(k, 0), sb.get(k, 0)) for k in set(sa) | set(sb))
        transitions.append({
            "from": A["n"], "to": B["n"],
            "mix_in": round(mix_in, 2), "swap": round(swap, 2), "mix_out": round(mix_out, 2),
            "duration": round(dur, 1),
            "bars": round(bars) if bars else None,
            "type": kind,
            "bpm_from": A["bpm"], "bpm_to": B["bpm"],
            "bpm_delta": round(B["bpm"] - A["bpm"], 1) if A["bpm"] and B["bpm"] else None,
            "key_from": A["key"]["camelot"] if A["key"] else None,
            "key_to": B["key"]["camelot"] if B["key"] else None,
            "harmonic": rel,
            "energy_delta": round(B["energy"] - A["energy"], 1),
            "loudness_delta_db": round(post_rms - pre_rms, 1),
            "low_dip_db": round(low_dip, 1),
            "low_before_db": round(pre_low, 1), "low_after_db": round(post_low, 1),
            "breakdown_s": round(breakdown_s, 1),
            "style_continuity": round(overlap, 2),
            "sharpness": round(float(pv), 2),
        })

    drops = [d for d in find_drops(bt, low1, D_rec) if s0 < d["t"] < D]
    return tracks, transitions, drops, nov, energy, (e_lo, e_hi)


def _longest_run(mask):
    best = cur = 0
    for v in mask:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best


def find_drops(bt, low1, D):
    """Breakdown -> drop moments: the bass falls away for a while, then slams back."""
    base = median_filter(low1, size=FPS * 60, mode="nearest")
    quiet = low1 < base - 8
    drops = []
    i, n = 0, len(quiet)
    while i < n:
        if quiet[i]:
            j = i
            while j < n and (quiet[j] or (j + FPS * 2 < n and quiet[j:j + FPS * 2].any())):
                j += 1
            length = (j - i) / FPS
            if length >= 6 and j < n - FPS * 2:
                back = low1[j:j + FPS * 4].max() if j + FPS * 4 <= n else low1[j:].max()
                depth = float(base[i:j].mean() - low1[i:j].mean())
                if back > base[j] - 3:
                    drops.append({
                        "t": round(j / FPS, 2), "breakdown_start": round(i / FPS, 2),
                        "breakdown_s": round(length, 1), "depth_db": round(depth, 1),
                        "impact_db": round(float(back - low1[max(i, j - FPS):j].mean()), 1),
                    })
            i = j
        i += 1
    return drops
