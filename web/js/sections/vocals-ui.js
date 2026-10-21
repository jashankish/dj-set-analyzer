/* ============================================================
   Set Replay — the vocal map, in the journey column.
   vocalsSection(ctx) draws vocals.js's windows as a strip, each cell's
   opacity its vocal score (one hue, light to strong), vocal stretches
   underlined, track boundaries as ticks, and the playhead; under it each
   track as a pill tagged vocal / mixed / instrumental. Hover for the
   window, click to play from there.
   ============================================================ */
import { vocalMap } from "../vocals.js";

const HUE = "232,123,164";      // the dataviz palette's magenta, on the dark panel

export function vocalsSection(ctx) {
  const { $, S, fit, fmt, esc, seek, showTip, clamp, shortName } = ctx;

  function renderVocals() {
    const V = (S.vocals = vocalMap(S.D));
    $("vocBlock").hidden = !V;
    if (!V) return;
    $("vocLine").textContent = V.sentence;
    $("vocTracks").innerHTML = V.tracks.map((t) => `<button class="voc-pill ${t.tag}" data-t="${t.start}" title="${esc(shortName(S.D.tracks.find((x) => x.n === t.n)))}: vocals in ${Math.round(t.share * 100)}% of it" aria-label="Track ${t.n}, ${t.tag}: vocals in ${Math.round(t.share * 100)}% of it">${t.n}</button>`).join("");
    $("vocTracks").onclick = (e) => { const b = e.target.closest(".voc-pill"); if (b) seek(+b.dataset.t + 0.05, true); };
    if (!renderVocals.bound) {
      renderVocals.bound = true;
      const box = $("vocBox"), tip = box.querySelector(".tip");
      const at = (e) => { const r = box.getBoundingClientRect(), V = S.vocals; return { x: e.clientX - r.left, w: r.width, t: V.s0 + ((e.clientX - r.left) / r.width) * (V.s1 - V.s0) }; };
      box.addEventListener("pointermove", (e) => {
        const p = at(e), V = S.vocals, c = V.cells.find((x) => p.t >= x.t0 && p.t < x.t1), tr = S.D.tracks.find((x) => p.t >= x.start && p.t < x.end);
        if (!c) { tip.hidden = true; return; }
        showTip(tip, p.x, p.w, `<span class="t-time">${fmt(c.t0)}</span>${tr ? `<span class="t-title">${esc(shortName(tr))}</span>` : ""}<span class="t-meta">${c.v >= 0.5 ? "vocals" : "instrumental"} · score ${Math.round(c.v * 100)}%</span>`, 6);
      });
      box.addEventListener("pointerleave", () => (tip.hidden = true));
      box.addEventListener("click", (e) => seek(clamp(at(e).t, S.vocals.s0, S.vocals.s1 - 1), true));
    }
    drawVocals();
  }

  function drawVocals(t) {
    const V = S.vocals;
    if (!V || $("vocBlock").hidden) return;
    const { ctx: g, w, h } = fit($("vocCanvas"));
    g.clearRect(0, 0, w, h);
    const X = (s) => ((s - V.s0) / (V.s1 - V.s0)) * w, band = h - 8;
    g.fillStyle = "rgba(255,255,255,.04)"; g.fillRect(0, 0, w, band);
    V.cells.forEach((c) => { g.fillStyle = `rgba(${HUE},${(0.08 + 0.92 * clamp(c.v, 0, 1)).toFixed(2)})`; g.fillRect(X(c.t0), 0, Math.max(1, X(c.t1) - X(c.t0) + 0.5), band); });
    // vocal stretches, underlined
    g.fillStyle = `rgb(${HUE})`;
    V.runs.forEach((r) => g.fillRect(X(r.t0), band + 3, Math.max(2, X(r.t1) - X(r.t0)), 3));
    g.fillStyle = "rgba(22,21,30,.9)";
    S.D.tracks.slice(1).forEach((tr) => { if (tr.start > V.s0 && tr.start < V.s1) g.fillRect(X(tr.start) - 0.5, 0, 1, band); });
    if (t != null && t >= V.s0 && t <= V.s1) { g.fillStyle = "#fff"; g.fillRect(X(t) - 1, 0, 2, h); }
  }

  return { renderVocals, drawVocals };
}
