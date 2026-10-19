/* Where the engine loads its heavy assets from.

   Libraries come from jsDelivr (free, CORS-enabled, pinned versions).
   The Essentia models are served by this site from /models/ — the upstream
   host (essentia.upf.edu) doesn't send CORS headers.

   To self-host the libraries too, copy them next to the site and override
   these URLs before the engine starts:
     window.SET_REPLAY_ASSETS = { essentiaWasm: "/vendor/essentia-wasm.es.js", … }
*/
const here = new URL(".", import.meta.url);

export const DEFAULT_ASSETS = {
  essentiaWasm: "https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia-wasm.es.js",
  essentiaCore: "https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia.js-core.es.js",
  ort: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs",
  ortWasmPath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/",
  models: new URL("../../models/", here).href,
};

export function assets() {
  const o = (typeof window !== "undefined" && window.SET_REPLAY_ASSETS) || {};
  return { ...DEFAULT_ASSETS, ...o };
}

/* the engine's working sample rate (what EffNet expects; cheap to decode) */
export const SR = 16000;

export const HEADS = {
  danceability: "danceable",
  mood_party: "party",
  mood_aggressive: "aggressive",
  mood_happy: "happy",
  voice_instrumental: "voice",
};
