/* ============================================================
   Set Replay — what each track does in the set.

   roles(D, X) gives every track up to two tags, each with a reason, from
   the page's own analyses (the strongest first):
     Opener / Closer   first and last track
     Peak              the highest-energy track
     Lift              energy up 1.5 points or more on the track before
     Breather          1.5+ points under the set's median, between higher tracks
     Core              the two tracks that sound most like the whole set (fit 90+)
     Curveball         the two that sound least like it (fit under 60)
     Echo              comes back to an earlier track's sound (similarity.js)
     Key bridge        a different key that mixes cleanly in from the track
                       before and out to the one after
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
import { trackFit } from "./vibe.js";
import { harmonicRelation } from "./engine/music.js";

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function roles(D, X = null) {
  const T = D.tracks || [], n = T.length, out = {};
  if (n < 3) return out;
  const add = (tr, w, tag, why) => (out[tr.n] = out[tr.n] || []).push({ w, tag, why });
  const e = T.map((t) => t.energy || 0), med = median(e);
  const fits = trackFit(D), F = new Map(fits.map((f) => [f.n, f]));
  // only the two clearest of each, so the tags keep their meaning
  const byFit = [...fits].sort((a, b) => a.fit - b.fit);
  const curve = new Set(byFit.filter((f) => f.fit < 0.6).slice(0, 2).map((f) => f.n));
  const core = new Set(byFit.reverse().filter((f) => f.fit >= 0.9).slice(0, 2).map((f) => f.n));
  const key = (t) => t.key && t.key.camelot;

  add(T[0], 3, "Opener", "the first track of the set");
  add(T[n - 1], 3, "Closer", "the last track of the set");
  const pk = e.indexOf(Math.max(...e));
  add(T[pk], 9, "Peak", `the most energetic track (${e[pk].toFixed(1)}/10)`);
  T.forEach((t, i) => {
    if (i && e[i] - e[i - 1] >= 1.5 && i !== pk) add(t, 6, "Lift", `energy up ${(e[i] - e[i - 1]).toFixed(1)} on the track before`);
    if (i && i < n - 1 && med - e[i] >= 1.5 && e[i - 1] > e[i] && e[i + 1] > e[i]) add(t, 6, "Breather", `energy ${e[i].toFixed(1)}, between ${e[i - 1].toFixed(1)} and ${e[i + 1].toFixed(1)}`);
    const f = F.get(t.n);
    if (f && n >= 4) {
      if (core.has(t.n)) add(t, 5, "Core", `sounds most like the whole set (fit ${Math.round(f.fit * 100)})`);
      else if (curve.has(t.n)) add(t, 7, "Curveball", `sounds unlike the rest${f.why.length ? `: ${f.why.join(", ")}` : ""} (fit ${Math.round(f.fit * 100)})`);
    }
    if (i && i < n - 1 && key(t) && key(T[i - 1]) && key(T[i + 1]) && key(t) !== key(T[i - 1]) && key(t) !== key(T[i + 1]) && key(T[i - 1]) !== key(T[i + 1]) &&
      harmonicRelation(key(T[i - 1]), key(t)).compatible === true && harmonicRelation(key(t), key(T[i + 1])).compatible === true &&
      harmonicRelation(key(T[i - 1]), key(T[i + 1])).compatible !== true) {
      add(t, 4, "Key bridge", `${key(T[i - 1])} → ${key(t)} → ${key(T[i + 1])}: carries the set between keys that don't mix directly`);
    }
  });
  if (X && X.echo) add(T[X.echo.b - 1], 5, "Echo", `comes back to the sound of track ${X.echo.a} (${Math.round(X.echo.v * 100)}% alike)`);
  Object.keys(out).forEach((k) => (out[k] = out[k].sort((a, b) => b.w - a.w).slice(0, 2)));
  return out;
}
