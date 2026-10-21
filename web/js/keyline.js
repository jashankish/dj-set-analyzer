/* ============================================================
   Set Replay — the key journey: Camelot key against time.

   keyTimeline(D) turns the tracks into key stretches and moves. Camelot
   numbers wrap (12 → 1 is one step), so each stretch takes the
   representation of its number nearest the one before, "unwrapping" the
   wheel into a line: a run of +1 moves climbs steadily instead of falling
   from 12 to 1. Minor (A) and major (B) keep their letter; the chart draws
   them a little apart. Returns the stretches (with their unwrapped level),
   the moves (with their harmonic relation and direction) and a summary.
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
import { harmonicRelation } from "./engine/music.js";

export function keyTimeline(D) {
  const T = (D.tracks || []).filter((t) => t.key && t.key.camelot);
  if (T.length < 2) return null;
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  const segs = [];
  let level = null;
  T.forEach((t) => {
    const k = t.key.camelot, num = parseInt(k, 10), mode = k.slice(-1);
    if (level == null) level = num;
    else {
      // the representation of num (num + 12m) nearest the previous level
      const cands = [-2, -1, 0, 1, 2].map((m) => num + 12 * m);
      level = cands.reduce((b, c) => (Math.abs(c - level) < Math.abs(b - level) ? c : b));
    }
    const last = segs[segs.length - 1];
    if (last && last.key === k) { last.end = Math.min(t.end, s1); last.tracks.push(t.n); }
    else segs.push({ key: k, mode, level, start: Math.max(t.start, s0), end: Math.min(t.end, s1), tracks: [t.n] });
  });
  const moves = segs.slice(1).map((b, i) => {
    const a = segs[i], rel = harmonicRelation(a.key, b.key);
    return { t: b.start, from: a.key, to: b.key, label: rel.label, compatible: rel.compatible, step: b.level - a.level, n: b.tracks[0] };
  });
  const levels = segs.map((s) => s.level);
  const up = moves.filter((m) => m.step > 0).length, down = moves.filter((m) => m.step < 0).length;
  const clashes = moves.filter((m) => m.compatible === false).length;
  const time = {};
  segs.forEach((s) => (time[s.key] = (time[s.key] || 0) + (s.end - s.start)));
  const net = levels[levels.length - 1] - levels[0];
  const shape = Math.abs(net) <= 1 ? "comes back to where it started" : net > 0 ? `ends ${net} step${net > 1 ? "s" : ""} up the wheel from where it began` : `ends ${-net} step${-net > 1 ? "s" : ""} down the wheel from where it began`;
  const sentence = `${moves.length} key change${moves.length === 1 ? "" : "s"}: ${up} up the wheel, ${down} down${moves.length - up - down ? `, ${moves.length - up - down} to the relative ${moves.length - up - down === 1 ? "key" : "keys"}` : ""}${clashes ? `, ${clashes} clash${clashes > 1 ? "es" : ""}` : ""}. Across ${Math.max(...levels) - Math.min(...levels) + 1} wheel positions, it ${shape}.`;
  return { segs, moves, range: [Math.min(...levels), Math.max(...levels)], up, down, clashes, sentence, s0, s1 };
}
