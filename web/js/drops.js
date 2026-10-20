/* ============================================================
   Set Replay — the anatomy of the set's drops.

   dropAnatomy(D) lines up every drop at the moment it lands (t = 0) and
   reads the low band (the bass line, curves.wave.low) from 32 s before to
   16 s after, so the set's drops can be overlaid: how long the breakdowns
   run, how far the bass is pulled out, how hard it comes back. Returns the
   curves (0–1, every half second), their average, the numbers behind them
   and a sentence. No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */

export const PRE = 32, POST = 16, STEP = 0.5;
const median = (xs) => { const s = xs.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function dropAnatomy(D) {
  const drops = D.drops || [], c = D.curves || {};
  const low = c.wave && c.wave.low, fps = c.wave_fps || 8;
  if (drops.length < 2 || !low || !low.length) return null;
  const T = D.tracks || [];
  const trackAt = (t) => { let k = 0; T.forEach((tr, i) => { if (tr.start <= t) k = i; }); return T[k]; };
  // the bass level around t, averaged over a second so single kicks don't read as the shape
  const at = (t) => {
    const a = Math.round((t - 0.5) * fps), b = Math.round((t + 0.5) * fps);
    if (a < 0 || b >= low.length) return null;
    let s = 0;
    for (let i = a; i <= b; i++) s += low[i];
    return s / (b - a + 1) / 99;
  };
  const xs = [];
  for (let dt = -PRE; dt <= POST + 1e-9; dt += STEP) xs.push(Math.round(dt * 10) / 10);

  const rows = drops.map((d, i) => {
    const tr = trackAt(d.t);
    return { i, t: d.t, n: tr ? tr.n : null, key: tr && tr.key ? tr.key.camelot : null, breakdown_s: d.breakdown_s, depth_db: d.depth_db, impact_db: d.impact_db, curve: xs.map((dt) => at(d.t + dt)) };
  });
  const mean = xs.map((_, k) => { const v = rows.map((r) => r.curve[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });

  const s = D.summary || {};
  const mins = (s.set_length || D.duration || 0) / 60;
  const bpm = s.bpm_avg || 0;
  const bars = (sec) => (bpm ? Math.round((sec * bpm) / 240) : null);    // 4 beats a bar
  const stats = {
    count: drops.length, every: mins ? mins / drops.length : null,
    breakdown: median(drops.map((d) => d.breakdown_s)), depth: median(drops.map((d) => d.depth_db)), impact: median(drops.map((d) => d.impact_db)),
  };
  stats.breakdownBars = bars(stats.breakdown);
  const biggest = rows.reduce((b, r) => ((r.impact_db || 0) > (b.impact_db || 0) ? r : b), rows[0]);
  const longest = rows.reduce((b, r) => ((r.breakdown_s || 0) > (b.breakdown_s || 0) ? r : b), rows[0]);
  const style = stats.breakdown < 10 ? { id: "switch", name: "quick switch-ups", say: "short breakdowns that snap straight back in" }
    : stats.breakdown < 18 ? { id: "build", name: "classic builds", say: "breakdowns of a phrase or two before the drop" }
      : { id: "epic", name: "long builds", say: "long, festival-style builds that hold the tension" };
  const sentence = `${stats.count} drops, about one every ${stats.every >= 1.5 ? `${Math.round(stats.every)} minutes` : `${Math.round(stats.every * 60)} seconds`}: ${style.say}. ` +
    `The typical breakdown lasts ${Math.round(stats.breakdown)} s${stats.breakdownBars ? ` (${stats.breakdownBars} bars)` : ""} and pulls the bass down ${Math.round(stats.depth)} dB before it lands ${Math.round(stats.impact)} dB harder. ` +
    `The biggest hits at ${clock(biggest.t)}${biggest.n ? ` (track ${biggest.n})` : ""}, ${Math.round(biggest.impact_db)} dB.`;
  const top = [...rows].sort((a, b) => (b.impact_db || 0) - (a.impact_db || 0)).slice(0, 3);
  return { xs, rows, mean, stats, style, biggest, longest, top, sentence };
}
