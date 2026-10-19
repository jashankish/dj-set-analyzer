/* In-browser analysis pipeline.

   analyzeFile(file, {onProgress}) →
     1. decode the file to mono 16 kHz with the browser's own decoder
     2. split the set into 2-minute ranges and hand them to a pool of Web
        Workers (Essentia.js + ONNX Runtime Web), one per spare CPU core
     3. stitch the ranges back together
     4. build the same JSON the Python pipeline writes (payload.js)

   Nothing leaves the visitor's machine. */
import { assets } from "./config.js";
import { buildPayload } from "./payload.js";
import { SR, FPS } from "./extract.js";

const RANGE = 120;          // seconds per job (a multiple of 10)
const LOOKAHEAD = 72;       // longest window any feature reads past its start (beats: 60 s)

let classesP = null;
function styleClasses() {
  classesP = classesP || fetch(assets().models + "discogs-effnet-bsdynamic-1.json").then((r) => r.json()).then((j) => j.classes);
  return classesP;
}

export const slugify = (name) =>
  name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "set";

/* ------------------------------------------------ decoding */
export async function decode(file) {
  const buf = await file.arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, SR);
  let audio;
  try {
    audio = await ctx.decodeAudioData(buf);
  } catch (e) {
    throw new Error(`This browser can't decode “${file.name}”. Try an MP3, M4A/AAC, WAV or FLAC file.`);
  }
  const n = audio.length, ch = audio.numberOfChannels, mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
  }
  return mono;
}

/* ------------------------------------------------ worker pool */
class Pool {
  constructor(size) {
    this.size = size;
    this.workers = [];
  }
  async start() {
    const a = assets();
    const url = new URL("./worker.js", import.meta.url);
    this.workers = await Promise.all(Array.from({ length: this.size }, () => new Promise((res, rej) => {
      const w = new Worker(url, { type: "module" });
      w.onmessage = (e) => {
        if (e.data.type === "ready") res(w);
        else if (e.data.type === "error") rej(new Error(e.data.message));
      };
      w.onerror = (e) => rej(new Error(e.message || "The analysis worker failed to start"));
      w.postMessage({ type: "init", assets: a });
    })));
  }
  run(jobs, onJobProgress) {
    const results = new Array(jobs.length);
    let next = 0;
    return new Promise((resolve, reject) => {
      let active = 0, failed = false;
      this.abort = () => { failed = true; reject(Object.assign(new Error("Analysis stopped"), { name: "AbortError" })); };
      const feed = (w) => {
        if (failed) return;
        if (next >= jobs.length) { if (active === 0) resolve(results); return; }
        const id = next++, job = jobs[id];
        active++;
        w.onmessage = (e) => {
          const m = e.data;
          if (m.id !== id) return;
          if (m.type === "progress") onJobProgress(id, m.f);
          else if (m.type === "done") { results[id] = m.res; active--; onJobProgress(id, 1); feed(w); }
          else if (m.type === "error") { failed = true; reject(new Error(m.message)); }
        };
        w.postMessage({ type: "run", id, ...job }, [job.audio.buffer]);
      };
      this.workers.forEach(feed);
    });
  }
  stop() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    if (this.abort) this.abort();
  }
}

export function poolSize() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;                // GB, Chrome only
  return Math.max(1, Math.min(cores - 1, mem >= 8 ? 6 : 3));
}

/* ------------------------------------------------ jobs + merge */
export function planJobs(y) {
  const total = y.length, duration = total / SR, jobs = [];
  for (let a = 0; a < duration; a += RANGE) {
    const b = Math.min(duration, a + RANGE);
    const s = Math.round(a * SR), e = Math.min(total, Math.round((b + LOOKAHEAD) * SR));
    jobs.push({ audio: y.slice(s, e), offset: a, range: [a, b], total });
  }
  return jobs;
}

function concat(parts, key, Type = Float32Array) {
  const n = parts.reduce((s, p) => s + p[key].length, 0), out = new Type(n);
  let o = 0;
  for (const p of parts) { out.set(p[key], o); o += p[key].length; }
  return out;
}
export function merge(parts, duration) {
  const bands = {};
  for (const k of ["low", "mid", "high", "rms"]) bands[k] = concat(parts.map((p) => p.bands), k);
  const heads = {};
  for (const k of Object.keys(parts.find((p) => p.embT.length)?.heads || {})) heads[k] = concat(parts.map((p) => p.heads), k);
  return {
    duration, bands, heads,
    beats: parts.flatMap((p) => p.beats).sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.15),
    bpmT: parts.flatMap((p) => p.bpmT), bpmRaw: parts.flatMap((p) => p.bpmRaw),
    keys: parts.flatMap((p) => p.keys),
    embT: concat(parts, "embT"), acts: concat(parts, "acts"), emb: concat(parts, "embs"),
  };
}

/* ------------------------------------------------ the whole thing */
let pool = null;
export async function analyzeFile(file, { onProgress = () => {}, title, bpmRange, signal } = {}) {
  const say = (stage, f) => onProgress({ stage, f });
  const check = () => { if (signal && signal.aborted) throw Object.assign(new Error("Analysis stopped"), { name: "AbortError" }); };
  say("Decoding audio", 0);
  let y;
  try {
    y = await decode(file);
  } catch (e) {
    if (e instanceof RangeError || /memory|allocation/i.test(String(e))) {
      throw new Error(`“${file.name}” is too long for this browser's memory. Try a shorter recording or a desktop browser.`);
    }
    throw e;
  }
  check();
  const total = y.length, duration = total / SR;
  if (duration < 60) throw new Error(`“${file.name}” is under a minute long — drop in a full set.`);
  say("Loading the analysis engine", 0.04);
  if (!pool) { pool = new Pool(poolSize()); await pool.start(); }
  const classes = await styleClasses();
  check();
  const onAbort = () => releaseEngine();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  const jobs = planJobs(y);
  const prog = new Array(jobs.length).fill(0);
  const parts = await pool.run(jobs, (id, f) => {
    prog[id] = f;
    say("Listening to the set", 0.06 + 0.88 * (prog.reduce((s, x) => s + x, 0) / jobs.length));
  });
  if (signal) signal.removeEventListener("abort", onAbort);
  say("Building the setlist", 0.95);
  const F = merge(parts, duration);
  await new Promise((r) => setTimeout(r, 0));
  const payload = buildPayload(F, classes, {
    slug: slugify(file.name), title: title || file.name.replace(/\.[^.]+$/, ""), file: file.name,
    bpmRange, source: "browser",
  });
  say("Done", 1);
  return payload;
}

export function releaseEngine() {
  if (pool) { pool.stop(); pool = null; }
}

export { FPS };
