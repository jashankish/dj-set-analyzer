/* ============================================================
   Set Replay — the vocal map: where in the set people are singing.

   vocalMap(D) reads the vocal model's score (curves.moods.v.
   voice_instrumental, one value per 10 s window, 0 instrumental to 1
   vocal) inside the set, lightly smoothed, and returns
     cells    { t0, t1, v } per window
     runs     vocal stretches (v ≥ 0.5 for at least 30 s), in order
     tracks   each track's vocal share (the fraction of its windows at
              0.5 or more) and a tag: vocal (≥ 60%), instrumental (≤ 20%)
              or mixed
     thirds   the vocal share of each third of the set
     longest vocal run, longest instrumental stretch, sentence
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
const ON = 0.5, MIN_RUN = 30;
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

export function vocalMap(D) {
  const m = D.curves && D.curves.moods, raw = m && m.v && m.v.voice_instrumental, step = (m && m.step) || 10;
  if (!raw || !raw.length) return null;
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  let cells = [];
  raw.forEach((v, i) => { const t0 = i * step; if (t0 + step / 2 >= s0 && t0 + step / 2 < s1) cells.push({ t0: Math.max(t0, s0), t1: Math.min(t0 + step, s1), v: v || 0 }); });
  if (cells.length < 6) return null;
  cells = cells.map((c, i) => ({ ...c, v: ((cells[i - 1] || c).v + 2 * c.v + (cells[i + 1] || c).v) / 4 }));

  // stretches: consecutive windows on one side of the line
  const stretches = [];
  cells.forEach((c) => {
    const on = c.v >= ON, last = stretches[stretches.length - 1];
    if (last && last.on === on) last.t1 = c.t1;
    else stretches.push({ on, t0: c.t0, t1: c.t1 });
  });
  const runs = stretches.filter((s) => s.on && s.t1 - s.t0 >= MIN_RUN);
  const gaps = stretches.filter((s) => !s.on);
  const len = (s) => s.t1 - s.t0;
  const longestVocal = runs.length ? runs.reduce((a, b) => (len(b) > len(a) ? b : a)) : null;
  const longestInst = gaps.length ? gaps.reduce((a, b) => (len(b) > len(a) ? b : a)) : null;

  const share = (a, b) => { const c = cells.filter((x) => x.t0 >= a && x.t0 < b); return c.length ? c.filter((x) => x.v >= ON).length / c.length : 0; };
  const L = s1 - s0, thirds = [0, 1, 2].map((k) => share(s0 + (L * k) / 3, s0 + (L * (k + 1)) / 3));
  const overall = share(s0, s1);
  const tracks = (D.tracks || []).map((t) => {
    const v = share(Math.max(t.start, s0), Math.min(t.end, s1));
    return { n: t.n, start: t.start, end: t.end, share: v, tag: v >= 0.6 ? "vocal" : v <= 0.2 ? "instrumental" : "mixed" };
  });
  const count = (tag) => tracks.filter((t) => t.tag === tag).length;

  const pc = (x) => `${Math.round(x * 100)}%`;
  const hi = thirds.indexOf(Math.max(...thirds)), lo = thirds.indexOf(Math.min(...thirds));
  const where = ["the first third", "the middle", "the last third"];
  const placement = thirds[hi] - thirds[lo] >= 0.2 ? `The vocals sit in ${where[hi]} (${pc(thirds[hi])}) and thin out in ${where[lo]} (${pc(thirds[lo])}).` : "The vocals are spread evenly through the set.";
  const sentence = `Vocals in ${pc(overall)} of the set: ${count("vocal")} vocal track${count("vocal") === 1 ? "" : "s"}, ${count("mixed")} mixed, ${count("instrumental")} instrumental. ${placement}` +
    (longestInst && len(longestInst) >= 120 ? ` Longest instrumental stretch: ${mmss(len(longestInst))} from ${mmss(longestInst.t0)}.` : "");
  return { cells, runs, tracks, thirds, overall, longestVocal, longestInst, sentence, s0, s1 };
}
