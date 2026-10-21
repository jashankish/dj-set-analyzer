/* ============================================================
   Set Replay — pacing: how long each track gets before the next one.

   pacing(D) measures each track's time in the set (start to end, inside
   the set; the tracks tile it, so a mix is shared at the swap) and, at
   the track's tempo, in bars. It finds:
     stats    median, shortest, longest, mean; tracks per hour
     quick    the 8-minute stretch with the most track starts
     trend    the second half's median against the first's: "speeds up"
              (under 80%), "slows down" (over 125%) or "even"
     style    quick-fire (median under 90 s), long-form (over 4 min) or
              steady, with a sentence
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
const WIN = 8 * 60;

export function pacing(D) {
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  const T = (D.tracks || []).map((t) => {
    const a = Math.max(t.start, s0), b = Math.min(t.end, s1), play = Math.max(0, b - a);
    return { n: t.n, start: a, end: b, play, bars: t.bpm ? Math.round((play * t.bpm) / 240) : null, key: t.key && t.key.camelot };
  }).filter((t) => t.play > 0);
  if (T.length < 4) return null;
  const plays = T.map((t) => t.play);
  const med = median(plays), mean = plays.reduce((a, b) => a + b, 0) / plays.length;
  const shortest = T.reduce((a, b) => (b.play < a.play ? b : a)), longest = T.reduce((a, b) => (b.play > a.play ? b : a));
  const perHour = (T.length / Math.max(1, s1 - s0)) * 3600;

  // the 8-minute window (starting at a track start) with the most track starts
  let quick = null;
  if (s1 - s0 >= WIN * 1.5) {
    T.forEach((t, i) => {
      if (t.start + WIN > s1) return;
      const n = T.filter((x) => x.start >= t.start && x.start < t.start + WIN).length;
      if (!quick || n > quick.count) quick = { t0: t.start, t1: t.start + WIN, count: n, from: t.n, to: T[i + n - 1].n };
    });
    if (quick && quick.count < 3) quick = null;
  }

  const half = (s0 + s1) / 2;
  const first = T.filter((t) => (t.start + t.end) / 2 < half).map((t) => t.play), second = T.filter((t) => (t.start + t.end) / 2 >= half).map((t) => t.play);
  const ratio = first.length && second.length ? median(second) / median(first) : 1;
  const trend = ratio < 0.8 ? "speeds up" : ratio > 1.25 ? "slows down" : "even";

  const style = med < 90 ? { id: "quick", name: "Quick-fire", line: "tracks come and go fast, rarely past their first drop" }
    : med > 240 ? { id: "long", name: "Long-form", line: "tracks get room to play out, often most of the way through" }
    : { id: "steady", name: "Steady", line: "tracks get a couple of minutes each, enough for a build and a drop" };
  const sentence = `${style.name}: ${style.line}. A typical track plays ${mmss(med)}, from ${mmss(shortest.play)} to ${mmss(longest.play)}; ` +
    `${Math.round(perHour)} tracks an hour.` +
    (trend === "even" ? " The pace holds through the set." : ` The pace ${trend} in the second half (typical track ${mmss(median(second))}, was ${mmss(median(first))}).`) +
    (quick ? ` Quickest stretch: ${quick.count} tracks in 8 minutes from ${mmss(quick.t0)}.` : "");
  return { tracks: T, stats: { median: med, mean, shortest, longest, perHour }, quick, trend, ratio, style, sentence, s0, s1 };
}
