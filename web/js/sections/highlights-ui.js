/* ============================================================
   Set Replay — Highlights: the cards and the reel.
   Moved out of app.js as is: highlightsSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */
import { highlights } from "../highlights.js";

export function highlightsSection(ctx) {
  const { $, S, audio, esc, fmt, seek, selectMix, shortName, span, tracks } = ctx;

  function renderHighlights() {
    stopReel();
    const H = (S.hl = highlights(S.D, (n) => shortName(tracks()[n - 1])));
    $("hl").hidden = H.items.length < 2;
    if ($("hl").hidden) return;
    $("hlSub").textContent = `${H.items.length} moments from across the set · a ${fmt(H.reel)} reel`;
    const KIND = { chapter: "Chapter", drop: "Drop", peak: "Peak", mix: "Mix", mood: "Mood", track: "Track" };
    $("hlList").innerHTML = H.items.map((h, i) => `<li><button class="hl-card" data-i="${i}" data-kind="${h.kind}" data-end="${(h.t + h.dur).toFixed(2)}">
      <span class="hl-meta"><b>${fmt(h.t)}</b> ${KIND[h.kind]}</span><span class="hl-title">${esc(h.title)}</span><span class="hl-why">${esc(h.why)}</span>
      <span class="hl-bar" aria-hidden="true"><i></i></span></button></li>`).join("");
    $("hlList").querySelectorAll(".hl-card").forEach((b) => b.addEventListener("click", () => {
      const h = S.hl.items[+b.dataset.i];
      stopReel();
      if (h.mix != null) selectMix(h.mix, false);
      seek(h.t, true);
    }));
    $("hlPlay").onclick = () => (S.reel ? stopReel() : playHighlight(0, true));
  }
  function playHighlight(i, reel) {
    const h = S.hl.items[i];
    if (reel && !S.noAudio) S.reel = { i };          // without audio there's nothing to step through
    if (h.mix != null) selectMix(h.mix, false);
    seek(h.t, true);
    markReel();
  }
  function stopReel() {
    if (!S.reel) return;
    S.reel = null;
    markReel();
  }
  function markReel() {
    $("hlPlay").textContent = S.reel ? `Stop the reel (${S.reel.i + 1} of ${S.hl.items.length})` : "Play the highlights";
    $("hlPlay").setAttribute("aria-pressed", String(!!S.reel));
    document.querySelectorAll(".hl-card").forEach((c) => c.classList.toggle("on", !!S.reel && +c.dataset.i === S.reel.i));
    const on = document.querySelector(".hl-card.on");
    if (on) on.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  return { playHighlight, renderHighlights, stopReel };
}
