/* Small numeric toolkit for the in-browser engine: the NumPy/SciPy bits the
   Python pipeline leans on (percentiles, smoothing, median filters, FFT). */

export function percentile(arr, p) {
  const a = Float64Array.from(arr).filter((x) => Number.isFinite(x)).sort();
  if (!a.length) return NaN;
  const r = (p / 100) * (a.length - 1), lo = Math.floor(r), hi = Math.ceil(r);
  return a[lo] + (a[hi] - a[lo]) * (r - lo);
}
export const median = (arr) => percentile(arr, 50);
export function mean(arr) {
  let s = 0, n = 0;
  for (const x of arr) if (Number.isFinite(x)) { s += x; n++; }
  return n ? s / n : NaN;
}

/* uniform_filter1d(mode="nearest") */
export function smooth(x, size) {
  size = Math.max(1, Math.round(size));
  const n = x.length, out = new Float64Array(n);
  if (size === 1) { out.set(x); return out; }
  const half = Math.floor(size / 2);
  const at = (i) => x[Math.min(n - 1, Math.max(0, i))];
  let s = 0;
  for (let k = -half; k < size - half; k++) s += at(k);
  for (let i = 0; i < n; i++) {
    out[i] = s / size;
    s += at(i + size - half) - at(i - half);
  }
  return out;
}

/* median_filter(mode="nearest"); fine for the sizes used here */
export function medianFilter(x, size) {
  const n = x.length, out = new Float64Array(n), half = Math.floor(size / 2);
  if (size > 64) {
    // large windows: median of a strided sample keeps it fast and close
    const stride = Math.ceil(size / 64);
    for (let i = 0; i < n; i++) {
      const buf = [];
      for (let k = -half; k < size - half; k += stride) buf.push(x[Math.min(n - 1, Math.max(0, i + k))]);
      buf.sort((a, b) => a - b);
      out[i] = buf[buf.length >> 1];
    }
    return out;
  }
  const buf = new Float64Array(size);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < size; k++) buf[k] = x[Math.min(n - 1, Math.max(0, i - half + k))];
    buf.sort();
    out[i] = buf[size >> 1];
  }
  return out;
}

export function interp(xs, xp, fp) {
  const out = new Float64Array(xs.length);
  let j = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x <= xp[0]) { out[i] = fp[0]; continue; }
    if (x >= xp[xp.length - 1]) { out[i] = fp[fp.length - 1]; continue; }
    while (j < xp.length - 2 && xp[j + 1] < x) j++;
    while (j > 0 && xp[j] > x) j--;
    const t = (x - xp[j]) / (xp[j + 1] - xp[j]);
    out[i] = fp[j] + (fp[j + 1] - fp[j]) * t;
  }
  return out;
}

export function norm01(x, loP = 3, hiP = 99.5) {
  const lo = percentile(x, loP), hi = percentile(x, hiP);
  return Float64Array.from(x, (v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo + 1e-9))));
}

/* in-place radix-2 FFT on (re, im) */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/* 3-band energy (dB) + RMS dB at `fps` frames per second, like features.band_energy */
export const BANDS = { low: [20, 150], mid: [150, 2500], high: [2500, 11000] };
export function bandEnergy(y, sr, fps, frameStart = 0, frameEnd = null) {
  const hop = Math.round(sr / fps), nfft = sr >= 32000 ? 4096 : 2048;
  const total = Math.max(1, Math.floor((y.length - nfft) / hop) + 1);
  const f1 = frameEnd == null ? total : Math.min(total, frameEnd);
  const n = Math.max(0, f1 - frameStart);
  const win = new Float64Array(nfft);
  for (let i = 0; i < nfft; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nfft - 1));
  const binHz = sr / nfft, nb = nfft / 2 + 1;
  const ranges = Object.fromEntries(Object.entries(BANDS).map(([k, [lo, hi]]) =>
    [k, [Math.ceil(lo / binHz), Math.min(nb, Math.ceil(hi / binHz))]]));
  const out = { low: new Float32Array(n), mid: new Float32Array(n), high: new Float32Array(n), rms: new Float32Array(n) };
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let f = 0; f < n; f++) {
    const off = (frameStart + f) * hop;
    let e = 0;
    for (let i = 0; i < nfft; i++) { const v = (y[off + i] || 0) * win[i]; re[i] = v; im[i] = 0; e += v * v; }
    fft(re, im);
    for (const k of ["low", "mid", "high"]) {
      const [a, b] = ranges[k];
      let s = 0;
      for (let i = a; i < b; i++) s += re[i] * re[i] + im[i] * im[i];
      out[k][f] = 10 * Math.log10(s + 1e-10);
    }
    out.rms[f] = 10 * Math.log10(e / nfft + 1e-12);
  }
  return out;
}

/* allocation-free helpers */
export function argmax(a, lo = 0, hi = a.length) {
  let best = lo;
  for (let i = lo + 1; i < hi; i++) if (a[i] > a[best]) best = i;
  return best;
}
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
