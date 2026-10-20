/* ============================================================
   Set Replay — two sets side by side.

   compareSets(A, B) (two payloads) returns:
     score      0–100 similarity, the weighted mean of four parts:
                sound (style shares, cosine), feel (the vibe axes),
                tempo (BPM gap) and artists (shared, trust-weighted)
     parts      each part 0–1, for the breakdown bars
     genres     trusted genres in both / only in A / only in B
     artists    artists in both
     diffs      the biggest differences, as sentences
     axes       the vibe fingerprint of each, for the overlaid radar
   mergePayloads(A, B) joins two sets end to end (tracks renumbered,
   curves and drops shifted, summary re-weighted by length), so vibe.js
   can write one "blend" prompt for a playlist covering both.
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
import { vibeProfile, AXES } from "./vibe.js";

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const len = (D) => (D.summary && D.summary.set_length) || D.duration || 1;

function cosine(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let ab = 0, aa = 0, bb = 0;
  keys.forEach((k) => { const x = a[k] || 0, y = b[k] || 0; ab += x * y; aa += x * x; bb += y * y; });
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

const AXIS_WORDS = {
  tempo: ["faster", "slower"], energy: ["more energetic", "calmer"], dance: ["more danceable", "less danceable"],
  party: ["more party-ready", "less party-ready"], aggr: ["more aggressive", "gentler"], happy: ["brighter", "darker"],
  vocal: ["more vocal", "more instrumental"], minor: ["more minor-key", "more major-key"],
};

export function compareSets(A, B, titles = {}) {
  const PA = vibeProfile(A), PB = vibeProfile(B);
  const ta = titles.a || A.title, tb = titles.b || B.title;

  // sound: style shares as vectors
  const styles = (D) => Object.fromEntries(((D.summary && D.summary.styles) || []).map((s) => [s.style, s.share]));
  const sound = cosine(styles(A), styles(B));
  // feel: 1 - mean absolute gap over the vibe axes (tempo left to its own part)
  const feelAxes = AXES.map(([k]) => k).filter((k) => k !== "tempo");
  const feel = 1 - feelAxes.reduce((s, k) => s + Math.abs((PA.axes[k] || 0) - (PB.axes[k] || 0)), 0) / feelAxes.length;
  // tempo: 0 BPM apart → 1, 30+ apart → 0
  const gap = Math.abs((PA.bpm || 0) - (PB.bpm || 0));
  const tempo = clamp01(1 - gap / 30);
  // artists: shared artists, over the smaller artist list
  const shared = PA.artists.filter((a) => PB.artists.includes(a));
  const artists = PA.artists.length && PB.artists.length ? shared.length / Math.min(PA.artists.length, PB.artists.length) : null;

  const parts = { sound, feel, tempo, artists };
  const W = { sound: 0.35, feel: 0.3, tempo: 0.2, artists: 0.15 };
  let s = 0, w = 0;
  Object.entries(parts).forEach(([k, v]) => { if (v != null) { s += W[k] * v; w += W[k]; } });
  const score = Math.round((100 * s) / w);

  const gA = PA.genres.map((g) => g.style), gB = PB.genres.map((g) => g.style);
  const genres = { both: gA.filter((g) => gB.includes(g)), onlyA: gA.filter((g) => !gB.includes(g)), onlyB: gB.filter((g) => !gA.includes(g)) };

  /* the three biggest differences on the vibe axes, said in words */
  const diffs = AXES.map(([k, label]) => ({ k, label, d: (PA.axes[k] || 0) - (PB.axes[k] || 0) }))
    .filter((x) => (x.k === "tempo" ? gap >= 4 : Math.abs(x.d) >= 0.08))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3)
    .map((x) => {
      const [more, less] = AXIS_WORDS[x.k];
      const fmtv = (P) => (x.k === "tempo" ? `${Math.round(P.bpm)} BPM` : x.k === "energy" ? `${((P.axes.energy || 0) * 10).toFixed(1)}/10` : `${Math.round((P.axes[x.k] || 0) * 100)}%`);
      return `${ta} is ${x.d > 0 ? more : less} (${fmtv(PA)} vs ${fmtv(PB)}).`;
    });
  if (genres.onlyA.length || genres.onlyB.length) {
    const say = (g) => g.join(" and ").toLowerCase().replace("drum n bass", "drum & bass");
    diffs.push([genres.onlyA.length ? `Only ${ta} leans ${say(genres.onlyA)}` : "", genres.onlyB.length ? `only ${tb} leans ${say(genres.onlyB)}` : ""].filter(Boolean).join("; ").replace(/^o/, "O") + ".");
  }

  const verdict = score >= 85 ? "Close siblings" : score >= 70 ? "Same world" : score >= 50 ? "Related" : "Different nights";
  return { score, verdict, parts, genres, artists: shared, diffs, axes: { a: PA.axes, b: PB.axes }, bpm: { a: PA.bpm, b: PB.bpm } };
}

/* both sets as one, end to end, for a blend prompt */
export function mergePayloads(A, B, title) {
  const off = len(A) + ((A.summary && A.summary.set_start) || 0);
  const shift = (t) => t + off - ((B.summary && B.summary.set_start) || 0);
  const nA = A.tracks.length;
  const la = len(A), lb = len(B), wa = la / (la + lb), wb = lb / (la + lb);
  const styleMap = {};
  [[A, wa], [B, wb]].forEach(([D, w]) => ((D.summary && D.summary.styles) || []).forEach((s) => (styleMap[s.style] = (styleMap[s.style] || 0) + s.share * w)));
  const sa = A.summary || {}, sb = B.summary || {};
  const avg = (k) => (sa[k] != null && sb[k] != null ? sa[k] * wa + sb[k] * wb : sa[k] != null ? sa[k] : sb[k]);
  const eA = (A.curves && A.curves.energy && A.curves.energy.v) || [], eB = (B.curves && B.curves.energy && B.curves.energy.v) || [];
  const s0B = Math.round((sb.set_start) || 0), s1B = Math.round(sb.set_end || eB.length);
  const s1A = Math.round(sa.set_end || eA.length);
  return {
    ...A,
    title: title || `${A.title} + ${B.title}`,
    duration: off + lb,
    tracks: [...A.tracks, ...B.tracks.map((t) => ({ ...t, n: t.n + nA, start: shift(t.start), end: shift(t.end) }))],
    drops: [...(A.drops || []), ...(B.drops || []).map((d) => ({ ...d, t: shift(d.t) }))],
    transitions: [],
    curves: { ...A.curves, energy: { ...((A.curves && A.curves.energy) || {}), v: [...eA.slice(0, s1A), ...new Array(Math.max(0, Math.round(off) - s1A)).fill(0), ...eB.slice(s0B, s1B)] } },
    summary: {
      ...sa,
      tracks: nA + B.tracks.length, identified: (sa.identified || 0) + (sb.identified || 0),
      bpm_avg: avg("bpm_avg"), bpm_min: Math.min(sa.bpm_min ?? Infinity, sb.bpm_min ?? Infinity), bpm_max: Math.max(sa.bpm_max ?? -Infinity, sb.bpm_max ?? -Infinity),
      vocal_pct: avg("vocal_pct") != null ? Math.round(avg("vocal_pct")) : undefined, harmonic_pct: avg("harmonic_pct") != null ? Math.round(avg("harmonic_pct")) : undefined,
      set_start: sa.set_start || 0, set_end: off + (s1B - s0B), set_length: la + lb,
      styles: Object.entries(styleMap).map(([style, share]) => ({ style, share })).sort((x, y) => y.share - x.share).slice(0, 8),
    },
  };
}
