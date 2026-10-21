/* ============================================================
   Set Replay — The chapters strip in the journey.
   Moved out of app.js as is: chaptersSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */
import { slicePayload } from "../phases.js";
import { vibeScope } from "../vibe-ui.js";
import { vibeProfile } from "../vibe.js";

export function chaptersSection(ctx) {
  const { $, S, esc, fmt, keyColor, keyOf, seek, span, tracks } = ctx;

  function renderPhases() {
    const P = S.phases, T = tracks();
    const block = $("phases").closest(".j-block");
    block.hidden = P.length < 2;
    if (P.length < 2) return;
    $("phaseSub").textContent = "Where the set changes gear, from track energy and tempo";
    const maxE = Math.max(...P.map((p) => p.energy));
    $("phases").style.gridTemplateColumns = P.map((p) => `minmax(0, ${Math.max(1, p.end - p.start).toFixed(0)}fr)`).join(" ");
    $("phases").innerHTML = P.map((p, i) => {
      const k = p.keys[0] || keyOf(T[p.from - 1]);
      // the same words the chapter's Spotify prompt uses: trusted genres, then the leading mood
      const V = vibeProfile(slicePayload(S.D, p));
      const styles = [...V.chips.filter((c) => c.group === "Genre" && c.on).slice(0, 2), ...V.chips.filter((c) => c.group === "Mood").slice(0, 1)].map((c) => c.text).join(" · ");
      return `<div class="ph" data-i="${i}" style="--c:${keyColor(k, "deep")};--c2:${keyColor(k, "base")}">
        <button class="ph-go" data-t="${p.start}" title="Play this chapter">
          <span class="ph-l">${esc(p.label)}</span>
          <span class="ph-t">${fmt(p.start)}–${fmt(p.end)} · tracks ${p.from}–${p.to}</span>
          <span class="ph-s">${Math.round(p.bpm)} BPM · energy ${p.energy.toFixed(1)}${p.drops ? ` · ${p.drops} drop${p.drops > 1 ? "s" : ""}` : ""}</span>
          ${styles ? `<span class="ph-st">${esc(styles)}</span>` : ""}
          <span class="ph-bar" aria-hidden="true"><i style="width:${Math.round((p.energy / maxE) * 100)}%"></i></span>
        </button>
        <button class="ph-vibe ghost" data-i="${i}">Spotify prompt</button>
      </div>`;
    }).join("");
    $("phases").querySelectorAll(".ph-go").forEach((b) => b.addEventListener("click", () => seek(+b.dataset.t + 0.05, true)));
    $("phases").querySelectorAll(".ph-vibe").forEach((b) => b.addEventListener("click", () => {
      vibeScope(+b.dataset.i);
      $("vibe").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }));
  }

  return { renderPhases };
}
