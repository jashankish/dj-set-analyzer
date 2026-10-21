/* ============================================================
   Set Replay — frequency balance chart, in the journey column.
   balanceSection(ctx) draws balance.js's windows as a 100% stack (bass at
   the bottom, then mids, then highs) with a 2px seam in the panel color
   between bands, the bands named at the right edge, track boundaries as
   ticks, and the playhead. Hover reads out the window's split and the track;
   click plays from there. Below: the heaviest and brightest tracks.
   ============================================================ */
import { soundBalance } from "../balance.js";

export const BAND_COLOR = { low: "#9085E9", mid: "#199E70", high: "#C98500" };   // validated on the panel surface
const BAND_NAME = { low: "Bass", mid: "Mids", high: "Highs" };

export function balanceSection(ctx) {
  const { $, S, fit, fmt, esc, seek, showTip, clamp, nameOf, shortName } = ctx;
  const PAD = { l: 0, r: 46, t: 4, b: 4 };
  const trackName = (n) => nameOf(S.D.tracks.find((x) => x.n === n));

  function renderBalance() {
    const B = (S.balance = soundBalance(S.D));
    $("balBlock").hidden = !B;
    if (!B) return;
    $("balLine").textContent = B.sentence;
    const pc = (x) => `${Math.round(x * 100)}%`;
    $("balTop").innerHTML = [["Heaviest", B.heaviest, `${pc(B.heaviest.low)} bass`], ["Brightest", B.brightest, `${pc(B.brightest.high)} highs`]]
      .map(([k, t, v]) => `<button class="bal-pick" data-t="${t.start}"><span class="bal-k">${k}</span> ${esc(shortName(S.D.tracks.find((x) => x.n === t.n)))} <span class="bal-v">${v}</span></button>`).join("");
    $("balTop").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => seek(+b.dataset.t + 0.05, true)));
    if (!renderBalance.bound) {
      renderBalance.bound = true;
      const box = $("balBox"), tip = box.querySelector(".tip");
      const at = (e) => { const r = box.getBoundingClientRect(), B = S.balance; return { x: e.clientX - r.left, w: r.width, t: B.s0 + ((e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)) * (B.s1 - B.s0) }; };
      box.addEventListener("pointermove", (e) => {
        const p = at(e), B = S.balance, b = B.bins.find((x) => p.t >= x.t0 && p.t < x.t1), tr = B.tracks.find((x) => p.t >= x.start && p.t < x.end);
        if (!b) { tip.hidden = true; return; }
        showTip(tip, p.x, p.w, `<span class="t-time">${fmt(b.t0)}</span>${tr ? `<span class="t-title">${esc(trackName(tr.n))}</span>` : ""}` +
          `<span class="t-meta">bass ${pc(b.low)} · mids ${pc(b.mid)} · highs ${pc(b.high)}${tr && tr.lean !== "balanced" ? ` · track: ${tr.lean}` : ""}</span>`, 6);
      });
      box.addEventListener("pointerleave", () => (tip.hidden = true));
      box.addEventListener("click", (e) => seek(clamp(at(e).t, S.balance.s0, S.balance.s1 - 1), true));
    }
    drawBalance();
  }

  function drawBalance(t) {
    const B = S.balance;
    if (!B || $("balBlock").hidden) return;
    const { ctx: g, w, h } = fit($("balCanvas"));
    g.clearRect(0, 0, w, h);
    const X = (s) => PAD.l + ((s - B.s0) / (B.s1 - B.s0)) * (w - PAD.l - PAD.r);
    const Y = (f) => PAD.t + (1 - f) * (h - PAD.t - PAD.b);
    // stacked from the bottom: bass, bass+mids, then everything
    const tops = { low: (b) => b.low, mid: (b) => b.low + b.mid, high: () => 1 };
    let below = B.bins.map((b) => [X((b.t0 + b.t1) / 2), Y(0)]);
    for (const k of ["low", "mid", "high"]) {
      const top = B.bins.map((b) => [X((b.t0 + b.t1) / 2), Y(tops[k](b))]);
      g.beginPath();
      g.moveTo(X(B.bins[0].t0), top[0][1]);
      top.forEach(([x, y]) => g.lineTo(x, y));
      g.lineTo(X(B.bins[B.bins.length - 1].t1), top[top.length - 1][1]);
      g.lineTo(X(B.bins[B.bins.length - 1].t1), below[below.length - 1][1]);
      for (let i = below.length - 1; i >= 0; i--) g.lineTo(below[i][0], below[i][1]);
      g.lineTo(X(B.bins[0].t0), below[0][1]);
      g.closePath();
      g.fillStyle = BAND_COLOR[k];
      g.fill();
      below = top;
    }
    // 2px seams in the panel color between the bands
    g.strokeStyle = "#201E2B"; g.lineWidth = 2;
    for (const k of ["low", "mid"]) {
      g.beginPath();
      B.bins.forEach((b, i) => { const x = X((b.t0 + b.t1) / 2), y = Y(tops[k](b)); i ? g.lineTo(x, y) : (g.moveTo(X(b.t0), y), g.lineTo(x, y)); });
      const lb = B.bins[B.bins.length - 1]; g.lineTo(X(lb.t1), Y(tops[k](lb)));
      g.stroke();
    }
    // track boundaries
    g.fillStyle = "rgba(32,30,43,.85)";
    B.tracks.slice(1).forEach((tr) => g.fillRect(X(tr.start) - 0.5, PAD.t, 1, h - PAD.t - PAD.b));
    // direct labels at the right edge, at the middle of each band's last window
    const lb = B.bins[B.bins.length - 1];
    g.font = "600 11px Archivo, sans-serif"; g.textAlign = "left"; g.fillStyle = "#C3BED3";
    let prev = Infinity;
    for (const [k, mid] of [["low", lb.low / 2], ["mid", lb.low + lb.mid / 2], ["high", lb.low + lb.mid + lb.high / 2]]) {
      let y = Y(mid) + 4;
      if (prev - y < 12) y = prev - 12;
      g.fillText(BAND_NAME[k], w - PAD.r + 6, clamp(y, 11, h - 2));
      prev = y;
    }
    if (t != null && t >= B.s0 && t <= B.s1) { g.fillStyle = "#fff"; g.fillRect(X(t) - 1, 0, 2, h); }
  }

  return { renderBalance, drawBalance };
}
