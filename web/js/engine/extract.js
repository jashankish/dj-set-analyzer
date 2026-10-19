/* Feature extraction for one time range of a set — runs inside a worker.
   Mirrors analyzer/features.py. Every feature lives on a fixed global grid
   (band frames, tempo windows, key windows, beat chunks, EffNet patches), and
   a worker only computes the grid items that START inside its range, so
   ranges processed in parallel stitch together exactly.

   Audio is mono 16 kHz (what the browser decodes cheaply and what EffNet
   wants). The beat tracker assumes 44.1 kHz, so its 60 s chunks are
   upsampled on the fly. */
import { bandEnergy } from "./dsp.js";
import { melFrame } from "./mel.js";

export const SR = 16000;
export const FPS = 8;
const MEL_FRAME = 512, MEL_HOP = 256, PATCH = 128, PATCH_HOP = 62;

/* linear-interpolation resample (only used to upsample for the beat tracker) */
function resample(x, from, to) {
  const n = Math.floor((x.length * to) / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * r, j = Math.floor(p), f = p - j;
    out[i] = x[j] * (1 - f) + (x[j + 1] ?? x[j]) * f;
  }
  return out;
}

/**
 * @param ctx      { essentia, effnet, heads: {name: {session, index}}, ort }
 * @param audio    Float32Array slice of the set, starting at `offset` seconds
 * @param offset   global time (s) of audio[0]; a multiple of 10 s
 * @param range    [a, b) global seconds this worker owns
 * @param total    total samples in the whole set
 * @param progress (fraction) => void
 */
export async function extractRange(ctx, audio, offset, [a, b], total, progress = () => {}) {
  const { essentia } = ctx;
  const off = Math.round(offset * SR);
  const local = (t) => Math.round(t * SR) - off;
  const seg = (t0, len) => audio.subarray(Math.max(0, local(t0)), Math.min(audio.length, local(t0 + len)));
  const out = {};

  // 1. 3-band energy -------------------------------------------------------
  const hop = SR / FPS;
  const totalFrames = Math.max(1, Math.floor((total - 2048) / hop) + 1);
  const f0 = Math.ceil(a * FPS), f1 = Math.min(totalFrames, Math.ceil(b * FPS));
  out.bandStart = f0;
  out.bands = bandEnergy(audio, SR, FPS, f0 - off / hop, f1 - off / hop);
  progress(0.1);

  // 2. tempo windows (Percival, 20 s every 10 s) ----------------------------
  out.bpmT = []; out.bpmRaw = [];
  for (let t0 = Math.ceil(a / 10) * 10; t0 < b && (t0 + 10) * SR < total; t0 += 10) {
    const s = seg(t0, 20);
    if (s.length < SR * 6) break;
    let e = 0;
    for (let i = 0; i < s.length; i++) e += s[i] * s[i];
    const rms = Math.sqrt(e / s.length);
    out.bpmT.push(t0 + s.length / SR / 2);
    if (rms > 1e-3) {
      const v = essentia.arrayToVector(s);
      out.bpmRaw.push(essentia.PercivalBpmEstimator(v, 1024, 2048, 128, 128, 190, 70, SR).bpm);
      v.delete && v.delete();
    } else out.bpmRaw.push(NaN);
  }
  progress(0.2);

  // 3. keys (EDM profile, 20 s every 10 s) ----------------------------------
  out.keys = [];
  for (let t0 = Math.ceil(a / 10) * 10; t0 < b && (t0 + 10) * SR < total; t0 += 10) {
    const s = seg(t0, 20);
    if (s.length < SR * 5) break;
    const v = essentia.arrayToVector(s);
    const k = essentia.KeyExtractor(v, true, 4096, 4096, 12, 3500, 60, 25, 0.2, "edma", SR, 0.0001, 440, "cosine", "hann");
    out.keys.push([t0 + s.length / SR / 2, k.key, k.scale, k.strength]);
    v.delete && v.delete();
  }
  progress(0.3);

  // 4. beats (RhythmExtractor2013 on 60 s chunks, 6 s overlap) --------------
  out.beats = [];
  for (let t0 = Math.ceil(a / 54) * 54; t0 < b && t0 * SR < total; t0 += 54) {
    const s = seg(t0, 60);
    if (s.length < SR * 8) break;
    const up = resample(s, SR, 44100);
    const v = essentia.arrayToVector(up);
    const r = essentia.RhythmExtractor2013(v, 180, "degara", 70);
    const ticks = essentia.vectorToArray(r.ticks);
    const lo = t0 + (t0 > 0 ? 3 : 0);
    const hi = (t0 + 60) * SR < total ? t0 + 57 : Infinity;
    for (const x of ticks) { const g = x + t0; if (g >= lo && g < hi) out.beats.push(g); }
    v.delete && v.delete();
  }
  progress(0.45);

  // 5. Discogs-EffNet: ~2 s patches every ~1 s --------------------------------
  const melTotal = Math.max(0, Math.floor((total - MEL_FRAME) / MEL_HOP) + 1);
  const patchStarts = [];
  for (let s = Math.ceil((a * SR) / MEL_HOP / PATCH_HOP) * PATCH_HOP; (s * MEL_HOP) / SR < b && s + PATCH <= melTotal; s += PATCH_HOP) patchStarts.push(s);
  out.embT = Float32Array.from(patchStarts, (s) => ((s + PATCH / 2) * MEL_HOP) / SR);
  if (patchStarts.length) {
    const m0 = patchStarts[0], m1 = patchStarts[patchStarts.length - 1] + PATCH;
    const mel = new Float32Array((m1 - m0) * 96);
    const frame = new Float32Array(MEL_FRAME);
    for (let f = m0; f < m1; f++) {
      const p = f * MEL_HOP - off;
      frame.fill(0);
      frame.set(audio.subarray(Math.max(0, p), Math.min(audio.length, p + MEL_FRAME)), Math.max(0, -p));
      melFrame(frame, mel.subarray((f - m0) * 96, (f - m0 + 1) * 96));
      if ((f - m0) % 4000 === 0) progress(0.45 + 0.2 * ((f - m0) / (m1 - m0)));
    }
    const n = patchStarts.length;
    const acts = new Float32Array(n * 400), embs = new Float32Array(n * 1280);
    const BATCH = 64;
    for (let i = 0; i < n; i += BATCH) {
      const k = Math.min(BATCH, n - i), data = new Float32Array(k * PATCH * 96);
      for (let j = 0; j < k; j++) data.set(mel.subarray((patchStarts[i + j] - m0) * 96, (patchStarts[i + j] - m0 + PATCH) * 96), j * PATCH * 96);
      const r = await ctx.effnet.run({ melspectrogram: new ctx.ort.Tensor("float32", data, [k, PATCH, 96]) });
      acts.set(r.activations.data, i * 400);
      embs.set(r.embeddings.data, i * 1280);
      progress(0.65 + 0.3 * ((i + k) / n));
    }
    out.acts = acts; out.embs = embs;
    out.heads = {};
    for (const [name, h] of Object.entries(ctx.heads)) {
      const r = await h.session.run({ [h.input]: new ctx.ort.Tensor("float32", embs, [n, 1280]) });
      const o = r[h.output].data, col = new Float32Array(n);
      for (let j = 0; j < n; j++) col[j] = o[j * 2 + h.index];
      out.heads[name] = col;
    }
  } else {
    out.acts = new Float32Array(0); out.embs = new Float32Array(0); out.heads = {};
  }
  progress(1);
  return out;
}
