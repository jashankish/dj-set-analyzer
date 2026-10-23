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
