/* Small read-only renderers for the landing page: the key-colored ribbon,
   key strips for cards, and the Camelot path. Same visual rules as the
   viewer (js/app.js). Uses window.KeyColor from color.js. */
const { keyRgb } = window.KeyColor;

export function fit(c) {
  const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d");
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, r) => a.map((v, i) => Math.round(v + (b[i] - v) * r));

/* color at time t, cross-fading through mixes */
function colorer(P) {
  const T = P.tracks, M = P.transitions;
  const tones = T.map((t) => ({ deep: keyRgb(t.key && t.key.camelot, "deep"), base: keyRgb(t.key && t.key.camelot, "base"), pale: keyRgb(t.key && t.key.camelot, "pale") }));
  return (t, tone) => {
    let i = 0;
    while (i < T.length - 1 && T[i + 1].start <= t) i++;
    for (const m of [M[i - 1], M[i]]) {
      if (m && t >= m.mix_in && t <= m.mix_out) return mix(tones[m.from - 1][tone], tones[m.to - 1][tone], (t - m.mix_in) / Math.max(1, m.mix_out - m.mix_in));
    }
    return tones[i][tone];
  };
}

/* the set ribbon: mirrored 3-band waveform, tinted by key */
export function drawRibbon(canvas, P, { t0 = 0, t1 = null, playhead = null, alpha = 1 } = {}) {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  t1 = t1 == null ? (P.summary.set_end || P.duration) : t1;
  const fps = P.curves.wave_fps, W = P.curves.wave, col = colorer(P), mid = h / 2, amp = mid - 2;
  const mx = (band, a, b) => {
    const arr = W[band], i0 = Math.max(0, Math.floor(a * fps)), i1 = Math.min(arr.length, Math.max(i0 + 1, Math.ceil(b * fps)));
    let m = 0;
    for (let i = i0; i < i1; i++) if (arr[i] > m) m = arr[i];
    return m / 99;
  };
  for (let x = 0; x < w; x++) {
    const a = t0 + ((t1 - t0) * x) / w, b = t0 + ((t1 - t0) * (x + 1)) / w, tm = (a + b) / 2;
    const lo = mx("low", a, b), mi = mx("mid", a, b), hi = mx("high", a, b);
    ctx.fillStyle = rgb(col(tm, "deep"), alpha); ctx.fillRect(x, mid - lo * amp, 1, lo * amp * 2);
    ctx.fillStyle = rgb(col(tm, "base"), alpha); ctx.fillRect(x, mid - mi * amp * 0.78, 1, mi * amp * 1.56);
    ctx.fillStyle = rgb(col(tm, "pale"), alpha); ctx.fillRect(x, mid - hi * amp * 0.5, 1, hi * amp);
  }
  if (playhead != null) {
    const x = ((playhead - t0) / (t1 - t0)) * w;
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.fillRect(x - 1, 0, 2, h);
  }
}

/* Animated ribbon: the waveform is rendered once per canvas size into an
   offscreen canvas, so each frame only copies it and draws the playhead
   (~0.1 ms instead of ~6 ms per frame on a fast laptop). */
const layers = new WeakMap();
export function drawRibbonFast(canvas, P, { playhead = null } = {}) {
  const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  let layer = layers.get(canvas);
  if (!layer || layer.w !== w || layer.h !== h || layer.P !== P) {
    drawRibbon(canvas, P);                                   // full render at the current size
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    off.getContext("2d").drawImage(canvas, 0, 0);
    layer = { w, h, P, off };
    layers.set(canvas, layer);
  }
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(layer.off, 0, 0);
  if (playhead != null) {
    const end = P.summary.set_end || P.duration;
    const x = Math.round((playhead / end) * w);
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.fillRect(x - d, 0, 2 * d, h);
  }
}

/* key strip for cards: one block per track */
export function drawStrip(canvas, segs, end) {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  const total = end || (segs.length ? segs[segs.length - 1][1] : 1);
  segs.forEach(([s, e, k], i) => {
    const x0 = (s / total) * w, x1 = (Math.min(e, total) / total) * w;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgb(keyRgb(k, "base")));
    grad.addColorStop(1, rgb(keyRgb(k, "deep")));
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0 - (i < segs.length - 1 ? 2 : 0)), h);
  });
}

/* Camelot wheel with the set's path */
export function drawWheel(svg, P) {
  const R = { B: [150, 190], A: [106, 146] };
  const pos = (code, r) => {
    const n = parseInt(code, 10), ang = (((n % 12) * 30 - 90) * Math.PI) / 180;
    return [Math.cos(ang) * r, Math.sin(ang) * r, ang];
  };
  const arc = (r0, r1, a0, a1) => {
    const p = (r, a) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
    return `M${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
  };
  const used = new Set(P.tracks.map((t) => t.key && t.key.camelot).filter(Boolean));
  const parts = [];
  for (let n = 1; n <= 12; n++) for (const m of ["B", "A"]) {
    const code = `${n}${m}`, [r0, r1] = R[m], c = (((n % 12) * 30 - 90) * Math.PI) / 180;
    parts.push(`<path d="${arc(r0, r1, c - Math.PI / 12 + 0.01, c + Math.PI / 12 - 0.01)}" fill="${window.KeyColor.keyColor(code, "base")}" opacity="${used.has(code) ? 1 : 0.16}" stroke="#16151E" stroke-width="2"/>`);
  }
  const counts = {};
  const pts = P.tracks.filter((t) => t.key).map((t) => {
    const k = t.key.camelot, idx = (counts[k] = (counts[k] || 0) + 1) - 1;
    const [, , ang] = pos(k, 1), base = R[k.slice(-1)];
    const a = ang + (idx % 3 - 1) * 0.12, r = base[0] + 12 + (idx % 2) * 12;
    return [Math.cos(a) * r, Math.sin(a) * r, k];
  });
  let d = "";
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const pull = Math.min(0.8, Math.hypot(ax - bx, ay - by) / 340);
    d += `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${(((ax + bx) / 2) * (1 - pull)).toFixed(1)} ${(((ay + by) / 2) * (1 - pull)).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  parts.push(`<path d="${d}" fill="none" stroke="#EFECF5" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>`);
  pts.forEach(([x, y, k]) => parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${window.KeyColor.keyColor(k, "pale")}" stroke="#16151E" stroke-width="2"/>`));
  svg.innerHTML = parts.join("");
}
