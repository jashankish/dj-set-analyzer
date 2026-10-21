/* ============================================================
   Set Replay — how alike every pair of tracks in the set sounds.

   similarity(D) returns an n × n matrix (0–1) and what stands out in it.
   Two tracks are alike when their styles agree (cosine of the style model's
   top styles, half the weight) and their feel does (1 − the mean gap on the
   vibe axes: tempo, energy, danceable, party, aggressive, bright, vocal,
   minor key; the other half). Read along the diagonal, blocks of high
   values are stretches where the DJ holds one sound; bright cells far from
   it are where the set comes back to an earlier sound.
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
import { trackAxes, AXES } from "./vibe.js";

function cosine(a, b) {
  let ab = 0, aa = 0, bb = 0;
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => { const x = a[k] || 0, y = b[k] || 0; ab += x * y; aa += x * x; bb += y * y; });
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0.5;
}

export function similarity(D) {
  const T = D.tracks || [], n = T.length;
  if (n < 4) return null;
  const st = T.map((t) => Object.fromEntries((t.styles || []).map((s) => [s.style, s.p])));
  const ax = T.map(trackAxes), keys = AXES.map(([k]) => k);
  const M = T.map((_, i) => T.map((__, j) => {
    if (i === j) return 1;
    const feel = 1 - keys.reduce((s, k) => s + Math.abs(ax[i][k] - ax[j][k]), 0) / keys.length;
    return Math.round((0.5 * cosine(st[i], st[j]) + 0.5 * feel) * 1000) / 1000;
  }));

  // the most consistent run: the longest stretch whose every hand-over is in the
  // smoother half of the set (adjacent similarity at or above the median)
  const nb = T.slice(1).map((_, i) => M[i][i + 1]);
  const q = [...nb].sort((x, y) => x - y)[Math.floor(nb.length * 0.5)];
  let run = null;
  for (let i = 0; i < nb.length;) {
    if (nb[i] < q) { i++; continue; }
    let j = i;
    while (j + 1 < nb.length && nb[j + 1] >= q) j++;
    const mean = nb.slice(i, j + 1).reduce((s, x) => s + x, 0) / (j - i + 1);
    if (!run || j - i > run.len || (j - i === run.len && mean > run.mean)) run = { from: T[i].n, to: T[j + 1].n, mean, len: j - i };
    i = j + 1;
  }
  // the set coming back to a sound: the most alike pair at least 4 tracks apart
  let echo = null;
  for (let i = 0; i < n; i++) for (let j = i + 4; j < n; j++) if (!echo || M[i][j] > echo.v) echo = { a: T[i].n, b: T[j].n, v: M[i][j] };
  // the hardest turn: the least alike neighbors
  let turn = null;
  for (let i = 0; i + 1 < n; i++) if (!turn || M[i][i + 1] < turn.v) turn = { a: T[i].n, b: T[i + 1].n, v: M[i][i + 1] };
  const flowAvg = nb.reduce((s, x) => s + x, 0) / nb.length;
  return { n, M, run, echo, turn, flowAvg };
}

/* For each unnamed track, the trusted named track in the set it sounds most
   like: a clue for hunting the ID down (DJs tend to play from one circle).
   Ranked by how much more alike the pair is than that named track is to the
   set in general, so one "generic" track doesn't become everyone's answer;
   shown only when the pair is at least 80% alike. trustOf(track) is 0–1
   (vibe.trust); names under 0.6 aren't used as references. */
export function idClues(D, X = similarity(D), trustOf = () => 1) {
  const T = D.tracks || [], out = {};
  if (!X) return out;
  const avg = T.map((_, j) => T.reduce((s, __, i) => s + (i === j ? 0 : X.M[i][j]), 0) / Math.max(1, T.length - 1));
  T.forEach((t, i) => {
    if (t.identified) return;
    let best = null;
    T.forEach((u, j) => {
      if (j === i || !u.identified || trustOf(u) < 0.6 || X.M[i][j] < 0.8) return;
      const lift = X.M[i][j] - avg[j];
      if (!best || lift > best.lift) best = { n: u.n, v: X.M[i][j], lift };
    });
    if (best) out[t.n] = best;
  });
  return out;
}
