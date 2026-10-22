/* ============================================================
   Set Replay — the tempo journey chart, under the key journey.
   tempoSection(ctx) draws tempo.js's result: each track's tempo (folded
   to the set's own, so a half-time track sits with the rest) as a thick
   step in its key color, the 10 s tempo readings as faint dots, ramps
   shaded, half/double-time switches marked "½×" / "2×", and the playhead.
   Hover for the track and its tempo; click to play from there.
   ============================================================ */
import { tempoJourney } from "../tempo.js";

export function tempoSection(ctx) {
  const { $, S, fit, fmt, esc, seek, showTip, clamp, keyColor, shortName } = ctx;
  const PAD = { l: 34, r: 8, t: 10, b: 18 };

  function renderTempo() {
    const T = (S.tempo = tempoJourney(S.D));
    $("tempoJourney").hidden = !T;
    if (!T) return;
    $("tjLine").textContent = T.sentence;
    const span = Math.max(8, T.hi - T.lo + 4), mid = (T.hi + T.lo) / 2;
    T.y0 = mid - span / 2; T.y1 = mid + span / 2;
    if (!renderTempo.bound) {
      renderTempo.bound = true;
      const box = $("tjBox"), tip = box.querySelector(".tip");
      const at = (e) => { const r = box.getBoundingClientRect(), T = S.tempo; return { x: e.clientX - r.left, w: r.width, t: T.s0 + ((e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)) * (T.s1 - T.s0) }; };
      box.addEventListener("mousemove", (e) => {
        const p = at(e), T = S.tempo, i = T.steps.findIndex((x) => p.t >= x.start && p.t < x.end);
        if (i < 0) { tip.hidden = true; return; }
        const st = T.steps[i], tr = S.D.tracks.find((x) => x.n === st.n), j = T.jumps.find((x) => x.n === st.n);
        showTip(tip, p.x, p.w, `<span class="t-time">${fmt(st.start)}–${fmt(st.end)}</span><span class="t-title">${esc(shortName(tr))}</span><span class="t-meta">${st.bpm.toFixed(1)} BPM${T.felt[i].bpm !== st.bpm ? ` (feels like ${T.felt[i].bpm.toFixed(0)})` : ""}${j ? ` · ${j.kind}` : ""}</span>`, 6);
      });
      box.addEventListener("mouseleave", () => (tip.hidden = true));
      box.addEventListener("click", (e) => seek(clamp(at(e).t, S.tempo.s0, S.tempo.s1 - 1), true));
    }
    drawTempo();
  }

  function drawTempo(t) {
    const T = S.tempo;
    if (!T || $("tempoJourney").hidden) return;
    const { ctx: g, w, h } = fit($("tjCanvas"));
    g.clearRect(0, 0, w, h);
    const X = (s) => PAD.l + ((s - T.s0) / (T.s1 - T.s0)) * (w - PAD.l - PAD.r);
    const Y = (b) => PAD.t + (1 - (b - T.y0) / (T.y1 - T.y0)) * (h - PAD.t - PAD.b);
    // gridlines every 2, 5 or 10 BPM, depending on the span
    const step = T.y1 - T.y0 > 30 ? 10 : T.y1 - T.y0 > 12 ? 5 : 2;
    g.font = "500 10px Archivo, sans-serif"; g.textAlign = "right"; g.fillStyle = "#928DA6";
    for (let b = Math.ceil(T.y0 / step) * step; b <= T.y1; b += step) {
      g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(PAD.l, Math.round(Y(b)), w - PAD.l - PAD.r, 1);
      g.fillStyle = "#928DA6"; g.fillText(String(b), PAD.l - 6, Y(b) + 3);
    }
    // ramps (a locked set's few-BPM drift isn't one)
    if (!T.locked) T.ramps.forEach((r) => { g.fillStyle = "rgba(57,135,229,.10)"; g.fillRect(X(r.t0), PAD.t, X(r.t1) - X(r.t0), h - PAD.t - PAD.b); });
    // 10 s readings, folded like the tracks
    const c = S.D.curves && S.D.curves.bpm;
    if (c && c.t) {
      g.fillStyle = "rgba(239,236,245,.22)";
      c.t.forEach((s, i) => {
        const v = c.v[i]; if (!v || s < T.s0 || s > T.s1) return;
        const f = [v, v * 2, v / 2].reduce((x, y) => (Math.abs(y - T.med) < Math.abs(x - T.med) ? y : x));
        if (f >= T.y0 && f <= T.y1) g.fillRect(X(s) - 1, Y(f) - 1, 2, 2);
      });
    }
    // each track's tempo
    g.lineCap = "round";
    T.steps.forEach((st, i) => {
      const f = T.felt[i].bpm, tr = S.D.tracks.find((x) => x.n === st.n);
      g.strokeStyle = keyColor(tr && tr.key && tr.key.camelot, "base"); g.lineWidth = 5;
      g.beginPath(); g.moveTo(X(st.start) + 2, Y(f)); g.lineTo(Math.max(X(st.start) + 3, X(st.end) - 2), Y(f)); g.stroke();
    });
    g.textAlign = "center"; g.font = "700 10.5px Archivo, sans-serif"; g.fillStyle = "#EFECF5";
    T.jumps.filter((j) => j.kind === "half-time" || j.kind === "double-time").forEach((j) => {
      const i = T.steps.findIndex((x) => x.n === j.n);
      g.fillText(j.kind === "half-time" ? "½×" : "2×", X(j.t), Y(T.felt[i].bpm) - 8);
    });
    if (t != null && t >= T.s0 && t <= T.s1) { g.fillStyle = "#fff"; g.fillRect(X(t) - 1, PAD.t - 4, 2, h - PAD.t - PAD.b + 8); }
    g.fillStyle = "#928DA6"; g.font = "500 10px Archivo, sans-serif"; g.textAlign = "left";
    g.fillText(fmt(T.s0), PAD.l, h - 3); g.textAlign = "right"; g.fillText(fmt(T.s1), w - PAD.r, h - 3);
  }

  return { renderTempo, drawTempo };
}
