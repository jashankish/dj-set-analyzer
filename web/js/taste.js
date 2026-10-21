/* ============================================================
   Set Replay — your taste, across every set saved here.

   taste(entries) takes [{ title, payload }] (two or more sets), joins
   them end to end (compare.mergePayloads), and writes one playlist prompt
   for the sound they share, with the numbers behind it: how many sets and
   hours, the tempo range, the home keys, and the artists and genres that
   recur. The per-set flow lines ("order it like a DJ set", the mood route)
   are switched off: the arc of several sets glued together means nothing.
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
import { vibeProfile, buildPrompt, defaultOff, say } from "./vibe.js";
import { mergePayloads } from "./compare.js";

export function taste(entries) {
  const sets = (entries || []).filter((e) => e && e.payload && (e.payload.tracks || []).length);
  if (sets.length < 2) return null;
  const merged = sets.map((e) => e.payload).reduce((a, b) => mergePayloads(a, b, "Across your sets"));
  const P = vibeProfile(merged);
  const off = defaultOff(P);
  ["f:flow", "f:mood", "n:len"].forEach((id) => off.add(id));
  const prompt = buildPrompt(P, off);

  const hours = sets.reduce((s, e) => s + (e.payload.summary.set_length || e.payload.duration || 0), 0) / 3600;
  const bpms = sets.map((e) => e.payload.summary.bpm_avg).filter(Boolean);
  const time = {};
  sets.forEach((e) => e.payload.tracks.forEach((t) => { const k = t.key && t.key.camelot; if (k) time[k] = (time[k] || 0) + (t.end - t.start); }));
  const keys = Object.entries(time).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  return {
    sets: sets.length, hours, tracks: merged.tracks.length,
    bpm: bpms.length ? [Math.round(Math.min(...bpms)), Math.round(Math.max(...bpms))] : null,
    keys, artists: P.artists.slice(0, 6), genres: P.genres.slice(0, 3).map((g) => say(g.style)),
    prompt,
  };
}
