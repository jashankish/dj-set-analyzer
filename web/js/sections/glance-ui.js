/* ============================================================
   Set Replay — At a glance: every timeline on the page, stacked on one
   time axis, so you can see how they line up.

   glanceSection(ctx) draws seven rows on one canvas: chapters, tracks (in
   key color), energy, vocals (vocals.js), the bass share (balance.js),
   drops (height = how hard they land) and mixes (solid in key, outlined
   for a bolder move, white for a clash). A crosshair follows the pointer
   and a readout lists every row at that moment; click to play from there.
   ============================================================ */
import { vocalMap } from "../vocals.js";
import { soundBalance } from "../balance.js";
import { BAND_COLOR } from "./balance-ui.js";

const ROWS = [["ch", "Chapters", 22], ["tr", "Tracks", 22], ["en", "Energy", 34], ["vo", "Vocals", 16], ["bs", "Bass", 26], ["dr", "Drops", 22], ["mx", "Mixes", 14]];
const LABEL = 70, GAP = 6;

export function glanceSection(ctx) {
  const { $, S, fit, fmt, esc, seek, showTip, clamp, keyColor, shortName, span } = ctx;
  let G = null;

  function renderGlance() {
    const D = S.D, [s0, s1] = span();
    G = { s0, s1, V: vocalMap(D), B: soundBalance(D), e: (D.curves && D.curves.energy) || { v: [], step: 1 } };
    const ev = G.e.v.slice(Math.floor(s0 / G.e.step), Math.ceil(s1 / G.e.step));
    G.emax = Math.max(1e-6, ...ev.map((x) => x || 0));
    if (G.B) { const b = G.B.bins.map((x) => x.low); G.blo = Math.min(...b); G.bhi = Math.max(...b); }
    G.maxImpact = Math.max(1, ...(D.drops || []).map((d) => d.impact_db || 0));
    $("glance").hidden = (D.tracks || []).length < 4;
    if ($("glance").hidden) return;
    $("glanceBox").style.height = `${ROWS.reduce((a, r) => a + r[2] + GAP, 0) + 14}px`;
    if (!renderGlance.bound) {
      renderGlance.bound = true;
      const box = $("glanceBox"), tip = box.querySelector(".tip");
      const at = (e) => { const r = box.getBoundingClientRect(), x = e.clientX - r.left; return { x, w: r.width, t: G.s0 + ((x - LABEL) / (r.width - LABEL)) * (G.s1 - G.s0) }; };
      const show = (e) => {
        const p = at(e);
        if (p.x < LABEL || p.t < G.s0 || p.t > G.s1) { tip.hidden = true; G.hover = null; drawGlance(); return; }
        G.hover = p.t; drawGlance();
        showTip(tip, p.x, p.w, readout(p.t), 6);
      };
      // a mouse reads as it moves; a finger has no hover, so a tap reads that moment too (and plays it)
      box.addEventListener("mousemove", show);
      box.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") show(e); });
      box.addEventListener("pointerleave", () => { tip.hidden = true; G.hover = null; drawGlance(); });
      box.addEventListener("click", (e) => { const p = at(e); if (p.x >= LABEL) seek(clamp(p.t, G.s0, G.s1 - 1), true); });
    }
    drawGlance();
  }

  function readout(t) {
    const D = S.D, tr = D.tracks.find((x) => t >= x.start && t < x.end), ph = (S.phases || []).find((p) => t >= p.start && t < p.end);
    const e = G.e.v[Math.round(t / G.e.step)] || 0, vc = G.V && G.V.cells.find((c) => t >= c.t0 && t < c.t1), bb = G.B && G.B.bins.find((b) => t >= b.t0 && b.t1 > t);
    const dr = (D.drops || []).find((d) => Math.abs(d.t - t) < 12), mx = (D.transitions || []).find((m) => t >= m.mix_in - 1 && t <= m.mix_out + 1);
    const rows = [
      ph && `<b>${esc(ph.label)}</b>`,
      tr && `${esc(shortName(tr))}${tr.key ? ` · ${esc(tr.key.camelot)}` : ""}`,
      `energy ${(e).toFixed(1)}${vc ? ` · ${vc.v >= 0.5 ? "vocals" : "instrumental"}` : ""}${bb ? ` · bass ${Math.round(bb.low * 100)}%` : ""}`,
      dr && `drop at ${fmt(dr.t)}`,
      mx && `mixing: ${esc(mx.type.toLowerCase())}, ${esc(mx.harmonic.label.toLowerCase())}`,
    ].filter(Boolean);
    return `<span class="t-time">${fmt(t)}</span>${rows.map((r, i) => `<span class="${i ? "t-meta" : "t-title"}">${r}</span>`).join("")}`;
  }

  function drawGlance(t) {
    if (!G || $("glance").hidden) return;
    if (t != null) G.now = t;
    const D = S.D, { ctx: g, w } = fit($("glanceCanvas"));
    const { s0, s1 } = G, X = (s) => LABEL + ((s - s0) / (s1 - s0)) * (w - LABEL);
    g.clearRect(0, 0, w, 9999);
    let y = 0;
    g.textBaseline = "middle";
    for (const [id, label, hgt] of ROWS) {
      g.fillStyle = "rgba(255,255,255,.035)"; g.fillRect(LABEL, y, w - LABEL, hgt);
      g.fillStyle = "#928DA6"; g.font = "600 10.5px Archivo, sans-serif"; g.textAlign = "left"; g.fillText(label, 0, y + hgt / 2);
      if (id === "ch") (S.phases || []).forEach((p, i) => {
        g.fillStyle = i % 2 ? "rgba(239,236,245,.10)" : "rgba(239,236,245,.18)";
        g.fillRect(X(p.start) + 1, y, X(p.end) - X(p.start) - 2, hgt);
        g.fillStyle = "#EFECF5"; g.font = "600 10.5px Archivo, sans-serif";
        if (X(p.end) - X(p.start) > 60) g.fillText(p.label, X(p.start) + 6, y + hgt / 2);
      });
      if (id === "tr") D.tracks.forEach((tr) => {
        const a = Math.max(tr.start, s0), b = Math.min(tr.end, s1); if (b <= a) return;
        g.fillStyle = keyColor(tr.key && tr.key.camelot, "base"); g.fillRect(X(a) + 0.5, y, Math.max(1, X(b) - X(a) - 1), hgt);
      });
      if (id === "en") {
        g.beginPath(); g.moveTo(X(s0), y + hgt);
        for (let px = LABEL; px <= w; px += 2) { const s = s0 + ((px - LABEL) / (w - LABEL)) * (s1 - s0); const v = G.e.v[Math.round(s / G.e.step)] || 0; g.lineTo(px, y + hgt - (v / G.emax) * (hgt - 2)); }
        g.lineTo(w, y + hgt); g.closePath(); g.fillStyle = "rgba(239,236,245,.55)"; g.fill();
      }
      if (id === "vo" && G.V) G.V.cells.forEach((c) => { g.fillStyle = `rgba(232,123,164,${(0.06 + 0.94 * clamp(c.v, 0, 1)).toFixed(2)})`; g.fillRect(X(c.t0), y, Math.max(1, X(c.t1) - X(c.t0) + 0.5), hgt); });
      if (id === "bs" && G.B) {
        const r = G.bhi - G.blo || 1;
        g.beginPath(); g.moveTo(X(G.B.bins[0].t0), y + hgt);
        G.B.bins.forEach((b) => g.lineTo(X((b.t0 + b.t1) / 2), y + hgt - ((b.low - G.blo) / r) * (hgt - 2)));
        g.lineTo(X(G.B.bins[G.B.bins.length - 1].t1), y + hgt); g.closePath(); g.fillStyle = BAND_COLOR.low; g.fill();
      }
      if (id === "dr") (D.drops || []).forEach((d) => {
        if (d.t < s0 || d.t > s1) return;
        const hh = 6 + ((d.impact_db || 0) / G.maxImpact) * (hgt - 6);
        g.fillStyle = "#EFECF5"; g.fillRect(X(d.t) - 1, y + hgt - hh, 2, hh);
      });
      if (id === "mx") (D.transitions || []).forEach((m) => {
        const a = X(m.mix_in), b = Math.max(a + 3, X(m.mix_out)), c = m.harmonic && m.harmonic.compatible;
        if (c === true) { g.fillStyle = "rgba(239,236,245,.6)"; g.fillRect(a, y + 2, b - a, hgt - 4); }
        else if (c === "partial") { g.strokeStyle = "rgba(239,236,245,.8)"; g.lineWidth = 1.5; g.strokeRect(a + 0.75, y + 2.75, b - a - 1.5, hgt - 5.5); }
        else { g.fillStyle = "#fff"; g.fillRect(a, y, b - a, hgt); }
      });
      y += hgt + GAP;
    }
    g.fillStyle = "#928DA6"; g.font = "500 10px Archivo, sans-serif"; g.textBaseline = "alphabetic";
    g.textAlign = "left"; g.fillText(fmt(s0), LABEL, y + 8); g.textAlign = "right"; g.fillText(fmt(s1), w, y + 8);
    const line = (s, color) => { if (s == null || s < s0 || s > s1) return; g.fillStyle = color; g.fillRect(X(s) - 1, 0, 2, y - GAP); };
    line(G.hover, "rgba(255,255,255,.5)");
    line(G.now, "#fff");
  }

  return { renderGlance, drawGlance };
}
