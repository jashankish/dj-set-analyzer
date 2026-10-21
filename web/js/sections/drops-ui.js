/* ============================================================
   Set Replay — Drop anatomy: every drop's bass line, lined up where it lands.
   Moved out of app.js as is: dropsSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */
import { POST, PRE, dropAnatomy } from "../drops.js";

export function dropsSection(ctx) {
  const { $, S, X, clamp, fit, fmt, keyColor, now, seek, showTip, span } = ctx;

  function renderDrops() {
    const A = (S.dropA = dropAnatomy(S.D));
    S.dropLive = -1; S.dropHover = -1;
    $("dropBlock").hidden = !A;
    if (!A) return;
    $("dropSub").textContent = `Every drop's bass line, lined up where it lands · ${A.style.name}`;
    $("dropLine").textContent = A.sentence;
    $("dropTop").innerHTML = `<span class="j-sub">Biggest drops:</span>` + A.top.map((r) => `<button class="ghost" data-t="${r.t}">${fmt(r.t)}${r.n ? ` · track ${r.n}` : ""} · ${Math.round(r.impact_db)} dB</button>`).join("");
    $("dropTop").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => seek(+b.dataset.t - 12, true)));
    if (renderDrops.bound) return;
    renderDrops.bound = true;
    const box = $("dropBox"), tip = box.querySelector(".tip");
    const pick = (e) => {
      const r = box.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const A2 = S.dropA, k = Math.round(((x / r.width) * (PRE + POST)) / 0.5);
      const yv = 1 - (y - 8) / (r.height - 26);
      let best = -1, d = Infinity;
      A2.rows.forEach((row, i) => { const v = row.curve[clamp(k, 0, row.curve.length - 1)]; if (v != null && Math.abs(v - yv) < d) { d = Math.abs(v - yv); best = i; } });
      return { best, x, w: r.width };
    };
    box.addEventListener("pointermove", (e) => {
      if (!S.dropA) return;
      const { best, x, w } = pick(e);
      if (best !== S.dropHover) { S.dropHover = best; drawDrops(); }
      const row = S.dropA.rows[best];
      if (row) showTip(tip, x, w, `<span class="t-time">Drop at ${fmt(row.t)}${row.n ? ` · track ${row.n}` : ""}</span><span class="t-meta">${Math.round(row.breakdown_s)} s breakdown, bass down ${Math.round(row.depth_db)} dB, lands ${Math.round(row.impact_db)} dB harder</span>`, 6);
    });
    box.addEventListener("pointerleave", () => { tip.hidden = true; S.dropHover = -1; drawDrops(); });
    box.addEventListener("click", (e) => { if (!S.dropA) return; const row = S.dropA.rows[pick(e).best]; if (row) seek(row.t - 12, true); });
  }
  function drawDrops() {
    const A = S.dropA;
    if (!A || $("dropBlock").hidden) return;
    const { ctx, w, h } = fit($("dropCanvas"));
    ctx.clearRect(0, 0, w, h);
    const X = (dt) => ((dt + PRE) / (PRE + POST)) * w, Y = (v) => 8 + (1 - v) * (h - 26);
    // the typical breakdown, shaded, and the moment of the drop
    ctx.fillStyle = "rgba(255,255,255,.045)";
    ctx.fillRect(X(-A.stats.breakdown), 0, X(0) - X(-A.stats.breakdown), h - 18);
    ctx.strokeStyle = "rgba(239,236,245,.35)"; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), h - 18); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#9792AB"; ctx.font = "500 10.5px Archivo, sans-serif";
    [-32, -24, -16, -8, 0, 8, 16].forEach((s) => { ctx.textAlign = "center"; ctx.fillText(s === 0 ? "drop" : `${s > 0 ? "+" : ""}${s} s`, clamp(X(s), 14, w - 14), h - 4); });
    ctx.textAlign = "left";
    const path = (curve) => { ctx.beginPath(); let on = false; curve.forEach((v, k) => { if (v == null) { on = false; return; } const x = X(A.xs[k]), y = Y(v); on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; }); };
    const focus = S.dropHover >= 0 ? S.dropHover : S.dropLive;
    A.rows.forEach((r, i) => {
      if (i === focus) return;
      path(r.curve);
      ctx.strokeStyle = keyColor(r.key, "base", focus >= 0 ? 0.25 : 0.5); ctx.lineWidth = 1.2; ctx.stroke();
    });
    path(A.mean); ctx.strokeStyle = "rgba(239,236,245,.95)"; ctx.lineWidth = 2.5; ctx.stroke();
    if (focus >= 0) {
      const r = A.rows[focus];
      path(r.curve); ctx.strokeStyle = keyColor(r.key, "ink"); ctx.lineWidth = 2.5; ctx.stroke();
      if (focus === S.dropLive) {                          // where playback is on this drop
        const dt = now() - r.t, k = clamp(Math.round((dt + PRE) / 0.5), 0, r.curve.length - 1);
        if (r.curve[k] != null) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(X(dt), Y(r.curve[k]), 4, 0, Math.PI * 2); ctx.fill(); }
      }
    }
  }

  return { drawDrops, renderDrops };
}
