"""
Low-level audio features for a DJ set, all computed locally.

  decode()        ffmpeg -> mono float32 numpy at a given sample rate
  band_energy()   3-band (low / mid / high) energy envelope  -> "RGB" waveform
  rhythm()        Essentia beat tracker, chunked across the whole set
  keys()          Essentia KeyExtractor (EDM profile) on sliding windows
  effnet()        Discogs-EffNet: 400 Discogs styles + 1280-d embeddings,
                  plus mood / danceability / vocal heads (ONNX, offline)
"""
import json
import os
import subprocess

import numpy as np

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")


# ---------------------------------------------------------------- decoding
def decode(path, sr):
    """Decode any audio file to mono float32 at `sr` using ffmpeg."""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr),
           "-f", "f32le", "-acodec", "pcm_f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


# ---------------------------------------------------------------- 3-band energy
BANDS = {"low": (20, 150), "mid": (150, 2500), "high": (2500, 11000)}


def band_energy(y, sr, fps=8):
    """Per-frame energy (dB) in low / mid / high bands, plus full-band RMS dB.

    fps frames per second. Returns dict of float32 arrays.
    """
    hop = sr // fps
    n_fft = 4096
    win = np.hanning(n_fft).astype(np.float32)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    masks = {k: (freqs >= lo) & (freqs < hi) for k, (lo, hi) in BANDS.items()}
    n_frames = max(1, (len(y) - n_fft) // hop + 1)
    out = {k: np.zeros(n_frames, np.float32) for k in list(BANDS) + ["rms"]}
    block = 2048  # frames per vectorised block, keeps memory bounded
    for b0 in range(0, n_frames, block):
        b1 = min(n_frames, b0 + block)
        idx = (np.arange(b0, b1) * hop)[:, None] + np.arange(n_fft)[None, :]
        frames = y[idx] * win
        spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2
        for k, m in masks.items():
            out[k][b0:b1] = 10 * np.log10(spec[:, m].sum(axis=1) + 1e-10)
        out["rms"][b0:b1] = 10 * np.log10((frames ** 2).mean(axis=1) + 1e-12)
    return out


# ---------------------------------------------------------------- rhythm
def rhythm(y44, chunk_s=60.0, overlap_s=6.0, log=print):
    """Beat positions (seconds) across the whole set.

    RhythmExtractor2013 assumes 44.1 kHz. The set is processed in overlapping
    chunks so tempo changes between tracks are followed; beats from the
    overlap are taken from whichever chunk has them further from its edge.
    """
    import essentia.standard as es
    sr = 44100
    ext = es.RhythmExtractor2013(method="degara", minTempo=70, maxTempo=180)
    n = len(y44)
    step = chunk_s - overlap_s
    beats = []
    t0 = 0.0
    while t0 * sr < n:
        a = int(t0 * sr)
        b = min(n, int((t0 + chunk_s) * sr))
        seg = y44[a:b]
        if len(seg) < sr * 8:
            break
        _bpm, ticks, _conf, _est, _intervals = ext(seg)
        ticks = np.asarray(ticks) + t0
        lo = t0 + (overlap_s / 2 if t0 > 0 else 0)
        hi = t0 + chunk_s - overlap_s / 2 if b < n else np.inf
        beats.extend(ticks[(ticks >= lo) & (ticks < hi)].tolist())
        t0 += step
        if int(t0) % 600 < step:
            log(f"    rhythm  {t0/60:5.1f} min")
    beats = np.array(sorted(beats))
    # drop near-duplicate beats at chunk seams
    if len(beats) > 1:
        keep = np.concatenate([[True], np.diff(beats) > 0.15])
        beats = beats[keep]
    return beats


def bpm_windows(y44, win_s=20.0, hop_s=5.0):
    """Percival tempo estimate on sliding windows -> (center_times, bpm).

    Raw estimates may sit an octave off (e.g. 87.5 for 175 BPM drum & bass);
    music.resolve_octaves() settles that with style evidence.
    """
    import essentia.standard as es
    sr = 44100
    est = es.PercivalBpmEstimator(sampleRate=sr, minBPM=70, maxBPM=190)
    times, bpms = [], []
    t0 = 0.0
    n = len(y44)
    while (t0 + win_s / 2) * sr < n:
        seg = y44[int(t0 * sr):int((t0 + win_s) * sr)]
        if len(seg) < sr * 6:
            break
        rms = float(np.sqrt(np.mean(seg ** 2)))
        times.append(t0 + len(seg) / sr / 2)
        bpms.append(float(est(seg)) if rms > 1e-3 else np.nan)
        t0 += hop_s
    return np.array(times, np.float32), np.array(bpms, np.float32)


def local_bpm(beats, times, window=16.0):
    """Median-interval BPM of beats within +-window/2 of each time."""
    out = np.full(len(times), np.nan, np.float32)
    if len(beats) < 4:
        return out
    ibi = np.diff(beats)
    mid = (beats[1:] + beats[:-1]) / 2
    for i, t in enumerate(times):
        m = (mid > t - window / 2) & (mid < t + window / 2) & (ibi > 0.25) & (ibi < 0.9)
        if m.sum() >= 6:
            out[i] = 60.0 / np.median(ibi[m])
    return out


# ---------------------------------------------------------------- key
def keys(y44, win_s=20.0, hop_s=10.0):
    """Sliding-window key estimates: list of (center_t, key, scale, strength)."""
    import essentia.standard as es
    sr = 44100
    ke = es.KeyExtractor(profileType="edma", sampleRate=sr)
    res = []
    n = len(y44)
    t0 = 0.0
    while (t0 + win_s / 2) * sr < n:
        seg = y44[int(t0 * sr):int((t0 + win_s) * sr)]
        if len(seg) < sr * 5:
            break
        k, s, strength = ke(seg)
        res.append((t0 + len(seg) / sr / 2, k, s, float(strength)))
        t0 += hop_s
    return res


# ---------------------------------------------------------------- Discogs-EffNet
HEADS = {
    "danceability": "danceable",
    "mood_party": "party",
    "mood_aggressive": "aggressive",
    "mood_happy": "happy",
    "voice_instrumental": "voice",
}


MODEL_URLS = {
    "discogs-effnet-bsdynamic-1": "feature-extractors/discogs-effnet",
    **{f"{h}-discogs-effnet-1": f"classification-heads/{h}" for h in HEADS},
}


def ensure_models(log=print):
    """Download the Essentia ONNX models (~19 MB, no account needed) on first run."""
    import urllib.request
    os.makedirs(MODELS_DIR, exist_ok=True)
    for name, folder in MODEL_URLS.items():
        for ext in ("onnx", "json"):
            dest = os.path.join(MODELS_DIR, f"{name}.{ext}")
            if not os.path.exists(dest):
                log(f"    downloading {name}.{ext}")
                urllib.request.urlretrieve(f"https://essentia.upf.edu/models/{folder}/{name}.{ext}", dest + ".part")
                os.replace(dest + ".part", dest)


def _session(name):
    import onnxruntime as ort
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    return ort.InferenceSession(os.path.join(MODELS_DIR, name), opts)


def style_classes():
    with open(os.path.join(MODELS_DIR, "discogs-effnet-bsdynamic-1.json")) as f:
        return json.load(f)["classes"]


def effnet(y16, log=print):
    """Run Discogs-EffNet over the whole set.

    Mirrors Essentia's TensorflowPredictEffnetDiscogs: 96-band log-mel frames
    (TensorflowInputMusiCNN, 512/256 @ 16 kHz) grouped into 128-frame patches
    with a 62-frame hop (~2 s patches every ~1 s).

    Returns (times, activations[n,400], embeddings[n,1280], heads{name: [n]}).
    """
    import essentia.standard as es
    sr, frame, hop, patch, patch_hop = 16000, 512, 256, 128, 62
    mel = es.TensorflowInputMusiCNN()
    frames = [mel(f) for f in es.FrameGenerator(y16, frameSize=frame, hopSize=hop,
                                                startFromZero=True)]
    M = np.asarray(frames, np.float32)  # [T, 96]
    starts = np.arange(0, max(1, len(M) - patch + 1), patch_hop)
    patches = np.stack([M[s:s + patch] for s in starts])  # [n,128,96]
    times = (starts + patch / 2) * hop / sr
    log(f"    effnet  {len(patches)} patches")

    sess = _session("discogs-effnet-bsdynamic-1.onnx")
    acts, embs = [], []
    for b in range(0, len(patches), 256):
        a, e = sess.run(["activations", "embeddings"], {"melspectrogram": patches[b:b + 256]})
        acts.append(a)
        embs.append(e)
    acts = np.concatenate(acts).astype(np.float32)
    embs = np.concatenate(embs).astype(np.float32)

    heads = {}
    for name, positive in HEADS.items():
        s = _session(f"{name}-discogs-effnet-1.onnx")
        with open(os.path.join(MODELS_DIR, f"{name}-discogs-effnet-1.json")) as f:
            idx = json.load(f)["classes"].index(positive)
        heads[name] = s.run(None, {s.get_inputs()[0].name: embs})[0][:, idx].astype(np.float32)
    return times.astype(np.float32), acts, embs, heads
