/* Analysis worker: loads Essentia (WASM) and ONNX Runtime once, then
   extracts features for whatever time ranges the main thread sends. */
import { extractRange } from "./extract.js";
import { HEADS } from "./config.js";

let ctx = null;

async function init(assets, models) {
  const [{ EssentiaWASM }, { default: Essentia }, ort] = await Promise.all([
    import(assets.essentiaWasm), import(assets.essentiaCore), import(assets.ort),
  ]);
  if (!EssentiaWASM.calledRun) await new Promise((r) => { EssentiaWASM.onRuntimeInitialized = r; });
  const essentia = new Essentia(EssentiaWASM);
  ort.env.wasm.wasmPaths = assets.ortWasmPath;
  ort.env.wasm.numThreads = 1;            // parallelism comes from running several workers
  const load = async (name) => {
    if (models && models[name]) return models[name];          // shared by the main thread
    const r = await fetch(assets.models + name);
    if (!r.ok) throw new Error(`Couldn't load the model ${name} (HTTP ${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const effnet = await ort.InferenceSession.create(await load("discogs-effnet-bsdynamic-1.onnx"));
  const heads = {};
  for (const [name, positive] of Object.entries(HEADS)) {
    const [bytes, meta] = await Promise.all([
      load(`${name}-discogs-effnet-1.onnx`),
      load(`${name}-discogs-effnet-1.json`).then((b) => JSON.parse(new TextDecoder().decode(b))),
    ]);
    const session = await ort.InferenceSession.create(bytes);
    heads[name] = { session, index: meta.classes.indexOf(positive), input: session.inputNames[0], output: session.outputNames[0] };
  }
  ctx = { essentia, ort, effnet, heads };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      await init(m.assets, m.models);
      self.postMessage({ type: "ready" });
    } else if (m.type === "run") {
      const res = await extractRange(ctx, m.audio, m.offset, m.range, m.total,
        (f) => self.postMessage({ type: "progress", id: m.id, f }));
      const transfer = [res.acts.buffer, res.embs.buffer, res.embT.buffer,
        ...Object.values(res.bands).map((a) => a.buffer), ...Object.values(res.heads).map((a) => a.buffer)];
      self.postMessage({ type: "done", id: m.id, res }, transfer);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
  }
};
