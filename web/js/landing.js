/* Landing page: drop zone, analysis queue, the visitor's library, demos and
   the live teaser. Analysis runs in this browser (engine/pipeline.js). */
import { drawRibbonFast, drawStrip, drawWheel } from "./mini.js";
import { listSets, listPayloads, deleteSet, saveSet, importSet, storageEstimate } from "./store.js";
import { taste } from "./taste.js";
import { helperStatus, helperWanted } from "./engine/naming.js";
import { openNamingDialog } from "./naming-ui.js";
import { parseLink, fetchLink, canFetch } from "./engine/fetchlink.js";
import { markHelperWanted } from "./engine/naming.js";
import { progressHTML, eta } from "./progress.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (t) => {
  t = Math.max(0, Math.round(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const mins = (t) => `${Math.round((t || 0) / 60)} min`;
const mb = (n) => `${(n / 1048576).toFixed(n > 1e8 ? 0 : 1)} MB`;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
/* key moments for screen readers (not every percentage tick) */
function announce(msg) {
  const el = $("announce");
  el.textContent = "";
  setTimeout(() => (el.textContent = msg), 50);
}
function toast(msg) {
  const el = $("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2600);
}

/* ------------------------------------------------ demos + teaser */
let demo = null;
async function loadDemos() {
  let idx = [];
  try { idx = await (await fetch("demo/index.json")).json(); } catch (e) { /* no demos bundled */ }
  $("demoList").innerHTML = idx.map((d) => `
    <li><a class="card" href="set.html?demo=${encodeURIComponent(d.slug)}">
      <canvas data-segs='${JSON.stringify(d.segs)}' data-end="${d.set_length || d.duration}"></canvas>
      <h3>${esc(d.title)}</h3>
      <p>${d.tracks} tracks · ${mins(d.set_length || d.duration)} · ${d.bpm_avg ? Math.round(d.bpm_avg) + " BPM" : ""}${d.harmonic_pct != null ? ` · ${d.harmonic_pct}% harmonic` : ""}</p>
    </a></li>`).join("");
  drawCards($("demoList"));
  if (!idx.length) { document.querySelector(".tease").hidden = true; $("demos").hidden = true; return; }
  try {
    demo = await (await fetch(`demo/${idx[0].slug}.json`)).json();
  } catch (e) {
    document.querySelector(".tease").hidden = true;   // no teaser rather than a broken one
    return;
  }
  startTeaser();
}

function drawCards(root) {
  root.querySelectorAll("canvas[data-segs]").forEach((c) => drawStrip(c, JSON.parse(c.dataset.segs), +c.dataset.end));
}

let sweep = 0, raf = 0;
const onScreen = new Set();
const watch = "IntersectionObserver" in window
  ? new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target))))
  : null;
function startTeaser() {
  drawWheel($("teaseWheel"), demo);
  const end = demo.summary.set_end || demo.duration;
  const canvases = [$("dropRibbon"), $("teaseRibbon")];
  if (watch) canvases.forEach((c) => watch.observe(c)); else canvases.forEach((c) => onScreen.add(c));
  const draw = (c, ph) => drawRibbonFast(c, demo, { playhead: ph });
  const frame = (ts) => {
    // one slow sweep across the set; only on-screen canvases are redrawn, and
    // the animation rests while an analysis runs so it never competes with it
    if (!running) {
      sweep = ((ts / 1000) * 14) % end;
      if (onScreen.has(canvases[0])) draw(canvases[0], sweep);
      if (onScreen.has(canvases[1])) draw(canvases[1], sweep);
    }
    raf = requestAnimationFrame(frame);
  };
  cancelAnimationFrame(raf);
  if (reduced) { draw(canvases[0], null); draw(canvases[1], end * 0.42); }
  else raf = requestAnimationFrame(frame);
  showMixCard(0);
}

/* cycle through a few real transitions from the demo */
let mixTimer = 0;
function showMixCard(i) {
  const M = demo.transitions.filter((m) => m.bars && m.type !== "Cut");
  if (!M.length) return;
  const m = M[i % M.length], A = demo.tracks[m.from - 1], B = demo.tracks[m.to - 1];
  const name = (t) => (t.identified ? t.title.replace(/\s*\((feat|ft)\.?[^)]*\)/i, "") : `ID ${t.n}`);
  const chip = (k) => `<span class="key-chip" style="background:${window.KeyColor.keyColor(k, "base")}">${k || "?"}</span>`;
  $("teaseMix").innerHTML = `<div class="mc-fade">
      <div class="mc-pair">
        <div class="mc-side"><b>${esc(name(A))}</b>${chip(m.key_from)}</div>
        <span class="mc-arrow">→</span>
        <div class="mc-side b"><b>${esc(name(B))}</b>${chip(m.key_to)}</div>
      </div>
    </div>
    <div class="mc-fade"><div class="mc-type">${esc(m.type)}</div>
      <div class="mc-meta"><span>${m.bars} bars</span><span>${esc(m.harmonic.label)}</span><span>${m.bpm_from ? Math.round(m.bpm_from) + " BPM" : ""}</span><span>at ${fmt(m.swap)}</span></div>
    </div>`;
  clearTimeout(mixTimer);
  if (!reduced) mixTimer = setTimeout(() => showMixCard(i + 1), 4200);
}

/* ------------------------------------------------ library */
async function loadLibrary() {
  let sets = [];
  try { sets = await listSets(); } catch (e) { /* IndexedDB unavailable (private mode) */ }
  $("library").hidden = !sets.length;
  $("navLibrary").hidden = !sets.length;
  $("libList").innerHTML = sets.map((s) => `
    <li><a class="card" href="set.html?id=${encodeURIComponent(s.id)}">
      <canvas data-segs='${JSON.stringify(s.segs)}' data-end="${s.set_length || s.duration}"></canvas>
      <h3>${esc(s.title)}</h3>
      <p>${s.tracks} tracks · ${mins(s.set_length || s.duration)}${s.bpm_avg ? ` · ${Math.round(s.bpm_avg)} BPM` : ""} · analyzed ${new Date(s.created).toLocaleDateString([], { month: "short", day: "numeric" })}</p>
      <button class="del" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.title)}">Delete</button>
    </a></li>`).join("");
  drawCards($("libList"));
  showStorage(sets.length);
  showTaste(sets.length);
  $("libList").querySelectorAll(".del").forEach((b) => b.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    // deleting also removes the saved recording, so it takes a second click
    if (b.dataset.armed !== "1") {
      b.dataset.armed = "1";
      b.textContent = "Click again to delete";
      b.classList.add("armed");
      clearTimeout(b._t);
      b._t = setTimeout(() => { b.dataset.armed = ""; b.textContent = "Delete"; b.classList.remove("armed"); }, 4000);
      return;
    }
    await deleteSet(b.dataset.id);
    try { localStorage.removeItem(`set-replay:${b.dataset.id}`); } catch (err) { /* private mode */ }
    toast("Set deleted from this browser");
    announce("Set deleted.");
    loadLibrary();
  }));
}

/* ------------------------------------------------ your taste, across your sets */
/* Two or more saved sets: one prompt for the sound they share. Fewer: the same
   across the two demo sets, fetched only when the section comes near the screen. */
let tasteWatch = null;
async function showTaste(count) {
  if (tasteWatch) { tasteWatch.disconnect(); tasteWatch = null; }
  if (count >= 2) {
    let entries = [];
    try { entries = await listPayloads(); } catch (e) { /* storage unavailable */ }
    entries = entries.map((e) => ({ ...e, title: titleOf(e.id, e.title) }));
    renderTaste(taste(entries), `From the ${entries.length} sets saved in this browser: the sound they share, as one playlist prompt.`, "Your taste, across your sets");
    return;
  }
  const load = async () => {
    try {
      const idx = await (await fetch("demo/index.json")).json();
      const entries = await Promise.all(idx.slice(0, 4).map(async (d) => ({ title: d.title, payload: await (await fetch(`demo/${encodeURIComponent(d.slug)}.json`)).json() })));
      renderTaste(taste(entries), `Here, across the ${entries.length} demo sets. Analyze two or more of your own and this becomes yours.`, "One playlist from several sets");
    } catch (e) { /* no demos bundled */ }
  };
  if (!("IntersectionObserver" in window)) { load(); return; }
  $("taste").hidden = false;                       // so it can be watched; empty until loaded
  tasteWatch = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { tasteWatch.disconnect(); tasteWatch = null; load(); } }, { rootMargin: "400px 0px" });
  tasteWatch.observe($("taste"));
}
function titleOf(id, fallback) {
  try { return (JSON.parse(localStorage.getItem(`set-replay:${id}`) || "null") || {}).title || fallback; } catch (e) { return fallback; }
}
function renderTaste(T, sub, title) {
  $("taste").hidden = !T;
  if (!T) return;
  $("tasteTitle").textContent = title;
  $("tasteSub").textContent = sub;
  const facts = [
    ["Sets", `${T.sets}`, `${T.hours >= 1 ? `${T.hours.toFixed(1)} hours` : `${Math.round(T.hours * 60)} min`}, ${T.tracks} tracks`],
    ["Tempo", T.bpm ? (T.bpm[0] === T.bpm[1] ? `${T.bpm[0]} BPM` : `${T.bpm[0]}–${T.bpm[1]} BPM`) : "—", "average per set"],
    ["Home keys", T.keys.join(" · ") || "—", "most time spent in"],
    ["Genres", T.genres.join(", ") || "—", "trusted across the sets"],
    ["Artists", T.artists.slice(0, 4).join(", ") || "—", "who keep coming back"],
  ];
  $("tasteFacts").innerHTML = facts.map(([k, v, s]) => `<div><dt>${k}</dt><dd>${esc(v)}<small>${esc(s)}</small></dd></div>`).join("");
  $("tasteText").textContent = T.prompt.full;
  $("tasteCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(T.prompt.full); toast("Prompt copied. Paste it into Prompted Playlist in Spotify"); } catch (e) { toast("Select the prompt and copy it"); }
  };
}

/* ------------------------------------------------ naming helper (optional) */
let helperOn = false, nameTracks = true;
function renderNaming() {
  const el = $("naming");
  el.classList.toggle("on", helperOn);
  el.innerHTML = helperOn
    ? `<span class="dot"></span><label><input type="checkbox" id="nameTracks" ${nameTracks ? "checked" : ""}> Name tracks with Shazam</label><span>Naming helper connected</span>`
    : `<span class="dot"></span><span>Tracks will show as IDs.</span><button class="linkish" id="wantNames" type="button">Want them named?</button>`;
  $("nameTracks")?.addEventListener("change", (e) => { nameTracks = e.target.checked; renderQueue(); });
  $("wantNames")?.addEventListener("click", showNaming);
}
function showNaming() {
  const d = openNamingDialog({ mode: "landing" });
  d.addEventListener("helper", (e) => { helperOn = e.detail; renderNaming(); renderQueue(); });
}
async function checkHelper() {
  if (!helperWanted()) return;         // never probe a visitor's computer uninvited
  const on = !!(await helperStatus());
  if (on !== helperOn) { helperOn = on; renderNaming(); renderQueue(); }
}

/* how much room the saved sets (and their recordings) take in this browser */
async function showStorage(count) {
  const sub = $("libSub");
  if (!count) return;
  const est = await storageEstimate();
  if (!est || !est.usage) { sub.textContent = "Saved in this browser only."; return; }
  const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
  let text = `Saved in this browser only, using ${size(est.usage)}`;
  if (est.quota && est.usage / est.quota > 0.8) text += ` of the ${size(est.quota)} it allows. Delete sets you no longer need to make room`;
  sub.textContent = `${text}.`;
}

/* ------------------------------------------------ the queue */
/* phones and low-memory devices: long sets may not fit while decoding */
const LOW_MEMORY = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const AUDIO_EXT = /\.(m4a|mp3|wav|flac|aac|ogg|oga|opus|aif|aiff|webm|mp4|m4v|mov|qt|mkv)$/i;
const queue = [];
let controller = null;        // {file, state: "ready"|"running"|"done"|"error", f, stage, id, error, duration}
let running = false;

async function importJson(f) {
  try {
    const id = await importSet(await f.text());
    toast(`Imported “${f.name.replace(/\.setreplay\.json$|\.json$/i, "")}”`);
    await loadLibrary();
    return id;
  } catch (e) {
    toast(e.message || "That file couldn't be imported");
  }
}

function addFiles(list) {
  let skipped = 0;
  for (const f of list) {
    if (/\.json$/i.test(f.name) || f.type === "application/json") { importJson(f); continue; }
    if (!(f.type.startsWith("audio/") || f.type.startsWith("video/") || AUDIO_EXT.test(f.name))) { skipped++; continue; }
    if (queue.some((q) => q.file && q.file.name === f.name && q.file.size === f.size)) continue;
    const item = { file: f, state: "ready", f: 0, stage: "" };
    queue.push(item);
    probeDuration(item);
  }
  if (skipped) toast(skipped === 1 ? "Skipped one file that isn't audio" : `Skipped ${skipped} files that aren't audio`);
  renderQueue();
  // start downloading the analysis models while the visitor is still choosing
  if (queue.some((q) => q.state === "ready")) import("./engine/pipeline.js").then((m) => m.loadModels()).catch(() => {});
}

/* ------------------------------------------------ a YouTube or SoundCloud link (through the helper) */
async function addLink(text) {
  const L = parseLink(text);
  if (!L) { toast("Paste the link of a single YouTube video or SoundCloud track"); return false; }
  if (queue.some((q) => q.link && q.link.url === L.url)) { toast("That link is already in the list"); return false; }
  const item = { link: L, label: L.url, state: "waiting", f: 0, stage: "" };
  queue.push(item);
  renderQueue();
  markHelperWanted();
  if (canFetch(await helperStatus())) startFetch(item);
  else { item.state = "needs-helper"; renderQueue(); linkHelp(item); }
  return true;
}
function linkHelp(item) {
  openNamingDialog({ mode: "link", onReady: () => startFetch(item) }).addEventListener("helper", (e) => { helperOn = e.detail; renderNaming(); });
}
async function startFetch(item) {
  if (!queue.includes(item) || item.state === "fetching") return;
  item.state = "fetching"; item.f = 0; item.stage = "Looking up the link"; item.t0 = Date.now(); item.f0 = 0;
  item.ctl = new AbortController();
  renderQueue();
  import("./engine/pipeline.js").then((m) => m.loadModels()).catch(() => {});   // the models download meanwhile
  try {
    const r = await fetchLink(item.link.url, {
      signal: item.ctl.signal,
      onProgress: (stage, f, job) => { item.stage = stage; item.f = f; if (job && job.title) item.label = job.title; renderQueue(); },
    });
    item.file = r.file; item.meta = r; item.label = r.title || item.label;
    item.state = "ready"; item.f = 0; item.duration = r.duration || undefined;
    if (!item.duration) probeDuration(item);
    announce(`${item.label} fetched from ${item.link.label}. Press Analyze.`);
  } catch (e) {
    if (e && e.name === "AbortError") return;           // removed or cleared: the item is already gone
    item.state = "error";
    item.error = /Failed to fetch|NetworkError|Load failed/i.test(String(e && e.message)) ? "The helper stopped answering. Is it still running?" : (e && e.message) || "Couldn't fetch it";
  }
  renderQueue();
}

function probeDuration(item) {
  const a = new Audio(), url = URL.createObjectURL(item.file);
  a.preload = "metadata";
  a.onloadedmetadata = () => { item.duration = a.duration; URL.revokeObjectURL(url); renderQueue(); };
  a.onerror = () => URL.revokeObjectURL(url);
  a.src = url;
}

function renderQueue() {
  $("queue").hidden = !queue.length;
  $("qList").innerHTML = queue.map((q, i) => {
    let state = "";
    if (q.state === "ready") {
      state = q.duration ? `${fmt(q.duration)} of audio` : "Ready";
      if (q.duration > 3 * 3600) state += ` · long set, needs about ${Math.ceil((q.duration * 16000 * 4 * 3) / 1e9)} GB of free memory`;
      else if (LOW_MEMORY && q.duration > 3600) state += " · may run out of memory on this device; a laptop works best";
    }
    if (q.state === "running" || q.state === "fetching") state = "";
    if (q.state === "waiting") state = "Looking for the helper…";
    if (q.state === "needs-helper") state = `Needs the Set Replay helper on this computer. <button class="ghost hl-setup" data-i="${i}">Set it up</button>`;
    if (q.state === "done") state = `<a class="ghost open" href="set.html?id=${encodeURIComponent(q.id)}">Open the set</a>`;
    if (q.state === "error") state = esc(q.error) + (q.link && !q.file ? ` <button class="ghost hl-retry" data-i="${i}">Try again</button>` : "");
    if (q.state === "unsaved") state = `Analyzed, but ${esc(q.error)}. <button class="ghost dl" data-i="${i}">Download the analysis</button>`;
    return `<li class="q-item">
      <div class="q-name"><b>${esc(q.link ? q.label : q.file.name)}</b><span>${q.link ? `${esc(q.link.label)}${q.file ? ` · ${mb(q.file.size)}` : ""}` : mb(q.file.size)}</span></div>
      <div class="q-state${q.state === "error" || q.state === "unsaved" ? " err" : ""}">${state}</div>
      ${["ready", "fetching", "waiting", "needs-helper", "error"].includes(q.state) && !running ? `<button class="q-x" data-i="${i}" aria-label="Remove ${esc(q.link ? q.label : q.file.name)}">✕</button>` : "<span></span>"}
      ${q.state === "running" || q.state === "fetching" ? `<div class="q-prog">${progressHTML(q.stage, q.f, eta(q.t0, q.f0, q.f))}</div>` : ""}
      <div class="q-bar" style="width:${["done", "unsaved"].includes(q.state) ? 100 : 0}%"></div>
    </li>`;
  }).join("");
  $("qList").querySelectorAll(".q-x").forEach((b) => b.addEventListener("click", () => { const [q] = queue.splice(+b.dataset.i, 1); if (q && q.ctl) q.ctl.abort(); renderQueue(); }));
  $("qList").querySelectorAll(".hl-setup").forEach((b) => b.addEventListener("click", () => linkHelp(queue[+b.dataset.i])));
  $("qList").querySelectorAll(".hl-retry").forEach((b) => b.addEventListener("click", async () => { const q = queue[+b.dataset.i]; if (canFetch(await helperStatus())) startFetch(q); else { q.state = "needs-helper"; renderQueue(); linkHelp(q); } }));
  $("qList").querySelectorAll(".dl").forEach((b) => b.addEventListener("click", () => downloadPayload(queue[+b.dataset.i].payload)));
  const ready = queue.filter((q) => q.state === "ready").length;
  $("analyzeBtn").disabled = running || !ready;
  $("analyzeBtn").textContent = running ? "Analyzing…" : ready > 1 ? `Analyze ${ready} sets` : "Analyze";
  $("clearBtn").textContent = running ? "Stop" : "Clear";
  const total = queue.filter((q) => q.state === "ready").reduce((s, q) => s + (q.duration || 0), 0);
  $("qNote").textContent = running
    ? "Keep this tab open while it works. Everything stays on this computer."
    : ready ? `Runs on this computer${total ? `, roughly ${Math.max(1, Math.round(total / 3600 * (helperOn && nameTracks ? 10 : 2)))} min of work` : ""}. Nothing is uploaded${helperOn && nameTracks ? "; short clips go to your naming helper" : ""}.` : "";
}

async function analyzeAll() {
  if (running) return;
  running = true;
  renderQueue();
  let engine;
  try {
    engine = await import("./engine/pipeline.js");
  } catch (e) {
    queue.filter((q) => q.state === "ready").forEach((q) => { q.state = "error"; q.error = "The analysis engine couldn't load. Check your connection and reload."; });
    running = false; renderQueue(); return;
  }
  const finished = [];
  controller = new AbortController();
  for (const q of queue) {
    if (q.state !== "ready") continue;
    if (controller.signal.aborted) break;
    q.state = "running"; q.stage = "Starting"; q.f = 0; q.t0 = Date.now(); q.f0 = 0; renderQueue();
    announce(`Analyzing ${q.link ? q.label : q.file.name}. This takes a minute or two.`);
    try {
      const payload = await engine.analyzeFile(q.file, {
        signal: controller.signal,
        identify: helperOn && nameTracks && helperWanted() && !!(await helperStatus()),
        onProgress: ({ stage, f }) => { q.stage = stage; q.f = f; renderQueue(); },
        onAudio: (a) => { q.audio = a; },              // a video: keep its soundtrack, not the video
      });
      if (q.meta) {
        // from a link: its own title, and where it came from (the set page links back)
        if (q.meta.title) payload.title = q.meta.title;
        payload.link = { url: q.meta.url, service: q.meta.service, title: q.meta.title || null, uploader: q.meta.uploader || null };
      }
      try {
        q.id = await saveSet(payload, q.audio || q.file);
      } catch (e) {
        // the analysis worked; don't throw it away because the browser won't store it
        q.state = "unsaved"; q.payload = payload; q.f = 1;
        q.error = /quota/i.test(String(e)) ? "this browser is out of storage space"
          : "this browser won't store it (private browsing, or storage is blocked)";
        console.error(e);
        announce(`${q.file.name} was analyzed but couldn't be saved. Download the analysis to keep it.`);
        renderQueue();
        continue;
      }
      q.state = "done"; q.f = 1;
      finished.push(q);
      announce(`${q.file.name} is ready: ${payload.summary.tracks} tracks.`);
    } catch (e) {
      if (e && e.name === "AbortError") { q.state = "ready"; q.f = 0; renderQueue(); announce("Analysis stopped."); break; }
      q.state = "error";
      q.error = (e && e.message) || "Analysis failed";
      console.error(e);
      announce(`${q.file.name} couldn't be analyzed. ${q.error}`);
    }
    renderQueue();
  }
  engine.releaseEngine();
  running = false;
  renderQueue();
  loadLibrary();
  if (finished.length === 1 && queue.length === 1) location.href = `set.html?id=${encodeURIComponent(finished[0].id)}`;
  else if (finished.length) toast(`${finished.length} set${finished.length > 1 ? "s" : ""} ready`);
}

/* same format as the viewer's "Download the analysis"; drop it back in to import */
function downloadPayload(payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...payload, user_names: {} })], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${(payload.title || "set").replace(/[^\w\- ]+/g, "")}.setreplay.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------ drag and drop */
function bindDrop() {
  const drop = $("drop"), input = $("fileInput");
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; depth++; drop.classList.add("over"); });
  window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove("over"); });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; drop.classList.remove("over");
    addFiles(e.dataTransfer.files);
    $("queue").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  });
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
  $("analyzeBtn").addEventListener("click", analyzeAll);
  $("clearBtn").addEventListener("click", () => {
    if (running) { controller && controller.abort(); toast("Stopping…"); return; }
    queue.forEach((q) => q.ctl && q.ctl.abort());
    queue.splice(0, queue.length); renderQueue();
  });
  $("linkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await addLink($("linkInput").value)) $("linkInput").value = "";
  });
  // a link dropped or pasted onto the drop zone works too
  $("drop").addEventListener("paste", (e) => { const t = e.clipboardData && e.clipboardData.getData("text"); if (t && parseLink(t)) { e.preventDefault(); addLink(t); } });
  window.addEventListener("beforeunload", (e) => {
    if (running || queue.some((q) => q.state === "unsaved")) { e.preventDefault(); e.returnValue = ""; }
  });
  window.addEventListener("resize", () => {
    if (demo) { drawWheel($("teaseWheel"), demo); if (reduced) startTeaser(); }
    drawCards(document);
  });
}

bindDrop();
loadLibrary();
loadDemos();
renderNaming();
checkHelper();
window.addEventListener("focus", checkHelper);
$("faqNaming")?.addEventListener("click", showNaming);
$("faqLink")?.addEventListener("click", () => openNamingDialog({ mode: "link", onReady: () => $("linkInput").focus() }));
