#!/usr/bin/env node
/* Run the in-browser engine under Node and compare it with the Python pipeline.

   Usage:
     node tools/engine-check.mjs "Recording 9.m4a" [--npm DIR] [--out file.json]

   --npm points at a folder with essentia.js and onnxruntime-web unpacked as
   ess/package and ort/package (npm pack + tar). The engine code is exactly the
   code the browser runs (web/js/engine/*), minus the Web Worker wrapper. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import v8 from "node:v8";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const audioPath = path.resolve(args[0]);
const NPM = path.resolve(opt("--npm", path.join(ROOT, ".engine-deps")));
const OUT = opt("--out", null);
const CACHE = opt("--cache", null);   // reuse extracted features between runs (setlist tuning)
const MODELS = path.join(ROOT, "web", "models");

const { extractRange, SR } = await import(pathToFileURL(path.join(ROOT, "web/js/engine/extract.js")));
const { buildPayload } = await import(pathToFileURL(path.join(ROOT, "web/js/engine/payload.js")));
const { planJobs, merge, slugify } = await import(pathToFileURL(path.join(ROOT, "web/js/engine/pipeline.js")));
const { HEADS } = await import(pathToFileURL(path.join(ROOT, "web/js/engine/config.js")));

const require = createRequire(import.meta.url);
const EssentiaWASM = require(path.join(NPM, "ess/package/dist/essentia-wasm.umd.js"));
const Essentia = require(path.join(NPM, "ess/package/dist/essentia.js-core.umd.js"));
const ort = await import(pathToFileURL(path.join(NPM, "ort/package/dist/ort.wasm.min.mjs")));
ort.env.wasm.numThreads = 1;
if (!EssentiaWASM.calledRun) await new Promise((r) => (EssentiaWASM.onRuntimeInitialized = r));
const essentia = new Essentia(EssentiaWASM);
const load = (f) => new Uint8Array(fs.readFileSync(path.join(MODELS, f)));
const effnet = await ort.InferenceSession.create(load("discogs-effnet-bsdynamic-1.onnx"));
const heads = {};
for (const [name, positive] of Object.entries(HEADS)) {
  const session = await ort.InferenceSession.create(load(`${name}-discogs-effnet-1.onnx`));
  const meta = JSON.parse(fs.readFileSync(path.join(MODELS, `${name}-discogs-effnet-1.json`)));
  heads[name] = { session, index: meta.classes.indexOf(positive), input: session.inputNames[0], output: session.outputNames[0] };
}
const classes = JSON.parse(fs.readFileSync(path.join(MODELS, "discogs-effnet-bsdynamic-1.json"))).classes;

let F;
if (CACHE && fs.existsSync(CACHE)) {
  F = v8.deserialize(fs.readFileSync(CACHE));
  console.log("  features from cache");
} else {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 2 ** 31 });
  const y = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice();
  const T = Date.now();
  const jobs = planJobs(y);
  const parts = [];
  for (const [i, job] of jobs.entries()) {
    parts.push(await extractRange({ essentia, ort, effnet, heads }, job.audio, job.offset, job.range, job.total));
    process.stdout.write(`\r  range ${i + 1}/${jobs.length}`);
  }
  console.log(`\n  extraction ${((Date.now() - T) / 1000).toFixed(0)} s (single thread) for ${(y.length / SR / 60).toFixed(1)} min`);
  F = merge(parts, y.length / SR);
  if (CACHE) fs.writeFileSync(CACHE, v8.serialize(F));
}
const P = buildPayload(F, classes, { slug: slugify(path.basename(audioPath)), title: path.basename(audioPath), file: path.basename(audioPath) });
if (OUT) fs.writeFileSync(OUT, JSON.stringify(P));

const s = P.summary;
console.log(`  engine: ${s.tracks} tracks, ${s.bpm_avg} BPM, span ${s.set_start}-${s.set_end}s, ${s.transitions} mixes ${JSON.stringify(s.transition_types)}, harmonic ${s.harmonic_pct}%, drops ${s.drops}`);
console.log(`  keys: ${P.tracks.map((t) => t.key && t.key.camelot).join(" ")}`);
console.log(`  styles: ${s.styles.slice(0, 4).map((x) => `${x.style} ${x.share}`).join(", ")}`);
const ref = path.join(ROOT, "web/data/sets", `${slugify(path.basename(audioPath))}.json`);
if (fs.existsSync(ref)) {
  const R = JSON.parse(fs.readFileSync(ref)), r = R.summary;
  console.log(`  python: ${r.tracks} tracks, ${r.bpm_avg} BPM, span ${r.set_start}-${r.set_end}s, ${r.transitions} mixes ${JSON.stringify(r.transition_types)}, harmonic ${r.harmonic_pct}%, drops ${r.drops}  (with Shazam)`);
  console.log(`  keys: ${R.tracks.map((t) => t.key && t.key.camelot).join(" ")}`);
}
