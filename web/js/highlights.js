/* ============================================================
   Set Replay — the set's highlights, as a tour and a reel.

   highlights(D, name) gathers the moments the page's analyses single out
   and turns each into something to listen to:
     chapters      where each chapter starts (phases.js)
     drops         the three that land hardest (drops.js)
     the peak      the set's energy peak
     mixes         the longest blend, the boldest key move, the biggest lift (craft.js)
     mood swing    the biggest jump on the mood map (moodmap.js)
     tracks        the one most like the whole set, and the curveball (vibe.trackFit)
   Each has a start, a listening length, a kind, a title and a "why". Moments
   within 25 s of a stronger one are dropped, the rest sorted by time and capped
   at 10, so the reel runs a few minutes. `name(n)` names track n (the page passes
   its own, so visitors' renames show). No DOM: tools/analysis-test.mjs runs it.
   ============================================================ */
import { findPhases } from "./phases.js";
import { dropAnatomy } from "./drops.js";
import { craftProfile } from "./craft.js";
import { moodMap } from "./moodmap.js";
import { trackFit } from "./vibe.js";

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function highlights(D, name = (n) => `track ${n}`) {
  const T = D.tracks || [], M = D.transitions || [];
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  const at = (t) => Math.max(s0, Math.min(s1 - 5, t));
  const out = [];
  const add = (score, h) => out.push({ score, ...h, t: at(h.t), dur: Math.round(h.dur) });

  findPhases(D).forEach((p, i) => {
    if (i) add(60, { kind: "chapter", t: p.start - 4, dur: 20, title: `${p.label} begins`, why: `${Math.round(p.bpm)} BPM, energy ${p.energy.toFixed(1)}: tracks ${p.from}–${p.to}` });
  });
  const A = dropAnatomy(D);
  if (A) A.top.forEach((r, i) => add(90 - i * 8, { kind: "drop", t: r.t - 10, dur: 18, title: i ? "A big drop" : "The biggest drop", why: `${Math.round(r.breakdown_s)} s breakdown, lands ${Math.round(r.impact_db)} dB harder${r.n ? ` (${name(r.n)})` : ""}` }));
  const pk = D.summary && D.summary.peak_t;
  if (pk != null) add(70, { kind: "peak", t: pk - 8, dur: 16, title: "The energy peak", why: `the most intense moment of the set, at ${clock(pk)}` });
  const C = craftProfile(D);
  if (C) {
    const label = { "Longest blend": 75, "Boldest key move": 55, "Biggest lift": 65 };
    C.moments.filter((m) => label[m.what]).forEach((m) => {
      const x = M[m.j];
      add(label[m.what], { kind: "mix", t: x.mix_in - 4, dur: Math.min(30, x.mix_out - x.mix_in + 8), title: m.what, why: `${name(x.from)} into ${name(x.to)}: ${m.detail}`, mix: m.j });
    });
  }
  const mm = moodMap(D);
  if (mm && mm.jump && mm.roam > 0.2) {
    const tr = T.find((t) => t.n === mm.jump.to);
    if (tr) add(45, { kind: "mood", t: tr.start - 6, dur: 18, title: "The biggest mood swing", why: `${name(mm.jump.from)} to ${name(mm.jump.to)}` });
  }
  const F = trackFit(D);
  if (F.length >= 4) {
    const best = F.reduce((a, b) => (b.fit > a.fit ? b : a)), worst = F.reduce((a, b) => (b.fit < a.fit ? b : a));
    const tb = T[best.n - 1], tw = T[worst.n - 1];
    add(50, { kind: "track", t: tb.start + Math.min(40, (tb.end - tb.start) / 3), dur: 20, title: "The set in one track", why: `${name(best.n)}, the closest fit to the whole set (${Math.round(best.fit * 100)}/100)` });
    if (worst.fit < 0.7) add(40, { kind: "track", t: tw.start + Math.min(30, (tw.end - tw.start) / 3), dur: 20, title: "The curveball", why: `${name(worst.n)}${worst.why.length ? `: ${worst.why.join(", ")}` : ""}` });
  }

  // strongest first; drop anything within 25 s of a stronger moment; then in time order
  const kept = [];
  out.sort((a, b) => b.score - a.score).forEach((h) => { if (kept.length < 10 && !kept.some((k) => Math.abs(k.t - h.t) < 25)) kept.push(h); });
  kept.sort((a, b) => a.t - b.t);
  return { items: kept, reel: Math.round(kept.reduce((s, h) => s + h.dur, 0)) };
}
