/* ============================================================
   Set Replay — the set card: one shareable image of the set.

   cardData(D, opts) gathers what the card says, from the same analyses
   the page shows (vibe.js, craft.js, moodmap.js, phases.js); it has no
   DOM, so tools/analysis-test.mjs checks it in Node.
   drawCard(ctx, data, keyColor) paints it on a 1080 × 1350 canvas
   (portrait, the shape social apps show whole): title and facts, the
   energy arc in key colors with the chapters, the vibe radar, mixing
   style / home key / mood route / chapters, keyword chips, and the
   short playlist prompt.
   ============================================================ */
import { vibeProfile, buildPrompt, AXES } from "./vibe.js";
import { craftProfile } from "./craft.js";
import { moodMap } from "./moodmap.js";
import { findPhases } from "./phases.js";

export const CARD = { w: 1080, h: 1350 };

const clock = (t) => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`; };

export function cardData(D, { title, names = {}, off } = {}) {
  const s = D.summary || {}, T = D.tracks || [];
  const P = vibeProfile(D, names), C = craftProfile(D), M = moodMap(D), ph = findPhases(D);
  const s0 = s.set_start || 0, s1 = s.set_end || D.duration;
  const time = {};
  T.forEach((t) => { const k = t.key && t.key.camelot; if (k) time[k] = (time[k] || 0) + Math.max(0, Math.min(t.end, s1) - Math.max(t.start, s0)); });
  const home = Object.entries(time).sort((a, b) => b[1] - a[1])[0];
  const homeName = home ? (T.find((t) => t.key && t.key.camelot === home[0]) || {}).key.name : null;
  const bpm = s.bpm_min != null && s.bpm_max - s.bpm_min >= 2 ? `${Math.round(s.bpm_min)}–${Math.round(s.bpm_max)} BPM` : s.bpm_avg ? `${Math.round(s.bpm_avg)} BPM` : null;
  const facts = [clock(s.set_length || D.duration), `${T.length} tracks`, bpm, s.harmonic_pct != null ? `${s.harmonic_pct}% in key` : null].filter(Boolean);
  const offSet = off || new Set(P.chips.filter((c) => !c.on).map((c) => c.id));
  const pick = (g, n) => P.chips.filter((c) => c.group === g && !offSet.has(c.id)).slice(0, n).map((c) => c.text);
  const chips = [...pick("Genre", 3), ...pick("Mood", 2), ...pick("Artists", 4)];
  return {
    title: title || D.title, facts,
    energy: (D.curves && D.curves.energy && D.curves.energy.v) || [], span: [s0, s1],
    tracks: T.map((t) => ({ start: t.start, end: t.end, key: t.key && t.key.camelot })),
    chapters: ph.length > 1 ? ph.map((p) => ({ label: p.label, start: p.start, end: p.end })) : [],
    axes: AXES.map(([k, label]) => ({ label, v: P.axes[k] || 0 })),
    style: C ? C.style.name : null,
    home: home ? { key: home[0], name: homeName, pct: Math.round((100 * home[1]) / Object.values(time).reduce((a, b) => a + b, 0)) } : null,
    route: P.mood ? P.mood.chip : M ? QUAD_ROUTE(M) : null,
    chips,
    prompt: buildPrompt(P, offSet).short,
  };
}
const QUAD_ROUTE = (M) => M.thirds.filter((q, i) => !i || q !== M.thirds[i - 1]).join(" → ");

/* ------------------------------------------------ painting */
const INK = "#EFECF5", INK2 = "#C3BED3", MUTED = "#9792AB", FAINT = "#928DA6", BG = "#16151E", PANEL = "#201E2B", LINE = "#363349";
const FONT = "Archivo, system-ui, sans-serif";

function font(ctx, size, weight = 400, stretch = "normal") {
  ctx.font = `${weight} ${size}px ${FONT}`;
  if ("fontStretch" in ctx) ctx.fontStretch = stretch;
}
/* wrap text into at most `max` lines of `width`, ellipsis on the last */
function lines(ctx, text, width, max) {
  const words = String(text).split(/\s+/), out = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= width) { line = t; continue; }
    out.push(line); line = w;
    if (out.length === max) break;
  }
  if (out.length < max && line) out.push(line);
  else if (out.length === max && line) {
    let last = out[max - 1];
    while (ctx.measureText(`${last}…`).width > width && last.includes(" ")) last = last.replace(/\s+\S+$/, "");
    out[max - 1] = `${last}…`;
  }
  return out;
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function drawCard(ctx, d, keyColor) {
  const { w: W, h: H } = CARD, PAD = 72;
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

  /* header */
  font(ctx, 20, 700, "expanded"); ctx.fillStyle = MUTED;
  ctx.fillText("SET REPLAY", PAD, PAD + 8);
  font(ctx, 74, 900, "expanded"); ctx.fillStyle = INK;
  const tl = lines(ctx, d.title, W - 2 * PAD, 2);
  tl.forEach((l, i) => ctx.fillText(l, PAD, PAD + 92 + i * 80));
  let y = PAD + 92 + (tl.length - 1) * 80 + 52;
  font(ctx, 28, 500, "condensed"); ctx.fillStyle = INK2;
  ctx.fillText(d.facts.join("  ·  "), PAD, y);

  /* energy arc, filled per track in its key color, chapters marked */
  const ex0 = PAD, ex1 = W - PAD, ey0 = y + 40, ey1 = ey0 + 220;
  const [s0, s1] = d.span, L = Math.max(1, s1 - s0), e = d.energy;
  const xt = (t) => ex0 + ((t - s0) / L) * (ex1 - ex0);
  const ev = (t) => e[Math.max(0, Math.min(e.length - 1, Math.round(t)))] || 0;
  const yv = (v) => ey1 - Math.min(1.05, v) * (ey1 - ey0 - 24);
  d.tracks.forEach((tr) => {
    const a = Math.max(tr.start, s0), b = Math.min(tr.end, s1);
    if (b <= a) return;
    ctx.beginPath(); ctx.moveTo(xt(a), ey1);
    for (let x = Math.floor(xt(a)); x <= Math.ceil(xt(b)); x += 2) ctx.lineTo(x, yv(ev(s0 + ((x - ex0) / (ex1 - ex0)) * L)));
    ctx.lineTo(xt(b), ey1); ctx.closePath();
    ctx.fillStyle = keyColor(tr.key, "deep"); ctx.fill();
  });
  ctx.beginPath();
  for (let x = ex0; x <= ex1; x += 2) { const v = yv(ev(s0 + ((x - ex0) / (ex1 - ex0)) * L)); x === ex0 ? ctx.moveTo(x, v) : ctx.lineTo(x, v); }
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  d.tracks.forEach((tr) => {               // key strip
    const a = Math.max(tr.start, s0), b = Math.min(tr.end, s1);
    if (b > a) { ctx.fillStyle = keyColor(tr.key, "base"); ctx.fillRect(xt(a), ey1 + 8, Math.max(1, xt(b) - xt(a) - 2), 14); }
  });
  font(ctx, 18, 700, "normal");
  d.chapters.forEach((c, i) => {
    const x = xt(c.start);
    if (i) { ctx.save(); ctx.setLineDash([6, 8]); ctx.strokeStyle = "rgba(239,236,245,.45)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, ey0); ctx.lineTo(x, ey1); ctx.stroke(); ctx.restore(); }
    if (xt(c.end) - x > 120) { ctx.fillStyle = "rgba(239,236,245,.75)"; ctx.fillText(c.label.toUpperCase(), x + 10, ey0 + 18); }
  });

  /* vibe radar */
  const cy = ey1 + 230, cx = PAD + 170, R = 130, n = d.axes.length;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.5;
  [0.5, 1].forEach((r) => { ctx.beginPath(); d.axes.forEach((_, i) => { const [x, yy] = pt(i, r); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }); ctx.closePath(); ctx.stroke(); });
  const hk = d.home ? d.home.key : null;
  ctx.beginPath(); d.axes.forEach((a, i) => { const [x, yy] = pt(i, Math.max(0.04, a.v)); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }); ctx.closePath();
  ctx.fillStyle = keyColor(hk, "base", 0.5); ctx.fill(); ctx.strokeStyle = keyColor(hk, "ink"); ctx.lineWidth = 3; ctx.stroke();
  font(ctx, 17, 500, "condensed"); ctx.fillStyle = MUTED;
  d.axes.forEach((a, i) => {
    const [x, yy] = pt(i, 1.2);
    ctx.textAlign = Math.abs(x - cx) < 10 ? "center" : x > cx ? "left" : "right";
    ctx.fillText(a.label, x, yy + 6);
  });
  ctx.textAlign = "left";

  /* facts column */
  let fy = ey1 + 98;
  const fx = PAD + 420;
  const fact = (label, value, color) => {
    if (!value) return;
    font(ctx, 17, 700, "expanded"); ctx.fillStyle = FAINT; ctx.fillText(label, fx, fy);
    font(ctx, 36, 750, "normal"); ctx.fillStyle = color || INK;
    lines(ctx, value, W - PAD - fx, 1).forEach((l) => ctx.fillText(l, fx, fy + 42));
    fy += 98;
  };
  fact("MIXING STYLE", d.style);
  fact("HOME KEY", d.home ? `${d.home.key} · ${d.home.name || ""} · ${d.home.pct}%` : null, d.home ? keyColor(d.home.key, "ink") : null);
  fact("MOOD ROUTE", d.route);
  fact("CHAPTERS", d.chapters.length ? d.chapters.map((c) => c.label).join(" → ") : null);

  /* keyword chips */
  let cx0 = PAD, cy0 = Math.max(fy + 10, cy + R + 64), rows = 1;
  font(ctx, 24, 600, "normal");
  for (const c of d.chips) {
    const w = ctx.measureText(c).width + 36;
    if (cx0 + w > W - PAD) { if (rows === 2) break; rows++; cx0 = PAD; cy0 += 58; }
    rrect(ctx, cx0, cy0, w, 44, 22); ctx.fillStyle = "#2A2838"; ctx.fill();
    ctx.fillStyle = INK; ctx.fillText(c, cx0 + 18, cy0 + 30);
    cx0 += w + 12;
  }

  /* prompt */
  const py = cy0 + 80;
  rrect(ctx, PAD, py, W - 2 * PAD, H - py - 110, 18); ctx.fillStyle = PANEL; ctx.fill();
  font(ctx, 17, 700, "expanded"); ctx.fillStyle = FAINT; ctx.fillText("PLAYLIST PROMPT", PAD + 28, py + 40);
  font(ctx, 25, 400, "normal"); ctx.fillStyle = INK2;
  const pl = lines(ctx, d.prompt, W - 2 * PAD - 56, Math.max(1, Math.floor((H - py - 110 - 70) / 36)));
  pl.forEach((l, i) => ctx.fillText(l, PAD + 28, py + 80 + i * 36));

  font(ctx, 19, 500, "normal"); ctx.fillStyle = FAINT; ctx.textAlign = "right";
  ctx.fillText("Made with Set Replay", W - PAD, H - 52);
  ctx.textAlign = "left";
}
