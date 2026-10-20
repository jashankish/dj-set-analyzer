/* In-browser analysis pipeline.

   analyzeFile(file, {onProgress}) →
     1. decode the file to mono 16 kHz with the browser's own decoder
     2. split the set into 2-minute ranges and hand them to a pool of Web
        Workers (Essentia.js + ONNX Runtime Web), one per spare CPU core
     3. stitch the ranges back together
     4. build the same JSON the Python pipeline writes (payload.js)

   Nothing leaves the visitor's machine. */
import { assets, HEADS } from "./config.js";
import { buildPayload } from "./payload.js";
import { SR, FPS } from "./extract.js";
import { musicSpan } from "./setlist.js";
import { identifyClips } from "./naming.js";
import { isVideo, extractAudio } from "./demux.js";

const RANGE = 120;          // seconds per job (a multiple of 10)
const LOOKAHEAD = 72;       // longest window any feature reads past its start (beats: 60 s)

const styleClasses = (models) => JSON.parse(new TextDecoder().decode(models["discogs-effnet-bsdynamic-1.json"])).classes;

export const slugify = (name) =>
  name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "set";

/* ------------------------------------------------ models: downloaded once, shared by every worker */
const MODEL_FILES = ["discogs-effnet-bsdynamic-1.onnx", "discogs-effnet-bsdynamic-1.json",
  ...Object.keys(HEADS).flatMap((h) => [`${h}-discogs-effnet-1.onnx`, `${h}-discogs-effnet-1.json`])];
let modelsP = null, lastProgress = null;
const modelListeners = new Set();

/** Fetch every model file once (with byte progress); later calls reuse the same
    download and still get progress, so the page can start it early (prefetch). */
export function loadModels(onProgress = () => {}) {
  modelListeners.add(onProgress);
  if (lastProgress) onProgress(...lastProgress);
  if (modelsP) return modelsP;
  modelsP = (async () => {
    const base = assets().models, got = new Map(), sizes = new Map();
    const report = () => {
      const done = [...got.values()].reduce((a, b) => a + b, 0), total = [...sizes.values()].reduce((a, b) => a + b, 0);
      if (!total) return;
      lastProgress = [done, total];
      modelListeners.forEach((fn) => fn(done, total));
    };
    const files = await Promise.all(MODEL_FILES.map(async (name) => {
      const r = await fetch(base + name);
      if (!r.ok) throw new Error(`Couldn't download the analysis model ${name} (HTTP ${r.status}).`);
      // some hosts (single-page-app fallbacks) answer a missing file with their homepage and HTTP 200
      if (/text\/html/i.test(r.headers.get("content-type") || "")) {
        throw new Error(`The analysis model ${name} is missing from this deployment (the server returned a web page instead).`);
      }
      sizes.set(name, +r.headers.get("content-length") || 0);
      if (!r.body || !sizes.get(name)) return [name, new Uint8Array(await r.arrayBuffer())];
      const reader = r.body.getReader(), chunks = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); n += value.length; got.set(name, n); report();
      }
      const out = new Uint8Array(n);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      return [name, out];
    }));
    return Object.fromEntries(files);
  })();
  modelsP.catch(() => { modelsP = null; });   // let a later attempt retry
  return modelsP;
}

/* ------------------------------------------------ decoding */
/* Band-limited resampling for browsers that won't decode straight to 16 kHz:
   16-tap windowed-sinc with a 512-phase lookup table, cutoff just under the
   new Nyquist (anti-aliasing). Fast enough for long sets on the main thread. */
export function resample(x, from, to) {
  if (from === to) return x;
  const TAPS = 16, PHASES = 512, ratio = from / to;
  const fc = Math.min(1, to / from) * 0.92;                 // cutoff relative to the input rate
  const table = new Float32Array(PHASES * TAPS);
  for (let p = 0; p < PHASES; p++) {
    let sum = 0;
    for (let k = 0; k < TAPS; k++) {
      const d = k - TAPS / 2 + 1 - p / PHASES;               // distance from the output point
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * fc * d) / (Math.PI * fc * d);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / (TAPS / 2));   // Hann over the kernel width
      table[p * TAPS + k] = sinc * w;
      sum += sinc * w;
    }
    for (let k = 0; k < TAPS; k++) table[p * TAPS + k] /= sum;    // unity gain
  }
  const n = Math.floor(x.length / ratio), out = new Float32Array(n), last = x.length - 1;
  for (let i = 0; i < n; i++) {
    const t = i * ratio, j = Math.floor(t), row = Math.floor((t - j) * PHASES) * TAPS;
    let acc = 0;
    for (let k = 0; k < TAPS; k++) {
      const idx = j + k - TAPS / 2 + 1;
      acc += table[row + k] * x[idx < 0 ? 0 : idx > last ? last : idx];
    }
    out[i] = acc;
  }
  return out;
}

function toMono(audio) {
  const n = audio.length, ch = audio.numberOfChannels, mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
  }
  return mono;
}

export async function decode(file) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  // Most browsers decode straight to the engine's 16 kHz. Some (older Safari)
  // only allow 22.05 kHz and up; then decode at 44.1 kHz and resample here.
  let direct = null;
  if (!window.SET_REPLAY_FORCE_RESAMPLE) { try { direct = new Ctx(1, 1, SR); } catch (e) { direct = null; } }
  try {
    if (direct) {
      try { return toMono(await direct.decodeAudioData(await file.arrayBuffer())); } catch (e) { if (e instanceof RangeError) throw e; }
    }
    const ctx = new Ctx(1, 1, 44100);
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());   // a fresh buffer: decoding detaches it
    return resample(toMono(audio), audio.sampleRate, SR);
  } catch (e) {
    if (e instanceof RangeError || /memory|allocation/i.test(String(e))) throw e;
    throw new Error(`This browser can't decode “${file.name}”. Try an MP3, M4A/AAC, WAV or FLAC file.`);
  }
}

/* ------------------------------------------------ worker pool */
export class Pool {
  constructor(size, { stallMs = 180000 } = {}) {
    this.size = size;
    this.workers = [];
    this.stallMs = stallMs;            // fail if a busy worker is silent this long
  }
  async start(models) {
    const a = assets();
    const url = new URL("./worker.js", import.meta.url);
    const spawn = () => new Promise((res, rej) => {
      const w = new Worker(url, { type: "module" });
      w.onmessage = (e) => {
        if (e.data.type === "ready") res(w);
        else if (e.data.type === "error") rej(new Error(e.data.message));
      };
      w.onerror = (e) => rej(new Error(e.message || "The analysis worker failed to start"));
      w.postMessage({ type: "init", assets: a, models });
    });
    // the first worker fills the browser cache with the WASM libraries, so the
    // others don't all download them at once on a first visit
    const first = await spawn();
    this.workers = [first, ...(await Promise.all(Array.from({ length: this.size - 1 }, spawn)))];
    this.spawn = spawn;                 // to replace a worker that crashed
  }
  run(jobs, onJobProgress) {
    const results = new Array(jobs.length);
    let next = 0;
    return new Promise((resolve, reject) => {
      let active = 0, failed = false;
      const busy = new Map();           // worker → { t: last time it was heard from, id: its range }
      const fail = (err) => {
        if (failed) return;
        failed = true;
        clearInterval(watch);
        reject(err);
      };
      // a worker that dies without saying so (crash, killed for memory; WebKit can do this
      // silently) would otherwise hang the run: treat it like a crash, i.e. retry once
      const watch = setInterval(() => {
        for (const [w, b] of [...busy.entries()]) {
          if (Date.now() - b.t > this.stallMs) {
            retry(w, b.id, new Error("The analysis stopped responding (the browser may have run out of memory). Close other tabs and try again, or try a shorter recording."));
            if (failed) return;
          }
        }
      }, Math.min(5000, this.stallMs / 2));
      this.abort = () => fail(Object.assign(new Error("Analysis stopped"), { name: "AbortError" }));
      /* A WASM crash (seen in WebKit as "Out of bounds memory access") can
         leave one worker's heap broken while the others are fine: replace
         that worker and give the range one more go before failing the run. */
      const retry = (w, id, err) => {
        if (failed) return;
        if (jobs[id].retried || !this.spawn) { fail(err); return; }
        jobs[id].retried = true;
        busy.delete(w);
        w.onmessage = w.onerror = null;
        w.terminate();
        this.spawn().then((nw) => {
          this.workers[this.workers.indexOf(w)] = nw;
          active--;
          feed(nw, id);
        }, () => fail(err));
      };
      const feed = (w, again) => {
        if (failed) return;
        if (again == null && next >= jobs.length) {
          busy.delete(w);
          if (active === 0) { clearInterval(watch); resolve(results); }
          return;
        }
        const id = again != null ? again : next++, job = jobs[id];
        active++;
        busy.set(w, { t: Date.now(), id });
        w.onmessage = (e) => {
          const m = e.data;
          if (m.id !== id) return;
          busy.set(w, { t: Date.now(), id });
          if (m.type === "progress") onJobProgress(id, m.f);
          else if (m.type === "done") { results[id] = m.res; job.audio = null; active--; onJobProgress(id, 1); feed(w); }
          else if (m.type === "error") retry(w, id, new Error(m.message));
        };
        w.onerror = (e) => {
          if (e.preventDefault) e.preventDefault();
          retry(w, id, new Error(`The analysis crashed${e.message ? ` (${e.message})` : ""}. Try again, or try a shorter recording.`));
        };
        w.onmessageerror = () => fail(new Error("The analysis couldn't pass data between threads. Try again."));
        // a copy, so the range is still here if this worker crashes and it has to run again
        const audio = job.audio.slice();
        w.postMessage({ type: "run", id, ...job, audio }, [audio.buffer]);
      };
      this.workers.forEach((w) => feed(w));
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

/* ------------------------------------------------ setlist building, off the main thread */
/* Resolves to the payload, or to null when no worker can be created (then the
   caller builds on the main thread; the arrays haven't been handed over yet). */
function buildInWorker(F, classes, meta) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL("./payload-worker.js", import.meta.url), { type: "module" }); } catch (e) { resolve(null); return; }
    w.onmessage = (e) => { w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.payload); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "setlist worker failed")); };
    // hand the big arrays over instead of copying them
    const transfer = [F.acts.buffer, F.emb.buffer, F.embT.buffer, ...Object.values(F.bands).map((a) => a.buffer),
      ...Object.values(F.heads).map((a) => a.buffer)];
    w.postMessage({ F, classes, meta }, transfer);
  });
}

/* ------------------------------------------------ the whole thing */
let pool = null;
export async function analyzeFile(file, { onProgress = () => {}, onAudio = () => {}, title, bpmRange, signal, identify = false } = {}) {
  const say = (stage, f) => onProgress({ stage, f });
  const check = () => { if (signal && signal.aborted) throw Object.assign(new Error("Analysis stopped"), { name: "AbortError" }); };
  const source = file;                       // names and titles come from what was dropped
  if (isVideo(file)) {
    // take just the soundtrack out (no re-encoding, no loading the video); onAudio
    // hands it back so the caller stores a few MB of audio rather than the video
    say("Extracting the audio from the video", 0);
    const audioOnly = await extractAudio(file).catch(() => null);
    if (audioOnly) { file = audioOnly; onAudio(audioOnly); }
    else if (file.size > 1.5e9) {
      throw new Error(`“${file.name}” is too big for the browser to read whole, and its audio couldn't be taken out on its own (it isn't an MP4 or MOV with AAC sound). Save its audio as an M4A or MP3 and drop that instead.`);
    }
  }
  check();
  say("Decoding audio", 0.01);
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
  say("Loading the analysis engine", 0.03);
  const onModels = (done, total) => {
    if (done < total) say(`Downloading the analysis models · ${Math.round(done / 1e6)} of ${Math.round(total / 1e6)} MB`, 0.03 + 0.02 * (done / total));
  };
  const models = await loadModels(onModels);
  modelListeners.delete(onModels);
  check();
  say("Starting the analysis engine", 0.05);
  if (!pool) { pool = new Pool(poolSize()); await pool.start(models); }
  const classes = styleClasses(models);
  check();
  const onAbort = () => releaseEngine();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  const jobs = planJobs(y);
  const prog = new Array(jobs.length).fill(0);
  let parts;
  try {
    parts = await pool.run(jobs, (id, f) => {
      prog[id] = f;
      say("Listening to the set", 0.06 + 0.88 * (prog.reduce((s, x) => s + x, 0) / jobs.length));
    });
  } catch (e) {
    // a failed pool may hold a dead or wedged worker: start fresh next time
    if (!(e && e.name === "AbortError")) releaseEngine();
    throw e;
  }
  if (signal) signal.removeEventListener("abort", onAbort);
  const F = merge(parts, duration);
  let probes = [], namingNote = null;
  if (identify) {
    // name tracks through the visitor's naming helper (optional)
    const r = await identifyClips(y, musicSpan(F.bands.rms, duration), {
      signal,
      onProgress: (i, n, hits) => say(`Naming tracks · ${i} of ${n} clips, ${hits} matched`, 0.93 + 0.05 * (i / Math.max(1, n))),
    });
    probes = r.probes; namingNote = r.stopped;
  }
  say("Building the setlist", 0.98);
  const meta = {
    slug: slugify(source.name), title: title || source.name.replace(/\.[^.]+$/, ""), file: source.name,
    bpmRange, source: "browser", probes,
  };
  let payload = await buildInWorker(F, classes, meta);
  if (!payload) payload = buildPayload(F, classes, meta);      // no worker available: build here
  if (identify) payload.credits.identification = probes.some((p) => p.track)
    ? "Shazam, through your Set Replay naming helper" : "the naming helper found no matches";
  if (namingNote) payload.naming_note = namingNote;
  say("Done", 1);
  return payload;
}

export function releaseEngine() {
  if (pool) { pool.stop(); pool = null; }
}

export { FPS };
