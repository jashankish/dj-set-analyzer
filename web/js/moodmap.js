/* ============================================================
   Set Replay — the mood map: where each track sits emotionally.

   Music-emotion research places a song on two axes: valence (dark ↔
   bright) and arousal (calm ↔ intense). moodMap(D) gives every track
     v  valence = 0.75 · happy + 0.25 · major key
     a  arousal = 0.6 · energy + 0.25 · aggressive + 0.15 · party
   and, because room recordings compress every score toward the middle,
   splits the map at the set's own medians: a quadrant means "brighter /
   more intense than this set's usual", not an absolute label.
   It also returns time per quadrant and a sentence about the route.
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */

export const QUADS = {
  euphoric: { name: "Euphoric", hint: "brighter and more intense" },
  intense: { name: "Intense", hint: "darker and more intense" },
  warm: { name: "Warm", hint: "brighter and calmer" },
  brooding: { name: "Brooding", hint: "darker and calmer" },
};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function moodMap(D) {
  const T = (D.tracks || []).filter((t) => t.moods);
  if (T.length < 3) return null;
  const pts = T.map((t) => {
    const m = t.moods, major = t.key && t.key.camelot ? (t.key.camelot.endsWith("B") ? 1 : 0) : 0.5;
    return {
      n: t.n, len: Math.max(1, t.end - t.start),
      v: 0.75 * (m.mood_happy || 0) + 0.25 * major,
      a: 0.6 * Math.min(1, (t.energy || 0) / 10) + 0.25 * (m.mood_aggressive || 0) + 0.15 * (m.mood_party || 0),
    };
  });
  const mv = median(pts.map((p) => p.v)), ma = median(pts.map((p) => p.a));
  const quad = (p) => (p.a >= ma ? (p.v >= mv ? "euphoric" : "intense") : (p.v >= mv ? "warm" : "brooding"));
  pts.forEach((p) => (p.q = quad(p)));

  // axis domains: the data's range, padded, so the cloud fills the square
  const pad = (lo, hi) => { const r = Math.max(0.08, hi - lo); return [lo - r * 0.12, hi + r * 0.12]; };
  const vd = pad(Math.min(...pts.map((p) => p.v)), Math.max(...pts.map((p) => p.v)));
  const ad = pad(Math.min(...pts.map((p) => p.a)), Math.max(...pts.map((p) => p.a)));

  const total = pts.reduce((s, p) => s + p.len, 0);
  const share = Object.fromEntries(Object.keys(QUADS).map((q) => [q, pts.filter((p) => p.q === q).reduce((s, p) => s + p.len, 0) / total]));
  const home = Object.entries(share).sort((a, b) => b[1] - a[1])[0][0];

  /* the route: where it starts, where it lives, where it ends, how far it roams */
  const thirds = [0, 1, 2].map((k) => {
    const part = pts.slice(Math.floor((pts.length * k) / 3), Math.floor((pts.length * (k + 1)) / 3));
    const c = {};
    part.forEach((p) => (c[p.q] = (c[p.q] || 0) + p.len));
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  });
  const name = (q) => QUADS[q].name.toLowerCase();
  let route;
  if (thirds[0] === thirds[2] && thirds[1] === thirds[0]) route = `It stays ${name(home)} from start to finish.`;
  else if (thirds[0] === thirds[2]) route = `It opens ${name(thirds[0])}, detours through ${name(thirds[1])} mid-set and comes home to ${name(thirds[2])}.`;
  else route = `It opens ${name(thirds[0])}${thirds[1] !== thirds[0] && thirds[1] !== thirds[2] ? `, moves through ${name(thirds[1])}` : ""} and ends ${name(thirds[2])}.`;
  const steps = pts.slice(1).map((p, i) => Math.hypot((p.v - pts[i].v) / (vd[1] - vd[0]), (p.a - pts[i].a) / (ad[1] - ad[0])));
  const roam = steps.length ? steps.reduce((s, x) => s + x, 0) / steps.length : 0;
  const jump = steps.indexOf(Math.max(...steps));
  const lead = share[home] >= 0.4
    ? `Most of the set (${Math.round(share[home] * 100)}%) is ${name(home)}: ${QUADS[home].hint} than its usual.`
    : `It spreads across all four corners; the largest share (${Math.round(share[home] * 100)}%) is ${name(home)}, ${QUADS[home].hint} than its usual.`;
  const sentence = `${lead} ${route}` +
    (roam > 0.35 ? " Track to track it swings widely." : roam < 0.18 ? " Track to track it moves in small steps." : "");

  return { points: pts, median: { v: mv, a: ma }, domain: { v: vd, a: ad }, share, home, thirds, roam, jump: jump >= 0 ? { from: pts[jump].n, to: pts[jump + 1].n } : null, sentence };
}
