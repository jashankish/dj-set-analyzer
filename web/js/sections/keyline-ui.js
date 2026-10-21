/* ============================================================
   Set Replay — the key journey chart, under the Camelot wheel.
   keylineSection(ctx) draws keyline.js's stretches against time: a thick
   line per stretch in its key's color (major a little above minor), and a
   connector per key change whose dash says what kind it is (solid clean,
   dashed bolder, dotted clash), plus the playhead. Hover for the stretch,
   click to play from there.
   ============================================================ */
import { keyTimeline } from "../keyline.js";

export function keylineSection(ctx) {
  const { $, S, fit, keyColor, fmt, esc, seek, showTip, clamp } = ctx;
  const PAD = { l: 30, r: 8, t: 10, b: 18 };

  function renderKeyline() {
    const K = (S.keyline = keyTimeline(S.D));
    $("keyJourney").hidden = !K;
    if (!K) return;
    $("kjLine").textContent = K.sentence;
    if (renderKeyline.bound) { drawKeyline(); return; }
    renderKeyline.bound = true;
    const box = $("kjBox"), tip = box.querySelector(".tip");
    const at = (e) => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, w: r.width, t: S.keyline.s0 + ((e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)) * (S.keyline.s1 - S.keyline.s0) }; };
    box.addEventListener("pointermove", (e) => {
      const p = at(e), seg = S.keyline.segs.find((s) => p.t >= s.start && p.t < s.end);
      if (!seg) { tip.hidden = true; return; }
      const mv = S.keyline.moves.find((m) => m.to === seg.key && Math.abs(m.t - seg.start) < 1);
      showTip(tip, p.x, p.w, `<span class="t-time">${fmt(seg.start)}–${fmt(seg.end)}</span><span class="t-title">${esc(seg.key)}, tracks ${seg.tracks[0]}${seg.tracks.length > 1 ? `–${seg.tracks[seg.tracks.length - 1]}` : ""}</span>${mv ? `<span class="t-meta">came in from ${esc(mv.from)}: ${esc(mv.label.toLowerCase())}</span>` : ""}`, 6);
    });
    box.addEventListener("pointerleave", () => (tip.hidden = true));
    box.addEventListener("click", (e) => seek(clamp(at(e).t, S.keyline.s0, S.keyline.s1 - 1), true));
    drawKeyline();
  }

  function drawKeyline(t) {
    const K = S.keyline;
    if (!K || $("keyJourney").hidden) return;
    const { ctx: g, w, h } = fit($("kjCanvas"));
    g.clearRect(0, 0, w, h);
    const lo = K.range[0] - 0.6, hi = K.range[1] + 0.9;
    const X = (s) => PAD.l + ((s - K.s0) / (K.s1 - K.s0)) * (w - PAD.l - PAD.r);
    const Y = (lv, mode) => PAD.t + (1 - (lv + (mode === "B" ? 0.3 : 0) - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
    // wheel-position guides, labeled with the Camelot number they wrap to
    g.font = "500 10px Archivo, sans-serif"; g.textAlign = "right"; g.fillStyle = "#928DA6";
    for (let lv = Math.ceil(lo); lv <= Math.floor(hi); lv++) {
      g.strokeStyle = "rgba(255,255,255,.05)"; g.beginPath(); g.moveTo(PAD.l, Y(lv)); g.lineTo(w - PAD.r, Y(lv)); g.stroke();
      g.fillText(String(((lv - 1) % 12 + 12) % 12 + 1), PAD.l - 6, Y(lv) + 3);
    }
    // connectors: the kind of move is in the dash, not only the color
    K.moves.forEach((m, i) => {
      const a = K.segs[i], b = K.segs[i + 1], x = X(m.t);
      g.setLineDash(m.compatible === true ? [] : m.compatible === "partial" ? [5, 4] : [1.5, 3]);
      g.strokeStyle = "rgba(239,236,245,.7)"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, Y(a.level, a.mode)); g.lineTo(x, Y(b.level, b.mode)); g.stroke();
    });
    g.setLineDash([]);
    // stretches
    g.lineCap = "round"; g.textAlign = "left";
    K.segs.forEach((s) => {
      const x0 = X(s.start), x1 = X(s.end), y = Y(s.level, s.mode);
      g.strokeStyle = keyColor(s.key, "base"); g.lineWidth = 6;
      g.beginPath(); g.moveTo(x0 + 2, y); g.lineTo(Math.max(x0 + 3, x1 - 2), y); g.stroke();
      if (x1 - x0 > 28) { g.fillStyle = keyColor(s.key, "ink"); g.font = "700 10.5px Archivo, sans-serif"; g.fillText(s.key, x0 + 3, y - 7); }
    });
    // playhead
    const now = t != null ? t : null;
    if (now != null && now >= K.s0 && now <= K.s1) { g.fillStyle = "#fff"; g.fillRect(X(now) - 1, PAD.t - 4, 2, h - PAD.t - PAD.b + 8); }
    g.fillStyle = "#928DA6"; g.font = "500 10px Archivo, sans-serif"; g.textAlign = "left";
    g.fillText(fmt(K.s0), PAD.l, h - 3); g.textAlign = "right"; g.fillText(fmt(K.s1), w - PAD.r, h - 3);
  }

  return { renderKeyline, drawKeyline };
}
