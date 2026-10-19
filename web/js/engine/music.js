/* DJ-domain knowledge — a straight port of analyzer/music.py.
   Camelot keys, harmonic mixing rules, and per-style tempo priors used to
   settle BPM octave errors and sharpen style predictions. */

const ALIASES = { Db: "C#", "D#": "Eb", Gb: "F#", "G#": "Ab", "A#": "Bb" };
const MAJOR = { B: 1, "F#": 2, "C#": 3, Ab: 4, Eb: 5, Bb: 6, F: 7, C: 8, G: 9, D: 10, A: 11, E: 12 };
const MINOR = { Ab: 1, Eb: 2, Bb: 3, F: 4, C: 5, G: 6, D: 7, A: 8, E: 9, B: 10, "F#": 11, "C#": 12 };

export function camelot(key, scale) {
  const k = ALIASES[key] || key;
  return scale === "major" ? `${MAJOR[k]}B` : `${MINOR[k]}A`;
}
export function keyName(key, scale) {
  return `${ALIASES[key] || key} ${scale === "major" ? "major" : "minor"}`;
}

export function harmonicRelation(a, b) {
  if (!a || !b) return { label: "Unknown", compatible: null };
  const na = parseInt(a, 10), la = a.slice(-1), nb = parseInt(b, 10), lb = b.slice(-1);
  const step = (((nb - na) % 12) + 12) % 12;
  if (a === b) return { label: "Same key", compatible: true };
  if (la === lb && (step === 1 || step === 11)) return { label: step === 1 ? "Energy up" : "Energy down", compatible: true };
  if (na === nb) return { label: `Relative ${lb === "B" ? "major" : "minor"}`, compatible: true };
  if (la === lb && (step === 2 || step === 10)) return { label: `Two-step ${step === 2 ? "up" : "down"}`, compatible: "partial" };
  if (la === lb && step === 7) return { label: "Energy boost (+7)", compatible: "partial" };
  if (la !== lb && ((la === "A" && step === 3) || (la === "B" && step === 9))) return { label: "Mood shift", compatible: "partial" };
  return { label: "Key clash", compatible: false };
}

/* (lo, hi) BPM as a DJ would beat-match them (half-time styles at full tempo) */
export const STYLE_TEMPO = {
  "Drum n Bass": [165, 180], "Jungle": [158, 175], "Halftime": [160, 178],
  "Hardcore": [160, 200], "Happy Hardcore": [165, 185], "Gabber": [165, 220],
  "Breakcore": [160, 220], "Speedcore": [200, 300], "Juke": [155, 165],
  "Dubstep": [136, 145], "Grime": [136, 145], "UK Garage": [128, 140],
  "Speed Garage": [128, 138], "Bassline": [132, 142], "Bass Music": [130, 150],
  "House": [118, 128], "Deep House": [115, 125], "Tech House": [122, 128],
  "Acid House": [118, 130], "Progressive House": [122, 130], "Electro House": [124, 132],
  "Garage House": [118, 126], "Ghetto House": [125, 140], "Tribal House": [120, 130],
  "Hard House": [135, 150], "Euro House": [120, 135], "Italo House": [118, 128],
  "Hip-House": [115, 128], "Tropical House": [100, 115],
  "Techno": [125, 140], "Hard Techno": [140, 160], "Minimal Techno": [120, 130],
  "Dub Techno": [115, 130], "Deep Techno": [120, 132], "Schranz": [145, 160],
  "Acid": [120, 145], "Minimal": [118, 128], "Tribal": [125, 135],
  "Trance": [132, 142], "Psy-Trance": [138, 148], "Goa Trance": [135, 150],
  "Hard Trance": [140, 155], "Progressive Trance": [128, 138], "Tech Trance": [135, 145],
  "Hardstyle": [145, 160], "Jumpstyle": [140, 150], "Makina": [160, 180],
  "Breakbeat": [125, 140], "Breaks": [125, 140], "Progressive Breaks": [128, 136],
  "Big Beat": [110, 140], "Electro": [120, 135], "EBM": [110, 135],
  "Disco": [110, 125], "Nu-Disco": [110, 124], "Italo-Disco": [115, 130],
  "Hi NRG": [125, 140], "Eurodance": [130, 145], "Hands Up": [135, 145],
  "Dance-pop": [110, 130], "Synth-pop": [100, 130],
  "Hip Hop": [80, 100], "Boom Bap": [85, 98], "Trap": [130, 160],
  "Trip Hop": [70, 100], "Downtempo": [80, 110], "Reggaeton": [88, 100],
  "Dancehall": [90, 110], "Dub": [70, 90], "Afrobeat": [100, 120],
};
const NEUTRAL = 0.15;
const SOFT_VOTE = { Downtempo: 0.3, Dub: 0.3, "Trip Hop": 0.3 };
const styleName = (c) => c.split("---").pop();

export function tempoLikelihood(style, bpm) {
  const rng = STYLE_TEMPO[styleName(style)];
  if (!rng || bpm == null || !Number.isFinite(bpm)) return NEUTRAL;
  const [lo, hi] = rng;
  if (bpm >= lo && bpm <= hi) return 1;
  const d = bpm < lo ? lo - bpm : bpm - hi;
  return Math.max(0.03, Math.exp(-0.5 * (d / 6) ** 2));
}

export function fuseStyles(acts, classes, bpm, top = 4) {
  const post = classes.map((c, i) => acts[i] * tempoLikelihood(c, bpm));
  const s = post.reduce((a, b) => a + b, 0) + 1e-9;
  return [...post.keys()].sort((a, b) => post[b] - post[a]).slice(0, top).map((i) => ({
    style: styleName(classes[i]), genre: classes[i].split("---")[0], p: Math.round((post[i] / s) * 1000) / 1000,
  }));
}

/* Viterbi over x0.5 / x1 / x2 per tempo window (see music.resolve_octaves):
   the transition cost follows how far the resolved tempo jumps, so only real
   speed changes cost anything; one-window outliers are median-filtered first. */
export function resolveOctaves(raw, styleActs, classes, jumpCost = 12) {
  const mult = [0.5, 1, 2];
  const okIdx = raw.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  const clean = raw.slice();
  okIdx.forEach((i, k) => {
    const w = [];
    for (let d = -2; d <= 2; d++) w.push(raw[okIdx[Math.min(okIdx.length - 1, Math.max(0, k + d))]]);
    w.sort((x, y) => x - y);
    clean[i] = w[2];
  });
  const idx = classes.map((c, i) => (STYLE_TEMPO[styleName(c)] ? i : -1)).filter((i) => i >= 0);
  const vote = idx.map((i) => SOFT_VOTE[styleName(classes[i])] || 1);
  const n = clean.length, E = [];
  for (let t = 0; t < n; t++) {
    const row = [-1e3, -1e3, -1e3];
    if (!Number.isFinite(clean[t])) { E.push([0, 0, 0]); continue; }
    const a = idx.map((i, k) => styleActs[t][i] * vote[k]);
    const sa = a.reduce((x, y) => x + y, 0) + 1e-9;
    mult.forEach((m, k) => {
      const b = clean[t] * m;
      if (b < 60 || b > 210) return;
      let s = 0;
      idx.forEach((i, j) => { s += a[j] * tempoLikelihood(classes[i], b); });
      row[k] = Math.log(s / sa + 1e-6);
    });
    E.push(row);
  }
  let D = E[0].slice();
  const P = [];
  let last = Number.isFinite(clean[0]) ? clean[0] : 120;
  for (let t = 1; t < n; t++) {
    const cur = Number.isFinite(clean[t]) ? clean[t] : last;
    const nd = [0, 0, 0], np = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      let best = -Infinity, bi = 0;
      for (let i = 0; i < 3; i++) {
        const v = D[i] - jumpCost * Math.abs(Math.log2((cur * mult[j]) / (last * mult[i])));
        if (v > best) { best = v; bi = i; }
      }
      nd[j] = best + E[t][j]; np[j] = bi;
    }
    D = nd; P.push(np); last = cur;
  }
  const path = new Array(n);
  path[n - 1] = D.indexOf(Math.max(...D));
  for (let t = n - 1; t > 0; t--) path[t - 1] = P[t - 1][path[t]];
  return clean.map((v, t) => v * mult[path[t]]);
}

/* Smooth over short tempo misreadings (see music.fill_tempo_blips; run on the
   set's music span): up to 9 windows (90 s) of misreadings, even a mix of
   them, between two stretches at the same tempo take that tempo; then, at each end of the set, up to 12 windows (2 min) of
   short runs (fades, crowd noise) take the nearest established tempo. */
export function fillTempoBlips(bpm, maxLen = 9, tol = 0.04, edgeLen = 12) {
  const v = Array.from(bpm);
  const same = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x / y - 1) < tol;
  const segments = () => {
    const segs = [];
    let start = 0;
    for (let i = 1; i <= v.length; i++) if (i === v.length || !same(v[i], v[start])) { segs.push([start, i]); start = i; }
    return segs;
  };
  // a cluster of short runs (up to maxLen windows in all) between two stretches
  // at the same tempo takes that tempo
  let changed = true;
  while (changed) {
    changed = false;
    const segs = segments();
    for (let k = 1; k < segs.length - 1 && !changed; k++) {
      const anchor = v[segs[k - 1][0]];
      if (!Number.isFinite(anchor)) continue;
      let total = 0;
      for (let j = k; j < segs.length - 1; j++) {
        total += segs[j][1] - segs[j][0];
        if (total > maxLen) break;
        if (same(anchor, v[segs[j + 1][0]])) { v.fill(anchor, segs[k][0], segs[j][1]); changed = true; break; }
      }
    }
  }
  const segs = segments();
  for (const lead of [true, false]) {
    const order = lead ? segs : segs.slice().reverse();
    let acc = 0;
    for (let k = 0; k < order.length; k++) {
      const [a, b] = order[k];
      if (b - a > maxLen) {
        if (k && acc <= edgeLen && Number.isFinite(v[a])) { if (lead) v.fill(v[a], 0, a); else v.fill(v[a], b); }
        break;
      }
      acc += b - a;
    }
  }
  return v;
}
