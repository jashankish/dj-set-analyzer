/* Optional track naming through the Set Replay naming helper
   (web/helper/set-replay-helper.py), a tiny program the visitor runs on their
   own computer. Browsers can't call Shazam directly (no CORS), so the page
   sends short clips to the helper on 127.0.0.1, which fingerprints each one
   and asks Shazam. The recording never leaves the visitor's machine.

   Probing mirrors analyzer/identify.py: a 12 s clip every 24 s inside the
   music span, stopping after 3 failures in a row (Shazam rate-limiting). */
import "../prefs.js";          // migrates old storage keys before any are read
import { SR } from "./config.js";   // not extract.js: keeps pages that only show the pop-up light

/* Default helper address; a site can set window.SET_REPLAY_HELPER_URL, and a
   visitor running the helper on another port (--port) can store theirs in
   localStorage["set-replay:helper-url"]. */
export const HELPER_URL = (() => {
  const fallback = "http://127.0.0.1:8789";
  try {
    if (typeof window === "undefined") return fallback;
    return (window.SET_REPLAY_HELPER_URL || localStorage.getItem("set-replay:helper-url") || fallback).replace(/\/$/, "");
  } catch (e) {
    return fallback;
  }
})();
export const PROBE_STEP = 24, PROBE_CLIP = 12;

/* Pages only look for the helper once the visitor has shown interest (opened
   the naming pop-up, or connected before). Otherwise every visitor's browser
   would contact their own computer on each page load, which logs errors and,
   with Chrome's local-network-access prompts, could ask strangers for
   permission they have no reason to give. */
const INTEREST = "set-replay:naming-helper";
export function helperWanted() { try { return localStorage.getItem(INTEREST) === "1"; } catch (e) { return false; } }
export function markHelperWanted() { try { localStorage.setItem(INTEREST, "1"); } catch (e) { /* private mode */ } }

/** Is the helper running? Resolves to its /health info or null. */
export async function helperStatus(timeoutMs = 900) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(`${HELPER_URL}/health`, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.name === "set-replay-helper" ? j : null;
  } catch (e) {
    return null;
  }
}

/* 16-bit PCM WAV — the helper hands these bytes straight to shazamio */
function wav(samples, sr) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return new Blob([buf], { type: "audio/wav" });
}

/**
 * Probe the set for track names.
 * @param y      mono Float32Array at engine SR
 * @param span   [start, end] of the music (setlist.musicSpan)
 * @returns { probes: [{t, dur, track, offset}], stopped: string|null }
 */
export async function identifyClips(y, [lo, hi], { onProgress = () => {}, signal } = {}) {
  const duration = y.length / SR, times = [];
  for (let t = 4; t <= duration - PROBE_CLIP; t += PROBE_STEP) if (t >= lo - PROBE_CLIP && t <= hi) times.push(Math.round(t * 100) / 100);
  const probes = [];
  let failures = 0, stopped = null;
  for (let i = 0; i < times.length; i++) {
    if (signal && signal.aborted) throw Object.assign(new Error("Analysis stopped"), { name: "AbortError" });
    const t = times[i];
    onProgress(i, times.length, probes.filter((p) => p.track).length);
    const clip = y.subarray(Math.round(t * SR), Math.round((t + PROBE_CLIP) * SR));
    let res = null;
    try {
      const r = await fetch(`${HELPER_URL}/identify`, { method: "POST", body: wav(clip, SR), signal });
      if (r.ok) res = await r.json();
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
    }
    if (!res) {
      if (++failures >= 3) { stopped = "Shazam stopped answering (probably rate-limiting), so some tracks are still IDs. Try naming them again later."; break; }
      continue;
    }
    failures = 0;
    probes.push({ t, dur: PROBE_CLIP, track: res.track, offset: res.offset });
  }
  onProgress(times.length, times.length, probes.filter((p) => p.track).length);
  return { probes, stopped };
}
