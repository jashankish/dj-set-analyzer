/* ============================================================
   Set Replay — the set's chapters (warm-up, build, peak, breather, close).

   findPhases(D) splits the set, on track boundaries, into 1–5 phases:
     each track is a point (energy, tempo), weighted by its length;
     dynamic programming finds, for every phase count K, the split with the
     least within-phase spread; K is chosen where one more phase stops
     paying for itself (a penalty per phase), and no phase may be shorter
     than max(2.5 min, 10% of the set).
   Each phase is then named from its energy against its neighbors and
   its place in the set, and measured (tempo, energy, styles, moods, keys).
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/* the point each track contributes: energy (0–1) and tempo, on comparable scales */
function point(tr) {
  return [(tr.energy || 0) / 10, tr.bpm ? Math.min(1, Math.max(0, (tr.bpm - 70) / 115)) * 0.8 : 0];
}

/* best split of tracks[0..n) into K contiguous groups for K = 1..kMax */
function partition(X, w, kMax, minLen, len) {
  const n = X.length, D = X[0].length;
  // prefix sums for O(1) weighted spread of any range
  const W = [0], S = [new Array(D).fill(0)], Q = [0], L = [0];
  for (let i = 0; i < n; i++) {
    W.push(W[i] + w[i]);
    S.push(S[i].map((v, d) => v + w[i] * X[i][d]));
    Q.push(Q[i] + w[i] * X[i].reduce((a, x) => a + x * x, 0));
    L.push(L[i] + len[i]);
  }
  const cost = (a, b) => {                                   // tracks a..b-1
    if (L[b] - L[a] < minLen) return Infinity;
    const ww = W[b] - W[a];
    if (ww <= 0) return 0;
    let s2 = 0;
    for (let d = 0; d < D; d++) { const s = S[b][d] - S[a][d]; s2 += s * s; }
    return Q[b] - Q[a] - s2 / ww;
  };
  const best = [], back = [];
  best[1] = []; back[1] = [];
  for (let b = 1; b <= n; b++) best[1][b] = cost(0, b);
  for (let k = 2; k <= kMax; k++) {
    best[k] = []; back[k] = [];
    for (let b = 1; b <= n; b++) {
      best[k][b] = Infinity;
      for (let a = k - 1; a < b; a++) {
        const c = best[k - 1][a] + cost(a, b);
        if (c < best[k][b]) { best[k][b] = c; back[k][b] = a; }
      }
    }
  }
  const out = [];
  for (let k = 1; k <= kMax; k++) {
    if (!isFinite(best[k][n])) break;
    const cuts = [];
    let b = n;
    for (let kk = k; kk > 1; kk--) { const a = back[kk][b]; cuts.unshift(a); b = a; }
    out.push({ k, cost: best[k][n], cuts });
  }
  return out;
}

export function findPhases(D) {
  const s = D.summary || {}, T = D.tracks || [];
  if (!T.length) return [];
  const s0 = s.set_start || 0, s1 = s.set_end || D.duration;
  const len = T.map((t) => Math.max(1, Math.min(t.end, s1) - Math.max(t.start, s0)));
  const total = len.reduce((a, b) => a + b, 0);
  const w = len.map((l) => l / total);
  const X = T.map(point);
  // (never longer than the recording: a 2-minute song is still one chapter, not none)
  const minLen = Math.min(total, Math.max(150, 0.1 * total));
  const fits = partition(X, w, Math.min(5, T.length), minLen, len);
  const spread = fits[0].cost;
  // a phase must remove at least 18% of the set's spread (and a bit more for each extra one)
  let pick = fits[0];
  for (const f of fits.slice(1)) if (pick.cost - f.cost > spread * (0.18 + 0.03 * f.k)) pick = f;

  const bounds = [0, ...pick.cuts, T.length];
  const phases = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const tr = T.slice(bounds[i], bounds[i + 1]);
    const ws = len.slice(bounds[i], bounds[i + 1]);
    const wsum = ws.reduce((a, b) => a + b, 0);
    const wavg = (f) => tr.reduce((a, t, j) => a + (f(t) || 0) * ws[j], 0) / wsum;
    phases.push({
      i, from: tr[0].n, to: tr[tr.length - 1].n,
      start: Math.max(tr[0].start, s0), end: Math.min(tr[tr.length - 1].end, s1),
      energy: wavg((t) => t.energy), bpm: wavg((t) => t.bpm),
    });
  }
  name(phases);
  phases.forEach((p) => measure(D, p));
  return phases;
}

/* names from shape: the highest is the peak, a low first phase is a warm-up, … */
function name(P) {
  const n = P.length;
  if (n === 1) { P[0].label = "The whole set"; P[0].role = "steady"; return; }
  const e = P.map((p) => p.energy), m = mean(e);
  const peak = e.indexOf(Math.max(...e));
  P.forEach((p, i) => {
    const prev = i ? e[i - 1] : null, next = i < n - 1 ? e[i + 1] : null;
    let label, role;
    const tempoJump = i && Math.abs(p.bpm - P[i - 1].bpm) >= 8;
    if (i === peak && e[i] >= m) { label = "Peak"; role = "peak"; }
    else if (i === 0) { label = e[i] < e[1] ? "Warm-up" : "Opening"; role = e[i] < e[1] ? "warmup" : "opening"; }
    else if (i === n - 1) { label = e[i] < prev ? "Cool-down" : "Finale"; role = e[i] < prev ? "cooldown" : "finale"; }
    else if (e[i] < prev && e[i] < next) { label = "Breather"; role = "breather"; }
    else if (i < peak) { label = "Build"; role = "build"; }
    else if (e[i] > prev) { label = "Second wind"; role = "second"; }
    else { label = "Comedown"; role = "comedown"; }
    if (tempoJump && role !== "peak") label = `${label} · tempo ${p.bpm > P[i - 1].bpm ? "up" : "down"}`;
    p.label = label; p.role = role;
  });
  // two phases can't share a name: number repeats ("Build 2")
  const seen = {};
  P.forEach((p) => { seen[p.label] = (seen[p.label] || 0) + 1; if (seen[p.label] > 1) p.label = `${p.label} ${seen[p.label]}`; });
}

const MOODS = ["danceability", "mood_party", "mood_aggressive", "mood_happy", "voice_instrumental"];
function measure(D, p) {
  const c = D.curves || {};
  // styles: mean share over the phase's 30 s windows
  if (c.styles && c.styles.v && c.styles.v.length) {
    const rows = c.styles.v.filter((_, i) => { const t = i * c.styles.step + c.styles.step / 2; return t >= p.start && t < p.end; });
    const avg = c.styles.names.map((_, j) => mean(rows.map((r) => r[j] || 0)));
    p.styles = c.styles.names.map((style, j) => ({ style, share: avg[j] })).filter((x) => x.style !== "Other").sort((a, b) => b.share - a.share);
  } else p.styles = [];
  p.moods = {};
  if (c.moods && c.moods.v) MOODS.forEach((k) => {
    const v = c.moods.v[k];
    if (v) p.moods[k] = mean(v.filter((_, i) => { const t = i * c.moods.step + c.moods.step / 2; return t >= p.start && t < p.end; }).map((x) => x || 0));
  });
  const keys = {};
  D.tracks.filter((t) => t.n >= p.from && t.n <= p.to).forEach((t) => { const k = t.key && t.key.camelot; if (k) keys[k] = (keys[k] || 0) + (t.end - t.start); });
  p.keys = Object.entries(keys).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  p.drops = (D.drops || []).filter((d) => d.t >= p.start && d.t < p.end).length;
}

/* a short stretch around track index i (it and one either side), measured like a
   phase, so a prompt can be written for "this part" of the set */
export function around(D, i) {
  const T = D.tracks || [];
  if (!T.length) return null;
  const c = Math.max(0, Math.min(T.length - 1, i | 0));
  const a = T[Math.max(0, c - 1)], b = T[Math.min(T.length - 1, c + 1)];
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  const p = { from: a.n, to: b.n, center: T[c].n, start: Math.max(a.start, s0), end: Math.min(b.end, s1), label: a.n === b.n ? `Track ${a.n}` : `Tracks ${a.n}–${b.n}` };
  measure(D, p);
  return p;
}

/* a payload cut down to one phase, so vibe.js can write a prompt for just that part */
export function slicePayload(D, p) {
  const T = D.tracks.filter((t) => t.n >= p.from && t.n <= p.to);
  const bpms = T.map((t) => t.bpm).filter(Boolean);
  const len = (t) => Math.max(1, Math.min(t.end, p.end) - Math.max(t.start, p.start));
  const wsum = T.reduce((a, t) => a + len(t), 0);
  const voice = (D.curves && D.curves.moods && D.curves.moods.v && D.curves.moods.v.voice_instrumental) || [];
  const step = (D.curves && D.curves.moods && D.curves.moods.step) || 10;
  const vin = voice.filter((_, i) => { const t = i * step + step / 2; return t >= p.start && t < p.end; });
  return {
    ...D,
    title: `${D.title} · ${p.label}`,
    tracks: T,
    drops: (D.drops || []).filter((d) => d.t >= p.start && d.t < p.end),
    summary: {
      ...D.summary,
      tracks: T.length, identified: T.filter((t) => t.identified).length,
      bpm_avg: wsum ? T.reduce((a, t) => a + (t.bpm || 0) * len(t), 0) / wsum : D.summary.bpm_avg,
      bpm_min: bpms.length ? Math.min(...bpms) : D.summary.bpm_min,
      bpm_max: bpms.length ? Math.max(...bpms) : D.summary.bpm_max,
      set_start: p.start, set_end: p.end, set_length: p.end - p.start,
      vocal_pct: vin.length ? Math.round((100 * vin.filter((x) => x > 0.5).length) / vin.length) : D.summary.vocal_pct,
      styles: (p.styles || []).map(({ style, share }) => ({ style, share })),
    },
  };
}
