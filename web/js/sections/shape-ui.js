/* ============================================================
   Set Replay — the set's shape, in the journey column after Energy.
   shapeSection(ctx) draws shape.js's result as SVG: the set's energy arc
   (normalized, filled) with one template dashed on top, and every shape
   ranked beside it, each with a sketch of its template and a match bar.
   Click a shape to lay it over the arc; the best match is shown first.
   ============================================================ */
import { setShape } from "../shape.js";

export function shapeSection(ctx) {
  const { $, S, esc } = ctx;
  const W = 600, H = 150, P = 8;
  const path = (ys, w, h, pad) => ys.map((y, i) => `${i ? "L" : "M"}${(pad + (i / (ys.length - 1)) * (w - 2 * pad)).toFixed(1)},${(pad + (1 - y) * (h - 2 * pad)).toFixed(1)}`).join("");

  function renderShape() {
    const X = (S.shape = setShape(S.D));
    $("shapeBlock").hidden = !X;
    if (!X) return;
    $("shapeLine").textContent = X.sentence;
    S.shapePick = X.best ? X.best.id : X.matches[0].id;
    $("shapeList").innerHTML = X.matches.map((m) => `
      <button class="sh-row" data-id="${m.id}" aria-pressed="false">
        <svg viewBox="0 0 48 20" aria-hidden="true"><path d="${path(m.t, 48, 20, 2)}"/></svg>
        <span class="sh-name">${esc(m.name)}</span>
        <span class="sh-bar"><i style="width:${m.match}%"></i></span>
        <span class="sh-pct">${m.match}%</span>
      </button>`).join("");
    $("shapeList").onclick = (e) => { const b = e.target.closest(".sh-row"); if (b) { S.shapePick = b.dataset.id; drawShape(); } };
    drawShape();
  }

  function drawShape() {
    const X = S.shape, m = X.matches.find((x) => x.id === S.shapePick) || X.matches[0];
    const line = path(X.curve, W, H, P);
    const area = `${line}L${W - P},${H - P}L${P},${H - P}Z`;
    $("shapeSvg").innerHTML = `
      <path class="sh-area" d="${area}"/>
      <path class="sh-set" d="${line}"/>
      <path class="sh-tpl" d="${path(m.t, W, H, P)}"/>
      <text class="sh-lab" x="${P}" y="${H - P - 4}">${esc(m.name)} · ${m.match}%</text>`;
    $("shapeSvg").setAttribute("aria-label", `The set's energy arc, with the ${m.name.toLowerCase()} shape laid over it: ${m.match}% match`);
    $("shapeList").querySelectorAll(".sh-row").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === m.id)));
  }

  return { renderShape };
}
