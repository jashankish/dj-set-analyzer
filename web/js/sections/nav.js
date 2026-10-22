/* ============================================================
   Set Replay — The sticky section bar: chips, the current section, smooth jumps.
   Moved out of app.js as is: navSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */

export function navSection(ctx) {
  const { $ } = ctx;

  const SECTIONS = [["hl", "Highlights"], ["rv", "Review"], ["glance", "At a glance"], ["desk", "Setlist"], ["mix", "The mix"], ["craft", "How it was mixed"], ["journey", "Journey"],
    ["moodmap", "Mood map"], ["simx", "Track by track"], ["ttab", "Track table"], ["compare", "Compare"], ["vibe", "Spotify"]];
  function renderNav() {
    if (!$("pnav")) return;                          // a page without the bar (e.g. a stale cached set.html)
    const live = SECTIONS.filter(([id]) => $(id) && !$(id).hidden);
    $("pnav").innerHTML = live.map(([id, label]) => `<button data-to="${id}">${label}</button>`).join("");
    const goal = () => $("pnav").offsetHeight + 12;
    $("pnav").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const el = $(b.dataset.to), top = el.getBoundingClientRect().top + window.scrollY - goal();
      window.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      // if something above changed height on the way (a section drawing as it came into view),
      // land on the section anyway once the scroll stops
      let last = -1, settle = setInterval(() => {
        if (window.scrollY !== last) { last = window.scrollY; return; }
        clearInterval(settle);
        const off = el.getBoundingClientRect().top - goal();
        if (Math.abs(off) > 24 && window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 4) window.scrollBy(0, off);
      }, 150);
    }));
    renderNav.ids = live.map(([id]) => id);
    spyNav();
  }
  /* the current section: the last one whose top has passed 30% of the way down the
     screen (or the last one, once the page is scrolled to the bottom) */
  function spyNav() {
    if (!$("pnav")) return;
    const ids = renderNav.ids || [], line = Math.max($("pnav").offsetHeight + 40, window.innerHeight * 0.3);
    let cur = null;
    ids.forEach((id) => { const el = $(id); if (!el.hidden && el.getBoundingClientRect().top <= line) cur = id; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && ids.length) cur = ids[ids.length - 1];
    if (cur === spyNav.cur) return;
    spyNav.cur = cur;
    $("pnav").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.to === cur;
      b.setAttribute("aria-current", on ? "true" : "false");
      if (on && $("pnav").scrollWidth > $("pnav").clientWidth) $("pnav").scrollTo({ left: b.offsetLeft - $("pnav").clientWidth / 2 + b.offsetWidth / 2 });
    });
  }

  return { SECTIONS, renderNav, spyNav };
}
