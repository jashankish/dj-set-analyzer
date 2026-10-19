#!/usr/bin/env node
/* Self-test for the browser engine on synthetic audio (no recordings needed).

     node tools/selftest.mjs [--npm DIR]

   Builds a 3-minute "set" with a known answer:
     0-90 s    house at 128 BPM over an A-minor chord (Camelot 8A)
     90-180 s  a different groove at 140 BPM over D minor (7A), different timbre
   runs the exact code the browser runs (web/js/engine), and checks tempo,
   key and that a track change is found near 90 s. Exits non-zero on failure.
   --npm: a folder with essentia.js and onnxruntime-web unpacked as ess/package
   and ort/package (see README, "The browser engine"). */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const NPM = path.resolve(args.includes("--npm") ? args[args.indexOf("--npm") + 1] : path.join(ROOT, ".engine-deps"));
const MODELS = path.join(ROOT, "web", "models");
const eng = (f) => import(pathToFileURL(path.join(ROOT, "web/js/engine", f)));
const { extractRange, SR } = await eng("extract.js");
const { buildPayload } = await eng("payload.js");
const { planJobs, merge } = await eng("pipeline.js");
const { HEADS } = await eng("config.js");

/* ---------------- synthetic set (tools/synth.mjs) */
const { makeSet } = await import(pathToFileURL(path.join(ROOT, "tools/synth.mjs")));
const DUR = 180, y = makeSet(SR);

/* ---------------- engine */
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
const T = Date.now();
const parts = [];
for (const job of planJobs(y)) parts.push(await extractRange({ essentia, ort, effnet, heads }, job.audio, job.offset, job.range, job.total));
const P = buildPayload(merge(parts, DUR), classes, { slug: "selftest", title: "Self-test", file: "selftest.wav" });

/* ---------------- checks */
const bpmAt = (t) => { const b = P.curves.bpm; let k = 0; for (let i = 0; i < b.t.length; i++) if (Math.abs(b.t[i] - t) < Math.abs(b.t[k] - t)) k = i; return b.v[k]; };
const keyIn = (a, b) => { const c = {}; P.curves.keys.t.forEach((t, i) => { if (t >= a && t <= b) c[P.curves.keys.v[i]] = (c[P.curves.keys.v[i]] || 0) + 1; }); return Object.entries(c).sort((x, z) => z[1] - x[1])[0]?.[0]; };
const near = (x, want, tol) => x != null && Math.abs(x - want) <= tol;
const checks = [
  ["tempo at 45 s is 128 BPM", bpmAt(45), (v) => near(v, 128, 3)],
  ["tempo at 135 s is 140 BPM", bpmAt(135), (v) => near(v, 140, 3)],
  ["key in the first half is A minor (8A)", keyIn(10, 80), (v) => v === "8A"],
  ["key in the second half is D minor (7A)", keyIn(100, 170), (v) => v === "7A"],
  ["a track change within 20 s of 90 s", P.tracks.slice(1).map((t) => Math.round(t.start)), (v) => v.some((s) => Math.abs(s - 90) <= 20)],
  ["setlist, transitions and curves are present", [P.tracks.length, P.transitions.length, P.curves.wave.low.length], (v) => v[0] >= 2 && v[1] >= 1 && v[2] > 1000],
];
let failed = 0;
for (const [name, value, ok] of checks) {
  const pass = ok(value);
  failed += pass ? 0 : 1;
  console.log(`${pass ? "ok  " : "FAIL"}  ${name}  (got ${JSON.stringify(value)})`);
}
console.log(`${checks.length - failed}/${checks.length} checks passed in ${((Date.now() - T) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
