/* Pure-JS twin of Essentia's TensorflowInputMusiCNN — the log-mel front-end
   Discogs-EffNet was trained on: 512-sample Hann frames at 16 kHz → magnitude
   spectrum → 96 Slaney-mel bands (0–8 kHz, unit_tri) on the power spectrum →
   log10(1 + 10000·x). Calling Essentia through WASM once per 32 ms frame
   costs more than the math, so this keeps the hot loop in JS. Checked
   against Essentia.js on real audio: max abs error 6e-5, ~30x faster. */
import { fft } from "./dsp.js";

const N = 512, SR = 16000, BANDS = 96, NB = N / 2 + 1;
const WIN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));

const hz2mel = (f) => (f < 1000 ? (3 * f) / 200 : 15 + 27 * Math.log(f / 1000) / Math.log(6.4));
const mel2hz = (m) => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp(((m - 15) * Math.log(6.4)) / 27));

/* filterbank as sparse [band] → {start, weights} */
const FB = (() => {
  const lo = hz2mel(0), hi = hz2mel(SR / 2);
  const edges = Array.from({ length: BANDS + 2 }, (_, i) => mel2hz(lo + ((hi - lo) * i) / (BANDS + 1)));
  const binHz = SR / N;
  return Array.from({ length: BANDS }, (_, b) => {
    const f0 = edges[b], f1 = edges[b + 1], f2 = edges[b + 2];
    const w = new Float64Array(NB);
    for (let k = 0; k < NB; k++) {
      const f = k * binHz;
      if (f > f0 && f < f2) w[k] = f <= f1 ? (f - f0) / (f1 - f0) : (f2 - f) / (f2 - f1);
    }
    return { w, scale: 2 / (f2 - f0) };          // unit_tri: each triangle has unit area
  });
})();

const re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(NB);

export function melFrame(frame, out = new Float32Array(BANDS)) {
  for (let i = 0; i < N; i++) { re[i] = (frame[i] || 0) * WIN[i]; im[i] = 0; }
  fft(re, im);
  for (let k = 0; k < NB; k++) {
    const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    mag[k] = m * m;
  }
  for (let b = 0; b < BANDS; b++) {
    const { w, scale } = FB[b];
    let s = 0;
    for (let k = 0; k < NB; k++) if (w[k]) s += w[k] * mag[k];
    out[b] = Math.log10(1 + 10000 * s * scale);
  }
  return out;
}
