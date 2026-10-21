/* ============================================================
   Set Replay — How it was mixed: the mixing breakdown, its timeline and the smoother running order.
   Moved out of app.js as is: craftSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */
import { craftProfile, relationClass, reorder } from "../craft.js";
import { harmonicRelation } from "../engine/music.js";
import { hasPending, spotifySave, takePending } from "../vibe-ui.js";

export function craftSection(ctx) {
  const { $, S, arc, esc, fmt, fmtDur, keyColor, keyOf, load, mixes, playMix, selectMix, shortName, showTip, span, tracks } = ctx;

  function renderCraft() {
    const C = craftProfile(S.D), M = mixes(), T = tracks();
    $("craft").hidden = !C || M.length < 2;
    if ($("craft").hidden) return;
    const st = C.stats;
    $("craftName").textContent = C.style.name;
    $("craftLine").textContent = C.style.line + (C.style.also ? ` A close second: ${C.style.also.replace(/^The /, "the ")}.` : "");
    const tiles = [
      ["Median mix", st.medBars ? `${st.medBars} bars` : fmtDur(st.medDur), st.medBars ? `${Math.round(st.medDur)} s` : ""],
      ["In key", `${st.harmonicPct}%`, st.partialPct ? `+${st.partialPct}% partly` : ""],
      ["Bass swaps", `${st.bassPct}%`, "of mixes"],
      ["Tempo moves", String(st.tempoMoves), st.maxBpmDelta ? `max ±${st.maxBpmDelta.toFixed(1)} BPM` : "none"],
      ["Lifts / drops", `${st.ups} / ${st.downs}`, "energy ±1 or more"],
      ["Smoothness", `${st.smooth}`, `${st.smoothLabel.toLowerCase()}, mean of 100`],
    ];
    $("craftStats").innerHTML = tiles.map(([k, v, sub]) => `<div><dt>${k}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ""}</dd></div>`).join("");
    // columns: height ∝ √bars so a 64-bar blend doesn't flatten the 8-bar swaps
    const bars = M.map((m) => m.bars || Math.max(1, Math.round(m.duration / 2)));
    const top = Math.max(32, ...bars), hgt = (b) => Math.sqrt(b / top);
    $("craftGrid").innerHTML = [8, 16, 32, 64].filter((b) => b <= top).map((b) => `<div class="cc-line" style="bottom:${(hgt(b) * 100).toFixed(1)}%"><span>${b}</span></div>`).join("");
    $("craftCols").innerHTML = M.map((m, j) => {
      const a = keyOf(T[m.from - 1]), b = keyOf(T[m.to - 1]);
      return `<button class="cc-col ${relationClass(m.harmonic.label)}" role="listitem" data-j="${j}" style="--h:${(hgt(bars[j]) * 100).toFixed(1)}%;--a:${keyColor(a, "base")};--b:${keyColor(b, "base")}" aria-label="Mix ${j + 1}: ${esc(shortName(T[m.from - 1]))} into ${esc(shortName(T[m.to - 1]))}, ${esc(m.type)}, ${m.bars ? `${m.bars} bars` : fmtDur(m.duration)}, ${esc(m.harmonic.label)}"><i></i></button>`;
    }).join("");
    const cols = $("craftCols"), tip = $("craftTip");
    cols.querySelectorAll(".cc-col").forEach((el) => {
      const j = +el.dataset.j, m = M[j];
      el.addEventListener("pointerenter", () => {
        const r = cols.getBoundingClientRect(), c = el.getBoundingClientRect();
        showTip(tip, c.left - r.left + c.width / 2, r.width,
          `<span class="t-time">Mix ${j + 1} · ${fmt(m.swap)}</span><span class="t-title">${esc(shortName(T[m.from - 1]))} → ${esc(shortName(T[m.to - 1]))}</span>` +
          `<span class="t-meta">${esc(m.type)} · ${m.bars ? `${m.bars} bars` : fmtDur(m.duration)} · ${esc(m.key_from || "?")} → ${esc(m.key_to || "?")} ${esc(m.harmonic.label.toLowerCase())}${m.bpm_delta ? ` · ${m.bpm_delta > 0 ? "+" : ""}${m.bpm_delta} BPM` : ""} · smoothness ${C.smooth[j].score}</span>`, 4);
      });
      el.addEventListener("pointerleave", () => (tip.hidden = true));
      el.addEventListener("click", () => { selectMix(j, true); playMix(); });
    });
    const list = (rows, cls) => {
      const max = Math.max(...rows.map((r) => r.count));
      return rows.map((r) => `<div class="cb-row ${cls ? cls(r.label) : ""}"><span class="cb-l">${esc(r.label)}</span><span class="cb-bar"><i style="width:${(r.count / max) * 100}%"></i></span><span class="cb-n">${r.count}</span></div>`).join("");
    };
    $("craftKeys").innerHTML = list(C.relations, relationClass);
    $("craftTypes").innerHTML = list(C.types);
    $("craftMoments").innerHTML = C.moments.map((x) => {
      const m = M[x.j];
      return `<li><button class="cb-mo" data-j="${x.j}"><b>${esc(x.what)}</b><span>${esc(shortName(T[m.from - 1]))} → ${esc(shortName(T[m.to - 1]))}</span><small>${esc(x.detail)} · at ${fmt(m.swap)}</small></button></li>`;
    }).join("");
    $("craftMoments").querySelectorAll(".cb-mo").forEach((b) => b.addEventListener("click", () => { selectMix(+b.dataset.j, true); playMix(); }));
    // the running-order search is the page's one heavy analysis (~0.2 s for 80 tracks):
    // run it when its section comes near the screen, in idle time, not at load
    if (tracks().filter((t) => keyOf(t)).length < 4) $("reorder").hidden = true;   // too few to re-order
    else if (hasPending("order")) renderReorder();   // back from Spotify with this save waiting
    else lazy($("reorder"), renderReorder);
    markCraft();
  }
  function lazy(el, fn) {
    if (lazy.watch) lazy.watch.disconnect();
    if (!("IntersectionObserver" in window)) { fn(); return; }
    const go = () => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 0));
    lazy.watch = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { lazy.watch.disconnect(); go(); } }, { rootMargin: "600px 0px" });
    el.hidden = false;
    el.classList.add("waiting");                     // holds about its final height, so nothing jumps
    lazy.watch.observe(el);
  }
  /* the same tracks, re-sequenced: a slope chart from the played order to the suggested one */
  function renderReorder() {
    $("reorder").classList.remove("waiting");
    const O = (S.order = reorder(S.D, { pinEnds: $("roPin").checked })), T = tracks();
    $("reorder").hidden = !O;
    if (!O) return;
    const ord = (k) => `${k}${["th", "st", "nd", "rd"][(k % 100 > 10 && k % 100 < 14) || k % 10 > 3 ? 0 : k % 10]}`;
    const b = O.before, a = O.after;
    $("roLine").textContent = O.unchanged
      ? `The running order is already as smooth as these tracks allow: ${b.clean} of ${O.mixes} mixes land in key.`
      : `Re-sequenced with the same energy arc, ${a.clean} of ${O.mixes} mixes would land in key (as played: ${b.clean}) and key clashes go from ${b.clash} to ${a.clash}; the average tempo step is ${a.tempo} BPM (was ${b.tempo}).`;
    const n = O.order.length, w = 1000 / n, pos = Object.fromEntries(O.order.map((tn, i) => [tn, i]));
    const played = T.filter((t) => keyOf(t)).map((t) => t.n);
    const clash = (seq) => seq.slice(1).map((tn, i) => harmonicRelation(keyOf(T[seq[i] - 1]), keyOf(T[tn - 1])).compatible === false ? i + 1 : -1).filter((i) => i > 0);
    let g = "";
    played.forEach((tn, i) => {
      const j = pos[tn], moved = i !== j;
      g += `<line class="ro-link${moved ? " moved" : ""}" x1="${(i + 0.5) * w}" y1="34" x2="${(j + 0.5) * w}" y2="116" vector-effect="non-scaling-stroke"/>`;
    });
    const row = (seq, y) => seq.map((tn, i) => `<rect x="${i * w + 1}" y="${y}" width="${w - 2}" height="30" rx="3" fill="${keyColor(keyOf(T[tn - 1]), "base")}"><title>Track ${tn}: ${esc(shortName(T[tn - 1]))} (${keyOf(T[tn - 1])})</title></rect>`).join("") +
      clash(seq).map((i) => `<rect class="ro-clash" x="${i * w - 2}" y="${y - 4}" width="4" height="38" />`).join("");
    g += row(played, 4) + row(O.order, 116);
    $("roSvg").innerHTML = g;
    $("roMoves").innerHTML = O.moves.slice(0, 3).map((m) => `<li><b>${esc(shortName(T[m.n - 1]))}</b> (track ${m.n}, ${keyOf(T[m.n - 1])}) moves from ${ord(m.from)} to ${ord(m.to)}</li>`).join("");
    $("roPin").onchange = renderReorder;
    $("roSave").onclick = saveOrder;
    if (takePending("order")) saveOrder();
  }
  /* the named tracks, in the suggested order, as a Spotify playlist */
  function saveOrder() {
    const T = tracks(), say = (h) => ($("roStatus").innerHTML = h);
    spotifySave({
      tracks: S.order.order.map((n) => T[n - 1]), names: S.names,
      name: `${S.title || S.D.title} · smoother order · Set Replay`,
      description: `The tracks of ${S.title || S.D.title}, re-sequenced: ${S.order.after.clean} of ${S.order.mixes} mixes in key.`,
      say, btn: $("roSave"), pending: { action: "order" },
    });
  }
  function markCraft() {
    document.querySelectorAll(".cc-col").forEach((el) => el.classList.toggle("on", +el.dataset.j === S.mix));
  }

  return { markCraft, renderCraft };
}
