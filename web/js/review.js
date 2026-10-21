/* ============================================================
   Set Replay — a written review of the set, and a scorecard.

   review(D, name) composes what every other analysis found into three
   short paragraphs (what it is, the journey, the craft) and scores five
   things out of 10. The scores describe the set; they don't judge taste:
     Mixing     mean smoothness of the mixes (craft.mixScore)
     Harmony    mixes in compatible keys, bolder moves counted half
     Flow       how alike neighboring tracks sound (similarity.js)
     Dynamics   how far the energy travels (track energy, 10th to 90th
                percentile) and how often drops land
     Variety    how many keys it visits and how different its tracks are
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
import { vibeProfile, say } from "./vibe.js";
import { craftProfile } from "./craft.js";
import { similarity } from "./similarity.js";
import { findPhases } from "./phases.js";
import { dropAnatomy } from "./drops.js";

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const r1 = (x) => Math.round(x * 10) / 10;
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const pct = (q, xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

export function review(D, name = (n) => `track ${n}`) {
  const T = D.tracks || [], s = D.summary || {};
  if (T.length < 4) return null;
  const P = vibeProfile(D), C = craftProfile(D), X = similarity(D), ph = findPhases(D), A = dropAnatomy(D);
  const mins = Math.round((s.set_length || D.duration) / 60);

  /* ---------- the scorecard */
  const keys = new Set(T.map((t) => t.key && t.key.camelot).filter(Boolean)).size;
  const off = X ? X.M.flatMap((r, i) => r.filter((_, j) => j !== i)) : [];
  const meanAll = off.length ? off.reduce((a, b) => a + b, 0) / off.length : 0.75;
  const e = T.map((t) => t.energy || 0);
  const spread = pct(0.9, e) - pct(0.1, e);
  const dropsPerHour = ((D.drops || []).length / Math.max(1, mins)) * 60;
  const scores = [
    { id: "mixing", label: "Mixing", v: C ? C.stats.smooth / 10 : null, why: C ? `mixes average ${C.stats.smooth}/100 for smoothness` : "" },
    { id: "harmony", label: "Harmony", v: C ? (C.stats.harmonicPct + C.stats.partialPct / 2) / 10 : null, why: C ? `${C.stats.harmonicPct}% of mixes in compatible keys${C.stats.partialPct ? `, ${C.stats.partialPct}% bolder moves` : ""}` : "" },
    { id: "flow", label: "Flow", v: X ? 10 * clamp01((X.flowAvg - 0.5) / 0.4) : null, why: X ? `neighboring tracks sound ${Math.round(X.flowAvg * 100)}% alike` : "" },
    { id: "dynamics", label: "Dynamics", v: 10 * (0.7 * clamp01(spread / 5) + 0.3 * clamp01(dropsPerHour / 30)), why: `energy travels ${spread.toFixed(1)} points; ${Math.round(dropsPerHour)} drops an hour` },
    { id: "variety", label: "Variety", v: 10 * (0.5 * clamp01((keys - 1) / 7) + 0.5 * clamp01((1 - meanAll) / 0.4)), why: `${keys} keys; tracks ${Math.round(meanAll * 100)}% alike on average` },
  ].filter((x) => x.v != null).map((x) => ({ ...x, v: r1(Math.min(10, Math.max(0, x.v))) }));
  const overall = r1(scores.reduce((a, x) => a + x.v, 0) / scores.length);

  /* ---------- what it is */
  const genres = P.genres.slice(0, 2).map((g) => say(g.style));
  const artists = P.artists.slice(0, 3);
  const moods = P.chips.filter((c) => c.group === "Mood" && c.on).slice(0, 2).map((c) => c.text);
  const p1 = `A ${mins}-minute ${genres.length ? list(genres) : "electronic"} set${P.bpm ? ` at ${Math.round(P.bpm)} BPM` : ""}${moods.length ? `, ${list(moods)}` : ""}.` +
    (artists.length ? ` It leans on ${list(artists)}${P.labels.length ? `, the ${list(P.labels)} sound` : ""}.` : " Most of it is unnamed, so it speaks through its sound rather than its names.");

  /* ---------- the journey */
  const j = [];
  const words = ["", "one", "two", "three", "four", "five"];
  if (ph.length > 1) j.push(`It runs in ${words[ph.length] || ph.length} chapters, ${list(ph.map((p) => `${p.label.toLowerCase()} (tracks ${p.from}–${p.to})`))}.`);
  else j.push(`It holds one level from start to finish rather than building in chapters.`);
  // the prompt says it as an instruction ("open dark, turn euphoric, and end warmer"); say it as a description
  if (P.mood) j.push(`The mood ${P.mood.say.replace(/^keep the mood/, "stays").replace(/^open /, "opens ").replace(/, turn /, ", turns ").replace(/and end /, "and ends ")}.`);
  if (A) j.push(`Its drops are ${A.style.name}: ${A.stats.count} of them, the typical breakdown ${Math.round(A.stats.breakdown)} s, the biggest at ${Math.floor(A.biggest.t / 60)}:${String(Math.floor(A.biggest.t % 60)).padStart(2, "0")}.`);
  if (X && X.echo) j.push(`It comes back to an earlier sound when ${name(X.echo.b)} answers ${name(X.echo.a)}.`);
  const p2 = j.join(" ");

  /* ---------- the craft */
  const k = [];
  if (C) {
    k.push(`At the decks it's ${C.style.name.toLowerCase()}: ${C.style.line.charAt(0).toLowerCase()}${C.style.line.slice(1)}`);
    const best = C.moments.find((m) => m.what === "Longest blend"), rough = C.moments.find((m) => m.what === "Roughest mix");
    if (best) k.push(`The longest blend, ${best.from} into ${best.to}, runs ${best.detail}.`);
    if (rough) k.push(`The roughest hand-over is ${rough.from} into ${rough.to}, at ${rough.detail.split(":")[0]}.`);
  }
  const p3 = k.join(" ");

  const verdict = overall >= 8 ? "A polished, carefully built set." : overall >= 6.5 ? "A well-mixed set with a clear shape." : overall >= 5 ? "A set with real moments and some rough edges." : "A raw, adventurous set that takes its chances.";
  return { scores, overall, verdict, paragraphs: [p1, p2, p3].filter(Boolean) };
}
