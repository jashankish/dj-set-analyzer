/* A progress bar for long work (analysis, naming, fetching a link): the stage in words, a
   bar, the percent, and an estimate of the time left once there's enough to go on.

   const P = progressBar();      P.el → put it in the page
   P.update(stage, f)            f from 0 to 1; the estimate comes from how fast f has moved
   progressHTML(stage, f, eta)   the same, as markup, for lists re-rendered as a whole */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function eta(start, f0, f, now = Date.now()) {
  // after 8 s and 3% of headway, extrapolate the pace so far
  const el = (now - start) / 1000, moved = f - f0;
  if (el < 8 || moved < 0.03 || f >= 1) return null;
  const s = (el * (1 - f)) / moved;
  return s < 45 ? "less than a minute left" : s < 90 ? "about a minute left" : `about ${Math.round(s / 60)} minutes left`;
}

export function progressHTML(stage, f, left) {
  const pc = Math.max(0, Math.min(100, Math.round(f * 100)));
  return `<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pc}" aria-valuetext="${esc(stage)}, ${pc}%">
    <div class="prog-top"><span class="prog-stage">${esc(stage)}</span><span class="prog-pc">${pc}%${left ? ` · ${esc(left)}` : ""}</span></div>
    <div class="prog-track"><i style="width:${pc}%"></i></div></div>`;
}

export function progressBar() {
  const el = document.createElement("div");
  let start = null, f0 = 0;
  return {
    el,
    update(stage, f) {
      if (start == null) { start = Date.now(); f0 = f; }
      el.innerHTML = progressHTML(stage, f, eta(start, f0, f));
    },
  };
}

/* ------------------------------------------------ the activity banner
   A banner pinned to the top of the page while long work runs (analyzing a set, naming
   its tracks, fetching a link): what's being worked on, the stage, a bar, the percent and
   the time left. It doesn't block the page: scroll, read and play as usual. A warning sits
   beside the bar when Shazam is rate-limiting (or the helper stops answering), and stays,
   softer, for the rest of the run once it has happened. While it shows, leaving the page
   asks first, since leaving stops the work. Its height is published as --activity-h, so
   sticky bars sit under it. */
let banner = null;
const WARN = {
  rate: "Shazam is rate-limiting lookups. Naming will take longer than usual; if it keeps refusing, the set is saved with the names found so far and you can carry on later.",
  helper: "The naming helper isn't answering. Check that it's still running on this computer; Set Replay keeps retrying for a few minutes.",
  past: "Shazam slowed down earlier in this run (rate limiting), so it may take a little longer than estimated.",
};
function guard(e) { e.preventDefault(); e.returnValue = ""; }

export function activity() {
  if (banner) return banner;
  const el = document.createElement("div");
  el.className = "activity";
  el.hidden = true;
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="act-in"><div class="act-head"><b class="act-title"></b><span class="act-keep">Keep this tab open: leaving stops it.</span><button class="act-x" type="button" hidden aria-label="Dismiss">✕</button></div>
    <div class="act-bar"></div><p class="act-warn" hidden></p></div>`;
  document.body.prepend(el);
  const $ = (s) => el.querySelector(s);
  let start = null, f0 = 0, warned = false, lastWarn = "";
  const fit = () => document.documentElement.style.setProperty("--activity-h", el.hidden ? "0px" : `${el.offsetHeight}px`);
  new ResizeObserver(fit).observe(el);
  $(".act-x").addEventListener("click", () => api.hide());
  const api = {
    /** title: what's being worked on; warn: "rate" | "helper" | null (this moment) */
    show({ title, stage, f, warn = null }) {
      if (el.hidden) { start = Date.now(); f0 = f; warned = false; window.addEventListener("beforeunload", guard); }
      el.hidden = false;
      el.classList.remove("done", "err");
      $(".act-x").hidden = true; $(".act-keep").hidden = false;
      $(".act-title").textContent = title;
      $(".act-bar").innerHTML = progressHTML(stage, f, eta(start, f0, f));
      if (warn) warned = true;
      const w = warn ? WARN[warn] : warned ? WARN.past : "";
      const box = $(".act-warn");
      box.hidden = !w;
      box.classList.toggle("soft", !warn);
      if (w !== lastWarn) { box.textContent = w; lastWarn = w; }
      fit();
    },
    /** the end: a message that stays (with an optional action) until dismissed, or nothing */
    finish({ title, text, tone = "done", action } = {}) {
      window.removeEventListener("beforeunload", guard);
      if (!title) { api.hide(); return; }
      el.hidden = false;
      el.classList.toggle("done", tone === "done");
      el.classList.toggle("err", tone !== "done");
      $(".act-title").textContent = title;
      $(".act-keep").hidden = true;
      $(".act-bar").innerHTML = "";
      const box = $(".act-warn");
      box.hidden = !text; box.classList.remove("soft"); box.textContent = text || ""; lastWarn = "";
      if (action) { const b = document.createElement("button"); b.className = "ghost act-do"; b.type = "button"; b.textContent = action.label; b.addEventListener("click", () => { api.hide(); action.run(); }); box.append(" ", b); box.hidden = false; }
      $(".act-x").hidden = false;
      fit();
    },
    hide() { el.hidden = true; window.removeEventListener("beforeunload", guard); fit(); },
    get running() { return !el.hidden && !el.classList.contains("done") && !el.classList.contains("err"); },
  };
  banner = api;
  return api;
}
