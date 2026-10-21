/* ============================================================
   Set Replay — Track by track: the similarity matrix and its insights.
   Moved out of app.js as is: simSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */

export function simSection(ctx) {
  const { $, S, X, esc, fit, keyColor, keyOf, seek, shortName, showTip, span, tracks } = ctx;

  function renderSim() {
    const X = S.sim, T = tracks();
    $("simx").hidden = !X;
    if (!X) return;
    const nm = (n) => `${n}. ${shortName(T[n - 1])}`;
    $("sxLine").textContent = `Track to track, the set hands over between sounds that are ${Math.round(X.flowAvg * 100)}% alike on average.`;
    const notes = [];
    if (X.run) notes.push(["The most consistent stretch", `tracks ${X.run.from}–${X.run.to}, every hand-over ${Math.round(X.run.mean * 100)}% alike on average`, X.run.from]);
    if (X.echo) notes.push(["The set comes back to a sound", `${nm(X.echo.a)} and ${nm(X.echo.b)}, ${X.echo.b - X.echo.a} tracks apart, are ${Math.round(X.echo.v * 100)}% alike`, X.echo.b]);
    if (X.turn) notes.push(["The hardest turn", `${nm(X.turn.a)} into ${nm(X.turn.b)}, only ${Math.round(X.turn.v * 100)}% alike`, X.turn.b]);
    $("sxNotes").innerHTML = notes.map(([k, v, n]) => `<button class="cb-mo" data-n="${n}"><b>${esc(k)}</b><span>${esc(v)}</span></button>`).join("");
    $("sxNotes").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => seek(T[+b.dataset.n - 1].start + 0.05, true)));
    if (renderSim.bound) { drawSim(); return; }
    renderSim.bound = true;
    const box = $("sxBox"), tip = box.querySelector(".tip");
    const cell = (e) => {
      const r = box.getBoundingClientRect(), n = S.sim.n;
      const i = Math.floor(((e.clientY - r.top) / r.height) * n), j = Math.floor(((e.clientX - r.left) / r.width) * n);
      return i >= 0 && j >= 0 && i < n && j < n ? { i, j, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width } : null;
    };
    box.addEventListener("pointermove", (e) => {
      const c = cell(e), T2 = tracks();
      if (!c) { tip.hidden = true; return; }
      showTip(tip, c.x, c.w, `<span class="t-title">${esc(`${c.i + 1}. ${shortName(T2[c.i])}`)} × ${esc(`${c.j + 1}. ${shortName(T2[c.j])}`)}</span><span class="t-meta">${Math.round(S.sim.M[c.i][c.j] * 100)}% alike · ${keyOf(T2[c.i]) || "?"} / ${keyOf(T2[c.j]) || "?"}</span>`, c.y + 14);
    });
    box.addEventListener("pointerleave", () => (tip.hidden = true));
    box.addEventListener("click", (e) => { const c = cell(e); if (c) seek(tracks()[c.j].start + 0.05, true); });
    drawSim();
  }
  function drawSim() {
    const X = S.sim;
    if (!X || $("simx").hidden) return;
    const { ctx, w } = fit($("sxCanvas"));
    const n = X.n, s = w / n;
    ctx.fillStyle = "#1C1B26"; ctx.fillRect(0, 0, w, w);
    // map the set's own range onto the ink ramp, so its structure shows
    let lo = 1, hi = 0;
    X.M.forEach((r, i) => r.forEach((v, j) => { if (i !== j) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = i === j ? 1 : (X.M[i][j] - lo) / Math.max(0.01, hi - lo);
      ctx.fillStyle = `rgba(239,236,245,${(0.06 + 0.9 * v * v).toFixed(3)})`;
      ctx.fillRect(j * s + 0.5, i * s + 0.5, Math.max(1, s - 1), Math.max(1, s - 1));
    }
    // chapters as boxes along the diagonal
    ctx.strokeStyle = "rgba(185,168,255,.9)"; ctx.lineWidth = 1.5;
    (S.phases || []).forEach((p) => { const a = (p.from - 1) * s, b = p.to * s; ctx.strokeRect(a + 0.75, a + 0.75, b - a - 1.5, b - a - 1.5); });
    // the playing track's row and column
    if (S.cur >= 0) {
      const c = S.cur * s, k = keyColor(keyOf(tracks()[S.cur]), "base");
      ctx.strokeStyle = k; ctx.lineWidth = 2;
      ctx.strokeRect(0.5, c + 0.5, w - 1, s - 1); ctx.strokeRect(c + 0.5, 0.5, s - 1, w - 1);
    }
  }

  return { drawSim, renderSim };
}
