/* ============================================================
   Set Replay — play a set from its YouTube video, for sets that have the
   link but not the recording (the bundled demo, or an imported analysis).

   youTubeMedia(videoId, onEvent) returns an object that behaves like the
   parts of an <audio> element the page uses: currentTime (get and set),
   paused, duration, playbackRate, play(), pause(); and it reports "play",
   "pause", "seeked", "ended" and "loadedmetadata" through onEvent. Behind
   it is YouTube's own embedded player (IFrame Player API, privacy-enhanced
   youtube-nocookie.com), loaded only when the visitor first presses play,
   and shown, as YouTube's terms require, as a small docked video above the
   transport bar. The analysis came from the same video's audio, so their
   clocks match. YouTube's audio can't be read by the page, so the live
   spectrum stays idle. Some owners (often record labels) don't allow their
   videos in other sites' players (YouTube errors 101 and 150): then the
   dock closes and onEvent("blocked") lets the page offer the video on
   YouTube itself, at the same moment.
   ============================================================ */
const API = "https://www.youtube.com/iframe_api";
let apiReady = null;
function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(window.YT); };
    const s = Object.assign(document.createElement("script"), { src: API, async: true });
    s.onerror = () => { apiReady = null; rej(new Error("YouTube's player couldn't load (blocked, or offline).")); };
    document.head.appendChild(s);
  });
  return apiReady;
}

/** The video id in a YouTube link, or null. */
export function youTubeId(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split("/")[0] || null;
    if (!/(^|\.)youtube(-nocookie)?\.com$/i.test(u.hostname)) return null;
    return u.searchParams.get("v") || (u.pathname.match(/^\/(?:live|shorts|embed)\/([\w-]{6,})/) || [])[1] || null;
  } catch (e) { return null; }
}

let made = 0;
export function youTubeMedia(videoId, onEvent, { title = "" } = {}) {
  const host = `ytPlayerHost${++made}`;            // one per player: switching sets makes a new one
  let player = null, ready = null, state = -1, pending = null, rate = 1, t0 = 0, dock = null, blocked = false;
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  function build() {
    if (ready) return ready;
    dock = document.createElement("div");
    dock.className = "yt-dock";
    dock.innerHTML = `<div class="yt-head"><span>Playing from YouTube${title ? ` · <b></b>` : ""}</span><button type="button" class="yt-x" aria-label="Stop and close the YouTube player">✕</button></div><div class="yt-frame"><div id="${host}"></div></div>`;
    if (title) dock.querySelector("b").textContent = title;
    document.body.appendChild(dock);
    dock.querySelector(".yt-x").addEventListener("click", () => { api.pause(); dock.hidden = true; });
    ready = loadApi().then((YT) => new Promise((res) => {
      player = new YT.Player(host, {
        host: "https://www.youtube-nocookie.com", videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(t0) },
        events: {
          onReady: () => { player.setPlaybackRate(rate); if (t0) player.seekTo(t0, true); onEvent("loadedmetadata"); res(player); },
          onError: (e) => {
            if (e.data === 101 || e.data === 150 || e.data === 100) { blocked = true; dock.hidden = true; onEvent("blocked"); res(null); }
          },
          onStateChange: (e) => {
            state = e.data;
            if (state === YT.PlayerState.PLAYING) onEvent("play");
            else if (state === YT.PlayerState.PAUSED) onEvent("pause");
            else if (state === YT.PlayerState.ENDED) onEvent("ended");
          },
        },
      });
    }));
    return ready;
  }

  const api = {
    youtube: true,
    get currentTime() { return player && player.getCurrentTime ? player.getCurrentTime() : t0; },
    set currentTime(t) { t0 = t; if (player && player.seekTo) { player.seekTo(t, true); onEvent("seeked"); } },
    get paused() { return !player || state !== 1; },
    get duration() { return player && player.getDuration ? player.getDuration() : NaN; },
    get playbackRate() { return rate; },
    set playbackRate(r) { rate = RATES.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a)); if (player && player.setPlaybackRate) player.setPlaybackRate(rate); },
    play() {
      if (blocked) { onEvent("blocked"); return Promise.resolve(); }
      if (dock) dock.hidden = false;
      pending = build().then((p) => { if (p) p.playVideo(); });
      return pending;
    },
    get blocked() { return blocked; },
    /** the video on YouTube itself, at a moment */
    watchUrl(t) { return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(t))}s`; },
    pause() { if (player && player.pauseVideo) player.pauseVideo(); },
    get started() { return !!ready; },
  };
  return api;
}
