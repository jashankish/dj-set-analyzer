/* ============================================================
   Set Replay — The review: the scorecard and the paragraphs.
   Moved out of app.js as is: reviewSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */
import { review } from "../review.js";

export function reviewSection(ctx) {
  const { $, S, copyText, esc, shortName, span, tracks } = ctx;

  function renderReview() {
    const Rv = review(S.D, (n) => shortName(tracks()[n - 1]));
    $("rv").hidden = !Rv;
    if (!Rv) return;
    $("rvOverall").textContent = Rv.overall.toFixed(1);
    $("rvVerdict").textContent = Rv.verdict;
    $("rvScores").innerHTML = Rv.scores.map((x) => `<div class="rv-s"><span class="rv-l">${x.label}</span><span class="cb-bar"><i style="width:${x.v * 10}%"></i></span><span class="rv-v">${x.v.toFixed(1)}</span><span class="rv-why">${esc(x.why)}</span></div>`).join("");
    $("rvText").innerHTML = Rv.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("");
    $("rvCopy").onclick = () => copyText(`${S.title || S.D.title}: ${Rv.overall.toFixed(1)}/10. ${Rv.verdict}\n\n${Rv.paragraphs.join("\n\n")}\n`, "Review copied");
  }

  return { renderReview };
}
