/* A set from a YouTube or SoundCloud link, through the Set Replay helper
   (web/helper/set-replay-helper.py, version 2+), which fetches the audio with
   yt-dlp on the visitor's own computer. A browser can't: neither site allows
   cross-site requests, and YouTube's streams need deciphering that only
   dedicated tools keep up with. The helper hands back an m4a (AAC) when it
   can, which every browser decodes, and the page analyzes it like a dropped
   file. Only single YouTube videos and SoundCloud tracks are accepted, here
   and again in the helper.

   parseLink(text)  → { url, service, label } or null
   fetchLink(url, { onProgress(stage, f), signal }) → { file, title, uploader, duration, service, url } */
import { HELPER_URL } from "./naming.js";

const HOSTS = /^(?:(?:www|m|music)\.)?youtube\.com$|^youtu\.be$|^(?:(?:www|m|on)\.)?soundcloud\.com$/i;

export function parseLink(text) {
  let s = String(text || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (!HOSTS.test(u.hostname)) return null;
  const sc = /soundcloud/i.test(u.hostname);
  if (!sc) {
    // a YouTube link must point at one video: watch?v=, youtu.be/<id>, /live/<id> or /shorts/<id>
    const id = u.hostname.toLowerCase() === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") || (u.pathname.match(/^\/(?:live|shorts|embed)\/([\w-]{6,})/) || [])[1];
    if (!id || !/^[\w-]{6,}$/.test(id)) return null;
  } else {
    // soundcloud.com/<artist>/<track> (or an on.soundcloud.com short link); not a set (playlist)
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.includes("sets") || parts.length < (u.hostname.toLowerCase().startsWith("on.") ? 1 : 2)) return null;
  }
  return { url: u.href, service: sc ? "soundcloud" : "youtube", label: sc ? "SoundCloud" : "YouTube" };
}

/** Does the running helper fetch links? Version 2 says so on /health, but YouTube now needs
 *  the JavaScript runtime version 3 brings (without it, downloads fail with 403): ask for 3. */
export const canFetch = (health) => !!(health && health.fetch && (health.version || 0) >= 3);

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener("abort", () => { clearTimeout(t); rej(Object.assign(new Error("Stopped"), { name: "AbortError" })); }, { once: true });
});

export async function fetchLink(url, { onProgress = () => {}, signal } = {}) {
  const r = await fetch(`${HELPER_URL}/fetch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal });
  let job = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(job.error || "The helper couldn't start the download.");
  const cancel = () => fetch(`${HELPER_URL}/fetch/${job.id}/cancel`, { method: "POST" }).catch(() => {});
  try {
    while (job.state !== "ready") {
      if (job.state === "error") throw new Error(job.error || "The download failed.");
      onProgress(job.state === "downloading" ? `Fetching${job.title ? ` “${job.title}”` : ""}` : "Looking up the link", job.pct || 0, job);
      await sleep(700, signal);
      const s = await fetch(`${HELPER_URL}/fetch/${job.id}`, { cache: "no-store", signal });
      job = await s.json();
      if (!s.ok) throw new Error(job.error || "The helper lost the download.");
    }
    onProgress("Handing the audio to the page", 1, job);
    const a = await fetch(`${HELPER_URL}/fetch/${job.id}/audio`, { signal });
    if (!a.ok) throw new Error("The helper couldn't hand over the audio.");
    const blob = await a.blob();
    const base = String(job.title || "set").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "set";
    const file = new File([blob], `${base}.${job.ext || "m4a"}`, { type: blob.type || "audio/mp4" });
    return { file, title: job.title, uploader: job.uploader, duration: job.duration, service: job.service, url };
  } catch (e) {
    if (e && e.name === "AbortError") cancel();
    throw e;
  }
}
