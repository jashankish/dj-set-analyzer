/* ============================================================
   Set Replay — Compare with another set: the score, the overlaid radar and the blend prompt.
   Moved out of app.js as is: compareSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */
import { compareSets, mergePayloads } from "../compare.js";
import { similarity } from "../similarity.js";
import { getSet } from "../store.js";
import { spotifySave, takePending } from "../vibe-ui.js";
import { AXES, buildPrompt, vibeProfile } from "../vibe.js";

export function compareSection(ctx) {
  const { $, S, esc, keyColor, keyOf, load, now, span, store, toast, tracks } = ctx;

  async function loadPayload(slug) {
    if (S.mode === "local") { const rec = await getSet(slug); return rec && rec.payload; }
    const r = await fetch(S.mode === "demo" ? `demo/${encodeURIComponent(slug)}.json` : `data/sets/${encodeURIComponent(slug)}.json`);
    return r.ok ? r.json() : null;
  }
  const titleOf = (slug, fallback) => (load(`set-replay:${slug}`) || {}).title || fallback;
  function renderCompare() {
    const others = (S.sets || []).filter((s) => s.slug !== S.D.slug);
    $("compare").hidden = !others.length;
    if (!others.length) return;
    const want = load(`set-replay:compare:${S.D.slug}`);
    const pick = others.find((s) => s.slug === want) || others[0];
    $("cmpSel").innerHTML = others.map((s) => `<option value="${esc(s.slug)}"${s === pick ? " selected" : ""}>${esc(titleOf(s.slug, s.title))}</option>`).join("");
    $("cmpSel").onchange = () => { store(`set-replay:compare:${S.D.slug}`, $("cmpSel").value); showCompare($("cmpSel").value); };
    $("cmpCopy").onclick = async () => {
      try { await navigator.clipboard.writeText($("cmpPrompt").value); toast("Blend prompt copied"); } catch (e) { $("cmpPrompt").select(); toast("Select the prompt and copy it"); }
    };
    showCompare(pick.slug);
  }
  async function showCompare(slug) {
    const mine = S.D.slug;
    const B = await loadPayload(slug).catch(() => null);
    if (S.D.slug !== mine) return;                 // the visitor moved on while it loaded
    $("cmpBody").hidden = !B;
    if (!B) return;
    const ta = S.title || S.D.title, tb = titleOf(slug, B.title);
    const C = compareSets(S.D, B, { a: ta, b: tb });
    $("cmpScore").textContent = `${C.score}`;
    $("cmpVerdict").textContent = `${C.verdict} · similarity out of 100`;
    const PART = { sound: "Sound (styles)", feel: "Feel (mood axes)", tempo: "Tempo", artists: "Shared artists" };
    $("cmpParts").innerHTML = Object.entries(C.parts).filter(([, v]) => v != null).map(([k, v]) =>
      `<div class="cb-row"><span class="cb-l">${PART[k]}</span><span class="cb-bar"><i style="width:${Math.round(v * 100)}%"></i></span><span class="cb-n">${Math.round(v * 100)}</span></div>`).join("");
    $("cmpDiffs").innerHTML = C.diffs.map((d) => `<li>${esc(d)}</li>`).join("") || "<li>No big differences on any axis.</li>";
    const both = [...C.genres.both.map((g) => g.toLowerCase().replace("drum n bass", "drum & bass")), ...C.artists];
    $("cmpShared").innerHTML = both.length ? `In common: ${both.map((x) => `<span class="tag">${esc(x)}</span>`).join(" ")}` : "No genres or artists in common.";
    // the overlaid radar: this set filled, the other outlined
    const R = 112, pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length; return [Math.cos(a) * R * v, Math.sin(a) * R * v]; };
    const poly = (ax) => AXES.map(([k], i) => pt(i, Math.max(0.03, ax[k] || 0)).map((n) => n.toFixed(1)).join(",")).join(" ");
    const home = (D) => { const t = {}; D.tracks.forEach((tr) => { const k = keyOf(tr); if (k) t[k] = (t[k] || 0) + tr.end - tr.start; }); return Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
    const ka = home(S.D), kb = home(B);
    let g = "";
    [0.25, 0.5, 0.75, 1].forEach((r) => (g += `<polygon class="vr-ring" points="${AXES.map((_, i) => pt(i, r).join(",")).join(" ")}"/>`));
    AXES.forEach(([, label], i) => {
      const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.17);
      g += `<line class="vr-spoke" x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="vr-lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${Math.abs(lx) < 8 ? "middle" : lx > 0 ? "start" : "end"}">${label}</text>`;
    });
    g += `<polygon class="vr-set" points="${poly(C.axes.a)}" style="fill:${keyColor(ka, "base")};stroke:${keyColor(ka, "ink")}"/>`;
    g += `<polygon class="cmp-b" points="${poly(C.axes.b)}" style="stroke:${keyColor(kb, "ink")}"/>`;
    $("cmpRadar").innerHTML = g;
    $("cmpCap").innerHTML = `<span class="v-lg"><i class="v-sw" style="background:${keyColor(ka, "base")};border-color:${keyColor(ka, "ink")}"></i>${esc(ta)}</span><span class="v-lg"><i class="v-sw v-sw-now" style="border-color:${keyColor(kb, "ink")}"></i>${esc(tb)}</span>`;
    const M = mergePayloads(S.D, B, `${ta} + ${tb}`), blend = buildPrompt(vibeProfile(M));
    $("cmpPrompt").value = blend.full;
    const saveBlend = () => spotifySave({
      tracks: M.tracks, names: S.names,                  // the first set's own names; its track numbers are unchanged
      name: `${ta} + ${tb} · Set Replay`, description: blend.short,
      say: (h) => ($("cmpStatus").innerHTML = h), btn: $("cmpSave"), pending: { action: "blend", slug },
    });
    $("cmpSave").onclick = saveBlend;
    const p = takePending("blend");
    if (p && p.slug === slug) saveBlend();
  }

  return { renderCompare };
}
