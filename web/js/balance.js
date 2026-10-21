/* ============================================================
   Set Replay — frequency balance: how the sound splits between bass,
   mids and highs, over the set and track by track.

   soundBalance(D) reads the waveform's three bands (curves.wave: low, mid,
   high, per frame) and returns
     bins    { t0, t1, low, mid, high }: each band's share of the sound
             (the three sum to 1) in ~20 s windows, lightly smoothed;
             near-silent windows are skipped
     tracks  each track's shares and its lean against the set's own
             average: "bass-heavy", "bright", "mid-forward" or "balanced"
     mean, heaviest, brightest, trend, sentence
   Absolute band levels differ from one recording to the next, so leans are
   judged against the set itself, never a fixed threshold.
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
const BANDS = ["low", "mid", "high"];
const avg = (a, i, j) => { let s = 0; for (let k = i; k < j; k++) s += a[k] || 0; return j > i ? s / (j - i) : 0; };

function shares(w, i, j) {
  const v = BANDS.map((b) => avg(w[b], i, j)), s = v[0] + v[1] + v[2];
  return s < 1.5 ? null : { low: v[0] / s, mid: v[1] / s, high: v[2] / s, level: s };
}

export function soundBalance(D, { bin = 20 } = {}) {
  const C = D.curves || {}, w = C.wave, fps = C.wave_fps;
  if (!w || !fps || !(w.low && w.mid && w.high)) return null;
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  const n = Math.max(1, Math.round((s1 - s0) / bin)), step = (s1 - s0) / n;
  let bins = [];
  for (let i = 0; i < n; i++) {
    const t0 = s0 + i * step, sh = shares(w, Math.floor(t0 * fps), Math.floor((t0 + step) * fps));
    if (sh) bins.push({ t0, t1: t0 + step, ...sh });
  }
  if (bins.length < 3) return null;
  // smooth over neighbors (1-2-1) so a single kick-free bar doesn't spike the chart
  bins = bins.map((b, i) => {
    const a = bins[i - 1] || b, c = bins[i + 1] || b, o = { t0: b.t0, t1: b.t1 };
    BANDS.forEach((k) => (o[k] = (a[k] + 2 * b[k] + c[k]) / 4));
    return o;
  });

  // the set's own average, weighted by time
  const mean = {};
  BANDS.forEach((k) => (mean[k] = bins.reduce((s, b) => s + b[k], 0) / bins.length));

  const tracks = (D.tracks || []).map((t) => {
    const sh = shares(w, Math.floor(Math.max(t.start, s0) * fps), Math.floor(Math.min(t.end, s1) * fps));
    if (!sh) return null;
    const d = { low: sh.low - mean.low, mid: sh.mid - mean.mid, high: sh.high - mean.high };
    const top = BANDS.reduce((a, b) => (d[b] > d[a] ? b : a));
    const lean = d[top] < 0.04 ? "balanced" : { low: "bass-heavy", mid: "mid-forward", high: "bright" }[top];
    return { n: t.n, start: t.start, end: t.end, low: sh.low, mid: sh.mid, high: sh.high, lean, d };
  }).filter(Boolean);
  if (!tracks.length) return null;

  const heaviest = tracks.reduce((a, b) => (b.low > a.low ? b : a));
  const brightest = tracks.reduce((a, b) => (b.high > a.high ? b : a));
  // trend: the highs' share, first third against last third
  const third = Math.max(1, Math.floor(bins.length / 3));
  const hi0 = bins.slice(0, third).reduce((s, b) => s + b.high, 0) / third;
  const hi1 = bins.slice(-third).reduce((s, b) => s + b.high, 0) / third;
  const lo0 = bins.slice(0, third).reduce((s, b) => s + b.low, 0) / third;
  const lo1 = bins.slice(-third).reduce((s, b) => s + b.low, 0) / third;
  const trend = hi1 - hi0 > 0.03 ? "brighter" : hi0 - hi1 > 0.03 ? (lo1 - lo0 > 0.03 ? "heavier" : "darker") : lo1 - lo0 > 0.03 ? "heavier" : "steady";
  const counts = {};
  tracks.forEach((t) => (counts[t.lean] = (counts[t.lean] || 0) + 1));
  const pc = (x) => `${Math.round(x * 100)}%`;
  const ends = { brighter: "it gets brighter toward the end", darker: "it gets darker toward the end", heavier: "the bass takes over toward the end", steady: "the balance holds steady from start to finish" }[trend];
  const sentence = `On average ${pc(mean.low)} bass, ${pc(mean.mid)} mids, ${pc(mean.high)} highs, and ${ends}.` +
    ` ${counts["bass-heavy"] || 0} bass-heavy track${counts["bass-heavy"] === 1 ? "" : "s"}, ${counts.bright || 0} bright, ${counts["mid-forward"] || 0} mid-forward.`;
  return { bins, tracks, mean, heaviest, brightest, trend, counts, sentence, s0, s1 };
}
