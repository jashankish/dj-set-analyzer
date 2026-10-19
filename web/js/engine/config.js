/* Where the engine loads its heavy assets from.

   Libraries come from jsDelivr (free, CORS-enabled, pinned versions), with
   unpkg as an automatic fallback if jsDelivr is down or blocked. Each library
   entry is a list of URLs tried in order.
   The Essentia models are served by this site from /models/ — the upstream
   host (essentia.upf.edu) doesn't send CORS headers.

   To self-host the libraries too, copy them next to the site and override
   these URLs before the engine starts:
     window.SET_REPLAY_ASSETS = { essentiaWasm: "/vendor/essentia-wasm.es.js", … }
*/
const here = new URL(".", import.meta.url);

const CDNS = ["https://cdn.jsdelivr.net/npm/", "https://unpkg.com/"];
const ESSENTIA = "essentia.js@0.1.3/dist/", ORT = "onnxruntime-web@1.30.0/dist/";

export const DEFAULT_ASSETS = {
  essentiaWasm: CDNS.map((c) => `${c}${ESSENTIA}essentia-wasm.es.js`),
  essentiaCore: CDNS.map((c) => `${c}${ESSENTIA}essentia.js-core.es.js`),
  ort: CDNS.map((c) => `${c}${ORT}ort.wasm.min.mjs`),
  ortWasmPath: CDNS.map((c) => `${c}${ORT}`),          // paired with `ort` by position
  models: new URL("../../models/", here).href,
};

const list = (v) => (Array.isArray(v) ? v : [v]);

export function assets() {
  const o = (typeof window !== "undefined" && window.SET_REPLAY_ASSETS) || {};
  const a = { ...DEFAULT_ASSETS, ...o };
  for (const k of ["essentiaWasm", "essentiaCore", "ort", "ortWasmPath"]) a[k] = list(a[k]);
  return a;
}

/** Import the first URL that loads; returns [module, index of the URL used]. */
export async function importFirst(urls) {
  let last;
  for (let i = 0; i < urls.length; i++) {
    try { return [await import(urls[i]), i]; } catch (e) { last = e; }
  }
  throw new Error(`Couldn't load the analysis engine from any CDN (${urls.map((u) => new URL(u).host).join(", ")}). Check your connection or network filters. ${last ? `(${last.message})` : ""}`);
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
