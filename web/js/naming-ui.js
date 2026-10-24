/* "Want these IDs named?" — the pop-up that explains the naming helper and
   watches for it to come online. Shared by the landing page and the viewer. */
import { helperStatus, HELPER_URL, markHelperWanted } from "./engine/naming.js";
import { canFetch } from "./engine/fetchlink.js";
import { progressBar } from "./progress.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isWin = /Win/i.test(navigator.platform || navigator.userAgent);
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
// served from a real site (not localhost), browsers ask before a page may reach the helper on this computer
const isPublic = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/**
 * @param opts.mode     "landing" | "viewer" | "link" (fetching a YouTube / SoundCloud link)
 * @param opts.resumeAt viewer: where an earlier naming run stopped ("52:52"), to carry on from there
 * @param opts.onReady  link mode: called when a helper that fetches links is connected and the visitor goes on
 * @param opts.ids      number of unnamed tracks (viewer)
 * @param opts.onNameNow async (progress) => void — viewer: re-run the analysis with names
 * @returns the <dialog>
 */
export function openNamingDialog({ mode = "landing", ids = 0, onNameNow, onReady, resumeAt = null } = {}) {
  const link = mode === "link";
  document.getElementById("namingDialog")?.remove();
  markHelperWanted();   // from now on, pages in this browser may look for the helper
  const helperHref = new URL("helper/set-replay-helper.py", document.baseURI).href;
  const cmd = isWin ? "cd $HOME\\Downloads; py set-replay-helper.py" : "cd ~/Downloads && python3 set-replay-helper.py";
  const d = document.createElement("dialog");
  d.id = "namingDialog";
  d.className = "nm";
  d.innerHTML = `
    <form method="dialog" class="nm-close"><button aria-label="Close">✕</button></form>
    <h2 class="nm-title">${link ? "Fetch sets from YouTube and SoundCloud" : mode === "viewer" && ids ? `Want these ${ids} ID${ids === 1 ? "" : "s"} named?` : "Want your tracks named instead of “ID”?"}</h2>
    <p class="nm-lead">${link
      ? "Browsers can't download audio from YouTube or SoundCloud, but a tiny helper on this computer can (with the open-source yt-dlp). Set it up once; links you paste are fetched on this computer and analyzed here like a dropped file. The same helper can also name your tracks with Shazam. Only fetch what you have the right to download."
      : "Your browser can't ask Shazam on its own, but a tiny helper on this computer can. Set it up once and Set Replay will send it short clips of the set; it asks Shazam what's playing. Your recording stays on this computer."}</p>
    <ol class="nm-steps">
      <li>
        <b>Download the helper</b>
        <a class="solid" href="${esc(helperHref)}" download="set-replay-helper.py">Download set-replay-helper.py</a>
        <span class="nm-small">${link ? "One small Python file. It only talks to this page, to Shazam, and to YouTube or SoundCloud for the links you paste." : "One small Python file. It only talks to this page and to Shazam."}</span>
      </li>
      <li>
        <b>Run it</b>
        <span class="nm-small">Open ${isWin ? "PowerShell" : "Terminal"} and paste:</span>
        <div class="nm-cmd"><code>${esc(cmd)}</code><button class="ghost" type="button" data-copy="${esc(cmd)}">Copy</button></div>
        <span class="nm-small">The first run sets itself up (about a minute). It needs Python 3.9–3.13 — <a href="https://www.python.org/downloads/" target="_blank" rel="noopener">get Python</a> if ${isWin ? "<code>py</code>" : "<code>python3</code>"} isn't found.</span>
      </li>
      <li>
        <b>Leave it running and come back here</b>
        <span class="nm-status" id="nmStatus"><i></i><span>Looking for the helper…</span></span>
        ${isPublic ? `<span class="nm-small">If your browser asks to let ${esc(location.hostname)} access devices on your local network, choose <b>Allow</b>; that's how this page reaches the helper. Clicked Block? Allow it again from the icon at the left of the address bar.</span>` : ""}
      </li>
    </ol>
    <div class="nm-actions" id="nmActions"></div>
    <p class="nm-foot">${isSafari ? "Safari may block pages from talking to programs on your computer; if it never connects, use Chrome, Edge or Firefox. " : ""}${link ? "Single videos and tracks up to six hours; no playlists or live streams." : "Lookups are paced gently; Shazam can still pause answering after a few hundred clips, so long sessions may leave a few IDs."} Stop the helper any time with Ctrl+C.</p>`;
  document.body.appendChild(d);
  d.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; } catch (e) { b.textContent = "Select and copy"; }
    setTimeout(() => (b.textContent = "Copy"), 1800);
  }));

  let connected = false, busy = false, old = false;
  const status = d.querySelector("#nmStatus"), actions = d.querySelector("#nmActions");
  const render = () => {
    status.classList.toggle("on", connected);
    status.querySelector("span").textContent = connected ? `Connected to the helper on ${HELPER_URL.replace("http://", "")}`
      : old ? "Connected, but this is an older helper that can't fetch from YouTube any more: download it again (step 1), stop the old one with Ctrl+C and run the new one."
      : "Not connected yet. Checking every few seconds…";
    if (busy) return;
    if (link) {
      actions.innerHTML = connected ? `<button class="solid big" id="nmFetch">Fetch it</button><span class="nm-small">Downloads on this computer, then it's ready to analyze.</span>` : "";
      d.querySelector("#nmFetch")?.addEventListener("click", () => { d.close(); if (onReady) onReady(); });
    } else if (mode === "viewer" && onNameNow) {
      actions.innerHTML = `<button class="solid big" id="nmGo" ${connected ? "" : "disabled"}>${resumeAt ? "Carry on naming" : "Name the tracks now"}</button><span class="nm-small" id="nmProgress">${connected ? resumeAt ? `Picks up where naming stopped (${resumeAt}); the lookups already made are kept.` : "Re-listens to this set with names; takes a few minutes." : ""}</span><div class="nm-prog" id="nmBar" hidden></div>`;
      d.querySelector("#nmGo").addEventListener("click", async () => {
        busy = true;
        const go = d.querySelector("#nmGo"), prog = d.querySelector("#nmProgress"), barBox = d.querySelector("#nmBar");
        const bar = progressBar();
        barBox.hidden = false; barBox.replaceChildren(bar.el); prog.textContent = "";
        go.disabled = true; go.textContent = "Naming…";
        try {
          await onNameNow((stage, f) => bar.update(stage, f));
        } catch (e) {
          busy = false; go.disabled = false; go.textContent = "Try again";
          barBox.hidden = true;
          prog.textContent = (e && e.message) || "Naming failed";
        }
      });
    } else {
      actions.innerHTML = connected
        ? `<button class="solid big" id="nmDone">Done — name my tracks</button><span class="nm-small">New analyses will include names while the helper runs.</span>`
        : "";
      d.querySelector("#nmDone")?.addEventListener("click", () => d.close());
    }
  };
  render();
  const poll = async () => {
    const was = connected;
    const h = await helperStatus();
    old = link && !!h && !canFetch(h);
    connected = !!h && (!link || canFetch(h));
    if (connected !== was || !status.dataset.init) { status.dataset.init = "1"; render(); d.dispatchEvent(new CustomEvent("helper", { detail: connected })); }
  };
  poll();
  const timer = setInterval(() => { if (d.open) poll(); }, 2500);
  d.addEventListener("close", () => { clearInterval(timer); setTimeout(() => d.remove(), 300); });
  d.showModal();
  return d;
}
