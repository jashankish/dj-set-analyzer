"""
DJ-domain knowledge: Camelot keys, harmonic mixing rules, and tempo priors for
Discogs styles (used both to settle BPM octave errors and to sharpen the style
predictions on noisy, room-recorded audio).
"""
import numpy as np

# ---------------------------------------------------------------- Camelot wheel
_PITCHES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
_ALIASES = {"Db": "C#", "D#": "Eb", "Gb": "F#", "G#": "Ab", "A#": "Bb"}
# Camelot number for each major key (B = major, A = minor)
_MAJOR = {"B": 1, "F#": 2, "C#": 3, "Ab": 4, "Eb": 5, "Bb": 6, "F": 7,
          "C": 8, "G": 9, "D": 10, "A": 11, "E": 12}
_MINOR = {"Ab": 1, "Eb": 2, "Bb": 3, "F": 4, "C": 5, "G": 6, "D": 7,
          "A": 8, "E": 9, "B": 10, "F#": 11, "C#": 12}


def camelot(key, scale):
    k = _ALIASES.get(key, key)
    if scale == "major":
        return f"{_MAJOR[k]}B"
    return f"{_MINOR[k]}A"


def key_name(key, scale):
    k = _ALIASES.get(key, key)
    return f"{k} {'major' if scale == 'major' else 'minor'}"


def _parse(c):
    return int(c[:-1]), c[-1]


def harmonic_relation(a, b):
    """How a DJ would describe moving from Camelot key a to b."""
    if not a or not b:
        return {"label": "Unknown", "compatible": None}
    na, la = _parse(a)
    nb, lb = _parse(b)
    step = (nb - na) % 12
    if a == b:
        return {"label": "Same key", "compatible": True}
    if la == lb and step in (1, 11):
        return {"label": "Energy up" if step == 1 else "Energy down", "compatible": True}
    if na == nb:
        return {"label": "Relative " + ("major" if lb == "B" else "minor"), "compatible": True}
    if la == lb and step in (2, 10):
        return {"label": "Two-step " + ("up" if step == 2 else "down"), "compatible": "partial"}
    if la == lb and step == 7:
        return {"label": "Energy boost (+7)", "compatible": "partial"}
    if la != lb and ((la == "A" and step == 3) or (la == "B" and step == 9)):
        return {"label": "Mood shift", "compatible": "partial"}
    return {"label": "Key clash", "compatible": False}


# ---------------------------------------------------------------- style tempo priors
# (lo, hi) BPM as a DJ would beat-match them (half-time styles at full tempo).
STYLE_TEMPO = {
    "Drum n Bass": (165, 180), "Jungle": (158, 175), "Halftime": (160, 178),
    "Hardcore": (160, 200), "Happy Hardcore": (165, 185), "Gabber": (165, 220),
    "Breakcore": (160, 220), "Speedcore": (200, 300), "Juke": (155, 165),
    "Dubstep": (136, 145), "Grime": (136, 145), "UK Garage": (128, 140),
    "Speed Garage": (128, 138), "Bassline": (132, 142), "Bass Music": (130, 150),
    "House": (118, 128), "Deep House": (115, 125), "Tech House": (122, 128),
    "Acid House": (118, 130), "Progressive House": (122, 130), "Electro House": (124, 132),
    "Garage House": (118, 126), "Ghetto House": (125, 140), "Tribal House": (120, 130),
    "Hard House": (135, 150), "Euro House": (120, 135), "Italo House": (118, 128),
    "Hip-House": (115, 128), "Tropical House": (100, 115),
    "Techno": (125, 140), "Hard Techno": (140, 160), "Minimal Techno": (120, 130),
    "Dub Techno": (115, 130), "Deep Techno": (120, 132), "Schranz": (145, 160),
    "Acid": (120, 145), "Minimal": (118, 128), "Tribal": (125, 135),
    "Trance": (132, 142), "Psy-Trance": (138, 148), "Goa Trance": (135, 150),
    "Hard Trance": (140, 155), "Progressive Trance": (128, 138), "Tech Trance": (135, 145),
    "Hardstyle": (145, 160), "Jumpstyle": (140, 150), "Makina": (160, 180),
    "Breakbeat": (125, 140), "Breaks": (125, 140), "Progressive Breaks": (128, 136),
    "Big Beat": (110, 140), "Electro": (120, 135), "EBM": (110, 135),
    "Disco": (110, 125), "Nu-Disco": (110, 124), "Italo-Disco": (115, 130),
    "Hi NRG": (125, 140), "Eurodance": (130, 145), "Hands Up": (135, 145),
    "Dance-pop": (110, 130), "Synth-pop": (100, 130),
    "Hip Hop": (80, 100), "Boom Bap": (85, 98), "Trap": (130, 160),
    "Trip Hop": (70, 100), "Downtempo": (80, 110), "Reggaeton": (88, 100),
    "Dancehall": (90, 110), "Dub": (70, 90), "Afrobeat": (100, 120),
}
NEUTRAL = 0.35   # likelihood for a style with no tempo prior (Ambient, Experimental...)


def tempo_likelihood(style, bpm):
    """How plausible is `bpm` for a Discogs style label ('Genre---Style')."""
    name = style.split("---")[-1]
    rng = STYLE_TEMPO.get(name)
    if rng is None or bpm is None or not np.isfinite(bpm):
        return NEUTRAL
    lo, hi = rng
    if lo <= bpm <= hi:
        return 1.0
    d = lo - bpm if bpm < lo else bpm - hi
    return float(max(0.03, np.exp(-0.5 * (d / 6.0) ** 2)))


def fuse_styles(acts, classes, bpm, top=4):
    """Re-weight mean EffNet activations by tempo plausibility; return top styles."""
    w = np.array([tempo_likelihood(c, bpm) for c in classes])
    post = acts * w
    post = post / (post.sum() + 1e-9)
    idx = np.argsort(-post)[:top]
    return [{"style": classes[i].split("---")[-1], "genre": classes[i].split("---")[0],
             "p": round(float(post[i]), 3)} for i in idx]


# ---------------------------------------------------------------- BPM octave resolution
def resolve_octaves(raw_bpm, style_acts, classes, jump_cost=3.0):
    """Choose x0.5 / x1 / x2 per window with a Viterbi pass.

    Emission: how well each tempo candidate agrees with the window's style
    activations (only styles with a tempo prior vote). Transition: penalty for
    switching tempo octave between neighbouring windows, so a whole set stays
    on one consistent grid unless the music really changes.
    """
    mult = np.array([0.5, 1.0, 2.0])
    prior_idx = [i for i, c in enumerate(classes) if c.split("---")[-1] in STYLE_TEMPO]
    pc = [classes[i] for i in prior_idx]
    n = len(raw_bpm)
    E = np.full((n, 3), -1e3)
    for t in range(n):
        if not np.isfinite(raw_bpm[t]):
            E[t] = 0
            continue
        a = style_acts[t][prior_idx]
        for k, m in enumerate(mult):
            b = raw_bpm[t] * m
            if b < 60 or b > 210:
                continue
            like = np.array([tempo_likelihood(c, b) for c in pc])
            E[t, k] = np.log((a * like).sum() / (a.sum() + 1e-9) + 1e-6)
    # Viterbi
    T = -jump_cost * np.abs(np.log2(mult[:, None] / mult[None, :]))
    D = np.zeros((n, 3))
    P = np.zeros((n, 3), int)
    D[0] = E[0]
    for t in range(1, n):
        s = D[t - 1][:, None] + T
        P[t] = s.argmax(0)
        D[t] = s.max(0) + E[t]
    path = np.zeros(n, int)
    path[-1] = D[-1].argmax()
    for t in range(n - 1, 0, -1):
        path[t - 1] = P[t, path[t]]
    return raw_bpm * mult[path], mult[path]
