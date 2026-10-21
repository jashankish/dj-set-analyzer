/* ============================================================
   Set Replay — pacing chart, in "How it was mixed".
   pacingSection(ctx) draws pacing.js's tracks as one bar each, in play
   order, height = time in the set, in the track's key color; the median
   as a dashed line, the longest and shortest labeled, the quickest
   8-minute stretch shaded behind its bars. Hover a bar for the track,
   click it to play from its start.
   ============================================================ */
import { pacing } from "../pacing.js";

export function pacingSection(ctx) {
  const { $, S, esc, fmt, keyColor, seek, showTip, shortName } = ctx;
  const W = 1000, H = 170, PT = 18, PB = 4, GAP = 3;

  function renderPacing() {
    const P = (S.pacing = pacing(S.D));
    $("pacing").hidden = !P;
    if (!P) return;
    $("paceLine").textContent = P.sentence;
    const max = Math.max(...P.tracks.map((t) => t.play)) * 1.08;
    const bw = (W - GAP * (P.tracks.length - 1)) / P.tracks.length;
    const X = (i) => i * (bw + GAP), Y = (v) => H - PB - (v / max) * (H - PT - PB);
    const med = P.stats.median;
    let g = "", labels = "";
    if (P.quick) {
      const a = P.tracks.findIndex((t) => t.n === P.quick.from), b = P.tracks.findIndex((t) => t.n === P.quick.to);
      g += `<rect class="pc-quick" x="${X(a) - GAP / 2}" y="0" width="${X(b) + bw - X(a) + GAP}" height="${H}"/>`;
    }
    P.tracks.forEach((t, i) => {
      const y = Y(t.play), lab = t === P.stats.longest || t === P.stats.shortest;
      g += `<rect class="pc-bar" data-i="${i}" x="${X(i).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - PB - y).toFixed(1)}" rx="3" fill="${keyColor(t.key, "base")}"/>`;
      // labels in HTML: the SVG stretches to the box, which would distort text
      if (lab) labels += `<span class="pc-val" style="left:${(((X(i) + bw / 2) / W) * 100).toFixed(2)}%;top:${((y / H) * 100).toFixed(2)}%">${fmt(t.play)}</span>`;
    });
    g += `<line class="pc-med" x1="0" x2="${W}" y1="${Y(med).toFixed(1)}" y2="${Y(med).toFixed(1)}"/>`;
    $("paceSvg").innerHTML = g;
    $("paceVals").innerHTML = labels;
    $("paceMed").textContent = `median ${fmt(med)}`;
    $("paceMed").style.top = `${(Y(med) / H) * 100}%`;
    $("paceSvg").setAttribute("aria-label", `Each track's time in the set, in play order: median ${fmt(med)}, longest ${fmt(P.stats.longest.play)}, shortest ${fmt(P.stats.shortest.play)}`);

    if (renderPacing.bound) return;
    renderPacing.bound = true;
    const box = $("paceBox"), tip = box.querySelector(".tip");
    box.addEventListener("pointermove", (e) => {
      const r = e.target.closest(".pc-bar");
      if (!r) { tip.hidden = true; return; }
      const t = S.pacing.tracks[+r.dataset.i], tr = S.D.tracks.find((x) => x.n === t.n), b = box.getBoundingClientRect();
      showTip(tip, e.clientX - b.left, b.width, `<span class="t-time">${fmt(t.start)}–${fmt(t.end)}</span><span class="t-title">${esc(shortName(tr))}</span><span class="t-meta">plays ${fmt(t.play)}${t.bars ? ` · ${t.bars} bars` : ""}${t.key ? ` · ${esc(t.key)}` : ""}</span>`, 6);
    });
    box.addEventListener("pointerleave", () => (tip.hidden = true));
    box.addEventListener("click", (e) => { const r = e.target.closest(".pc-bar"); if (r) seek(S.pacing.tracks[+r.dataset.i].start + 0.05, true); });
  }

  return { renderPacing };
}
