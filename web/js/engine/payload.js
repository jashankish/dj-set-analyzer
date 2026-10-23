/* Merged features → the set JSON the viewer reads (port of
   analyzer/analyze.py build_payload). Environment-neutral: runs in the
   browser and in Node (for checking against the Python pipeline). */
import * as M from "./music.js";
import * as SL from "./setlist.js";
import { percentile, median, mean, smooth, medianFilter, interp } from "./dsp.js";

const FPS = SL.FPS;
const q = (arr, n = 2) => Array.from(arr, (v) => (Number.isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : null));

function resolveBeats(beats, bpmT, bpm) {
  const out = [];
  for (let i = 0; i < beats.length - 1; i++) {
    const a = beats[i], b = beats[i + 1];
    out.push(a);
    const tb = interp([(a + b) / 2], bpmT, bpm)[0];
    const ratio = (tb * (b - a)) / 60;
    if (ratio > 1.7 && ratio < 2.3) out.push((a + b) / 2);
  }
  if (beats.length) out.push(beats[beats.length - 1]);
  return out;
}

function waveCurve(x, span) {
  const a = Math.floor(span[0] * FPS), b = Math.floor(span[1] * FPS), seg = x.subarray(a, b);
  const lo = percentile(seg, 5), hi = percentile(seg, 99.7);
  return Array.from(x, (v) => Math.round(Math.min(1, Math.max(0, (v - lo) / (hi - lo + 1e-9))) ** 1.4 * 99));
}

/**
 * @param F       merged features: {duration, bands{low,mid,high,rms}, beats, bpmT, bpmRaw,
 *                keys[[t,key,scale,strength]], embT, acts(n*400), emb(n*1280), heads{}}
 * @param classes the 400 Discogs style labels
 * @param meta    {slug, title, file, probes?, bpmRange?, source}
 */
export function buildPayload(F, classes, meta) {
  const D = F.duration;
  const span = SL.musicSpan(F.bands.rms, D);
  const nAct = F.embT.length;
  const actsAround = (t) => {
    const out = new Float64Array(400);
    let n = 0;
    for (let p = 0; p < nAct; p++) if (F.embT[p] >= t - 10 && F.embT[p] <= t + 10) { n++; for (let j = 0; j < 400; j++) out[j] += F.acts[p * 400 + j]; }
    if (!n) { for (let p = 0; p < nAct; p++) for (let j = 0; j < 400; j++) out[j] += F.acts[p * 400 + j]; n = nAct; }
    return out.map((v) => v / Math.max(1, n));
  };

  // tempo: octave-resolved, then lightly smoothed
  let bpm;
  if (meta.bpmRange) {
    const [lo, hi] = meta.bpmRange;
    bpm = F.bpmRaw.map((b) => { for (let k = 0; k < 3; k++) { if (b < lo) b *= 2; if (b >= hi) b /= 2; } return b; });
  } else {
    bpm = M.resolveOctaves(Array.from(F.bpmRaw), F.bpmT.map((t) => actsAround(t)), classes);
  }
  // smooth tempo misreadings within the set (its start and end count as edges)
  const inside = F.bpmT.map((t, i) => (t >= span[0] && t <= span[1] ? i : -1)).filter((i) => i >= 0);
  if (inside.length) {
    const fixed = M.fillTempoBlips(inside.map((i) => bpm[i]));
    inside.forEach((i, k) => { bpm[i] = fixed[k]; });
  }
  const fin = bpm.filter(Number.isFinite), fill = fin.length ? median(fin) : 120;
  const bpmS = medianFilter(Float64Array.from(bpm, (v) => (Number.isFinite(v) ? v : fill)), 5);

  const built = SL.build({
    duration: D, span, probes: meta.probes || [], probeStep: 24,
    embT: F.embT, emb: F.emb, acts: F.acts, heads: F.heads, bands: F.bands,
    bpmT: F.bpmT, bpm: bpmS, keys: F.keys,
  }, classes);
  const { tracks, transitions, drops, nov, energy, eLo, eHi } = built;
  const beats = resolveBeats(F.beats, F.bpmT, bpmS);

  // style stream: tempo-aware style mix per 30 s for the set's top styles
  const step = 30, grid = [];
  for (let g = 0; g < D; g += step) grid.push(g);
  const rows = grid.map((g) => {
    const acc = new Float64Array(400);
    let n = 0;
    for (let p = 0; p < nAct; p++) if (F.embT[p] >= g && F.embT[p] <= g + step) { n++; for (let j = 0; j < 400; j++) acc[j] += F.acts[p * 400 + j]; }
    const acts = n ? acc.map((v) => v / n) : actsAround(g);
    const b = interp([g + step / 2], F.bpmT, bpmS)[0];
    const p = Array.from(acts, (v, j) => v * M.tempoLikelihood(classes[j], b));
    const s = p.reduce((x, y) => x + y, 0) + 1e-9;
    return p.map((v) => v / s);
  });
  const total = new Float64Array(400);
  rows.forEach((r) => r.forEach((v, j) => (total[j] += v / rows.length)));
  const top = [...total.keys()].sort((a, b) => total[b] - total[a]).slice(0, 6);
  const styleV = rows.map((r) => { const v = top.map((j) => Math.round(r[j] * 1e4) / 1e4); return [...v, Math.round((1 - top.reduce((s, j) => s + r[j], 0)) * 1e4) / 1e4]; });

  const moodGrid = [];
  for (let t = 0; t < D; t += 10) moodGrid.push(t);
  const moods = Object.fromEntries(Object.entries(F.heads).map(([k, v]) => [k, q(interp(moodGrid, F.embT, smooth(v, 8)), 3)]));

  // summary
  const durs = tracks.map((t) => t.end - t.start), tb = tracks.map((t) => t.bpm);
  const ok = tb.map((b) => b != null);
  const okDur = durs.filter((_, i) => ok[i]).reduce((a, b) => a + b, 0);
  const known = transitions.filter((x) => x.harmonic.compatible !== null);
  const harm = known.filter((x) => x.harmonic.compatible === true);
  const types = {};
  transitions.forEach((x) => (types[x.type] = (types[x.type] || 0) + 1));
  const mass = {};
  tracks.forEach((t) => t.styles.forEach((s) => (mass[s.style] = (mass[s.style] || 0) + s.p * (t.end - t.start))));
  const tot = Object.values(mass).reduce((a, b) => a + b, 0) || 1;
  const e60 = smooth(energy, 60);
  let peak = Math.floor(span[0]);
  for (let i = Math.floor(span[0]); i < Math.min(e60.length, Math.floor(span[1])); i++) if (e60[i] > e60[peak]) peak = i;
  const voiceIdx = [];
  for (let p = 0; p < nAct; p++) if (F.embT[p] >= span[0] && F.embT[p] <= span[1]) voiceIdx.push(p);
  const longest = transitions.length ? transitions.reduce((a, b) => (b.duration > a.duration ? b : a)) : null;
  const okB = tb.filter((b) => b != null);
  const summary = {
    tracks: tracks.length,
    identified: tracks.filter((t) => t.identified).length,
    avg_track_s: durs.length ? Math.round(mean(durs) * 10) / 10 : null,
    bpm_avg: okB.length ? Math.round((tb.reduce((s, b, i) => s + (ok[i] ? b * durs[i] : 0), 0) / okDur) * 10) / 10 : null,
    bpm_min: okB.length ? Math.min(...okB) : null,
    bpm_max: okB.length ? Math.max(...okB) : null,
    tempo_method: meta.bpmRange ? "range" : "style-viterbi",
    transitions: transitions.length,
    avg_transition_s: transitions.length ? Math.round(mean(transitions.map((x) => x.duration)) * 10) / 10 : null,
    avg_transition_bars: transitions.some((x) => x.bars) ? Math.round(mean(transitions.filter((x) => x.bars).map((x) => x.bars)) * 10) / 10 : null,
    transition_types: types,
    harmonic_pct: known.length ? Math.round((100 * harm.length) / known.length) : null,
    longest_blend: longest ? { from: longest.from, to: longest.to, duration: longest.duration } : null,
    drops: drops.length,
    peak_t: peak,
    set_start: Math.round(span[0] * 10) / 10, set_end: Math.round(span[1] * 10) / 10,
    set_length: Math.round((span[1] - span[0]) * 10) / 10,
    vocal_pct: voiceIdx.length ? Math.round((100 * voiceIdx.filter((p) => F.heads.voice_instrumental[p] > 0.5).length) / voiceIdx.length) : 0,
    styles: Object.entries(mass).map(([style, v]) => ({ style, share: Math.round((v / tot) * 1000) / 1000 })).sort((a, b) => b.share - a.share).slice(0, 8),
  };

  return {
    version: 1,
    source: meta.source || "browser",
    slug: meta.slug, title: meta.title, file: meta.file,
    duration: Math.round(D * 100) / 100,
    analyzed_at: new Date().toISOString(),
    summary, tracks, transitions, drops,
    beats: q(beats, 3),
    curves: {
      wave_fps: FPS,
      wave: { low: waveCurve(F.bands.low, span), mid: waveCurve(F.bands.mid, span), high: waveCurve(F.bands.high, span) },
      energy: { step: 1, v: q(Array.from(energy, (v) => Math.min(1.1, Math.max(0, (v - eLo) / (eHi - eLo + 1e-9)))), 3) },
      bpm: { t: q(F.bpmT, 1), v: q(bpmS, 1), raw: q(F.bpmRaw, 1) },
      novelty: { step: SL.NOV_BIN, v: q(nov, 3) },
      moods: { step: 10, v: moods },
      styles: { step, names: [...top.map((j) => classes[j].split("---").pop()), "Other"], v: styleV },
      keys: { t: q(F.keys.map((k) => k[0]), 1), v: F.keys.map((k) => M.camelot(k[1], k[2])), strength: F.keys.map((k) => Math.round(k[3] * 100) / 100) },
    },
    probes: (meta.probes || []).map((p) => ({ t: p.t, dur: p.dur, id: p.track ? p.track.id : null, ...(p.offset != null ? { offset: p.offset } : {}) })),
    // each song a probe matched, once: enough to rebuild the probes and carry on naming later
    probe_tracks: Object.fromEntries((meta.probes || []).filter((p) => p.track && p.track.id != null).map((p) => [String(p.track.id), p.track])),
    credits: {
      beats_key_tempo: "Essentia.js (RhythmExtractor2013, PercivalBpmEstimator, KeyExtractor/edma), in your browser",
      styles_moods: "Discogs-EffNet + classification heads (MTG, UPF), via ONNX Runtime Web, in your browser",
      identification: (meta.probes || []).some((p) => p.track) ? "Shazam" : "none — name tracks yourself",
    },
  };
}
