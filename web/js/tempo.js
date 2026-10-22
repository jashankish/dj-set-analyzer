/* ============================================================
   Set Replay — the tempo journey: how the BPM moves through the set.

   tempoJourney(D) reads each track's tempo (inside the set) and finds:
     steps    { n, start, end, bpm } per track with a tempo
     range    the 5th–95th percentile of tempo, weighted by time (one
              odd reading doesn't stretch it), with half- and double-time
              tracks folded to the set's own tempo (65 in a 130 set counts
              as 130); "locked" when it spans 2 BPM or less
     ramps    climbs and slowdowns of 3 BPM or more, however gradual (a run
              that never falls back more than 1 BPM from its furthest),
              biggest first
     jumps    single moves of 6 BPM or more; a move to about twice or half
              the tempo is a double-time / half-time switch
     sentence
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
const r1 = (x) => Math.round(x * 10) / 10;
const fmtB = (b) => (Math.abs(b - Math.round(b)) < 0.25 ? String(Math.round(b)) : b.toFixed(1));

function wpct(steps, q) {
  const s = [...steps].sort((a, b) => a.bpm - b.bpm), tot = s.reduce((a, x) => a + (x.end - x.start), 0);
  let acc = 0;
  for (const x of s) { acc += x.end - x.start; if (acc >= q * tot) return x.bpm; }
  return s[s.length - 1].bpm;
}

export function tempoJourney(D) {
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  const steps = (D.tracks || []).filter((t) => t.bpm).map((t) => ({ n: t.n, start: Math.max(t.start, s0), end: Math.min(t.end, s1), bpm: t.bpm })).filter((t) => t.end > t.start);
  if (steps.length < 3) return null;
  const med = wpct(steps, 0.5);
  const fold = (b) => [b, b * 2, b / 2].reduce((x, y) => (Math.abs(y - med) < Math.abs(x - med) ? y : x));
  const felt = steps.map((x) => ({ ...x, bpm: fold(x.bpm) }));
  const lo = wpct(felt, 0.05), hi = wpct(felt, 0.95), locked = hi - lo <= 2;

  const moves = steps.slice(1).map((b, i) => ({ a: steps[i], b, d: b.bpm - steps[i].bpm, ratio: b.bpm / steps[i].bpm, fa: felt[i], fb: felt[i + 1] }));
  const jumps = moves.filter((m) => Math.abs(m.d) >= 6).map((m) => ({
    t: m.b.start, from: m.a.bpm, to: m.b.bpm, n: m.b.n,
    kind: Math.abs(m.ratio - 2) < 0.08 ? "double-time" : Math.abs(m.ratio - 0.5) < 0.04 ? "half-time" : m.d > 0 ? "jump up" : "drop down",
  }));
  // ramps, up then down: from a track, keep going while the (folded) tempo doesn't fall back
  // more than 1 BPM from the furthest it has reached and no 6 BPM jump intervenes; a run that
  // gets 3 BPM or more from where it started is a ramp, and the next search starts at its peak.
  // Gradual ramps (a fraction of a BPM per track) count, the way DJs actually ride the pitch.
  const ramps = [];
  for (const dir of [1, -1]) {
    let i = 0;
    while (i < felt.length - 1) {
      let ext = felt[i].bpm, extI = i, j = i + 1;
      while (j < felt.length && Math.abs(felt[j].bpm - felt[j - 1].bpm) < 6 && dir * (felt[j].bpm - ext) > -1) {
        if (dir * (felt[j].bpm - ext) > 0) { ext = felt[j].bpm; extI = j; }
        j++;
      }
      if (dir * (ext - felt[i].bpm) >= 3) ramps.push({ dir, from: felt[i].bpm, to: ext, t0: steps[i].start, t1: steps[extI].end, fromN: steps[i].n, toN: steps[extI].n });
      i = extI > i ? extI : i + 1;
    }
  }
  ramps.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));

  const parts = [];
  if (locked) parts.push(`Locked at ${fmtB(med)} BPM: the tempo stays within ${Math.max(1, Math.round(hi - lo))} BPM for most of the set.`);
  else parts.push(`From ${fmtB(lo)} to ${fmtB(hi)} BPM across the set.`);
  if (ramps.length && !locked) {
    const r = ramps[0];
    parts.push(`${r.dir > 0 ? "The biggest climb" : "The biggest slowdown"}: ${fmtB(r.from)} to ${fmtB(r.to)} BPM over ${Math.max(1, Math.round((r.t1 - r.t0) / 60))} minutes, from ${mmss(r.t0)}.`);
  }
  const sw = jumps.filter((j) => j.kind === "double-time" || j.kind === "half-time");
  if (sw.length) parts.push(`${sw.length} ${sw.length === 1 ? "switch" : "switches"} to ${sw.map((j) => j.kind).filter((k, i, a) => a.indexOf(k) === i).join(" and ")}.`);
  const big = jumps.filter((j) => j.kind === "jump up" || j.kind === "drop down");
  if (big.length) parts.push(`${big.length} sudden tempo ${big.length === 1 ? "change" : "changes"} of 6 BPM or more.`);
  return { steps, felt, med, lo, hi, locked, ramps, jumps, sentence: parts.join(" "), s0, s1 };
}
