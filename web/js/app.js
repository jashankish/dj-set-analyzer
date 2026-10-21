/* ============================================================
   Set Replay — app
   Three sources, one viewer:
     set.html?id=<id>      a set analyzed in this browser (IndexedDB, with its audio)
     set.html?demo=<slug>  a bundled demo (demo/<slug>.json; audio optional)
     set.html#<slug>       the local Python server (data/sets.json + /audio/<file>)
   Draws the set and keeps every view in step with the audio.
   ============================================================ */
import { getSet, listSets, deleteSet, attachAudio, replacePayload } from "./store.js";
import { openNamingDialog } from "./naming-ui.js";
import { mountVibe, vibeTrack, vibeNames, vibeAuthReturn, vibeScope, copyPrompt, vibeOffWhole, spotifySave, takePending } from "./vibe-ui.js";
import { cardData, drawCard } from "./card.js";
import { compareSets, mergePayloads } from "./compare.js";
import { buildPrompt, AXES, vibeProfile } from "./vibe.js";
import { findPhases, slicePayload } from "./phases.js";
import { harmonicRelation } from "./engine/music.js";
import { isVideo, extractAudio } from "./engine/demux.js";
import { craftProfile, relationClass, mixScore, mixTips, reorder } from "./craft.js";
import { moodMap, QUADS } from "./moodmap.js";
import { dropAnatomy, PRE, POST } from "./drops.js";
import { highlights } from "./highlights.js";
import { tracklist } from "./tracklist.js";

(function () {
  "use strict";

  const { keyRgb, keyColor } = window.KeyColor;
  const $ = (id) => document.getElementById(id);
  const audio = $("audio");

  const S = {
    sets: [], set: null, D: null,
    view: { t0: 0, t1: 1 },
    cur: -1, mix: 0, follow: true, loop: false,
    names: {}, title: null,
    actx: null, analyzer: null, freq: null,
    lastBeat: -1, beatAt: 0,
  };

  /* time source: the audio element, or a virtual clock when there's no audio */
  const now = () => (S.noAudio ? S.vt || 0 : audio.currentTime || 0);
  const isPaused = () => S.noAudio || audio.paused;

  /* ------------------------------------------------ utils */
  function fmt(t) {
    if (!isFinite(t)) t = 0;
    t = Math.max(0, t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }
  function fmtDur(t) {
    if (t < 60) return `${Math.round(t)} s`;
    const m = Math.floor(t / 60), s = Math.round(t % 60);
    return s ? `${m} min ${s} s` : `${m} min`;
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function fit(c) {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }
  function bsearch(arr, t, key) {           // last index with arr[i][key] <= t
    let lo = 0, hi = arr.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = key ? arr[mid][key] : arr[mid];
      if (v <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  const mixRgb = (a, b, r) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * r));
  const rgb = (c, a) => (a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 2200);
  }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }

  /* ------------------------------------------------ track helpers */
  const tracks = () => S.D.tracks;
  /* the part of the recording that is the set (phones keep recording after) */
  const span = () => [S.D.summary.set_start || 0, S.D.summary.set_end || S.D.duration];
  const mixes = () => S.D.transitions;
  const trackAt = (t) => bsearch(tracks(), t, "start");
  const keyOf = (tr) => (tr && tr.key ? tr.key.camelot : null);
  function nameOf(tr) {
    const o = S.names[tr.n];
    if (o) return o;
    return tr.identified ? tr.title : "ID";
  }
  function artistOf(tr) {
    if (S.names[tr.n] && !tr.identified) return "Named by you";
    return tr.identified ? tr.artist : "Unidentified";
  }
  /* in sentences an unnamed track needs its number to be told apart: "ID 7" */
  const shortName = (tr) => (!tr.identified && !S.names[tr.n] ? `ID ${tr.n}` : nameOf(tr).replace(/\s*\((feat|ft)\.?[^)]*\)/i, ""));
  const possible = (tr) => tr.identified && tr.shazam_hits <= 1 && tr.id_confidence < 0.25;
  function artHtml(tr, big) {
    const local = tr.meta && (tr.meta.art_local || tr.meta.art);
    if (local) return `${genArt(tr, big, true)}<img class="art-img" src="${esc(local)}" alt="" onerror="this.remove()">`;
    return genArt(tr, big, false);
  }
  function genArt(tr, big, under) {
    const k = keyOf(tr);
    const a = keyColor(k, "base"), b = keyColor(k, "deep");
    const label = tr.identified ? (k || "") : "ID";
    return `<div class="art-gen" style="background:linear-gradient(150deg, ${a}, ${b})"><span>${esc(label)}</span></div>`;
  }

  /* precomputed colors per track */
  let TC = [];
  function prepColors() {
    TC = tracks().map((tr) => ({
      deep: keyRgb(keyOf(tr), "deep"), base: keyRgb(keyOf(tr), "base"),
      pale: keyRgb(keyOf(tr), "pale"), ink: keyRgb(keyOf(tr), "ink"),
    }));
  }
  /* color at time t, cross-fading through each mix */
  function colorAt(t, tone) {
    const i = trackAt(t);
    const m = mixes();
    for (let j = Math.max(0, i - 1); j <= Math.min(m.length - 1, i); j++) {
      const x = m[j];
      if (t >= x.mix_in && t <= x.mix_out) {
        const r = clamp((t - x.mix_in) / Math.max(1, x.mix_out - x.mix_in), 0, 1);
        return mixRgb(TC[x.from - 1][tone], TC[x.to - 1][tone], r);
      }
    }
    return TC[i][tone];
  }

  /* ------------------------------------------------ boot */
  async function boot() {
    bindStatic();
    await vibeAuthReturn();       // back from Spotify's sign-in: restores the set's URL first
    const q = new URLSearchParams(location.search);
    try {
      if (q.get("id")) await bootLocal(q.get("id"));
      else if (q.get("demo")) await bootDemo(q.get("demo"));
      else await bootServer();
    } catch (e) {
      console.error(e);
      showMissing("This set couldn't be loaded.", e && e.message);
    }
  }

  function showMissing(msg, detail) {
    $("title").textContent = "Set not found";
    $("story").innerHTML = `${esc(msg)} ${detail ? `<span style="color:var(--muted)">(${esc(detail)})</span>` : ""} <a href="./" style="color:var(--ink)">Back to Set Replay</a>`;
    document.querySelectorAll(".ribbon-wrap, .desk, .mix, .journey, .player").forEach((el) => (el.hidden = true));
  }

  /* a set analyzed in this browser */
  async function bootLocal(id) {
    S.mode = "local";
    const rec = await getSet(id);
    if (!rec) return showMissing("This set isn't saved in this browser. Sets live in the browser that analyzed them.");
    S.sets = (await listSets()).map((x) => ({ slug: x.id, title: x.title, keys: x.keys, duration: x.set_length || x.duration, href: `set.html?id=${encodeURIComponent(x.id)}` }));
    S.record = rec;
    renderSetNav();
    openPayload(rec.payload, rec.audio ? URL.createObjectURL(rec.audio) : null);
    if (rec.payload.naming_note) toast(rec.payload.naming_note);
    setupNaming(rec);
  }

  /* "Name these IDs": re-run the analysis with the visitor's naming helper */
  function setupNaming(rec) {
    const ids = rec.payload.tracks.filter((t) => !t.identified).length;
    const btn = $("nameBtn");
    btn.hidden = !ids || !rec.audio;
    btn.textContent = ids === rec.payload.tracks.length ? "Name these IDs" : `Name the ${ids} remaining ID${ids === 1 ? "" : "s"}`;
    btn.onclick = () => openNamingDialog({
      mode: "viewer", ids,
      onNameNow: async (progress) => {
        audio.pause();
        const engine = await import("./engine/pipeline.js");
        const file = rec.audio instanceof File ? rec.audio : new File([rec.audio], rec.payload.file || "set.m4a");
        const payload = await engine.analyzeFile(file, {
          identify: true, title: rec.payload.title,
          onProgress: ({ stage, f }) => progress(stage, f),
        });
        engine.releaseEngine();
        await replacePayload(rec.id, payload);
        // track numbers change once names anchor the setlist; keep the title, drop per-number names
        const saved = load(`set-replay:${rec.id}`) || {};
        store(`set-replay:${rec.id}`, { title: saved.title || null, names: {} });
        location.reload();
      },
    });
  }

  /* a bundled demo */
  async function bootDemo(slug) {
    S.mode = "demo";
    let idx = [];
    try { idx = await (await fetch("demo/index.json")).json(); } catch (e) { /* listing is optional */ }
    S.sets = idx.map((x) => ({ slug: x.slug, title: x.title, keys: x.keys, duration: x.set_length || x.duration, href: `set.html?demo=${encodeURIComponent(x.slug)}` }));
    const r = await fetch(`demo/${encodeURIComponent(slug)}.json`);
    if (!r.ok) return showMissing("That demo doesn't exist.");
    renderSetNav();
    const entry = idx.find((x) => x.slug === slug);
    openPayload(await r.json(), entry && entry.audio ? entry.audio : null);
  }

  /* the local Python server */
  async function bootServer() {
    S.mode = "server";
    try {
      const r = await fetch("data/sets.json", { cache: "no-store" });
      if (!r.ok) throw new Error();
      S.sets = await r.json();
    } catch (e) {
      S.sets = [];
    }
    if (!S.sets.length) { location.replace("./"); return; }
    renderSetNav();
    const want = decodeURIComponent(location.hash.slice(1));
    const pick = S.sets.find((s) => s.slug === want) || S.sets[0];
    await openSet(pick.slug);
  }

  function renderSetNav() {
    const home = `<a class="home" href="./">Set Replay</a>`;
    $("sets").innerHTML = home + S.sets.map((s) => {
      const sw = (s.keys || []).slice(0, 40).map((k) => `<i style="background:${keyColor(k, "base")}"></i>`).join("");
      const t = (load(`set-replay:${s.slug}`) || {}).title || s.title;
      return `<button data-slug="${esc(s.slug)}"${s.href ? ` data-href="${esc(s.href)}"` : ""}><span class="set-sw">${sw}</span>${esc(t)} <span class="set-dur">${fmt(s.duration)}</span></button>`;
    }).join("");
    $("sets").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.href) location.href = b.dataset.href; else openSet(b.dataset.slug);
    }));
  }

  async function openSet(slug) {
    const r = await fetch(`data/sets/${encodeURIComponent(slug)}.json`, { cache: "no-store" });
    const D = await r.json();
    history.replaceState(null, "", `#${slug}`);
    openPayload(D, `audio/${encodeURIComponent(D.file)}`);
  }

  function openPayload(D, audioUrl) {
    S.D = D;
    const slug = D.slug;
    S.set = S.sets.find((s) => s.slug === slug);
    $("sets").querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", b.dataset.slug === slug ? "true" : "false"));
    const saved = load(`set-replay:${slug}`) || {};
    S.names = saved.names || {};
    S.title = saved.title || null;
    S.cur = -1; S.mix = 0; S.lastBeat = -1;
    S.view = { t0: span()[0], t1: span()[1] };
    S.phases = findPhases(D);
    prepColors();
    S.noAudio = !audioUrl;
    S.vt = span()[0];
    if (audioUrl) audio.src = audioUrl; else audio.removeAttribute("src");
    document.body.classList.toggle("no-audio", S.noAudio);
    $("tDur").textContent = fmt(S.D.duration);
    renderHeader();
    renderSetlist();
    renderWheel();
    renderRows();
    renderCredits();
    renderPhases();
    renderCraft();
    renderMoodMap();
    renderDrops();
    renderHighlights();
    renderCompare();
    mountVibe({ D, phases: S.phases, names: S.names, title: S.title || D.title, cur: 0, keyColor, toast, seek, nameOf });
    drawAll();
    setTrack(0, true);
    selectMix(0, false);
    tick(true);
  }

  function saveLocal() {
    store(`set-replay:${S.D.slug}`, { title: S.title, names: S.names });
  }

  /* ------------------------------------------------ header */
  function renderHeader() {
    const D = S.D, s = D.summary;
    const title = S.title || D.title;
    $("title").textContent = title;
    document.title = `${title} · Set Replay`;
    const bpm = s.bpm_min === s.bpm_max || s.bpm_min == null ? (s.bpm_avg ? Math.round(s.bpm_avg) : "—")
      : `${Math.round(s.bpm_min)}–${Math.round(s.bpm_max)}`;
    const facts = [
      ["Length", fmt(s.set_length || D.duration)],
      ["Tracks", s.tracks],
      ["BPM", bpm],
      ["Harmonic mixes", s.harmonic_pct != null ? `${s.harmonic_pct}%` : "—"],
    ];
    $("facts").innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    $("story").innerHTML = story();
  }

  function story() {
    const D = S.D, s = D.summary, T = tracks(), M = mixes();
    const parts = [];
    const mins = Math.round((s.set_length || D.duration) / 60);
    let tempo = "";
    if (s.bpm_avg) {
      tempo = s.bpm_max - s.bpm_min < 2
        ? `, held at <b>${Math.round(s.bpm_avg)} BPM</b> the whole way`
        : `, moving between <b>${Math.round(s.bpm_min)} and ${Math.round(s.bpm_max)} BPM</b>`;
    }
    parts.push(`<b>${s.tracks} tracks</b> in ${mins} minutes${tempo}.`);
    const unknown = s.tracks - s.identified;
    if (s.identified) parts.push(unknown ? `Shazam named ${s.identified}; ${unknown === 1 ? "one is an ID" : `${unknown} are IDs`}.` : "Shazam named every one.");
    else parts.push("No tracks were named, so the setlist comes from the audio alone.");
    const known = M.filter((x) => x.harmonic.compatible !== null);
    if (known.length) {
      const ok = known.filter((x) => x.harmonic.compatible === true).length;
      const types = Object.entries(s.transition_types).sort((a, b) => b[1] - a[1]);
      const lead = types.slice(0, 2).map(([k, n]) => `${k.toLowerCase()}s (${n})`).join(" and ");
      parts.push(`<b>${ok} of ${known.length} mixes</b> stayed in compatible keys, mostly ${lead}.`);
    }
    if (s.longest_blend && M.length) {
      const x = M.find((m) => m.from === s.longest_blend.from);
      const a = T[x.from - 1], b = T[x.to - 1];
      parts.push(`The longest blend ran <b>${x.bars ? `${x.bars} bars` : fmtDur(x.duration)}</b>, ${esc(shortName(a))} into ${esc(shortName(b))}.`);
    }
    const P = S.phases || [];
    if (P.length > 1) {
      const words = ["two", "three", "four", "five"][P.length - 2];
      const named = P.map((p) => `${p.label.toLowerCase()} (tracks ${p.from}–${p.to})`);
      parts.push(`It plays in ${words} chapters: ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}.`);
    }
    const tail = D.duration - (s.set_end || D.duration);
    if (tail > 60) parts.push(`The recording runs on for another ${fmtDur(Math.round(tail / 60) * 60)} after the music stops; that part is grayed out.`);
    return parts.join(" ");
  }

  /* ------------------------------------------------ ribbon */
  const X = (t, w) => ((t - S.view.t0) / (S.view.t1 - S.view.t0)) * w;
  const T_ = (x, w) => S.view.t0 + (x / w) * (S.view.t1 - S.view.t0);

  function waveMax(band, ta, tb) {
    const fps = S.D.curves.wave_fps, arr = S.D.curves.wave[band];
    const i0 = clamp(Math.floor(ta * fps), 0, arr.length - 1);
    const i1 = clamp(Math.ceil(tb * fps), i0 + 1, arr.length);
    let m = 0;
    for (let i = i0; i < i1; i++) if (arr[i] > m) m = arr[i];
    return m;
  }

  function drawWave(ctx, w, h, t0, t1, opt) {
    opt = opt || {};
    const mid = h / 2, amp = mid - 2;
    const vspan = t1 - t0;
    for (let x = 0; x < w; x++) {
      const ta = t0 + (x / w) * vspan, tb = t0 + ((x + 1) / w) * vspan;
      if (tb < 0 || ta > S.D.duration) continue;
      const tm = (ta + tb) / 2;
      const lo = waveMax("low", ta, tb) / 99, mi = waveMax("mid", ta, tb) / 99, hi = waveMax("high", ta, tb) / 99;
      const dim = opt.dimBefore != null && tm < opt.dimBefore ? 0.55 : 1;
      ctx.fillStyle = rgb(colorAt(tm, "deep"), dim);
      ctx.fillRect(x, mid - lo * amp, 1, lo * amp * 2);
      ctx.fillStyle = rgb(colorAt(tm, "base"), dim);
      const mh = mi * amp * 0.78;
      ctx.fillRect(x, mid - mh, 1, mh * 2);
      ctx.fillStyle = rgb(colorAt(tm, "pale"), dim);
      const hh = hi * amp * 0.5;
      ctx.fillRect(x, mid - hh, 1, hh * 2);
    }
  }

  let hatch = null;
  function hatchPattern(ctx) {
    if (hatch) return hatch;
    const c = document.createElement("canvas");
    c.width = c.height = 6;
    const g = c.getContext("2d");
    g.strokeStyle = "rgba(255,255,255,.55)";
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.stroke();
    hatch = ctx.createPattern(c, "repeat");
    return hatch;
  }

  function drawRibbon() {
    const c = $("rCanvas");
    const { ctx, w, h } = fit(c);
    ctx.clearRect(0, 0, w, h);
    const { t0, t1 } = S.view;
    // track bands behind the wave
    tracks().forEach((tr, i) => {
      const x0 = X(tr.start, w), x1 = X(tr.end, w);
      if (x1 < 0 || x0 > w) return;
      ctx.fillStyle = rgb(TC[i].deep, i === S.cur ? 0.16 : 0.08);
      ctx.fillRect(x0, 0, x1 - x0, h);
    });
    drawWave(ctx, w, h - 10, t0, t1);
    // mix zones (hatched strip along the bottom) + swap ticks
    mixes().forEach((m, j) => {
      const x0 = X(m.mix_in, w), x1 = X(m.mix_out, w), xs = X(m.swap, w);
      if (x1 < 0 || x0 > w) return;
      ctx.fillStyle = hatchPattern(ctx);
      ctx.fillRect(x0, h - 7, Math.max(2, x1 - x0), 7);
      ctx.fillStyle = j === S.mix ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.5)";
      ctx.fillRect(xs - 0.5, h - 12, 1, 12);
      if (j === S.mix) {
        ctx.strokeStyle = "rgba(255,255,255,.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, h - 1);
      }
    });
    // drops: small markers along the top
    ctx.fillStyle = "rgba(239,236,245,.85)";
    S.D.drops.forEach((d) => {
      const x = X(d.t, w);
      if (x < -5 || x > w + 5) return;
      ctx.beginPath(); ctx.moveTo(x - 4, 1); ctx.lineTo(x + 4, 1); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill();
    });
    shadeOutside(ctx, w, h, (t) => X(t, w));
    drawLabels(w);
    drawAxis(w);
    syncOverviewWindow();
  }

  function shadeOutside(ctx, w, h, x) {
    const [s0, s1] = span(), D = S.D.duration;
    ctx.fillStyle = "rgba(22,21,30,.78)";
    if (s1 < D - 1) ctx.fillRect(x(s1), 0, w - x(s1) + 1, h);
    if (s0 > 1) ctx.fillRect(0, 0, x(s0), h);
  }

  function drawLabels(w) {
    const box = $("rLabels");
    const html = [];
    const [s0, s1] = span();
    if (s1 < S.D.duration - 1) {
      const L = Math.max(0, X(s1, w)), R = w;
      if (R - L > 60) html.push(`<div class="r-label" style="left:${L}px;width:${R - L}px">After the set · ${fmtDur(S.D.duration - s1)} of room sound</div>`);
    }
    if (s0 > 1) {
      const L = 0, R = Math.min(w, X(s0, w));
      if (R - L > 60) html.push(`<div class="r-label" style="left:${L}px;width:${R - L}px">Before the set</div>`);
    }
    tracks().forEach((tr, i) => {
      const x0 = X(tr.start, w), x1 = X(Math.min(tr.end, s1), w);
      if (x1 < 0 || x0 > w) return;
      const L = Math.max(0, x0), R = Math.min(w, x1);
      if (R - L < 18) return;
      const label = R - L > 90 ? `<b>${tr.n}</b>${esc(tr.identified || S.names[tr.n] ? shortName(tr) : "ID")}` : `<b>${tr.n}</b>`;
      const tight = R - L < 44 ? " tight" : "";   // narrow tracks: just the number, no side padding
      html.push(`<div class="r-label${i === S.cur ? " now" : ""}${tight}" style="left:${L}px;width:${R - L}px;border-left-color:${keyColor(keyOf(tr), "base", 0.8)}">${label}</div>`);
    });
    box.innerHTML = html.join("");
  }

  function drawAxis(w) {
    const vspan = S.view.t1 - S.view.t0;
    const steps = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const step = steps.find((s) => vspan / s <= 12) || 3600;
    const out = [];
    for (let t = Math.ceil(S.view.t0 / step) * step; t <= S.view.t1; t += step) {
      const x = X(t, w);
      if (x < 16 || x > w - 16) continue;
      out.push(`<span style="left:${x}px">${fmt(t)}</span>`);
    }
    $("rAxis").innerHTML = out.join("");
  }

  function drawOverview() {
    const { ctx, w, h } = fit($("ovCanvas"));
    ctx.clearRect(0, 0, w, h);
    const D = S.D.duration;
    for (let x = 0; x < w; x++) {
      const ta = (x / w) * D, tb = ((x + 1) / w) * D;
      const v = Math.max(waveMax("low", ta, tb), waveMax("mid", ta, tb)) / 99;
      ctx.fillStyle = rgb(colorAt((ta + tb) / 2, "base"), 0.9);
      const bh = Math.max(2, v * (h - 4));
      ctx.fillRect(x, (h - bh) / 2, 1, bh);
    }
    shadeOutside(ctx, w, h, (t) => (t / D) * w);
  }

  function syncOverviewWindow() {
    const ov = $("ovWindow"), D = S.D.duration;
    const [s0, s1] = span();
    const full = Math.abs(S.view.t0 - s0) < 0.5 && Math.abs(S.view.t1 - s1) < 0.5;
    ov.classList.toggle("full", full);
    const W = $("overview").clientWidth;
    ov.style.left = `${(S.view.t0 / D) * W}px`;
    ov.style.width = `${Math.max(6, ((S.view.t1 - S.view.t0) / D) * W)}px`;
    const vspan = S.view.t1 - S.view.t0;
    $("zoomLabel").textContent = full ? "Whole set" : `${fmtDur(vspan)} shown`;
    ov.classList.toggle("full", full && s0 === 0 && s1 >= D - 0.5);
  }

  function setView(t0, vspan) {
    const D = S.D.duration;
    vspan = clamp(vspan, 20, D);
    t0 = clamp(t0, 0, D - vspan);
    S.view = { t0, t1: t0 + vspan };
    drawRibbon();
    tick(true);
  }
  function zoomAround(t, factor, frac) {
    const vspan = (S.view.t1 - S.view.t0) * factor;
    if (frac == null) frac = (t - S.view.t0) / (S.view.t1 - S.view.t0);
    setView(t - frac * vspan, vspan);
  }

  /* ------------------------------------------------ ribbon + overview interaction */
  function bindRibbon() {
    const rb = $("ribbon"), tip = $("rTip"), hov = $("rHover");
    let down = null;
    rb.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, t0: S.view.t0, moved: false };
      rb.setPointerCapture(e.pointerId);
    });
    rb.addEventListener("pointermove", (e) => {
      const r = rb.getBoundingClientRect(), x = e.clientX - r.left;
      if (down) {
        const dx = e.clientX - down.x;
        if (Math.abs(dx) > 4) down.moved = true;
        const vspan = S.view.t1 - S.view.t0;
        if (down.moved && vspan < S.D.duration - 0.5) {
          setView(down.t0 - (dx / r.width) * vspan, vspan);
          return;
        }
      }
      const t = T_(x, r.width);
      hov.hidden = false; hov.style.left = `${x}px`;
      showTip(tip, x, r.width, ribbonTip(t), 40);
    });
    rb.addEventListener("pointerup", (e) => {
      const r = rb.getBoundingClientRect();
      if (down && !down.moved) seek(T_(e.clientX - r.left, r.width), true);
      down = null;
    });
    rb.addEventListener("pointerleave", () => { if (!down) { tip.hidden = true; hov.hidden = true; } });
    rb.addEventListener("wheel", (e) => {
      const r = rb.getBoundingClientRect();
      const t = T_(e.clientX - r.left, r.width);
      if (e.ctrlKey || e.metaKey) {           // pinch / ctrl-scroll zooms
        e.preventDefault();
        zoomAround(t, Math.exp(e.deltaY * 0.01));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {   // horizontal scroll pans
        e.preventDefault();
        const vspan = S.view.t1 - S.view.t0;
        setView(S.view.t0 + (e.deltaX / r.width) * vspan, vspan);
      }
    }, { passive: false });

    const ov = $("overview");
    let ovDown = null;
    ov.addEventListener("pointerdown", (e) => {
      const r = ov.getBoundingClientRect();
      const t = ((e.clientX - r.left) / r.width) * S.D.duration;
      const vspan = S.view.t1 - S.view.t0;
      const zoomed = vspan < S.D.duration - 0.5;
      ovDown = { x: e.clientX, t0: S.view.t0, onWin: zoomed && t >= S.view.t0 && t <= S.view.t1, moved: false };
      ov.setPointerCapture(e.pointerId);
    });
    ov.addEventListener("pointermove", (e) => {
      if (!ovDown) return;
      const r = ov.getBoundingClientRect();
      const dx = e.clientX - ovDown.x;
      if (Math.abs(dx) > 3) ovDown.moved = true;
      if (ovDown.onWin && ovDown.moved) {
        setView(ovDown.t0 + (dx / r.width) * S.D.duration, S.view.t1 - S.view.t0);
      }
    });
    ov.addEventListener("pointerup", (e) => {
      const r = ov.getBoundingClientRect();
      if (ovDown && !ovDown.moved) {
        const t = ((e.clientX - r.left) / r.width) * S.D.duration;
        const vspan = S.view.t1 - S.view.t0;
        if (vspan < S.D.duration - 0.5) setView(t - vspan / 2, vspan);
        seek(t, true);
      }
      ovDown = null;
    });

    $("zoomIn").addEventListener("click", () => zoomAround(focusTime(), 0.5));
    $("zoomOut").addEventListener("click", () => zoomAround(focusTime(), 2));
    $("zoomFit").addEventListener("click", () => setView(span()[0], span()[1] - span()[0]));
  }
  function focusTime() {
    const t = now();
    return t >= S.view.t0 && t <= S.view.t1 ? t : (S.view.t0 + S.view.t1) / 2;
  }

  function ribbonTip(t) {
    const [s0, s1] = span();
    if (t > s1 || t < s0) return `<span class="t-time">${fmt(t)}</span><span class="t-title">${t > s1 ? "After the set" : "Before the set"}</span><span class="t-meta">The recording continues, but there's no music here</span>`;
    const tr = tracks()[trackAt(t)];
    const m = mixes().find((x) => t >= x.mix_in && t <= x.mix_out);
    let html = `<span class="t-time">${fmt(t)}</span><span class="t-title">${esc(nameOf(tr))}</span>`;
    html += `<span class="t-meta">${esc(artistOf(tr))}${tr.key ? ` · ${tr.key.camelot}` : ""}${tr.bpm ? ` · ${Math.round(tr.bpm)} BPM` : ""}</span>`;
    if (m) {
      const b = tracks()[m.to - 1];
      html += `<br><span class="t-meta">Mixing into ${esc(shortName(b))} · ${esc(m.type.toLowerCase())}</span>`;
    }
    const d = S.D.drops.find((x) => Math.abs(x.t - t) < (S.view.t1 - S.view.t0) / 200 + 1.5);
    if (d) html += `<br><span class="t-meta">Drop after a ${Math.round(d.breakdown_s)} s breakdown</span>`;
    return html;
  }

  function showTip(tip, x, w, html, top) {
    tip.innerHTML = html;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${clamp(x + 14, 4, w - tw - 4)}px`;
    if (x + 14 + tw > w) tip.style.left = `${clamp(x - tw - 14, 4, w - tw - 4)}px`;
    tip.style.top = `${top}px`;
  }

  /* ------------------------------------------------ deck */
  function setTrack(i, force) {
    if (i === S.cur && !force) return;
    S.cur = i;
    const tr = tracks()[i];
    if (!tr) return;
    const k = keyOf(tr);
    $("deckArt").innerHTML = artHtml(tr, true);
    $("deckN").textContent = `Track ${tr.n} of ${tracks().length} · ${fmt(tr.start)}–${fmt(tr.end)}`;
    $("deckTitle").textContent = nameOf(tr);
    $("deckTitle").title = tr.identified ? "" : "Double-click to name this ID";
    $("deckArtist").textContent = possible(tr) ? `${artistOf(tr)} · possible match` : artistOf(tr);
    $("roKey").textContent = k || "—";
    $("roKey").style.color = k ? keyColor(k, "ink") : "";
    $("roKeyName").textContent = tr.key ? tr.key.name : "Key";
    $("roEnergy").textContent = tr.energy != null ? tr.energy.toFixed(1) : "—";
    $("deck").style.setProperty("--beat", keyColor(k, "base"));
    $("deckStyles").innerHTML = tr.styles.slice(0, 3).map((s) => `<span class="tag"><b>${esc(s.style)}</b> ${Math.round(s.p * 100)}%</span>`).join("");
    const L = [];
    if (tr.meta && tr.meta.shazam_url) L.push(`<a href="${esc(tr.meta.shazam_url)}" target="_blank" rel="noopener">Shazam</a>`);
    if (tr.meta && tr.meta.apple_url) L.push(`<a href="${esc(tr.meta.apple_url)}" target="_blank" rel="noopener">Apple Music</a>`);
    if (tr.identified || S.names[tr.n]) {
      const q = tr.identified && !S.names[tr.n] ? `${tr.artist} ${tr.title.replace(/\s*[([][^)\]]*[)\]]/g, "")}` : S.names[tr.n];
      L.push(`<a href="https://open.spotify.com/search/${encodeURIComponent(q)}" target="_blank" rel="noopener">Spotify</a>`);
    }
    if (tr.meta && (tr.meta.label || tr.meta.released)) L.push(`<span style="color:var(--muted)">${esc([tr.meta.label, tr.meta.released].filter(Boolean).join(", "))}</span>`);
    $("deckLinks").innerHTML = L.join("");
    const nx = tracks()[i + 1], m = mixes()[i];
    $("deckNext").innerHTML = nx && m ? `Next: <b>${esc(nameOf(nx))}</b>, ${esc(m.type.toLowerCase())} at ${fmt(m.swap)}` : "Last track of the set";
    $("pNow").innerHTML = `<b>${esc(nameOf(tr))}</b><span>${esc(artistOf(tr))}</span>`;
    // setlist + labels + wheel
    document.querySelectorAll(".trk").forEach((el) => el.classList.toggle("now", +el.dataset.i === i));
    drawRibbon();
    updateWheel();
    vibeTrack(i);
    updateMoodMap(i);
    const ph = (S.phases || []).findIndex((p) => tr.n >= p.from && tr.n <= p.to);
    document.querySelectorAll(".ph").forEach((el) => el.classList.toggle("now", +el.dataset.i === ph));
  }

  function bindRename() {
    const el = $("deckTitle");
    el.addEventListener("dblclick", () => {
      const tr = tracks()[S.cur];
      el.contentEditable = "true";
      el.focus();
      document.getSelection().selectAllChildren(el);
      const done = (save) => {
        el.contentEditable = "false";
        const v = el.textContent.trim();
        if (save) {
          if (v && v !== (tr.identified ? tr.title : "ID")) S.names[tr.n] = v; else delete S.names[tr.n];
          saveLocal();
          renderSetlist(); renderHeader();
          vibeNames(S.names, S.title || S.D.title);
          toast(v ? "Track renamed" : "Name cleared");
        }
        setTrack(S.cur, true);
      };
      el.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); done(true); }
        if (e.key === "Escape") done(false);
      };
      el.onblur = () => done(true);
    });
    const t = $("title");
    t.addEventListener("dblclick", () => {
      t.contentEditable = "true"; t.focus();
      document.getSelection().selectAllChildren(t);
      const done = (save) => {
        t.contentEditable = "false";
        t.onblur = null;
        const v = t.textContent.trim();
        if (save) {
          S.title = v && v !== S.D.title ? v : null;
          saveLocal();
          vibeNames(S.names, S.title || S.D.title);
          renderSetNav();
          $("sets").querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", b.dataset.slug === S.D.slug ? "true" : "false"));
        }
        renderHeader();
      };
      t.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); done(true); }
        if (e.key === "Escape") done(false);
      };
      t.onblur = () => done(true);
    });
  }

  /* live spectrum through Web Audio (created on first play: needs a user gesture) */
  function ensureAudioGraph() {
    if (S.actx || !window.AudioContext) return;
    try {
      S.actx = new AudioContext();
      const src = S.actx.createMediaElementSource(audio);
      S.analyzer = S.actx.createAnalyser();
      S.analyzer.fftSize = 4096;
      S.analyzer.smoothingTimeConstant = 0.72;
      src.connect(S.analyzer);
      S.analyzer.connect(S.actx.destination);
      S.freq = new Uint8Array(S.analyzer.frequencyBinCount);
    } catch (e) {
      S.actx = null;
    }
  }
  function drawSpectrum() {
    const { ctx, w, h } = fit($("spectrum"));
    ctx.clearRect(0, 0, w, h);
    const tr = tracks()[S.cur];
    const col = TC[S.cur] || TC[0];
    const n = 56, gap = 2, bw = (w - gap * (n - 1)) / n;
    let data = null;
    if (S.analyzer && !isPaused()) {
      S.analyzer.getByteFrequencyData(S.freq);
      data = S.freq;
    }
    const sr = S.actx ? S.actx.sampleRate : 48000, bins = S.freq ? S.freq.length : 1;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (data) {
        const f0 = 30 * Math.pow(16000 / 30, i / n), f1 = 30 * Math.pow(16000 / 30, (i + 1) / n);
        const b0 = Math.floor((f0 / (sr / 2)) * bins), b1 = Math.max(b0 + 1, Math.floor((f1 / (sr / 2)) * bins));
        for (let b = b0; b < b1 && b < bins; b++) v = Math.max(v, data[b]);
        v = v / 255;
      }
      const bh = Math.max(2, v * h);
      ctx.fillStyle = rgb(v > 0.72 ? col.pale : v > 0.45 ? col.base : col.deep, data ? 1 : 0.5);
      ctx.fillRect(i * (bw + gap), h - bh, bw, bh);
    }
    void tr;
  }

  function updatePulse(t) {
    const beats = S.D.beats;
    if (beats.length) {
      const i = bsearch(beats, t);
      const on = beats[i] <= t && t - beats[i] < 0.12 && !isPaused();
      const dots = $("pulse").children;
      for (let k = 0; k < 4; k++) dots[k].classList.toggle("on", on && k === i % 4);
    }
    // live tempo from the curve
    const c = S.D.curves.bpm;
    const j = bsearch(c.t, t);
    const v = c.v[j];
    $("roBpm").textContent = v ? (Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v.toFixed(1)) : "—";
  }

  /* ------------------------------------------------ setlist */
  function renderSetlist() {
    const T = tracks(), M = mixes();
    const html = [];
    T.forEach((tr, i) => {
      const k = keyOf(tr);
      const flag = possible(tr) ? `<span class="flag">possible match</span>` : "";
      html.push(`<li class="trk${tr.identified || S.names[tr.n] ? "" : " unknown"}${i === S.cur ? " now" : ""}" data-i="${i}" tabindex="0">
        <span class="when">${fmt(tr.start)}</span>
        <span class="thumb">${artHtml(tr)}</span>
        <span class="name"><span class="t">${esc(nameOf(tr))}${flag}</span><span class="a">${esc(artistOf(tr))}</span></span>
        <span class="key-chip" style="background:${keyColor(k, "base")}" title="${esc(tr.key ? `${tr.key.name}, ${Math.round(tr.key.confidence * 100)}% of windows agree` : "Key unclear")}">${k || "?"}</span>
        <span class="bpm">${tr.bpm ? Math.round(tr.bpm) : "—"}<small>BPM</small></span>
        <canvas class="spark" data-i="${i}" title="Energy across the track"></canvas>
        <span class="prog"><i style="background:${keyColor(k, "base")}"></i></span>
      </li>`);
      const m = M[i];
      if (m) {
        const a = keyColor(keyOf(tr), "base"), b = keyColor(keyOf(T[i + 1]), "base");
        const ok = m.harmonic.compatible === true ? "ok-yes" : m.harmonic.compatible === "partial" ? "ok-part" : m.harmonic.compatible === false ? "ok-no" : "";
        const len = m.bars ? `${m.bars} bars` : fmtDur(m.duration);
        const bpmd = m.bpm_delta ? ` · ${m.bpm_delta > 0 ? "+" : ""}${m.bpm_delta} BPM` : "";
        html.push(`<li class="seam${i === S.mix ? " sel" : ""}" data-m="${i}" tabindex="0" aria-label="Transition ${i + 1}: ${esc(m.type)}">
          <span class="seam-line" style="background:linear-gradient(${a}, ${b})"></span>
          <span class="seam-txt"><span class="seam-type">${esc(m.type)}</span><span>${len}</span><span class="${ok}">${esc(m.harmonic.label)}</span>${bpmd ? `<span>${bpmd.slice(3)}</span>` : ""}<span>${fmt(m.swap)}</span><span class="seam-sm" title="Smoothness out of 100">${mixScore(m).score}</span></span>
        </li>`);
      }
    });
    const ol = $("setlist");
    ol.innerHTML = html.join("");
    ol.querySelectorAll(".trk").forEach((el) => {
      const go = () => { const tr = T[+el.dataset.i]; seek(tr.start + 0.05, true); };
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
    ol.querySelectorAll(".seam").forEach((el) => {
      const go = () => { selectMix(+el.dataset.m, true); };
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
    requestAnimationFrame(drawSparks);
  }

  function drawSparks() {
    document.querySelectorAll("canvas.spark").forEach((c) => {
      const tr = tracks()[+c.dataset.i];
      const { ctx, w, h } = fit(c);
      ctx.clearRect(0, 0, w, h);
      const v = tr.spark, n = v.length;
      ctx.beginPath();
      v.forEach((y, i) => {
        const x = (i / (n - 1)) * w, yy = h - 2 - clamp(y, 0, 1) * (h - 4);
        i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      });
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = keyColor(keyOf(tr), "deep", 0.9);
      ctx.fill();
      ctx.beginPath();
      v.forEach((y, i) => {
        const x = (i / (n - 1)) * w, yy = h - 2 - clamp(y, 0, 1) * (h - 4);
        i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      });
      ctx.strokeStyle = keyColor(keyOf(tr), "base");
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  /* the tracklist in the format asked for (tracklist.js); an unnamed track keeps its clues */
  const lists = () => tracklist(S.D, { title: S.title || S.D.title, name: nameOf, artist: (tr) => (tr.identified ? tr.artist : "ID") });
  function copyText(txt, done) {
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
      .then(() => toast(done))
      .catch(() => toast("Copy isn't available in this browser"));
  }
  function copyTracklist() { copyText(lists().text, "Tracklist copied"); }
  function exportTracklist(f) {
    const L = lists();
    $("tlMore").open = false;
    if (f === "youtube") copyText(L.youtube, L.chapters >= 3 ? "YouTube chapters copied: paste them into the video's description" : "Copied, but YouTube needs at least three chapters");
    else if (f === "tl1001") copyText(L.tl1001, "Tracklist copied for 1001Tracklists");
    else {
      const url = URL.createObjectURL(new Blob([L.cue], { type: "application/x-cue" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `${(S.title || S.D.title).replace(/[^\w\- ]+/g, "")}.cue` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  /* ------------------------------------------------ mix inspector */
  function selectMix(j, scroll) {
    const M = mixes();
    if (!M.length) { $("mix").hidden = true; return; }
    $("mix").hidden = false;
    S.mix = clamp(j, 0, M.length - 1);
    const m = M[S.mix], A = tracks()[m.from - 1], B = tracks()[m.to - 1];
    $("mixCount").textContent = `${S.mix + 1} of ${M.length}`;
    $("mixTitle").textContent = `Mix ${S.mix + 1}: ${shortName(A)} into ${shortName(B)}`;
    const side = (tr, cls) => `<div class="mix-side ${cls}">
        ${cls === "b" ? "" : `<span class="thumb">${artHtml(tr)}</span>`}
        <div class="nm"><b>${esc(nameOf(tr))}</b><span>${esc(artistOf(tr))}</span>
          <span class="meta"><span class="key-chip" style="background:${keyColor(keyOf(tr), "base")};padding:0 6px">${keyOf(tr) || "?"}</span> ${tr.bpm ? `${Math.round(tr.bpm)} BPM` : ""}</span></div>
        ${cls === "b" ? `<span class="thumb">${artHtml(tr)}</span>` : ""}
      </div>`;
    $("mixPair").innerHTML = `${side(A, "a")}
      <div class="mix-type"><b>${esc(m.type)}</b><span>${m.bars ? `${m.bars} bars · ` : ""}${fmtDur(m.duration)}</span></div>
      ${side(B, "b")}`;
    const rel = m.harmonic;
    const stats = [
      ["Next track comes in", fmt(m.mix_in)],
      ["Swap", fmt(m.swap)],
      ["Mix ends", fmt(m.mix_out)],
      ["Key", `${m.key_from || "?"} → ${m.key_to || "?"} <small>${esc(rel.label.toLowerCase())}</small>`],
      ["Tempo", m.bpm_from && m.bpm_to ? (Math.abs(m.bpm_delta) < 0.5 ? `${Math.round(m.bpm_from)} BPM <small>matched</small>` : `${Math.round(m.bpm_from)} → ${Math.round(m.bpm_to)} <small>${m.bpm_delta > 0 ? "+" : ""}${m.bpm_delta}</small>`) : "—"],
      ["Energy", `${A.energy.toFixed(1)} → ${B.energy.toFixed(1)} <small>${m.energy_delta > 0 ? "+" : ""}${m.energy_delta}</small>`],
      ["Low-end dip", `${m.low_dip_db > 0 ? Math.round(m.low_dip_db) : 0} dB`],
      ["Shared sound", `${Math.round(m.style_continuity * 100)}%`],
      ["Smoothness", `${mixScore(m).score} <small>${mixScore(m).label.toLowerCase()}</small>`],
    ];
    $("mixStats").innerHTML = stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    const sc = mixScore(m);
    const tips = mixTips(m, tracks());
    $("mixTips").hidden = !tips.length;
    $("mixTips").innerHTML = tips.length ? `<h3 class="h3">How it could be smoother</h3><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
    $("mixNote").textContent = `${mixSentence(m, A, B)} Smoothness ${sc.score} of 100${sc.notes.length ? `; points lost for ${sc.notes.join(", ")}` : ", a clean hand-over on every count"}.`;
    document.querySelectorAll(".seam").forEach((el) => el.classList.toggle("sel", +el.dataset.m === S.mix));
    markCraft();
    drawMix();
    drawRibbon();
    if (scroll) $("mix").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  function mixSentence(m, A, B) {
    const a = shortName(A), b = shortName(B);
    const len = m.bars ? `${m.bars} bars` : fmtDur(m.duration);
    const how = {
      "Cut": `A hard cut from ${a} straight into ${b}.`,
      "Bass swap": `${b} ran under ${a} for ${len}; the low end dropped out for a moment at ${fmt(m.swap)} as the basslines swapped.`,
      "Breakdown drop": `${a} fell into a ${Math.round(m.breakdown_s)} s breakdown and ${b} dropped in on the other side.`,
      "Into breakdown": `The mix landed in ${b}'s stripped-back section, pulling the low end out after ${a}.`,
      "Drop swap": `${b} came in quietly, then its drop hit right at the swap.`,
      "Double drop": `Both tracks hit together around ${fmt(m.swap)}, louder than either side alone.`,
      "Long blend": `A long blend: ${a} and ${b} played together for ${len}.`,
      "Blend": `${a} blended into ${b} over ${len}.`,
    }[m.type] || "";
    const key = m.harmonic.compatible === true ? " The keys sit next to each other on the wheel." :
      m.harmonic.compatible === false ? " The keys clash on paper, so the DJ likely leaned on the drums here." : "";
    return how + key;
  }

  function mixWindow(m) {
    const pad = Math.max(14, (m.mix_out - m.mix_in) * 0.45);
    return [Math.max(0, m.mix_in - pad), Math.min(S.D.duration, m.mix_out + pad)];
  }

  function drawMix() {
    const m = mixes()[S.mix];
    if (!m) return;
    const { ctx, w, h } = fit($("mixCanvas"));
    ctx.clearRect(0, 0, w, h);
    const [w0, w1] = mixWindow(m);
    const x = (t) => ((t - w0) / (w1 - w0)) * w;
    const waveH = h * 0.6, top = 22;
    // overlap shading
    ctx.fillStyle = "rgba(255,255,255,.04)";
    ctx.fillRect(x(m.mix_in), 0, x(m.mix_out) - x(m.mix_in), h);
    ctx.save();
    ctx.translate(0, top);
    drawWave(ctx, w, waveH - top, w0, w1);
    ctx.restore();
    // low-end line underneath
    const fps = S.D.curves.wave_fps, low = S.D.curves.wave.low;
    const ly0 = waveH + 10, ly1 = h - 22;
    ctx.beginPath();
    for (let px = 0; px <= w; px += 2) {
      const t = w0 + (px / w) * (w1 - w0);
      let s = 0, n = 0;
      for (let i = Math.floor((t - 0.5) * fps); i <= Math.floor((t + 0.5) * fps); i++) { if (low[i] != null) { s += low[i]; n++; } }
      const v = n ? s / n / 99 : 0;
      const y = ly1 - v * (ly1 - ly0);
      px ? ctx.lineTo(px, y) : ctx.moveTo(px, y);
    }
    ctx.strokeStyle = "rgba(239,236,245,.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#9792AB";
    ctx.font = "500 11px Archivo, sans-serif";
    ctx.fillText("Low end", 6, ly0 + 2);
    // beat grid, counted in bars from the swap
    const beats = S.D.beats;
    if (beats.length) {
      const k0 = bsearch(beats, m.swap);
      ctx.fillStyle = "rgba(239,236,245,.28)";
      for (let k = bsearch(beats, w0); k < beats.length && beats[k] <= w1; k++) {
        const rel = k - k0, bx = x(beats[k]);
        const bar = rel % 4 === 0;
        ctx.fillRect(bx, h - (bar ? 9 : 5), 1, bar ? 9 : 5);
        if (rel % 32 === 0) {
          ctx.fillStyle = "#9792AB";
          const lbl = rel === 0 ? "0" : `${rel > 0 ? "+" : "−"}${Math.abs(rel / 4)}`;
          ctx.fillText(lbl, bx + 3, h - 11);
          ctx.fillStyle = "rgba(239,236,245,.28)";
        }
      }
    }
    // markers
    const mark = (t, label, solid) => {
      const mx = x(t);
      ctx.strokeStyle = solid ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.55)";
      ctx.lineWidth = solid ? 1.5 : 1;
      ctx.setLineDash(solid ? [] : [3, 3]);
      ctx.beginPath(); ctx.moveTo(mx, 16); ctx.lineTo(mx, h - 14); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#EFECF5";
      ctx.font = "600 11px Archivo, sans-serif";
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, clamp(mx - tw / 2, 4, w - tw - 4), 11);
    };
    mark(m.mix_in, "Next track in", false);
    mark(m.swap, "Swap", true);
    mark(m.mix_out, "Mix ends", false);
  }

  function bindMix() {
    const view = document.querySelector(".mix-view"), tip = $("mixTip");
    const tAt = (e) => {
      const r = view.getBoundingClientRect(), m = mixes()[S.mix], [w0, w1] = mixWindow(m);
      return w0 + ((e.clientX - r.left) / r.width) * (w1 - w0);
    };
    view.addEventListener("click", (e) => seek(tAt(e), true));
    view.addEventListener("pointermove", (e) => {
      const r = view.getBoundingClientRect(), t = tAt(e), m = mixes()[S.mix];
      const beats = S.D.beats;
      let bars = "";
      if (beats.length) {
        const rel = bsearch(beats, t) - bsearch(beats, m.swap);
        bars = ` · ${rel === 0 ? "at the swap" : `${Math.abs(rel / 4).toFixed(rel % 4 ? 1 : 0)} bars ${rel < 0 ? "before" : "after"} the swap`}`;
      }
      showTip(tip, e.clientX - r.left, r.width, `<span class="t-time">${fmt(t)}${bars}</span>`, 26);
    });
    view.addEventListener("pointerleave", () => (tip.hidden = true));
    $("mixPrev").addEventListener("click", () => selectMix(S.mix - 1));
    $("mixNext").addEventListener("click", () => selectMix(S.mix + 1));
    $("mixPlay").addEventListener("click", () => playMix());
    $("mixLoop").addEventListener("click", () => {
      S.loop = !S.loop;
      $("mixLoop").setAttribute("aria-pressed", String(S.loop));
      if (S.loop) playMix();
    });
  }
  function playMix(j) {
    if (j != null) selectMix(j);
    const m = mixes()[S.mix];
    seek(Math.max(0, m.mix_in - 6), true);
  }

  /* ------------------------------------------------ wheel */
  const WHEEL = { rB: [150, 190], rA: [106, 146] };
  function wheelPos(code, ring) {
    const k = window.KeyColor.parse(code);
    const ang = ((k.n % 12) * 30 - 90) * (Math.PI / 180);   // 12 at the top, clockwise
    const r = ring != null ? ring : k.mode === "B" ? (WHEEL.rB[0] + WHEEL.rB[1]) / 2 : (WHEEL.rA[0] + WHEEL.rA[1]) / 2;
    return [Math.cos(ang) * r, Math.sin(ang) * r, ang];
  }
  function arc(r0, r1, a0, a1) {
    const p = (r, a) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    return `M${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
  }
  function renderWheel() {
    const svg = $("wheel");
    const used = new Set(tracks().map(keyOf).filter(Boolean));
    const parts = [];
    for (let n = 1; n <= 12; n++) {
      for (const mode of ["B", "A"]) {
        const code = `${n}${mode}`;
        const [r0, r1] = mode === "B" ? WHEEL.rB : WHEEL.rA;
        const c = ((n % 12) * 30 - 90) * (Math.PI / 180);
        const a0 = c - (Math.PI / 12) + 0.01, a1 = c + (Math.PI / 12) - 0.01;
        const on = used.has(code);
        parts.push(`<path class="wheel-seg" d="${arc(r0, r1, a0, a1)}" fill="${keyColor(code, "base")}" opacity="${on ? 1 : 0.2}"><title>${code}</title></path>`);
        const [lx, ly] = wheelPos(code, (r0 + r1) / 2 + (mode === "B" ? 9 : 9));
        parts.push(`<text class="wheel-lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" opacity="${on ? 1 : 0.5}">${code}</text>`);
      }
    }
    parts.push(`<g id="wheelPath"></g><g id="wheelDots"></g>`);
    parts.push(`<text class="wheel-center" id="wcKey" y="-4" font-size="38" font-weight="700" style="font-stretch:75%"></text>`);
    parts.push(`<text class="wheel-center" id="wcSub" y="22" font-size="12" fill="#9792AB"></text>`);
    svg.innerHTML = parts.join("");
    // dots: tracks sharing a key fan out inside the segment
    const counts = {};
    const pts = tracks().map((tr) => {
      const k = keyOf(tr);
      if (!k) return null;
      counts[k] = (counts[k] || 0) + 1;
      return { tr, k, idx: counts[k] - 1 };
    });
    S.wheelPts = pts.map((p) => {
      if (!p) return null;
      const total = counts[p.k];
      const [, , ang] = wheelPos(p.k);
      const kk = window.KeyColor.parse(p.k);
      const base = kk.mode === "B" ? WHEEL.rB : WHEEL.rA;
      const spread = Math.min(0.42, 0.11 * (total - 1));
      const a = ang + (total > 1 ? -spread / 2 + (spread * p.idx) / (total - 1) : 0);
      const r = base[0] + 12 + ((p.idx % 2) * 10);
      return { ...p, x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
    const dots = S.wheelPts.map((p, i) => p ? `<circle class="wheel-dot" data-i="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6.5" fill="${keyColor(p.k, "pale")}"><title>${p.tr.n}. ${esc(nameOf(p.tr))} (${p.k})</title></circle>` : "").join("");
    $("wheelDots").innerHTML = dots;
    $("wheelDots").querySelectorAll("circle").forEach((c) => c.addEventListener("click", () => seek(tracks()[+c.dataset.i].start + 0.05, true)));
    const harmonic = S.D.summary.harmonic_pct;
    $("wheelSub").textContent = `Each dot is a track on the Camelot wheel, joined in the order played. Neighboring keys mix cleanly${harmonic != null ? `; ${harmonic}% of these mixes did` : ""}.`;
    renderKeyTime();
    updateWheel();
  }
  /* minutes in each key, under the wheel; the top one is the set's home key */
  function renderKeyTime() {
    const [s0, s1] = span(), time = {}, first = {};
    tracks().forEach((tr) => {
      const k = keyOf(tr);
      if (!k) return;
      time[k] = (time[k] || 0) + Math.max(0, Math.min(tr.end, s1) - Math.max(tr.start, s0));
      if (first[k] == null) first[k] = tr.start;
    });
    const rows = Object.entries(time).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((a, [, t]) => a + t, 0) || 1;
    if (!rows.length) { $("keyTime").innerHTML = ""; return; }
    const shown = rows.slice(0, 6), rest = rows.slice(6);
    const name = (k) => (tracks().find((t) => keyOf(t) === k) || {}).key?.name || "";
    const [hk, ht] = rows[0];
    $("keyTime").innerHTML = `<p class="kt-home">Home key <b style="color:${keyColor(hk, "ink")}">${hk}</b> ${esc(name(hk))}: ${Math.round((100 * ht) / total)}% of the set, across ${rows.length} key${rows.length > 1 ? "s" : ""}</p>` +
      shown.map(([k, t]) => `<button class="kt-row" data-k="${k}" data-t="${first[k]}" aria-label="${k}, ${fmtDur(Math.round(t))}: play the first track in this key">
        <span class="kt-k" style="background:${keyColor(k, "base")}">${k}</span>
        <span class="kt-bar"><i style="width:${((100 * t) / ht).toFixed(1)}%;background:${keyColor(k, "base")}"></i></span>
        <span class="kt-v">${Math.round(t / 60)} min</span></button>`).join("") +
      (rest.length ? `<p class="kt-rest">+ ${rest.map(([k]) => k).join(", ")} (${Math.round(rest.reduce((a, [, t]) => a + t, 0) / 60)} min)</p>` : "");
    $("keyTime").querySelectorAll(".kt-row").forEach((b) => b.addEventListener("click", () => seek(+b.dataset.t + 0.05, true)));
  }
  function updateWheel() {
    if (!S.wheelPts) return;
    const pts = S.wheelPts.filter(Boolean);
    const curve = (a, b) => {
      // bow long jumps toward the center so the path reads as a journey
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const pull = clamp(d / 340, 0, 0.8);
      return `Q${(mx * (1 - pull)).toFixed(1)} ${(my * (1 - pull)).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    };
    let done = "", rest = "";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const seg = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} ${curve(a, b)}`;
      if (b.tr.n - 1 <= S.cur) done += seg; else rest += seg;
    }
    $("wheelPath").innerHTML = `<path class="wheel-path-dim" d="${rest}"/><path class="wheel-path" d="${done}"/>`;
    $("wheelDots").querySelectorAll("circle").forEach((c) => {
      const i = +c.dataset.i;
      c.classList.toggle("now", i === S.cur);
      c.setAttribute("r", i === S.cur ? 9 : 6.5);
      c.setAttribute("opacity", i <= S.cur ? 1 : 0.55);
    });
    const tr = tracks()[Math.max(0, S.cur)];
    $("wcKey").textContent = keyOf(tr) || "?";
    $("wcKey").setAttribute("fill", keyColor(keyOf(tr), "ink"));
    $("wcSub").textContent = tr.key ? tr.key.name : "key unclear";
    $("keyTime").querySelectorAll(".kt-row").forEach((b) => b.classList.toggle("now", b.dataset.k === keyOf(tr)));
  }

  /* ------------------------------------------------ how it was mixed */
  function renderCraft() {
    const C = craftProfile(S.D), M = mixes(), T = tracks();
    $("craft").hidden = !C || M.length < 2;
    if ($("craft").hidden) return;
    const st = C.stats;
    $("craftName").textContent = C.style.name;
    $("craftLine").textContent = C.style.line + (C.style.also ? ` A close second: ${C.style.also.replace(/^The /, "the ")}.` : "");
    const tiles = [
      ["Median mix", st.medBars ? `${st.medBars} bars` : fmtDur(st.medDur), st.medBars ? `${Math.round(st.medDur)} s` : ""],
      ["In key", `${st.harmonicPct}%`, st.partialPct ? `+${st.partialPct}% partly` : ""],
      ["Bass swaps", `${st.bassPct}%`, "of mixes"],
      ["Tempo moves", String(st.tempoMoves), st.maxBpmDelta ? `max ±${st.maxBpmDelta.toFixed(1)} BPM` : "none"],
      ["Lifts / drops", `${st.ups} / ${st.downs}`, "energy ±1 or more"],
      ["Smoothness", `${st.smooth}`, `${st.smoothLabel.toLowerCase()}, mean of 100`],
    ];
    $("craftStats").innerHTML = tiles.map(([k, v, sub]) => `<div><dt>${k}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ""}</dd></div>`).join("");
    // columns: height ∝ √bars so a 64-bar blend doesn't flatten the 8-bar swaps
    const bars = M.map((m) => m.bars || Math.max(1, Math.round(m.duration / 2)));
    const top = Math.max(32, ...bars), hgt = (b) => Math.sqrt(b / top);
    $("craftGrid").innerHTML = [8, 16, 32, 64].filter((b) => b <= top).map((b) => `<div class="cc-line" style="bottom:${(hgt(b) * 100).toFixed(1)}%"><span>${b}</span></div>`).join("");
    $("craftCols").innerHTML = M.map((m, j) => {
      const a = keyOf(T[m.from - 1]), b = keyOf(T[m.to - 1]);
      return `<button class="cc-col ${relationClass(m.harmonic.label)}" role="listitem" data-j="${j}" style="--h:${(hgt(bars[j]) * 100).toFixed(1)}%;--a:${keyColor(a, "base")};--b:${keyColor(b, "base")}" aria-label="Mix ${j + 1}: ${esc(shortName(T[m.from - 1]))} into ${esc(shortName(T[m.to - 1]))}, ${esc(m.type)}, ${m.bars ? `${m.bars} bars` : fmtDur(m.duration)}, ${esc(m.harmonic.label)}"><i></i></button>`;
    }).join("");
    const cols = $("craftCols"), tip = $("craftTip");
    cols.querySelectorAll(".cc-col").forEach((el) => {
      const j = +el.dataset.j, m = M[j];
      el.addEventListener("pointerenter", () => {
        const r = cols.getBoundingClientRect(), c = el.getBoundingClientRect();
        showTip(tip, c.left - r.left + c.width / 2, r.width,
          `<span class="t-time">Mix ${j + 1} · ${fmt(m.swap)}</span><span class="t-title">${esc(shortName(T[m.from - 1]))} → ${esc(shortName(T[m.to - 1]))}</span>` +
          `<span class="t-meta">${esc(m.type)} · ${m.bars ? `${m.bars} bars` : fmtDur(m.duration)} · ${esc(m.key_from || "?")} → ${esc(m.key_to || "?")} ${esc(m.harmonic.label.toLowerCase())}${m.bpm_delta ? ` · ${m.bpm_delta > 0 ? "+" : ""}${m.bpm_delta} BPM` : ""} · smoothness ${C.smooth[j].score}</span>`, 4);
      });
      el.addEventListener("pointerleave", () => (tip.hidden = true));
      el.addEventListener("click", () => { selectMix(j, true); playMix(); });
    });
    const list = (rows, cls) => {
      const max = Math.max(...rows.map((r) => r.count));
      return rows.map((r) => `<div class="cb-row ${cls ? cls(r.label) : ""}"><span class="cb-l">${esc(r.label)}</span><span class="cb-bar"><i style="width:${(r.count / max) * 100}%"></i></span><span class="cb-n">${r.count}</span></div>`).join("");
    };
    $("craftKeys").innerHTML = list(C.relations, relationClass);
    $("craftTypes").innerHTML = list(C.types);
    $("craftMoments").innerHTML = C.moments.map((x) => {
      const m = M[x.j];
      return `<li><button class="cb-mo" data-j="${x.j}"><b>${esc(x.what)}</b><span>${esc(shortName(T[m.from - 1]))} → ${esc(shortName(T[m.to - 1]))}</span><small>${esc(x.detail)} · at ${fmt(m.swap)}</small></button></li>`;
    }).join("");
    $("craftMoments").querySelectorAll(".cb-mo").forEach((b) => b.addEventListener("click", () => { selectMix(+b.dataset.j, true); playMix(); }));
    renderReorder();
    markCraft();
  }
  /* the same tracks, re-sequenced: a slope chart from the played order to the suggested one */
  function renderReorder() {
    const O = (S.order = reorder(S.D, { pinEnds: $("roPin").checked })), T = tracks();
    $("reorder").hidden = !O;
    if (!O) return;
    const ord = (k) => `${k}${["th", "st", "nd", "rd"][(k % 100 > 10 && k % 100 < 14) || k % 10 > 3 ? 0 : k % 10]}`;
    const b = O.before, a = O.after;
    $("roLine").textContent = O.unchanged
      ? `The running order is already as smooth as these tracks allow: ${b.clean} of ${O.mixes} mixes land in key.`
      : `Re-sequenced with the same energy arc, ${a.clean} of ${O.mixes} mixes would land in key (as played: ${b.clean}) and key clashes go from ${b.clash} to ${a.clash}; the average tempo step is ${a.tempo} BPM (was ${b.tempo}).`;
    const n = O.order.length, w = 1000 / n, pos = Object.fromEntries(O.order.map((tn, i) => [tn, i]));
    const played = T.filter((t) => keyOf(t)).map((t) => t.n);
    const clash = (seq) => seq.slice(1).map((tn, i) => harmonicRelation(keyOf(T[seq[i] - 1]), keyOf(T[tn - 1])).compatible === false ? i + 1 : -1).filter((i) => i > 0);
    let g = "";
    played.forEach((tn, i) => {
      const j = pos[tn], moved = i !== j;
      g += `<line class="ro-link${moved ? " moved" : ""}" x1="${(i + 0.5) * w}" y1="34" x2="${(j + 0.5) * w}" y2="116" vector-effect="non-scaling-stroke"/>`;
    });
    const row = (seq, y) => seq.map((tn, i) => `<rect x="${i * w + 1}" y="${y}" width="${w - 2}" height="30" rx="3" fill="${keyColor(keyOf(T[tn - 1]), "base")}"><title>Track ${tn}: ${esc(shortName(T[tn - 1]))} (${keyOf(T[tn - 1])})</title></rect>`).join("") +
      clash(seq).map((i) => `<rect class="ro-clash" x="${i * w - 2}" y="${y - 4}" width="4" height="38" />`).join("");
    g += row(played, 4) + row(O.order, 116);
    $("roSvg").innerHTML = g;
    $("roMoves").innerHTML = O.moves.slice(0, 3).map((m) => `<li><b>${esc(shortName(T[m.n - 1]))}</b> (track ${m.n}, ${keyOf(T[m.n - 1])}) moves from ${ord(m.from)} to ${ord(m.to)}</li>`).join("");
    $("roPin").onchange = renderReorder;
    $("roSave").onclick = saveOrder;
    if (takePending("order")) saveOrder();
  }
  /* the named tracks, in the suggested order, as a Spotify playlist */
  function saveOrder() {
    const T = tracks(), say = (h) => ($("roStatus").innerHTML = h);
    spotifySave({
      tracks: S.order.order.map((n) => T[n - 1]), names: S.names,
      name: `${S.title || S.D.title} · smoother order · Set Replay`,
      description: `The tracks of ${S.title || S.D.title}, re-sequenced: ${S.order.after.clean} of ${S.order.mixes} mixes in key.`,
      say, btn: $("roSave"), pending: { action: "order" },
    });
  }
  function markCraft() {
    document.querySelectorAll(".cc-col").forEach((el) => el.classList.toggle("on", +el.dataset.j === S.mix));
  }

  /* ------------------------------------------------ mood map */
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

  /* ------------------------------------------------ compare with another set */
  async function loadPayload(slug) {
    if (S.mode === "local") { const rec = await getSet(slug); return rec && rec.payload; }
    const r = await fetch(S.mode === "demo" ? `demo/${encodeURIComponent(slug)}.json` : `data/sets/${encodeURIComponent(slug)}.json`);
    return r.ok ? r.json() : null;
  }
  const titleOf = (slug, fallback) => (load(`set-replay:${slug}`) || {}).title || fallback;
  function renderCompare() {
    const others = (S.sets || []).filter((s) => s.slug !== S.D.slug);
    $("compare").hidden = !others.length;
    if (!others.length) return;
    const want = load(`set-replay:compare:${S.D.slug}`);
    const pick = others.find((s) => s.slug === want) || others[0];
    $("cmpSel").innerHTML = others.map((s) => `<option value="${esc(s.slug)}"${s === pick ? " selected" : ""}>${esc(titleOf(s.slug, s.title))}</option>`).join("");
    $("cmpSel").onchange = () => { store(`set-replay:compare:${S.D.slug}`, $("cmpSel").value); showCompare($("cmpSel").value); };
    $("cmpCopy").onclick = async () => {
      try { await navigator.clipboard.writeText($("cmpPrompt").value); toast("Blend prompt copied"); } catch (e) { $("cmpPrompt").select(); toast("Select the prompt and copy it"); }
    };
    showCompare(pick.slug);
  }
  async function showCompare(slug) {
    const mine = S.D.slug;
    const B = await loadPayload(slug).catch(() => null);
    if (S.D.slug !== mine) return;                 // the visitor moved on while it loaded
    $("cmpBody").hidden = !B;
    if (!B) return;
    const ta = S.title || S.D.title, tb = titleOf(slug, B.title);
    const C = compareSets(S.D, B, { a: ta, b: tb });
    $("cmpScore").textContent = `${C.score}`;
    $("cmpVerdict").textContent = `${C.verdict} · similarity out of 100`;
    const PART = { sound: "Sound (styles)", feel: "Feel (mood axes)", tempo: "Tempo", artists: "Shared artists" };
    $("cmpParts").innerHTML = Object.entries(C.parts).filter(([, v]) => v != null).map(([k, v]) =>
      `<div class="cb-row"><span class="cb-l">${PART[k]}</span><span class="cb-bar"><i style="width:${Math.round(v * 100)}%"></i></span><span class="cb-n">${Math.round(v * 100)}</span></div>`).join("");
    $("cmpDiffs").innerHTML = C.diffs.map((d) => `<li>${esc(d)}</li>`).join("") || "<li>No big differences on any axis.</li>";
    const both = [...C.genres.both.map((g) => g.toLowerCase().replace("drum n bass", "drum & bass")), ...C.artists];
    $("cmpShared").innerHTML = both.length ? `In common: ${both.map((x) => `<span class="tag">${esc(x)}</span>`).join(" ")}` : "No genres or artists in common.";
    // the overlaid radar: this set filled, the other outlined
    const R = 112, pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length; return [Math.cos(a) * R * v, Math.sin(a) * R * v]; };
    const poly = (ax) => AXES.map(([k], i) => pt(i, Math.max(0.03, ax[k] || 0)).map((n) => n.toFixed(1)).join(",")).join(" ");
    const home = (D) => { const t = {}; D.tracks.forEach((tr) => { const k = keyOf(tr); if (k) t[k] = (t[k] || 0) + tr.end - tr.start; }); return Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
    const ka = home(S.D), kb = home(B);
    let g = "";
    [0.25, 0.5, 0.75, 1].forEach((r) => (g += `<polygon class="vr-ring" points="${AXES.map((_, i) => pt(i, r).join(",")).join(" ")}"/>`));
    AXES.forEach(([, label], i) => {
      const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.17);
      g += `<line class="vr-spoke" x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="vr-lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${Math.abs(lx) < 8 ? "middle" : lx > 0 ? "start" : "end"}">${label}</text>`;
    });
    g += `<polygon class="vr-set" points="${poly(C.axes.a)}" style="fill:${keyColor(ka, "base")};stroke:${keyColor(ka, "ink")}"/>`;
    g += `<polygon class="cmp-b" points="${poly(C.axes.b)}" style="stroke:${keyColor(kb, "ink")}"/>`;
    $("cmpRadar").innerHTML = g;
    $("cmpCap").innerHTML = `<span class="v-lg"><i class="v-sw" style="background:${keyColor(ka, "base")};border-color:${keyColor(ka, "ink")}"></i>${esc(ta)}</span><span class="v-lg"><i class="v-sw v-sw-now" style="border-color:${keyColor(kb, "ink")}"></i>${esc(tb)}</span>`;
    const M = mergePayloads(S.D, B, `${ta} + ${tb}`), blend = buildPrompt(vibeProfile(M));
    $("cmpPrompt").value = blend.full;
    const saveBlend = () => spotifySave({
      tracks: M.tracks, names: S.names,                  // the first set's own names; its track numbers are unchanged
      name: `${ta} + ${tb} · Set Replay`, description: blend.short,
      say: (h) => ($("cmpStatus").innerHTML = h), btn: $("cmpSave"), pending: { action: "blend", slug },
    });
    $("cmpSave").onclick = saveBlend;
    const p = takePending("blend");
    if (p && p.slug === slug) saveBlend();
  }

  /* ------------------------------------------------ set card */
  async function openCard() {
    const dlg = $("cardDlg");
    if (!dlg.open) dlg.showModal();
    // the canvas only uses Archivo once those weights are loaded
    try { await Promise.all(["400 25px Archivo", "700 20px Archivo", "900 74px Archivo"].map((f) => document.fonts.load(f))); } catch (e) { /* system font */ }
    const c = $("cardCanvas");
    drawCard(c.getContext("2d"), cardData(S.D, { title: S.title || S.D.title, names: S.names, off: vibeOffWhole() }), keyColor);
    $("cardShare").hidden = !(navigator.canShare && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] }));
  }
  const cardBlob = () => new Promise((res) => $("cardCanvas").toBlob(res, "image/png"));

  /* ------------------------------------------------ chapters */
  function renderPhases() {
    const P = S.phases, T = tracks();
    const block = $("phases").closest(".j-block");
    block.hidden = P.length < 2;
    if (P.length < 2) return;
    $("phaseSub").textContent = "Where the set changes gear, from track energy and tempo";
    const maxE = Math.max(...P.map((p) => p.energy));
    $("phases").style.gridTemplateColumns = P.map((p) => `minmax(0, ${Math.max(1, p.end - p.start).toFixed(0)}fr)`).join(" ");
    $("phases").innerHTML = P.map((p, i) => {
      const k = p.keys[0] || keyOf(T[p.from - 1]);
      // the same words the chapter's Spotify prompt uses: trusted genres, then the leading mood
      const V = vibeProfile(slicePayload(S.D, p));
      const styles = [...V.chips.filter((c) => c.group === "Genre" && c.on).slice(0, 2), ...V.chips.filter((c) => c.group === "Mood").slice(0, 1)].map((c) => c.text).join(" · ");
      return `<div class="ph" data-i="${i}" style="--c:${keyColor(k, "deep")};--c2:${keyColor(k, "base")}">
        <button class="ph-go" data-t="${p.start}" aria-label="Play ${esc(p.label)}, tracks ${p.from} to ${p.to}">
          <span class="ph-l">${esc(p.label)}</span>
          <span class="ph-t">${fmt(p.start)}–${fmt(p.end)} · tracks ${p.from}–${p.to}</span>
          <span class="ph-s">${Math.round(p.bpm)} BPM · energy ${p.energy.toFixed(1)}${p.drops ? ` · ${p.drops} drop${p.drops > 1 ? "s" : ""}` : ""}</span>
          ${styles ? `<span class="ph-st">${esc(styles)}</span>` : ""}
          <span class="ph-bar" aria-hidden="true"><i style="width:${Math.round((p.energy / maxE) * 100)}%"></i></span>
        </button>
        <button class="ph-vibe ghost" data-i="${i}">Spotify prompt</button>
      </div>`;
    }).join("");
    $("phases").querySelectorAll(".ph-go").forEach((b) => b.addEventListener("click", () => seek(+b.dataset.t + 0.05, true)));
    $("phases").querySelectorAll(".ph-vibe").forEach((b) => b.addEventListener("click", () => {
      vibeScope(+b.dataset.i);
      $("vibe").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }));
  }

  /* ------------------------------------------------ energy + rows */
  function drawEnergy() {
    const box = $("energyBox"), c = $("energyCanvas");
    const { ctx, w, h } = fit(c);
    ctx.clearRect(0, 0, w, h);
    const e = S.D.curves.energy.v;
    const [s0, s1] = span(), L = s1 - s0;
    const xt = (t) => ((t - s0) / L) * w, tx = (px) => s0 + (px / w) * L;
    const y = (v) => h - 14 - clamp(v || 0, 0, 1.05) * (h - 26);
    // gridlines
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((g) => { ctx.beginPath(); ctx.moveTo(0, y(g)); ctx.lineTo(w, y(g)); ctx.stroke(); });
    // per-track fill
    tracks().forEach((tr, i) => {
      const x0 = xt(tr.start), x1 = xt(Math.min(tr.end, s1));
      ctx.beginPath();
      ctx.moveTo(x0, h - 14);
      for (let px = Math.floor(x0); px <= Math.ceil(x1); px++) {
        const t = clamp(Math.round(tx(px)), 0, e.length - 1);
        ctx.lineTo(px, y(e[t]));
      }
      ctx.lineTo(x1, h - 14);
      ctx.closePath();
      ctx.fillStyle = rgb(TC[i].deep, 0.85);
      ctx.fill();
    });
    ctx.beginPath();
    for (let px = 0; px <= w; px++) {
      const t = clamp(Math.round(tx(px)), 0, e.length - 1);
      px ? ctx.lineTo(px, y(e[t])) : ctx.moveTo(px, y(e[t]));
    }
    ctx.strokeStyle = "rgba(239,236,245,.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // chapter boundaries and names
    if ((S.phases || []).length > 1) {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(239,236,245,.35)";
      ctx.font = "600 10.5px Archivo, sans-serif";
      S.phases.forEach((p, i) => {
        const x = xt(p.start);
        if (i) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 14); ctx.stroke(); }
        ctx.fillStyle = "rgba(239,236,245,.6)";
        if (xt(p.end) - x > 60) ctx.fillText(p.label.toUpperCase(), x + 6, 12);
      });
      ctx.restore();
    }
    // drops along the baseline
    ctx.fillStyle = "rgba(239,236,245,.85)";
    S.D.drops.forEach((d) => {
      const x = xt(d.t);
      ctx.beginPath(); ctx.moveTo(x - 4, h - 1); ctx.lineTo(x + 4, h - 1); ctx.lineTo(x, h - 8); ctx.closePath(); ctx.fill();
    });
    // peak marker
    const pk = S.D.summary.peak_t, px = xt(pk);
    ctx.fillStyle = "#EFECF5";
    ctx.beginPath(); ctx.arc(px, y(e[pk]), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = "600 11px Archivo, sans-serif";
    const lbl = "Peak";
    ctx.fillText(lbl, clamp(px + 6, 2, w - 30), y(e[pk]) - 6);
    $("energySub").textContent = `Loudness, brightness and intensity combined · peak at ${fmt(pk)} · ${S.D.drops.length} drops`;
    void box;
  }

  const MOODS = [["danceability", "Danceable"], ["mood_party", "Party"], ["mood_aggressive", "Aggressive"], ["mood_happy", "Happy"], ["voice_instrumental", "Vocals"]];
  function renderRows() {
    const st = S.D.curves.styles;
    const [s0, s1] = span();
    const inSet = (i, step) => i * step + step / 2 >= s0 && i * step + step / 2 <= s1;
    const sv = st.v.filter((_, i) => inSet(i, st.step));
    const avg = st.names.map((_, i) => sv.reduce((s, r) => s + r[i], 0) / Math.max(1, sv.length));
    $("styleRows").innerHTML = st.names.slice(0, -1).map((n, i) =>
      `<div class="row" data-kind="style" data-i="${i}"><span class="rl" title="${esc(n)}">${esc(n)}</span><canvas></canvas><span class="rv">${Math.round(avg[i] * 100)}%</span></div>`).join("");
    const mv = S.D.curves.moods.v;
    $("moodRows").innerHTML = MOODS.filter(([k]) => mv[k]).map(([k, label]) => {
      const vals = mv[k].filter((_, i) => inSet(i, S.D.curves.moods.step));
      const a = vals.reduce((s, x) => s + (x || 0), 0) / Math.max(1, vals.length);
      return `<div class="row" data-kind="mood" data-k="${k}"><span class="rl">${label}</span><canvas></canvas><span class="rv">${a.toFixed(2)}</span></div>`;
    }).join("");
    document.querySelectorAll(".row").forEach((row) => {
      const c = row.querySelector("canvas");
      c.addEventListener("click", (e) => {
        const r = c.getBoundingClientRect();
        seek(span()[0] + ((e.clientX - r.left) / r.width) * (span()[1] - span()[0]), true);
      });
    });
  }
  function drawRows(t) {
    const st = S.D.curves.styles;
    const [s0, s1] = span(), L = s1 - s0;
    const gmax = Math.max(...st.v.map((r) => Math.max(...r.slice(0, -1))));
    document.querySelectorAll(".row").forEach((row) => {
      const c = row.querySelector("canvas");
      const { ctx, w, h } = fit(c);
      ctx.clearRect(0, 0, w, h);
      let vals, step, max;
      if (row.dataset.kind === "style") { vals = st.v.map((r) => r[+row.dataset.i]); step = st.step; max = gmax; }
      else { vals = S.D.curves.moods.v[row.dataset.k]; step = S.D.curves.moods.step; max = 1; }
      ctx.fillStyle = "rgba(255,255,255,.04)";
      ctx.fillRect(0, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(0, h);
      vals.forEach((v, i) => {
        const x = ((i * step + step / 2 - s0) / L) * w;
        ctx.lineTo(x, h - clamp((v || 0) / max, 0, 1) * (h - 2));
      });
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = "rgba(239,236,245,.5)";
      ctx.fill();
      if (t != null) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(((t - s0) / L) * w - 1, 0, 2, h);
      }
    });
  }

  function bindEnergy() {
    const box = $("energyBox"), tip = box.querySelector(".tip"), hov = box.querySelector(".c-hover");
    box.addEventListener("pointermove", (e) => {
      const r = box.getBoundingClientRect(), x = e.clientX - r.left;
      const t = span()[0] + (x / r.width) * (span()[1] - span()[0]), tr = tracks()[trackAt(t)];
      const v = S.D.curves.energy.v[clamp(Math.round(t), 0, S.D.curves.energy.v.length - 1)] || 0;
      hov.hidden = false; hov.style.left = `${x}px`;
      showTip(tip, x, r.width, `<span class="t-time">${fmt(t)}</span><span class="t-title">${esc(nameOf(tr))}</span><span class="t-meta">Energy ${(1 + 9 * clamp(v, 0, 1)).toFixed(1)} of 10</span>`, 6);
    });
    box.addEventListener("pointerleave", () => { tip.hidden = true; hov.hidden = true; });
    box.addEventListener("click", (e) => {
      const r = box.getBoundingClientRect();
      seek(span()[0] + ((e.clientX - r.left) / r.width) * (span()[1] - span()[0]), true);
    });
  }

  function renderCredits() {
    const D = S.D, c = D.credits;
    const when = new Date(D.analyzed_at);
    $("credits").innerHTML = `Analyzed ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} from <b>${esc(D.file)}</b>.
      Beats, tempo and key: ${esc(c.beats_key_tempo)}. Styles and moods: ${esc(c.styles_moods)}. Track names: ${esc(c.identification)}.
      Mix points, types and energy are estimated from the audio, so treat them as a close read rather than ground truth.
      ${S.mode === "local" ? `<span class="c-actions">${S.noAudio ? `<button class="ghost" id="attachBtn">Add the recording</button>` : ""}<button class="ghost" id="exportBtn">Download the analysis (JSON)</button> <button class="ghost" id="deleteBtn">Delete from this browser</button></span>` : ""}`;
    if (S.mode !== "local") return;
    if (S.noAudio) {
      $("attachBtn").addEventListener("click", () => {
        const input = Object.assign(document.createElement("input"), { type: "file", accept: "audio/*,video/mp4,video/quicktime,.m4a,.mp3,.wav,.flac,.aac,.ogg,.aif,.aiff,.mp4,.mov,.m4v" });
        input.onchange = async () => {
          let f = input.files[0];
          if (!f) return;
          if (isVideo(f)) f = (await extractAudio(f).catch(() => null)) || f;   // keep the soundtrack, not the video
          await attachAudio(S.D.slug, f);
          location.reload();
        };
        input.click();
      });
    }
    $("exportBtn").addEventListener("click", () => {
      const out = { ...S.D, title: S.title || S.D.title, user_names: S.names };
      const url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `${(S.title || S.D.title).replace(/[^\w\- ]+/g, "")}.setreplay.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    $("deleteBtn").addEventListener("click", async () => {
      const btn = $("deleteBtn");
      if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Click again to delete"; return; }
      await deleteSet(S.D.slug);
      location.href = "./";
    });
  }

  /* ------------------------------------------------ scrub bar */
  function drawScrub() {
    const { ctx, w, h } = fit($("scrubCanvas"));
    ctx.clearRect(0, 0, w, h);
    const D = S.D.duration;
    for (let x = 0; x < w; x++) {
      const ta = (x / w) * D, tb = ((x + 1) / w) * D;
      const v = Math.max(waveMax("low", ta, tb), waveMax("mid", ta, tb)) / 99;
      const bh = Math.max(2, v * (h - 6));
      ctx.fillStyle = rgb(colorAt((ta + tb) / 2, "base"));
      ctx.fillRect(x, (h - bh) / 2, 1, bh);
    }
  }

  /* ------------------------------------------------ playback */
  function seek(t, play) {
    t = clamp(t, 0, S.D.duration - 0.1);
    if (S.noAudio) S.vt = t; else audio.currentTime = t;
    if (play) startPlay();
    tick(true);
  }
  function startPlay() {
    if (S.noAudio) {
      if (!S.toldNoAudio) toast(S.mode === "demo" ? "This demo comes without its audio. Click around to explore, or drop in your own set." : "This set was imported without its audio. Use “Add the recording” at the bottom of the page.");
      S.toldNoAudio = true;
      return;
    }
    ensureAudioGraph();
    if (S.actx && S.actx.state === "suspended") S.actx.resume().catch(() => {});   // Firefox rejects it on navigation
    const p = audio.play();
    if (p && p.catch) p.catch(() => toast("Press play to start the audio"));
  }
  function togglePlay() { isPaused() ? startPlay() : audio.pause(); }

  function tick(force) {
    if (!S.D) return;
    const t = now(), D = S.D.duration;
    // current track + live mix selection
    const i = trackAt(t);
    if (i !== S.cur) setTrack(i);
    const live = mixes().findIndex((m) => t >= m.mix_in - 4 && t <= m.mix_out);
    if (live >= 0 && live !== S.mix && !isPaused() && !S.loop) selectMix(live, false);
    // loop the selected mix
    if (S.loop && !isPaused()) {
      const m = mixes()[S.mix];
      if (t > m.mix_out + 6 || t < m.mix_in - 12) audio.currentTime = Math.max(0, m.mix_in - 6);
    }
    // follow
    const vspan = S.view.t1 - S.view.t0;
    if (S.follow && !isPaused() && vspan < D - 0.5 && (t > S.view.t1 - vspan * 0.04 || t < S.view.t0)) {
      setView(t - vspan * 0.1, vspan);
      return;
    }
    // ribbon playhead
    const rw = $("ribbon").clientWidth;
    const rx = X(t, rw);
    $("rPlayhead").style.left = `${rx}px`;
    $("rPlayhead").hidden = rx < 0 || rx > rw;
    $("ovPlayhead").style.left = `${(t / D) * $("overview").clientWidth}px`;
    // scrub
    $("scrubFill").style.left = `${(t / D) * 100}%`;
    $("tCur").textContent = fmt(t);
    // setlist progress
    const tr = tracks()[S.cur];
    const li = document.querySelector(`.trk[data-i="${S.cur}"] .prog i`);
    if (li) li.style.width = `${clamp((t - tr.start) / (tr.end - tr.start), 0, 1) * 100}%`;
    // mix playhead
    const m = mixes()[S.mix];
    if (m) {
      const [w0, w1] = mixWindow(m), ph = $("mixPlayhead");
      ph.hidden = t < w0 || t > w1;
      ph.style.left = `${((t - w0) / (w1 - w0)) * 100}%`;
    }
    updatePulse(t);
    drawSpectrum();
    if (force || (tick._rows || 0) + 0.5 < t || t < (tick._rows || 0)) { drawRows(t); tick._rows = t; }
    // the highlights reel: on to the next moment, or stop if the listener went elsewhere
    if (S.reel && !isPaused()) {
      const h = S.hl.items[S.reel.i];
      if (t < h.t - 3 || t > h.t + h.dur + 3) stopReel();
      else if (t >= h.t + h.dur) S.reel.i + 1 < S.hl.items.length ? playHighlight(S.reel.i + 1, true) : stopReel();
      else { const c = document.querySelector(".hl-card.on"); if (c) c.style.setProperty("--p", `${clamp((t - h.t) / h.dur, 0, 1) * 100}%`); }
    }
    // drop anatomy: highlight the drop being played, with a dot riding its curve
    if (S.dropA) {
      const k = S.dropA.rows.findIndex((r) => t >= r.t - PRE && t <= r.t + POST);
      if (k !== S.dropLive || (k >= 0 && (force || Math.abs(t - (tick._drop || 0)) > 0.2))) { S.dropLive = k; tick._drop = t; drawDrops(); }
    }
  }
  function loop() {
    if (!isPaused()) tick();
    requestAnimationFrame(loop);
  }

  function setPlayIcon() {
    const p = isPaused();
    // the icons are <svg>: SVG elements have no .hidden property, so set the attribute
    document.querySelector(".i-play").toggleAttribute("hidden", !p);
    document.querySelector(".i-pause").toggleAttribute("hidden", p);
    $("playBtn").setAttribute("aria-label", p ? "Play" : "Pause");
  }

  function bindStatic() {
    bindRibbon();
    bindMix();
    bindEnergy();
    bindRename();
    $("playBtn").addEventListener("click", togglePlay);
    $("nextTrack").addEventListener("click", () => { const n = tracks()[S.cur + 1]; if (n) seek(n.start + 0.05, !isPaused()); });
    $("prevTrack").addEventListener("click", () => {
      const tr = tracks()[S.cur];
      const target = now() - tr.start > 4 || S.cur === 0 ? tr : tracks()[S.cur - 1];
      seek(target.start + 0.05, !isPaused());
    });
    $("followBtn").addEventListener("click", () => {
      S.follow = !S.follow;
      $("followBtn").setAttribute("aria-pressed", String(S.follow));
    });
    $("copyBtn").addEventListener("click", copyTracklist);
    $("tlMore").querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => exportTracklist(b.dataset.f)));
    $("cardBtn").addEventListener("click", openCard);
    $("cardClose").addEventListener("click", () => $("cardDlg").close());
    $("cardDl").addEventListener("click", () => cardBlob().then((b) => {
      const url = URL.createObjectURL(b);
      const a = Object.assign(document.createElement("a"), { href: url, download: `${(S.title || S.D.title).replace(/[^\w\- ]+/g, "")} - set card.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }));
    $("cardShare").addEventListener("click", () => cardBlob().then((b) => {
      const file = new File([b], "set-card.png", { type: "image/png" });
      navigator.share({ files: [file], title: S.title || S.D.title }).catch(() => { /* canceled */ });
    }));
    $("helpBtn").addEventListener("click", () => ($("keysHelp").hidden = !$("keysHelp").hidden));
    const scrub = $("scrub");
    const scrubTo = (e) => { const r = scrub.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * S.D.duration, false); };
    let scrubbing = false;
    scrub.addEventListener("pointerdown", (e) => { scrubbing = true; scrub.setPointerCapture(e.pointerId); scrubTo(e); });
    scrub.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e); });
    scrub.addEventListener("pointerup", () => (scrubbing = false));
    ["play", "pause"].forEach((ev) => audio.addEventListener(ev, () => { setPlayIcon(); tick(true); }));
    audio.addEventListener("seeked", () => tick(true));
    audio.addEventListener("loadedmetadata", () => tick(true));
    window.addEventListener("resize", () => { if (S.D) { hatch = null; drawAll(); tick(true); } });
    window.addEventListener("hashchange", () => {
      const slug = decodeURIComponent(location.hash.slice(1));
      if (S.D && slug !== S.D.slug && S.sets.find((s) => s.slug === slug)) openSet(slug);
    });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(loop);
  }

  function onKey(e) {
    if (!S.D) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    // Space presses a focused button or link (keyboard convention); elsewhere it plays/pauses
    if (k === " " && (tag === "button" || tag === "a") && e.target.id !== "playBtn") return;
    if (k === " ") { e.preventDefault(); togglePlay(); }
    else if (k === "ArrowRight" || k === "ArrowLeft") {
      e.preventDefault();
      const d = (e.shiftKey ? 30 : 5) * (k === "ArrowRight" ? 1 : -1);
      seek(now() + d, false);
    } else if (k === "n" || k === "N") $("nextTrack").click();
    else if (k === "p" || k === "P") $("prevTrack").click();
    else if (k === "m" || k === "M") {
      const t = now();
      const j = mixes().findIndex((m) => m.mix_in > t);
      playMix(j >= 0 ? j : 0);
    } else if (k === "+" || k === "=") zoomAround(focusTime(), 0.5);
    else if (k === "-" || k === "_") zoomAround(focusTime(), 2);
    else if (k === "f" || k === "F") $("followBtn").click();
    else if (k === "?") $("helpBtn").click();
    else if (k === "c" || k === "C") copyPrompt();
    else if (k === "k" || k === "K") openCard();
  }

  /* ------------------------------------------------ highlights */
  function renderHighlights() {
    stopReel();
    const H = (S.hl = highlights(S.D, (n) => shortName(tracks()[n - 1])));
    $("hl").hidden = H.items.length < 2;
    if ($("hl").hidden) return;
    $("hlSub").textContent = `${H.items.length} moments from across the set · a ${fmt(H.reel)} reel`;
    const KIND = { chapter: "Chapter", drop: "Drop", peak: "Peak", mix: "Mix", mood: "Mood", track: "Track" };
    $("hlList").innerHTML = H.items.map((h, i) => `<li><button class="hl-card" data-i="${i}" data-kind="${h.kind}" data-end="${(h.t + h.dur).toFixed(2)}">
      <span class="hl-meta"><b>${fmt(h.t)}</b> ${KIND[h.kind]}</span><span class="hl-title">${esc(h.title)}</span><span class="hl-why">${esc(h.why)}</span>
      <span class="hl-bar" aria-hidden="true"><i></i></span></button></li>`).join("");
    $("hlList").querySelectorAll(".hl-card").forEach((b) => b.addEventListener("click", () => {
      const h = S.hl.items[+b.dataset.i];
      stopReel();
      if (h.mix != null) selectMix(h.mix, false);
      seek(h.t, true);
    }));
    $("hlPlay").onclick = () => (S.reel ? stopReel() : playHighlight(0, true));
  }
  function playHighlight(i, reel) {
    const h = S.hl.items[i];
    if (reel && !S.noAudio) S.reel = { i };          // without audio there's nothing to step through
    if (h.mix != null) selectMix(h.mix, false);
    seek(h.t, true);
    markReel();
  }
  function stopReel() {
    if (!S.reel) return;
    S.reel = null;
    markReel();
  }
  function markReel() {
    $("hlPlay").textContent = S.reel ? `Stop the reel (${S.reel.i + 1} of ${S.hl.items.length})` : "Play the highlights";
    $("hlPlay").setAttribute("aria-pressed", String(!!S.reel));
    document.querySelectorAll(".hl-card").forEach((c) => c.classList.toggle("on", !!S.reel && +c.dataset.i === S.reel.i));
    const on = document.querySelector(".hl-card.on");
    if (on) on.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  /* ------------------------------------------------ drop anatomy */
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

  function drawAll() {
    drawOverview();
    drawRibbon();
    drawScrub();
    drawEnergy();
    drawSparks();
    drawMix();
    drawRows(now());
    drawDrops();
  }

  boot();
})();
