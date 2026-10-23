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

/* when a lookup fails (Shazam rate-limiting, a timeout, the network), wait and ask again
   for the same clip, longer each time; only after all of these (about 4 minutes of
   refusals in a row) does naming stop, and it says where, so it can be resumed */
export const RETRY_WAITS = [5, 15, 30, 60, 120];
export const SECONDS_PER_CLIP = 3.2;          // measured: a lookup plus the helper's pacing

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const pause = (s, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, s * 1000);
  if (signal) signal.addEventListener("abort", () => { clearTimeout(t); rej(Object.assign(new Error("Analysis stopped"), { name: "AbortError" })); }, { once: true });
});

/** The clip times naming asks about for a recording of `duration` s with music in [lo, hi]. */
export function probeTimes(duration, [lo, hi]) {
  const times = [];
  for (let t = 4; t <= duration - PROBE_CLIP; t += PROBE_STEP) if (t >= lo - PROBE_CLIP && t <= hi) times.push(Math.round(t * 100) / 100);
  return times;
}

/**
 * Probe the set for track names.
 * @param y      mono Float32Array at engine SR
 * @param span   [start, end] of the music (setlist.musicSpan)
 * @param known  probes already asked (resuming): their times are skipped and they're kept
 * @param wait   (s, signal) => Promise: how to wait between retries (tests pass a fast one)
 * @returns { probes: [{t, dur, track, offset}], stopped: string|null, stoppedAt: number|null }
 *   onProgress(done, total, matched, { waiting, retry }) reports each clip, and each wait
 */
export async function identifyClips(y, span, { onProgress = () => {}, signal, known = [], wait = pause } = {}) {
  const duration = y.length / SR, all = probeTimes(duration, span);
  const done = new Set(known.map((p) => Math.round(p.t)));
  const todo = all.filter((t) => !done.has(Math.round(t)));
  const probes = [...known];
  const matched = () => probes.filter((p) => p.track).length;
  const base = all.length - todo.length;
  let stopped = null, stoppedAt = null;
  for (let i = 0; i < todo.length; i++) {
    if (signal && signal.aborted) throw Object.assign(new Error("Analysis stopped"), { name: "AbortError" });
    const t = todo[i];
    onProgress(base + i, all.length, matched(), {});
    const clip = y.subarray(Math.round(t * SR), Math.round((t + PROBE_CLIP) * SR));
    let res = null, unreachable = false;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(`${HELPER_URL}/identify`, { method: "POST", body: wav(clip, SR), signal });
        if (r.ok) res = await r.json();
        unreachable = false;
      } catch (e) {
        if (e && e.name === "AbortError") throw e;
        unreachable = true;                   // the helper itself didn't answer
      }
      if (res || attempt >= RETRY_WAITS.length) break;
      onProgress(base + i, all.length, matched(), { waiting: RETRY_WAITS[attempt], retry: attempt + 1, unreachable });
      await wait(RETRY_WAITS[attempt], signal);
    }
    if (!res) {
      stoppedAt = t;
      stopped = unreachable
        ? `The naming helper stopped answering at ${clock(t)}, so tracks after that are still IDs. Start the helper again and press “Name the remaining IDs” to carry on from there.`
        : `Shazam stopped answering at ${clock(t)} (it was still refusing after about 4 minutes of retries), so tracks after that are still IDs. Press “Name the remaining IDs” later to carry on from there.`;
      break;
    }
    probes.push({ t, dur: PROBE_CLIP, track: res.track, offset: res.offset });
  }
  probes.sort((a, b) => a.t - b.t);
  onProgress(stopped ? all.indexOf(stoppedAt) : all.length, all.length, matched(), {});
  return { probes, stopped, stoppedAt };
}

/** A saved set's probes, ready to resume naming: each matched one gets its song back (from
 *  payload.probe_tracks, or for sets saved before that existed, from the named track with the
 *  same Shazam id). A match whose song can't be found is left out, so it's asked again;
 *  clips that matched nothing stay as they are. */
export function restoreProbes(payload) {
  const songs = { ...(payload.probe_tracks || {}) };
  for (const t of payload.tracks || []) if (t.meta && t.meta.id != null && !songs[String(t.meta.id)]) songs[String(t.meta.id)] = t.meta;
  return (payload.probes || [])
    .filter((p) => p.id == null || songs[String(p.id)])
    .map((p) => ({ t: p.t, dur: p.dur, track: p.id == null ? null : songs[String(p.id)], offset: p.offset != null ? p.offset : null }));
}
