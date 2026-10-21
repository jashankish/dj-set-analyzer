/* ============================================================
   Set Replay — the set's shape: its energy arc against the classic
   shapes DJs build sets in.

   setShape(D) resamples the energy curve (curves.energy, 1 s steps, inside
   the set) to N points, each the mean of its slice, smooths it, and scores
   it against seven templates by correlation (r, shown as a 0–100 match,
   negatives as 0):
     slow burn     a steady climb to the end
     peak time     straight up, then held high
     mid-set peak  up to the middle, then down
     wind-down     high first, easing out
     dip & return  a breather in the middle, then back up
     waves         three rises and falls
     tidal         two big swells
   A set whose arc barely moves (spread under 12% of its level) is "level"
   whatever it correlates with. Returns the curve, every match, the best
   and a sentence. No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
const N = 24;
const lin = (f) => Array.from({ length: N }, (_, i) => f(i / (N - 1)));
export const SHAPES = [
  { id: "burn", name: "Slow burn", line: "a steady climb that saves the biggest moments for the end", t: lin((x) => x) },
  { id: "peaktime", name: "Peak time", line: "straight up to full intensity, then held there", t: lin((x) => Math.min(1, x / 0.2)) },
  { id: "mid", name: "Mid-set peak", line: "a build to the middle, then a gentle way out", t: lin((x) => 1 - Math.abs(x - 0.5) * 2) },
  { id: "down", name: "Wind-down", line: "starts high and eases out", t: lin((x) => 1 - x) },
  { id: "dip", name: "Dip & return", line: "a breather in the middle before it comes back up", t: lin((x) => Math.abs(x - 0.5) * 2) },
  { id: "waves", name: "Waves", line: "rises and falls again and again, three times over", t: lin((x) => 0.5 - 0.5 * Math.cos(x * 6 * Math.PI)) },
  { id: "tidal", name: "Tidal", line: "two big swells with a trough between", t: lin((x) => 0.5 - 0.5 * Math.cos(x * 4 * Math.PI)) },
];
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function corr(a, b) {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function setShape(D) {
  const e = (D.curves && D.curves.energy) || {}, v = e.v || [], step = e.step || 1;
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  const i0 = Math.floor(s0 / step), i1 = Math.min(v.length, Math.floor(s1 / step));
  if (i1 - i0 < N * 4) return null;
  let curve = Array.from({ length: N }, (_, k) => {
    const a = i0 + Math.floor(((i1 - i0) * k) / N), b = i0 + Math.floor(((i1 - i0) * (k + 1)) / N);
    return mean(v.slice(a, b).map((x) => x || 0));
  });
  curve = curve.map((x, k) => (curve[k - 1] ?? x) * 0.25 + x * 0.5 + (curve[k + 1] ?? x) * 0.25);
  const lo = Math.min(...curve), hi = Math.max(...curve), lvl = mean(curve);
  const norm = curve.map((x) => (hi > lo ? (x - lo) / (hi - lo) : 0.5));
  const matches = SHAPES.map((s) => ({ id: s.id, name: s.name, line: s.line, t: s.t, r: corr(curve, s.t), match: Math.round(Math.max(0, corr(curve, s.t)) * 100) }))
    .sort((a, b) => b.r - a.r);
  const level = lvl > 0 && (hi - lo) / lvl < 0.12;
  const best = matches[0];
  const pct = (m) => `${m.match}%`;
  const sentence = level
    ? `Level: the energy barely moves, staying within ${Math.round(((hi - lo) / lvl) * 100)}% of its average from start to finish.`
    : best.match < 35
      ? `No classic shape: the closest is ${best.name.toLowerCase()} at only ${pct(best)}, so this set writes its own arc.`
      : `Closest to ${best.name.toLowerCase()} (${pct(best)} match): ${best.line}.${matches[1].match >= best.match - 8 ? ` Close behind: ${matches[1].name.toLowerCase()} (${pct(matches[1])}).` : ""}`;
  return { curve: norm, raw: curve, matches, best: level ? null : best, level, sentence, s0, s1 };
}
