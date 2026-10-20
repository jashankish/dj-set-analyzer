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

const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

/* key moves in the order a DJ would rank them, smoothest first */
export const RELATIONS = ["Same key", "Energy up", "Energy down", "Relative major", "Relative minor", "Two-step up", "Two-step down", "Energy boost (+7)", "Mood shift", "Key clash", "Unknown"];
/* mix types from the gentlest to the most abrupt */
export const TYPES = ["Long blend", "Blend", "Bass swap", "Double drop", "Breakdown drop", "Into breakdown", "Drop swap", "Cut"];
const DRAMA = new Set(["Double drop", "Breakdown drop", "Into breakdown", "Drop swap"]);

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

  const stats = {
    mixes: n, medBars, medDur, harmonicPct: pct(good, known.length), partialPct: pct(partial, known.length), clashPct: pct(clash, known.length),
    bassPct: pct(bass, n), dramaPct: pct(drama, n), cutPct: pct(cuts, n), longPct: pct(longs, n),
    tempoMoves: moved, maxBpmDelta: maxBpm, ups, downs, continuity: cont,
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

  return { stats, style, relations, types, moments };
}

/* how a key move is judged, for colouring and legends */
export function relationClass(label) {
  if (label === "Key clash") return "clash";
  if (label === "Unknown") return "unknown";
  if (/Two-step|boost|Mood/.test(label)) return "partial";
  return "good";
}
