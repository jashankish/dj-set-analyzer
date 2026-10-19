/* Landing page: drop zone, analysis queue, the visitor's library, demos and
   the live teaser. Analysis runs in this browser (engine/pipeline.js). */
import { drawRibbon, drawStrip, drawWheel } from "./mini.js";
import { listSets, deleteSet, saveSet } from "./store.js";

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
  demo = await (await fetch(`demo/${idx[0].slug}.json`)).json();
  startTeaser();
}

function drawCards(root) {
  root.querySelectorAll("canvas[data-segs]").forEach((c) => drawStrip(c, JSON.parse(c.dataset.segs), +c.dataset.end));
}

let sweep = 0, raf = 0;
function startTeaser() {
  drawWheel($("teaseWheel"), demo);
  const end = demo.summary.set_end || demo.duration;
  const frame = (ts) => {
    // one slow sweep across the set behind the drop zone; static when motion is reduced
    sweep = reduced ? end * 0.42 : ((ts / 1000) * 14) % end;
    drawRibbon($("dropRibbon"), demo, { playhead: reduced ? null : sweep });
    drawRibbon($("teaseRibbon"), demo, { playhead: sweep });
    if (!reduced) raf = requestAnimationFrame(frame);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
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
      <p>${s.tracks} tracks · ${mins(s.set_length || s.duration)}${s.bpm_avg ? ` · ${Math.round(s.bpm_avg)} BPM` : ""} · analysed ${new Date(s.created).toLocaleDateString([], { month: "short", day: "numeric" })}</p>
      <button class="del" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.title)}">Delete</button>
    </a></li>`).join("");
  drawCards($("libList"));
  $("libList").querySelectorAll(".del").forEach((b) => b.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    await deleteSet(b.dataset.id);
    toast("Set deleted from this browser");
    loadLibrary();
  }));
}

/* ------------------------------------------------ the queue */
const AUDIO_EXT = /\.(m4a|mp3|wav|flac|aac|ogg|oga|opus|aif|aiff|webm|mp4)$/i;
const queue = [];        // {file, state: "ready"|"running"|"done"|"error", f, stage, id, error, duration}
let running = false;

function addFiles(list) {
  let skipped = 0;
  for (const f of list) {
    if (!(f.type.startsWith("audio/") || AUDIO_EXT.test(f.name))) { skipped++; continue; }
    if (queue.some((q) => q.file.name === f.name && q.file.size === f.size)) continue;
    const item = { file: f, state: "ready", f: 0, stage: "" };
    queue.push(item);
    probeDuration(item);
  }
  if (skipped) toast(skipped === 1 ? "Skipped one file that isn't audio" : `Skipped ${skipped} files that aren't audio`);
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
    if (q.state === "ready") state = q.duration ? `${fmt(q.duration)} of audio` : "Ready";
    if (q.state === "running") state = `${q.stage} · ${Math.round(q.f * 100)}%`;
    if (q.state === "done") state = `<a class="ghost open" href="set.html?id=${encodeURIComponent(q.id)}">Open the set</a>`;
    if (q.state === "error") state = esc(q.error);
    return `<li class="q-item">
      <div class="q-name"><b>${esc(q.file.name)}</b><span>${mb(q.file.size)}</span></div>
      <div class="q-state${q.state === "error" ? " err" : ""}">${state}</div>
      ${q.state === "ready" && !running ? `<button class="q-x" data-i="${i}" aria-label="Remove ${esc(q.file.name)}">✕</button>` : "<span></span>"}
      <div class="q-bar" style="width:${q.state === "running" || q.state === "done" ? q.f * 100 : 0}%"></div>
    </li>`;
  }).join("");
  $("qList").querySelectorAll(".q-x").forEach((b) => b.addEventListener("click", () => { queue.splice(+b.dataset.i, 1); renderQueue(); }));
  const ready = queue.filter((q) => q.state === "ready").length;
  $("analyseBtn").disabled = running || !ready;
  $("analyseBtn").textContent = running ? "Analysing…" : ready > 1 ? `Analyse ${ready} sets` : "Analyse";
  $("clearBtn").hidden = running;
  const total = queue.filter((q) => q.state === "ready").reduce((s, q) => s + (q.duration || 0), 0);
  $("qNote").textContent = running
    ? "Keep this tab open while it works. Everything stays on this computer."
    : ready ? `Runs on this computer${total ? `, roughly ${Math.max(1, Math.round(total / 3600 * 1.2))} min of work` : ""}. Nothing is uploaded.` : "";
}

async function analyseAll() {
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
  for (const q of queue) {
    if (q.state !== "ready") continue;
    q.state = "running"; q.stage = "Starting"; q.f = 0; renderQueue();
    try {
      const payload = await engine.analyzeFile(q.file, {
        onProgress: ({ stage, f }) => { q.stage = stage; q.f = f; renderQueue(); },
      });
      q.id = await saveSet(payload, q.file);
      q.state = "done"; q.f = 1;
      finished.push(q);
    } catch (e) {
      q.state = "error";
      q.error = /quota|storage/i.test(String(e)) ? "Analysed, but this browser is out of storage space for it. Free some space and try again."
        : (e && e.message) || "Analysis failed";
      console.error(e);
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
  $("analyseBtn").addEventListener("click", analyseAll);
  $("clearBtn").addEventListener("click", () => { queue.splice(0, queue.length); renderQueue(); });
  window.addEventListener("beforeunload", (e) => { if (running) { e.preventDefault(); e.returnValue = ""; } });
  window.addEventListener("resize", () => {
    if (demo) { drawWheel($("teaseWheel"), demo); if (reduced) startTeaser(); }
    drawCards(document);
  });
}

bindDrop();
loadLibrary();
loadDemos();
