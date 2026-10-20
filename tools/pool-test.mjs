#!/usr/bin/env node
/* Checks the analysis worker pool's crash recovery (web/js/engine/pipeline.js,
   Pool) with a stand-in Worker, so it runs in plain Node:
     node tools/pool-test.mjs
   A WASM crash in one worker (WebKit has shown "Out of bounds memory access")
   should cost a retry of that range in a fresh worker, not the whole run. */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* a stand-in Worker: says "ready" on init; on "run" answers "done" unless the
   plan says this range should crash ("error" message, or a hard onerror) */
let plan = {}, spawned = 0;
class FakeWorker {
  constructor() { spawned++; this.dead = false; }
  postMessage(m) {
    if (this.dead) return;
    setTimeout(() => {
      if (this.dead || !this.onmessage) return;
      if (m.type === "init") return this.onmessage({ data: { type: "ready" } });
      const left = plan[m.id] || 0;
      if (left > 0) {
        plan[m.id] = left - 1;
        if (plan.hard) return this.onerror && this.onerror({ message: "Out of bounds memory access", preventDefault() {} });
        return this.onmessage({ data: { type: "error", id: m.id, message: "Out of bounds memory access" } });
      }
      this.onmessage({ data: { type: "progress", id: m.id, f: 0.5 } });
      this.onmessage({ data: { type: "done", id: m.id, res: { id: m.id, n: m.audio.length } } });
    }, 1);
  }
  terminate() { this.dead = true; }
}
globalThis.Worker = FakeWorker;
const { Pool } = await import(pathToFileURL(path.join(ROOT, "web/js/engine/pipeline.js")));

const jobs = () => Array.from({ length: 6 }, (_, i) => ({ audio: new Float32Array(100 + i), offset: i * 120, range: [i * 120, (i + 1) * 120], total: 720 }));
const checks = [];
const check = (name, value, ok) => checks.push([name, JSON.stringify(value), !!ok(value)]);

async function runWith(p, hard = false) {
  plan = { ...p, hard }; spawned = 0;
  const pool = new Pool(3);
  await pool.start({});
  const J = jobs();
  try {
    const r = await pool.run(J, () => {});
    return { ok: true, ids: r.map((x) => x.id), lens: r.map((x) => x.n), spawned, audioKept: J.every((j) => j.audio === null) };
  } catch (e) {
    return { ok: false, msg: e.message, spawned };
  } finally { pool.stop(); }
}

const clean = await runWith({});
check("no crash: every range comes back in order", clean.ids, (v) => v.join() === "0,1,2,3,4,5");
check("no crash: no extra workers", clean.spawned, (n) => n === 3);
check("finished ranges release their audio", clean.audioKept, (v) => v === true);

const once = await runWith({ 2: 1 });
check("a range that crashes once is retried in a fresh worker", [once.ok, once.ids, once.spawned], ([ok, ids, n]) => ok && ids.join() === "0,1,2,3,4,5" && n === 4);
check("the retried range still gets its full audio", once.lens, (v) => v[2] === 102);

const hard = await runWith({ 4: 1 }, true);
check("a hard worker crash (onerror) is retried too", [hard.ok, hard.spawned], ([ok, n]) => ok && n === 4);

const twice = await runWith({ 1: 2 });
check("a range that crashes twice fails the run with the error", [twice.ok, twice.msg], ([ok, m]) => !ok && /Out of bounds/.test(m));

let bad = 0;
for (const [name, v, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : v}`); if (!ok) bad++; }
console.log(bad ? `\n${bad} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
