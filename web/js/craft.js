/* ============================================================
   Set Replay — how the set was mixed.

   craftProfile(D) reads the transitions and returns:
     stats      mix length (median bars and seconds), harmonic share,
                bass-swap share, tempo riding, energy lifts vs. drops
     style      the DJ's mixing archetype (the best-scoring of six), with
                a sentence of evidence
     relations  how many mixes made each key move (same key, energy up, …)
     types      how many mixes of each type (bass swap, long blend, …)
     moments    the set's signature mixes: longest blend, deepest bass
                swap, biggest lift, boldest key move
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */

import { harmonicRelation } from "./engine/music.js";

const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

/* key moves in the order a DJ would rank them, smoothest first */
export const RELATIONS = ["Same key", "Energy up", "Energy down", "Relative major", "Relative minor", "Two-step up", "Two-step down", "Energy boost (+7)", "Mood shift", "Key clash", "Unknown"];
/* mix types from the gentlest to the most abrupt */
export const TYPES = ["Long blend", "Blend", "Bass swap", "Double drop", "Breakdown drop", "Into breakdown", "Drop swap", "Cut"];
const DRAMA = new Set(["Double drop", "Breakdown drop", "Into breakdown", "Drop swap"]);

/* how smooth one transition is, 0–100, from five things a DJ is judged on:
   key (30), tempo (25), low end (20: one bass line at a time), phrasing (15:
   a length on 4- or 8-bar phrases) and energy (10: no lurch, unless the type is a
   deliberate drop or breakdown). Returns the score, a label, the parts and
   what cost points. It's read from a recording, so it's a close estimate. */
export function mixScore(m) {
  const notes = [];
  const h = m.harmonic || {};
  const key = h.compatible === true ? 30 : h.compatible === "partial" ? 18 : h.compatible === false ? 4 : 15;
  if (h.compatible === false) notes.push(`keys clash (${m.key_from} → ${m.key_to})`);
  else if (h.compatible === "partial") notes.push(`a bolder key move (${h.label.toLowerCase()})`);
  const d = Math.abs(m.bpm_delta || 0);
  const tempo = d <= 0.5 ? 25 : 25 * Math.max(0, 1 - (d - 0.5) / 5.5);
  if (d > 0.5) notes.push(`tempo shifts ${m.bpm_delta > 0 ? "+" : "−"}${d.toFixed(1)} BPM`);
  const swapped = m.type === "Bass swap" || DRAMA.has(m.type) || (m.low_dip_db || 0) >= 6;
  const low = swapped ? 20 : m.type === "Cut" ? 14 : 6 + 14 * Math.min(1, (m.low_dip_db || 0) / 6);
  if (!swapped && m.type !== "Cut") notes.push("both bass lines overlap");
  let phrase;
  if (m.type === "Cut") phrase = 12;
  else if (!m.bars) phrase = 9;
  else {
    // bar counts from a room recording are off by a bar or two: short mixes may sit on
    // 4-bar phrases, longer ones on 8, with 10% (at least 1 bar) of slack
    const unit = m.bars < 16 ? 4 : 8, near = unit * Math.max(1, Math.round(m.bars / unit));
    if (m.bars >= 4 && Math.abs(m.bars - near) <= Math.max(1, 0.1 * m.bars)) phrase = 15;
    else { phrase = m.bars >= 4 ? 9 : 6; notes.push(`about ${m.bars} bars, off the phrase`); }
  }
  const e = Math.abs(m.energy_delta || 0);
  const flow = DRAMA.has(m.type) || e <= 1.5 ? 10 : e <= 3 ? 6 : 3;
  if (flow < 10) notes.push(`energy ${m.energy_delta > 0 ? "jumps" : "drops"} ${e.toFixed(1)}`);
  const score = Math.round(key + tempo + low + phrase + flow);
  const label = score >= 85 ? "Seamless" : score >= 70 ? "Clean" : score >= 55 ? "Rough edges" : "Bumpy";
  return { score, label, parts: { key, tempo: Math.round(tempo), low: Math.round(low), phrase, flow }, notes };
}

/* Camelot keys that mix cleanly with both a and b (same key, ±1, relative) */
const ALL_KEYS = Array.from({ length: 24 }, (_, i) => `${(i % 12) + 1}${i < 12 ? "A" : "B"}`);
const clean = (a, b) => harmonicRelation(a, b).compatible === true;
export function bridgeKeys(a, b) {
  if (!a || !b) return { direct: [], via: null };
  const direct = ALL_KEYS.filter((k) => k !== a && k !== b && clean(a, k) && clean(k, b));
  if (direct.length) return { direct, via: null };
  // no single key: the shortest in-key route around the wheel (breadth-first)
  const prev = { [a]: null }, queue = [a];
  while (queue.length) {
    const k = queue.shift();
    if (k === b) break;
    ALL_KEYS.forEach((n) => { if (!(n in prev) && clean(k, n)) { prev[n] = k; queue.push(n); } });
  }
  if (!(b in prev)) return { direct: [], via: null };
  const via = [];
  for (let k = prev[b]; k && k !== a; k = prev[k]) via.unshift(k);
  return { direct: [], via };
}

/* what would have made a mix smoother, in a DJ's terms; tracks lets a
   key clash point at tracks from this very set that would have bridged it */
export function mixTips(m, tracks = []) {
  const sc = mixScore(m), tips = [];
  if (sc.score >= 85) return tips;
  const name = (t) => (t.identified ? t.title.replace(/\s*\((feat|ft)\.?[^)]*\)/i, "") : `ID ${t.n}`);
  if (m.harmonic && m.harmonic.compatible === false) {
    const { direct, via } = bridgeKeys(m.key_from, m.key_to);
    if (direct.length) {
      const fits = tracks.filter((t) => t.n !== m.from && t.n !== m.to && t.key && direct.includes(t.key.camelot)).slice(0, 2);
      tips.push(`A track in ${direct.join(" or ")} between them would have bridged ${m.key_from} and ${m.key_to}${fits.length ? `, e.g. ${fits.map((t) => `${name(t)} (track ${t.n}, ${t.key.camelot})`).join(" or ")} from this set` : ""}.`);
    } else if (via) {
      const fits = tracks.filter((t) => t.n !== m.from && t.n !== m.to && t.key && via.includes(t.key.camelot)).slice(0, 2);
      tips.push(`${m.key_from} and ${m.key_to} are ${via.length + 1} steps apart on the wheel: going via ${via.join(", ")} keeps every mix in key${fits.length ? ` (${fits.map((t) => `${name(t)}, track ${t.n}, is in ${t.key.camelot}`).join("; ")})` : ""}. Short of that, mixing over drums only (a breakdown or an intro) hides the clash.`);
    } else tips.push("Mixing over drums only (a breakdown or an intro) hides a key clash.");
  }
  if (Math.abs(m.bpm_delta || 0) > 0.5) tips.push(`Ride the pitch across the blend so the ${Math.abs(m.bpm_delta).toFixed(1)} BPM change lands gradually, or match it before the mix.`);
  if (sc.notes.includes("both bass lines overlap")) tips.push("Cut the outgoing track's lows at the swap, so only one bass line plays at a time.");
  if (sc.notes.some((n) => /off the phrase/.test(n))) tips.push(`Start the blend on a phrase so it runs ${m.bars < 12 ? "8" : m.bars < 24 ? "16" : "32"} bars.`);
  if (sc.notes.some((n) => /energy (jumps|drops)/.test(n))) tips.push("Going through a breakdown or straight into the drop would make the energy change feel deliberate.");
  return tips;
}

export function craftProfile(D) {
  const M = D.transitions || [], T = D.tracks || [];
  const n = M.length;
  if (!n) return null;
  const name = (i) => { const t = T[i - 1]; return t && t.identified ? t.title.replace(/\s*\((feat|ft)\.?[^)]*\)/i, "") : `ID ${i}`; };

  const known = M.filter((m) => m.harmonic && m.harmonic.compatible !== null);
  const good = known.filter((m) => m.harmonic.compatible === true).length;
  const partial = known.filter((m) => m.harmonic.compatible === "partial").length;
  const clash = known.filter((m) => m.harmonic.compatible === false).length;
  const count = (f) => M.filter(f).length;
  const bass = count((m) => m.type === "Bass swap" || (m.low_dip_db || 0) >= 8);
  const drama = count((m) => DRAMA.has(m.type));
  const cuts = count((m) => m.type === "Cut");
  const longs = count((m) => (m.bars || 0) >= 32);
  const moved = count((m) => Math.abs(m.bpm_delta || 0) >= 1);
  const maxBpm = Math.max(0, ...M.map((m) => Math.abs(m.bpm_delta || 0)));
  const ups = count((m) => (m.energy_delta || 0) >= 1), downs = count((m) => (m.energy_delta || 0) <= -1);
  const medBars = median(M.map((m) => m.bars));
  const medDur = median(M.map((m) => m.duration));
  const cont = median(M.map((m) => m.style_continuity));
  const smooth = M.map(mixScore);
  const avgSmooth = Math.round(smooth.reduce((a, x) => a + x.score, 0) / n);

  const stats = {
    mixes: n, medBars, medDur, harmonicPct: pct(good, known.length), partialPct: pct(partial, known.length), clashPct: pct(clash, known.length),
    bassPct: pct(bass, n), dramaPct: pct(drama, n), cutPct: pct(cuts, n), longPct: pct(longs, n),
    tempoMoves: moved, maxBpmDelta: maxBpm, ups, downs, continuity: cont,
    smooth: avgSmooth, smoothLabel: avgSmooth >= 85 ? "Seamless" : avgSmooth >= 70 ? "Clean" : avgSmooth >= 55 ? "Rough edges" : "Bumpy",
  };

  /* archetypes: each scores 0–1+ from the evidence; the best one names the style */
  const H = known.length ? good / known.length : 0.5;
  const arche = [
    { id: "blender", name: "The long blender", score: clamp01(((medBars || 0) - 10) / 22) + 0.35 * clamp01(longs / n * 3) + 0.2 * H,
      why: () => `mixes run a median ${medBars} bars${longs ? `, ${longs} of them 32 bars or more` : ""}, so tracks overlap more than they hand over` },
    { id: "technician", name: "The technician", score: 0.9 * (bass / n) + 0.5 * H + 0.2 * (maxBpm < 3 ? 1 : 0),
      why: () => `${bass} of ${n} mixes swap the bass line cleanly${known.length ? ` and ${pct(good, known.length)}% stay in compatible keys` : ""}${maxBpm < 3 ? `, with the tempo held within ${Math.max(1, Math.ceil(maxBpm))} BPM` : ""}` },
    { id: "architect", name: "The drop architect", score: 1.1 * (drama / n) + 0.15 * clamp01(((D.drops || []).length) / Math.max(1, n)),
      why: () => `${drama} of ${n} mixes are built around a breakdown or a drop, so the changes land as moments rather than blends` },
    { id: "cutter", name: "The quick cutter", score: 1.2 * (cuts / n) + clamp01((8 - (medBars || 8)) / 8),
      why: () => `${cuts ? `${cuts} hard cuts and ` : ""}a median mix of ${medBars || "a few"} bars keep the changes quick` },
    { id: "purist", name: "The key purist", score: known.length >= 4 ? clamp01((H - 0.6) / 0.3) * 1.05 + 0.1 * (clash === 0 ? 1 : 0) : 0,
      why: () => `${good} of ${known.length} mixes land in a compatible key${clash ? `, only ${clash} clash${clash > 1 ? "es" : ""}` : ", and none clash"}` },
    { id: "selector", name: "The selector", score: 0.8 * (known.length ? clash / known.length : 0) + 0.4 * clamp01(moved / n * 2) + 0.3 * clamp01((0.25 - (cont || 0.25)) / 0.25),
      why: () => `the set jumps between keys${moved ? ` and tempos (${moved} tempo moves)` : ""}, choosing tracks for contrast over smooth hand-offs` },
  ].sort((a, b) => b.score - a.score);
  const top = arche[0], runner = arche[1];
  const style = { id: top.id, name: top.name, line: `${top.why()[0].toUpperCase()}${top.why().slice(1)}.`, also: runner.score > top.score * 0.8 ? runner.name : null, scores: Object.fromEntries(arche.map((a) => [a.id, Math.round(a.score * 100) / 100])) };

  const tally = (keyOf, order) => {
    const c = {};
    M.forEach((m) => { const k = keyOf(m); c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).sort((a, b) => (order.indexOf(a[0]) + 99 * (order.indexOf(a[0]) < 0)) - (order.indexOf(b[0]) + 99 * (order.indexOf(b[0]) < 0))).map(([label, count]) => ({ label, count }));
  };
  const relations = tally((m) => (m.harmonic ? m.harmonic.label : "Unknown"), RELATIONS);
  const types = tally((m) => m.type, TYPES);

  /* signature moments, each a pointer into transitions[] */
  const best = (f) => M.reduce((bi, m, i) => (f(m) > f(M[bi]) ? i : bi), 0);
  const moments = [];
  const add = (j, what, detail) => { if (j != null && !moments.some((x) => x.j === j)) moments.push({ j, what, detail, from: name(M[j].from), to: name(M[j].to) }); };
  const lb = best((m) => m.duration || 0);
  add(lb, "Longest blend", `${M[lb].bars ? `${M[lb].bars} bars` : `${Math.round(M[lb].duration)} s`}`);
  const bs = best((m) => m.low_dip_db || 0);
  if ((M[bs].low_dip_db || 0) >= 8) add(bs, "Deepest bass swap", `bass pulled ${Math.round(M[bs].low_dip_db)} dB`);
  const lift = best((m) => m.energy_delta || 0);
  if ((M[lift].energy_delta || 0) >= 1) add(lift, "Biggest lift", `energy +${M[lift].energy_delta.toFixed(1)}`);
  const bold = M.findIndex((m) => m.harmonic && m.harmonic.compatible === "partial" && /boost|Two-step|Mood/.test(m.harmonic.label));
  if (bold >= 0) add(bold, "Boldest key move", `${M[bold].key_from} → ${M[bold].key_to}, ${M[bold].harmonic.label.toLowerCase()}`);
  const tm = best((m) => Math.abs(m.bpm_delta || 0));
  if (Math.abs(M[tm].bpm_delta || 0) >= 2) add(tm, "Biggest tempo move", `${M[tm].bpm_delta > 0 ? "+" : ""}${M[tm].bpm_delta.toFixed(1)} BPM`);

  const sm = best((m) => mixScore(m).score), rough = best((m) => -mixScore(m).score);
  if (smooth[sm].score > smooth[rough].score) {
    add(sm, "Smoothest mix", `smoothness ${smooth[sm].score}`);
    add(rough, "Roughest mix", `smoothness ${smooth[rough].score}: ${smooth[rough].notes.slice(0, 2).join(", ") || "small slips"}`);
  }

  return { stats, style, relations, types, moments, smooth };
}

/* how a key move is judged, for coloring and legends */
export function relationClass(label) {
  if (label === "Key clash") return "clash";
  if (label === "Unknown") return "unknown";
  if (/Two-step|boost|Mood/.test(label)) return "partial";
  return "good";
}

/* ------------------------------------------------ a smoother running order
   The same tracks, re-sequenced. The cost of an order adds, for each
   neighboring pair, the key move (0 clean, 0.4 bolder, 1 clash) and half the
   tempo step (in units of 6 BPM, capped at 1), and, for each position, how far
   the track's energy is from the energy the original set had at that point
   (×0.06 per energy point), so the arc (warm-up, peak, cool-down) survives.
   Local search from the original order: move any track to any slot, or swap
   any two, keep whatever lowers the cost, until nothing does. Deterministic.
   pinEnds (the default) keeps the opening and closing tracks where they were. */
const KEYCOST = (a, b) => { const c = harmonicRelation(a, b).compatible; return c === true ? 0 : c === "partial" ? 0.4 : c === false ? 1 : 0.5; };
export function reorder(D, { pinEnds = true } = {}) {
  const T = (D.tracks || []).filter((t) => t.key && t.key.camelot);
  const n = T.length;
  if (n < 4) return null;
  const E = T.map((t) => t.energy || 0);
  const edge = (a, b) => KEYCOST(a.key.camelot, b.key.camelot) + 0.5 * Math.min(1, Math.abs((a.bpm || 0) - (b.bpm || 0)) / 6);
  const cost = (o) => {
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (i) c += edge(T[o[i - 1]], T[o[i]]);
      c += 0.06 * Math.abs(E[o[i]] - E[i]);
    }
    return c;
  };
  const search = (start, lo, hi) => {
    let order = start, best = cost(order);
    for (let pass = 0, better = true; better && pass < 50; pass++) {
      better = false;
      for (let i = lo; i < hi; i++) for (let j = lo; j < hi; j++) {
        if (i === j) continue;
        const moved = order.slice(); moved.splice(j, 0, moved.splice(i, 1)[0]);
        const swapped = order.slice(); [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
        for (const o of [moved, swapped]) { const c = cost(o); if (c < best - 1e-9) { best = c; order = o; better = true; } }
      }
    }
    return { order, best };
  };
  const pinned = search(T.map((_, i) => i), 1, n - 1);
  let { order } = pinned;
  if (!pinEnds) {
    // free ends: search from the played order and from the pinned answer, keep the cheaper,
    // so freeing the ends can never come out worse than keeping them
    const a = search(T.map((_, i) => i), 0, n), b = search(pinned.order, 0, n);
    order = (a.best <= b.best ? a : b).order;
  }
  const tally = (o) => {
    let clean = 0, clash = 0, tempo = 0;
    for (let i = 1; i < n; i++) {
      const k = KEYCOST(T[o[i - 1]].key.camelot, T[o[i]].key.camelot);
      if (k === 0) clean++; else if (k === 1) clash++;
      tempo += Math.abs((T[o[i - 1]].bpm || 0) - (T[o[i]].bpm || 0));
    }
    return { clean, clash, tempo: Math.round((tempo / (n - 1)) * 10) / 10 };
  };
  const orig = T.map((_, i) => i);
  const moves = order.map((ti, pos) => ({ n: T[ti].n, from: ti + 1, to: pos + 1, d: Math.abs(pos - ti) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
  return {
    order: order.map((i) => T[i].n), before: tally(orig), after: tally(order), mixes: n - 1,
    moves, unchanged: moves.length === 0, pinEnds, cost: Math.round(cost(order) * 1000) / 1000,
  };
}
