/* Setlist builder — a port of analyzer/setlist.py.
   Low-level features (+ optional identification probes) → tracks,
   transitions, drops and set-wide curves. Field names match the Python
   JSON exactly so the viewer renders either. */
import * as M from "./music.js";
import { percentile, median, mean, smooth, medianFilter, interp, norm01, argmax } from "./dsp.js";

export const NOV_BIN = 2, NOV_HALF = 12, MIN_TRACK = 60, FPS = 8;
const AUDIO_ONLY_MIN = 75, AUDIO_ONLY_PROM = 0.4;   // no identification: fewer, surer track changes
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;

/* ---------------------------------------------------------------- novelty */
export function novelty(embT, emb, dim, duration) {
  const nb = Math.ceil(duration / NOV_BIN);
  const E = new Float32Array(nb * dim), cnt = new Float32Array(nb);
  for (let p = 0; p < embT.length; p++) {
    const i = Math.min(nb - 1, Math.max(0, Math.floor(embT[p] / NOV_BIN)));
    for (let d = 0; d < dim; d++) E[i * dim + d] += emb[p * dim + d];
    cnt[i]++;
  }
  for (let i = 1; i < nb; i++) if (!cnt[i]) { E.copyWithin(i * dim, (i - 1) * dim, i * dim); cnt[i] = 1; }
  for (let i = 0; i < nb; i++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += E[i * dim + d] ** 2;
    s = Math.sqrt(s) + 1e-9;
    for (let d = 0; d < dim; d++) E[i * dim + d] /= s;
  }
  const L = NOV_HALF, g = [];
  for (let k = 0; k < 2 * L; k++) g.push(Math.exp(-0.5 * (-1.5 + (3 * k) / (2 * L - 1)) ** 2));
  const K = new Float64Array(4 * L * L);
  let ks = 0;
  for (let i = 0; i < 2 * L; i++) for (let j = 0; j < 2 * L; j++) {
    const v = g[i] * g[j] * ((i < L) === (j < L) ? 1 : -1);
    K[i * 2 * L + j] = v; ks += Math.abs(v);
  }
  for (let i = 0; i < K.length; i++) K[i] /= ks;
  // similarity is only needed within the kernel's band around the diagonal
  const W = 2 * L, band = new Float32Array(nb * (2 * W + 1));
  const clampI = (i) => Math.min(nb - 1, Math.max(0, i));
  for (let i = 0; i < nb; i++) for (let o = -W; o <= W; o++) {
    const j = clampI(i + o);
    let s = 0;
    for (let d = 0; d < dim; d++) s += E[i * dim + d] * E[j * dim + d];
    band[i * (2 * W + 1) + o + W] = s;
  }
  const sim = (i, j) => {
    // edge padding (np.pad mode="edge"): clamp both indices first
    i = clampI(i); j = clampI(j);
    return band[i * (2 * W + 1) + (j - i) + W];
  };
  const nov = new Float64Array(nb);
  for (let c = 0; c < nb; c++) {
    let s = 0;
    for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) s += K[i * W + j] * sim(c - L + i, c - L + j);
    nov[c] = Math.max(0, s);
  }
  const p = percentile(nov, 99.5) + 1e-9;
  return nov.map((v) => Math.min(1.2, v / p));
}
const novAt = (nov, t) => nov[Math.min(nov.length - 1, Math.max(0, Math.floor(t / NOV_BIN)))];

/* scipy.signal.find_peaks(prominence, distance) — sorted by prominence desc */
function peaksIn(nov, a, b, minDist = MIN_TRACK, prominence = 0.12) {
  const lo = Math.floor(Math.max(0, a) / NOV_BIN), hi = Math.floor(Math.min(nov.length * NOV_BIN, b) / NOV_BIN);
  if (hi - lo < 3) return [];
  const x = nov.subarray(lo, hi);
  let pk = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] > x[i - 1]) {
      let j = i;
      while (j + 1 < x.length && x[j + 1] === x[i]) j++;
      if (j + 1 < x.length && x[j + 1] < x[i]) pk.push((i + j) >> 1);
      i = j;
    }
  }
  const dist = Math.max(1, Math.floor(minDist / NOV_BIN / 2));
  const keep = new Set(pk);
  [...pk].sort((p, q) => x[q] - x[p]).forEach((p) => {
    if (!keep.has(p)) return;
    for (const q of pk) if (q !== p && Math.abs(q - p) < dist && keep.has(q) && x[q] <= x[p]) keep.delete(q);
  });
  pk = pk.filter((p) => keep.has(p));
  const out = [];
  for (const p of pk) {
    let l = p, lmin = x[p];
    while (l > 0 && x[l - 1] <= x[p]) { l--; lmin = Math.min(lmin, x[l]); }
    let r = p, rmin = x[p];
    while (r < x.length - 1 && x[r + 1] <= x[p]) { r++; rmin = Math.min(rmin, x[r]); }
    const prom = x[p] - Math.max(lmin, rmin);
    if (prom >= prominence) out.push([(lo + p) * NOV_BIN + NOV_BIN / 2, prom]);
  }
  return out.sort((p, q) => q[1] - p[1]);
}

/* ---------------------------------------------------------------- identification runs */
const EDIT = /\s*[([](?:feat\.?|ft\.?|featuring)[^)\]]*[)\]]|\s*[([](?:extended|original|radio|club|album)(?: mix| edit| version)?[)\]]/gi;
export function songKey(track) {
  const title = (track.title || "").replace(EDIT, "").trim().toLowerCase();
  const artist = (track.artist || "").split("&")[0].split(",")[0].trim().toLowerCase();
  return `${artist}|${title}`;
}
function idRuns(probes) {
  const runs = [];
  for (const p of probes.filter((p) => p.track)) {
    const id = songKey(p.track);
    if (runs.length && runs[runs.length - 1].id === id) runs[runs.length - 1].probes.push(p);
    else runs.push({ id, probes: [p] });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < runs.length - 1; i++) {
      if (runs[i].probes.length === 1 && runs[i - 1].id === runs[i + 1].id) {
        runs[i - 1].probes.push(...runs[i + 1].probes);
        runs.splice(i, 2);
        changed = true;
        break;
      }
    }
  }
  for (const r of runs) {
    const ps = r.probes;
    r.first = ps[0].t; r.last = ps[ps.length - 1].t + ps[ps.length - 1].dur; r.meta = ps[0].track;
    const starts = ps.filter((p) => p.offset != null).map((p) => p.t - p.offset);
    r.start_est = starts.length ? median(starts) : null;
    r.linear = starts.length > 0 && Math.max(...starts) - Math.min(...starts) < 20;
  }
  return runs;
}

/* ---------------------------------------------------------------- segmentation */
function segment(duration, probes, nov, step) {
  const runs = idRuns(probes);
  if (!runs.length) {
    const chosen = [];
    for (const [t, prom] of peaksIn(nov, AUDIO_ONLY_MIN, duration - AUDIO_ONLY_MIN, AUDIO_ONLY_MIN, 0.05))
      if (prom >= AUDIO_ONLY_PROM && chosen.every((c) => Math.abs(t - c) >= AUDIO_ONLY_MIN)) chosen.push(t);
    const edges = [0, ...chosen.sort((x, y) => x - y), duration];
    return edges.slice(0, -1).map((s, k) => ({ s, e: edges[k + 1], run: null }));
  }
  const anchors = [null, ...runs, null];
  let boundaries = [];
  const order = [];
  const argmaxT = (lo, hi) => (lo + argmax(nov, lo, Math.min(nov.length, hi + 1)) - lo) * NOV_BIN + NOV_BIN / 2;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    const left = a ? a.last : 0, right = b ? b.first : duration, span = right - left;
    let chosen = [];
    const far = (t) => chosen.every((c) => Math.abs(t - c) >= MIN_TRACK);
    if (a && b) {
      let floor = left - step * 0.5;
      if (b.start_est != null && left - step < b.start_est && b.start_est < right) floor = b.start_est - 6;
      const lo = Math.floor(Math.max(0, floor) / NOV_BIN), hi = Math.max(lo + 1, Math.floor((right + step * 0.5) / NOV_BIN));
      chosen = [argmaxT(lo, hi)];
      if (span >= 180) for (const [t, prom] of peaksIn(nov, left - step * 0.5, chosen[0] - MIN_TRACK)) if (prom >= 0.25 && far(t)) chosen.push(t);
    } else if (!a && b && b.start_est != null && b.start_est >= MIN_TRACK * 0.75) {
      const lo = Math.floor((b.start_est - 6) / NOV_BIN), hi = Math.max(lo + 1, Math.floor((right + step * 0.5) / NOV_BIN));
      chosen = [argmaxT(lo, hi)];
      for (const [t, prom] of peaksIn(nov, MIN_TRACK, chosen[0] - MIN_TRACK)) if (prom >= 0.25 && far(t)) chosen.push(t);
    } else if (!a && b && b.start_est != null) {
      // the first ID was playing from (nearly) the start
    } else if (span >= MIN_TRACK + step) {
      for (const [t, prom] of peaksIn(nov, left, right)) {
        if ((!a && t < MIN_TRACK) || (!b && duration - t < MIN_TRACK)) continue;
        if ((b && right - t < 6) || (a && t - left < 6)) continue;
        if (prom >= 0.22 && far(t)) chosen.push(t);
      }
    }
    chosen.sort((x, y) => x - y);
    if (a) order.push(a);
    let nUnknown = a && b ? chosen.length - 1 : chosen.length;
    if (!a && !b) nUnknown = chosen.length + 1;
    for (let k = 0; k < nUnknown; k++) order.push(null);
    boundaries = boundaries.concat(chosen);
  }
  const edges = [0, ...boundaries.sort((x, y) => x - y), duration];
  return order.map((run, k) => ({ s: edges[k], e: edges[k + 1], run }));
}

/* ---------------------------------------------------------------- where the music is */
export function musicSpan(rmsDb, duration, win = 10, gap = 0.2) {
  const n = Math.floor(duration / win);
  if (n < 12) return [0, duration];
  const step = win * FPS;
  const w = Array.from({ length: n }, (_, i) => median(rmsDb.subarray(i * step, (i + 1) * step)));
  const thr = percentile(w, 90) - 20;
  const active = w.map((v) => v > thr);
  const frac = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += active[i]; return s / Math.max(1, b - a); };
  const k = Math.floor(120 / win);
  let end = duration, start = 0;
  for (let i = 0; i < n - k; i++) if (frac(i, i + k) <= 0.2 && frac(i, n) < gap) { end = i * win; break; }
  for (let i = n - 1; i > k; i--) if (frac(i - k, i) <= 0.2 && frac(0, i) < gap) { start = i * win; break; }
  if (end - start < 120) return [0, duration];
  return [start, Math.min(duration, end + win)];
}

/* ---------------------------------------------------------------- helpers */
function sliceIdx(t, a, b) { const out = []; for (let i = 0; i < t.length; i++) if (t[i] >= a && t[i] <= b) out.push(i); return out; }
const pick = (arr, idx) => idx.map((i) => arr[i]);
function longestRun(mask) { let best = 0, cur = 0; for (const v of mask) { cur = v ? cur + 1 : 0; best = Math.max(best, cur); } return best; }

/* ---------------------------------------------------------------- the whole thing */
export function build(F, classes) {
  const Drec = F.duration, [s0, D] = F.span;
  const nov = novelty(F.embT, F.emb, 1280, Drec);
  const step = F.probeStep || 24;
  const probes = (F.probes || []).filter((p) => s0 - p.dur <= p.t && p.t < D);
  const stubs = segment(D, probes, nov.subarray(0, Math.ceil(D / NOV_BIN)), step);
  if (stubs[0].e > s0 + MIN_TRACK) stubs[0].s = Math.max(stubs[0].s, s0);

  const B = F.bands, nfr = B.rms.length;
  const bt = Float64Array.from({ length: nfr }, (_, i) => i / FPS);
  const low1 = smooth(B.low, FPS), rms1 = smooth(B.rms, FPS), low2 = smooth(B.low, FPS * 2);

  const sec = Float64Array.from({ length: Math.floor(Drec) }, (_, i) => i);
  const loud = interp(sec, bt, smooth(norm01(B.rms), FPS * 4));
  const bright = interp(sec, bt, smooth(norm01(B.high), FPS * 4));
  const party = interp(sec, F.embT, smooth(F.heads.mood_party, 10));
  const aggr = interp(sec, F.embT, smooth(F.heads.mood_aggressive, 10));
  const energy = smooth(sec.map((_, i) => 0.5 * loud[i] + 0.2 * bright[i] + 0.15 * party[i] + 0.15 * aggr[i]), 8);
  const inSet = energy.subarray(Math.floor(s0), Math.floor(D));
  const eLo = percentile(inSet, 2), eHi = percentile(inSet, 99.5);

  const { bpmT, bpm } = F;
  const nAct = F.embT.length;

  function metrics(s, e) {
    const [a, b] = e - s > 40 ? [s + 8, e - 8] : [s, e];
    const bi = sliceIdx(bpmT, a, b).filter((i) => Number.isFinite(bpm[i]));
    const tb = bi.length ? median(pick(bpm, bi)) : null;
    const votes = {};
    for (const [t, k, sc, st] of F.keys) if (t >= a && t <= b) {
      const c = M.camelot(k, sc);
      votes[c] = votes[c] || [0, k, sc];
      votes[c][0] += st;
    }
    let key = null;
    const vs = Object.entries(votes);
    if (vs.length) {
      const [cam, [w, k, sc]] = vs.sort((p, q) => q[1][0] - p[1][0])[0];
      key = { camelot: cam, name: M.keyName(k, sc), confidence: r2(w / vs.reduce((x, [, v]) => x + v[0], 0)) };
    }
    let me = sliceIdx(F.embT, a, b);
    const acts = new Float64Array(400);
    const use = me.length ? me : [...Array(nAct).keys()];
    for (const p of use) for (let j = 0; j < 400; j++) acts[j] += F.acts[p * 400 + j] / use.length;
    const moods = {};
    for (const [k, v] of Object.entries(F.heads)) moods[k] = me.length ? r3(mean(pick(v, me))) : null;
    const es = energy.subarray(Math.floor(a), Math.max(Math.floor(a) + 1, Math.floor(b)));
    const lvl = Math.min(1, Math.max(0, (mean(es) - eLo) / (eHi - eLo + 1e-9)));
    const spark = interp(Float64Array.from({ length: 48 }, (_, i) => s + ((e - s) * i) / 47), sec, energy);
    return {
      bpm: tb ? r1(tb) : null, key, styles: M.fuseStyles(acts, classes, tb), moods,
      energy: r1(1 + 9 * lvl), loudness_db: r1(mean(pick(rms1, sliceIdx(bt, a, b)))),
      spark: Array.from(spark, (v) => r3((v - eLo) / (eHi - eLo + 1e-9))),
    };
  }

  const tracks = stubs.map((st, i) => {
    const run = st.run, meta = run ? run.meta : null;
    const nIn = probes.filter((p) => st.s <= p.t + p.dur / 2 && p.t + p.dur / 2 <= st.e).length;
    const nHit = run ? run.probes.length : 0;
    return {
      n: i + 1, start: r2(st.s), end: r2(st.e),
      title: meta ? meta.title : null, artist: meta ? meta.artist : null,
      identified: !!meta, meta,
      id_confidence: meta ? r2(nHit / Math.max(1, nIn)) : 0, shazam_hits: nHit,
      start_est: run && run.start_est != null ? r1(run.start_est) : null,
      played_linear: run ? run.linear : null,
      ...metrics(st.s, st.e),
    };
  });

  const transitions = [];
  for (let i = 0; i < tracks.length - 1; i++) {
    const A = tracks[i], Bt = tracks[i + 1], swap = Bt.start, pv = novAt(nov, swap);
    const loLim = A.start + 5, hiLim = Bt.end - 5;
    let t = swap;
    while (t - NOV_BIN > loLim && novAt(nov, t - NOV_BIN) > 0.5 * pv && swap - t < 48) t -= NOV_BIN;
    let mixIn = t;
    t = swap;
    while (t + NOV_BIN < hiLim && novAt(nov, t + NOV_BIN) > 0.5 * pv && t - swap < 48) t += NOV_BIN;
    let mixOut = t;
    if (Bt.start_est != null && swap - 150 <= Bt.start_est && Bt.start_est <= swap) mixIn = Math.max(loLim, Bt.start_est);
    mixIn = Math.min(mixIn, swap - 1); mixOut = Math.max(mixOut, swap + 1);
    const dur = mixOut - mixIn;
    const bs = [A.bpm, Bt.bpm].filter(Boolean), bb = bs.length ? mean(bs) : null;
    const bars = bb ? (dur * bb) / 240 : null;

    const lp = pick(low2, sliceIdx(bt, swap - 24, swap - 8)), la = pick(low2, sliceIdx(bt, swap - 6, swap + 6)), lq = pick(low2, sliceIdx(bt, swap + 8, swap + 24));
    const preLow = lp.length ? median(lp) : median(low2);
    const postLow = lq.length ? median(lq) : preLow;
    const lowMin = la.length ? Math.min(...la) : preLow;
    const lowDip = Math.min(preLow, postLow) - lowMin;
    const quietS = longestRun(pick(low2, sliceIdx(bt, swap - 16, swap + 16)).map((v) => v < Math.min(preLow, postLow) - 10)) / FPS;
    const preRms = median(pick(rms1, sliceIdx(bt, swap - 24, swap - 8)));
    const postRms = median(pick(rms1, sliceIdx(bt, swap + 8, swap + 24)));
    const peakRms = percentile(pick(rms1, sliceIdx(bt, swap - 4, swap + 8)), 90);
    let kind;
    if (dur < 8) kind = "Cut";
    else if (postLow < preLow - 12) kind = "Into breakdown";
    else if (preLow < postLow - 12) kind = "Drop swap";
    else if (quietS >= 6) kind = "Breakdown drop";
    else if (lowDip >= 8) kind = "Bass swap";
    else if (peakRms > Math.max(preRms, postRms) + 2.5) kind = "Double drop";
    else if (bars && bars >= 32) kind = "Long blend";
    else kind = "Blend";

    const kA = A.key ? A.key.camelot : null, kB = Bt.key ? Bt.key.camelot : null;
    const sa = Object.fromEntries(A.styles.map((s) => [s.style, s.p])), sb = Object.fromEntries(Bt.styles.map((s) => [s.style, s.p]));
    let overlap = 0;
    for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) overlap += Math.min(sa[k] || 0, sb[k] || 0);
    transitions.push({
      from: A.n, to: Bt.n, mix_in: r2(mixIn), swap: r2(swap), mix_out: r2(mixOut),
      duration: r1(dur), bars: bars ? Math.round(bars) : null, type: kind,
      bpm_from: A.bpm, bpm_to: Bt.bpm, bpm_delta: A.bpm && Bt.bpm ? r1(Bt.bpm - A.bpm) : null,
      key_from: kA, key_to: kB, harmonic: M.harmonicRelation(kA, kB),
      energy_delta: r1(Bt.energy - A.energy), loudness_delta_db: r1(postRms - preRms),
      low_dip_db: r1(lowDip), low_before_db: r1(preLow), low_after_db: r1(postLow),
      breakdown_s: r1(quietS), style_continuity: r2(overlap), sharpness: r2(pv),
    });
  }

  const drops = findDrops(low1).filter((d) => s0 < d.t && d.t < D);
  return { tracks, transitions, drops, nov, energy, eLo, eHi };
}

export function findDrops(low1) {
  const base = medianFilter(low1, FPS * 60), n = low1.length, drops = [];
  const quiet = Array.from(low1, (v, i) => v < base[i] - 8);
  const anyQuiet = (a, b) => { for (let k = a; k < b; k++) if (quiet[k]) return true; return false; };
  let i = 0;
  while (i < n) {
    if (quiet[i]) {
      let j = i;
      while (j < n && (quiet[j] || (j + FPS * 2 < n && anyQuiet(j, j + FPS * 2)))) j++;
      const length = (j - i) / FPS;
      if (length >= 6 && j < n - FPS * 2) {
        const back = Math.max(...low1.subarray(j, Math.min(n, j + FPS * 4)));
        const depth = mean(base.subarray(i, j)) - mean(low1.subarray(i, j));
        if (back > base[j] - 3) drops.push({
          t: r2(j / FPS), breakdown_start: r2(i / FPS), breakdown_s: r1(length), depth_db: r1(depth),
          impact_db: r1(back - mean(low1.subarray(Math.max(i, j - FPS), j))),
        });
      }
      i = j;
    }
    i++;
  }
  return drops;
}
