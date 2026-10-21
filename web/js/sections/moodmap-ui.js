/* ============================================================
   Set Replay — The mood map: each track by brightness and intensity, and the route.
   Moved out of app.js as is: moodMapSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */
import { QUADS, moodMap } from "../moodmap.js";

export function moodMapSection(ctx) {
  const { $, S, X, esc, fmt, keyColor, keyOf, nameOf, now, seek, shortName, showTip, span, tracks } = ctx;

  const MM = { x0: 46, x1: 384, y0: 16, y1: 354 };
  function renderMoodMap() {
    const M = (S.mood = moodMap(S.D)), T = tracks();
    $("moodmap").hidden = !M;
    if (!M) return;
    const X = (v) => MM.x0 + ((v - M.domain.v[0]) / (M.domain.v[1] - M.domain.v[0])) * (MM.x1 - MM.x0);
    const Y = (a) => MM.y1 - ((a - M.domain.a[0]) / (M.domain.a[1] - M.domain.a[0])) * (MM.y1 - MM.y0);
    const cx = X(M.median.v), cy = Y(M.median.a);
    const maxLen = Math.max(...M.points.map((p) => p.len));
    M.points.forEach((p) => { p.x = X(p.v); p.y = Y(p.a); p.r = 4 + 5 * Math.sqrt(p.len / maxLen); });
    let g = `<rect class="mm-bg" x="${MM.x0}" y="${MM.y0}" width="${MM.x1 - MM.x0}" height="${MM.y1 - MM.y0}"/>`;
    g += `<line class="mm-mid" x1="${cx}" y1="${MM.y0}" x2="${cx}" y2="${MM.y1}"/><line class="mm-mid" x1="${MM.x0}" y1="${cy}" x2="${MM.x1}" y2="${cy}"/>`;
    const corner = (q, x, y, anchor) => `<text class="mm-q" x="${x}" y="${y}" text-anchor="${anchor}">${QUADS[q].name.toUpperCase()}</text>`;
    g += corner("intense", MM.x0 + 8, MM.y0 + 16, "start") + corner("euphoric", MM.x1 - 8, MM.y0 + 16, "end") +
      corner("brooding", MM.x0 + 8, MM.y1 - 8, "start") + corner("warm", MM.x1 - 8, MM.y1 - 8, "end");
    g += `<text class="mm-ax" x="${(MM.x0 + MM.x1) / 2}" y="${MM.y1 + 22}" text-anchor="middle">darker  ←  brightness  →  brighter</text>`;
    g += `<text class="mm-ax" transform="translate(${MM.x0 - 14} ${(MM.y0 + MM.y1) / 2}) rotate(-90)" text-anchor="middle">calmer  ←  intensity  →  more intense</text>`;
    g += `<polyline class="mm-path-dim" id="mmAhead"/><polyline class="mm-path" id="mmDone"/>`;
    g += M.points.map((p, i) => `<g class="mm-pt" data-i="${i}" tabindex="0" role="button" aria-label="Track ${p.n}: ${esc(shortName(T[p.n - 1]))}, ${QUADS[p.q].name}">
      <circle class="mm-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" style="fill:${keyColor(keyOf(T[p.n - 1]), "base")}"/>
      <text class="mm-n" x="${(p.x + p.r + 2).toFixed(1)}" y="${(p.y - p.r + 2).toFixed(1)}">${p.n}</text></g>`).join("");
    $("mmSvg").innerHTML = g;
    const tip = $("mmTip"), box = $("mmSvg");
    box.querySelectorAll(".mm-pt").forEach((el) => {
      const p = M.points[+el.dataset.i], tr = T[p.n - 1];
      el.addEventListener("pointerenter", () => {
        const r = box.getBoundingClientRect(), k = r.width / 400;
        showTip(tip, p.x * k, r.width, `<span class="t-time">Track ${p.n} · ${fmt(tr.start)}</span><span class="t-title">${esc(nameOf(tr))}</span><span class="t-meta">${QUADS[p.q].name} · energy ${tr.energy.toFixed(1)} · ${keyOf(tr) || "?"}</span>`, p.y * k + 14);
      });
      el.addEventListener("pointerleave", () => (tip.hidden = true));
      const go = () => seek(tr.start + 0.05, true);
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
    $("mmLine").textContent = M.sentence;
    $("mmQuads").innerHTML = ["euphoric", "intense", "warm", "brooding"].map((q) =>
      `<div class="mmq${q === M.home ? " home" : ""}"><span class="mmq-l">${QUADS[q].name}</span><span class="cb-bar"><i style="width:${Math.round(M.share[q] * 100)}%"></i></span><span class="mmq-v">${Math.round(M.share[q] * 100)}%</span><span class="mmq-h">${QUADS[q].hint}</span></div>`).join("") +
      (M.jump ? `<button class="ghost mm-jump" id="mmJump">Biggest swing: track ${M.jump.from} → ${M.jump.to}</button>` : "");
    if (M.jump) $("mmJump").addEventListener("click", () => seek(T[M.jump.to - 1].start - 8, true));
    updateMoodMap(Math.max(0, S.cur));
  }
  function updateMoodMap(i) {
    const M = S.mood;
    if (!M || !$("mmDone")) return;
    const k = M.points.findIndex((p) => p.n === i + 1);
    const pts = (a) => a.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    $("mmDone").setAttribute("points", pts(M.points.slice(0, k + 1)));
    $("mmAhead").setAttribute("points", pts(M.points.slice(Math.max(0, k))));
    $("mmSvg").querySelectorAll(".mm-pt").forEach((el) => el.classList.toggle("now", +el.dataset.i === k));
  }

  return { renderMoodMap, updateMoodMap };
}
