/* ============================================================
   Set Replay — "Take the vibe to Spotify" (the section under the journey).
   The vibe fingerprint radar, the keyword chips, the prompt, and the
   Spotify actions. Words come from vibe.js, Spotify calls from spotify.js;
   app.js owns the set and tells this module when the set or track changes.
   Per-set choices (chips switched off, per scope; own direction; prompt
   length; scope) are kept in localStorage under set-replay:vibe:<slug>.
   ============================================================ */
import { vibeProfile, buildPrompt, defaultOff, AXES, trust } from "./vibe.js";
import { slicePayload } from "./phases.js";
import * as spotify from "./spotify.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const R = 112;                                   // radar radius in viewBox units
const GROUPS = ["Genre", "Tempo", "Mood", "Sound", "Artists", "Tracks", "Labels", "Era", "Flow", "Avoid", "Length"];

/* where the prompt goes. Every service builds its own playlist from the text;
   only Spotify can also take a saved playlist from this page. */
const TARGETS = [
  { id: "spotify", name: "Spotify", open: "https://open.spotify.com/", where: "Prompted Playlist in Spotify",
    steps: ["Copy the prompt.", "In the Spotify app, tap <b>Create</b> (+), then <b>Prompted Playlist</b> (Premium; English; in the US, Canada, the UK, Ireland, Australia, New Zealand and Sweden).",
      "Paste, then refine it there. <b>Save the set to Spotify</b> also gives you the set's own named tracks as a playlist, with the keywords as its description."] },
  { id: "youtube", name: "YouTube Music", open: "https://music.youtube.com/", where: "YouTube Music's AI playlist",
    steps: ["Copy the prompt.", "In the YouTube Music app, open <b>Library</b>, tap <b>New</b>, then choose the <b>AI playlist</b> option (Premium, in the US and some other markets).", "Paste it, then adjust the playlist there."] },
  { id: "apple", name: "Apple Music", open: "https://music.apple.com/", where: "Playlist Playground in Apple Music",
    steps: ["Copy the prompt.", "In Apple Music, open <b>Playlist Playground</b>. It's in beta, so it may not be on your device yet.", "Paste it, then refine the playlist there."] },
  { id: "deezer", name: "Deezer", open: "https://www.deezer.com/", where: "Deezer's Playlist with AI",
    steps: ["Copy the prompt.", "In Deezer, start a <b>Playlist with AI</b> (a beta, open to some subscribers).", "Paste it, then refine the playlist there."] },
  { id: "chat", name: "Any AI chat", open: null, where: "your AI assistant",
    steps: ["Copy the prompt. This version asks for a numbered list of <i>Artist – Title</i>, real released tracks only.", "Paste it into any AI assistant.", "Look the tracks up in your music app, or ask the assistant to make the list into a playlist for you."] },
];
const K_TARGET = "set-replay:vibe-target";
let target = TARGETS[0];
try { target = TARGETS.find((t) => t.id === localStorage.getItem(K_TARGET)) || TARGETS[0]; } catch (e) { /* private mode */ }

let V = null;      // { D, phases, scope, Ds, P, Pall, offs, off, extra, form, names, title, cur, keyColor, toast }

function storeKey() { return `set-replay:vibe:${V.D.slug}`; }
function save() {
  try { localStorage.setItem(storeKey(), JSON.stringify({ offs: Object.assign(V.offs, { [V.scope]: [...V.off] }), extra: V.extra, form: V.form, scope: V.scope })); } catch (e) { /* private mode */ }
}
function restore() {
  try { return JSON.parse(localStorage.getItem(storeKey()) || "null"); } catch (e) { return null; }
}

/* ------------------------------------------------ radar */
const pt = (i, v) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
  return [Math.cos(a) * R * v, Math.sin(a) * R * v];
};
const poly = (vals) => AXES.map(([k], i) => pt(i, Math.max(0.03, vals[k] || 0)).map((n) => n.toFixed(1)).join(",")).join(" ");

function dominantKey(D) {
  const t = {};
  D.tracks.forEach((tr) => { const k = tr.key && tr.key.camelot; if (k) t[k] = (t[k] || 0) + (tr.end - tr.start); });
  return Object.entries(t).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function axisText(k, v, bpm) {
  if (k === "tempo") return bpm ? `${Math.round(bpm)} BPM` : "—";
  if (k === "energy") return `${(v * 10).toFixed(1)} of 10`;
  return `${Math.round(v * 100)}%`;
}

function renderRadar() {
  const { P, keyColor } = V;
  const k = dominantKey(V.Ds);
  const fill = keyColor(k, "base"), ink = keyColor(k, "ink");
  let g = "";
  [0.25, 0.5, 0.75, 1].forEach((r) => (g += `<polygon class="vr-ring" points="${AXES.map((_, i) => pt(i, r).join(",")).join(" ")}"/>`));
  AXES.forEach(([, label], i) => {
    const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.17);
    const anchor = Math.abs(lx) < 8 ? "middle" : lx > 0 ? "start" : "end";
    g += `<line class="vr-spoke" x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    g += `<text class="vr-lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${label}</text>`;
  });
  g += `<polygon class="vr-set" points="${poly(P.axes)}" style="fill:${fill};stroke:${ink}"/>`;
  g += `<polygon class="vr-now" id="vrNow" points="${poly(P.axes)}"/>`;
  g += `<g id="vrDots"></g>`;
  // hit wedges, wider than the marks, one per axis
  AXES.forEach(([key], i) => {
    const a0 = -Math.PI / 2 + ((i - 0.5) * 2 * Math.PI) / AXES.length, a1 = a0 + (2 * Math.PI) / AXES.length, rr = R * 1.25;
    g += `<path class="vr-hit" data-k="${key}" d="M0,0 L${(Math.cos(a0) * rr).toFixed(1)},${(Math.sin(a0) * rr).toFixed(1)} A${rr},${rr} 0 0 1 ${(Math.cos(a1) * rr).toFixed(1)},${(Math.sin(a1) * rr).toFixed(1)} Z"/>`;
  });
  $("vibeRadar").innerHTML = g;
  $("vibeCap").innerHTML = `<span class="v-lg"><i class="v-sw" style="background:${fill};border-color:${ink}"></i>${scopeName()}</span><span class="v-lg"><i class="v-sw v-sw-now"></i>Track playing now</span>`;
  $("vibeVals").innerHTML = AXES.map(([key, label]) => `<div><dt>${label}</dt><dd>${axisText(key, P.axes[key], P.bpm)}</dd></div>`).join("");
  $("vibeRadar").querySelectorAll(".vr-hit").forEach((h) => {
    h.addEventListener("pointerenter", () => showAxisTip(h.dataset.k));
    h.addEventListener("pointerleave", () => ($("vibeTip").hidden = true));
  });
  updateRadar();
}

function showAxisTip(key) {
  const { P, D, cur } = V;
  const i = AXES.findIndex(([k]) => k === key), label = AXES[i][1];
  const tr = D.tracks[cur], ta = V.Pall.trackAxes[cur];
  const tip = $("vibeTip"), box = $("vibeRadar").getBoundingClientRect(), fig = $("vibeRadar").parentElement.getBoundingClientRect();
  const [x, y] = pt(i, 1.05);
  const sx = box.width / 340, px = box.left - fig.left + (x + 170) * sx, py = box.top - fig.top + (y + 150) * sx;
  tip.innerHTML = `<span class="t-title">${label}</span><span class="t-meta">${scopeName()}: ${axisText(key, P.axes[key], P.bpm)}</span>` +
    (tr ? `<span class="t-meta">Track ${tr.n}: ${axisText(key, ta[key], tr.bpm)}</span>` : "");
  tip.hidden = false;
  tip.style.left = `${Math.max(4, Math.min(fig.width - 170, px - 80))}px`;
  tip.style.top = `${py + (y > 0 ? 10 : -64)}px`;
}

function updateRadar() {
  if (!V || !$("vrNow")) return;
  const ta = V.Pall.trackAxes[V.cur];
  if (!ta) return;
  $("vrNow").setAttribute("points", poly(ta));
  $("vrDots").innerHTML = AXES.map(([k], i) => { const [x, y] = pt(i, Math.max(0.03, ta[k])); return `<circle class="vr-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`; }).join("");
}

/* ------------------------------------------------ chips + prompt */
function renderChips() {
  const { P, off } = V;
  $("vibeChips").innerHTML = GROUPS.filter((g) => P.chips.some((c) => c.group === g)).map((g) =>
    `<div class="v-group"><span class="v-gl">${g}</span>${P.chips.filter((c) => c.group === g).map((c) =>
      `<button class="chip" data-id="${esc(c.id)}" aria-pressed="${!off.has(c.id)}"${c.hint ? ` title="${esc(c.hint)}"` : ""}>${esc(c.text)}</button>`).join("")}</div>`).join("");
}

function prompt() {
  const p = buildPrompt(V.P, V.off, V.extra);
  if (target.id !== "chat") return p;
  const ask = `Make me a playlist of about ${V.P.songs} songs, as a numbered list of "Artist – Title", using only real, released tracks.`;
  return { full: `${ask} ${p.full}`, short: `${ask} Keywords: ${p.short}` };
}
function renderTarget() {
  $("vibeTarget").innerHTML = `<span class="v-gl">Send to</span>` + TARGETS.map((t) =>
    `<button class="ghost" role="tab" data-t="${t.id}" aria-selected="${t === target}">${t.name}</button>`).join("");
  const open = $("vibeOpen");
  open.hidden = !target.open;
  if (target.open) { open.href = target.open; open.textContent = `Open ${target.name}`; }
  $("vibeSave").hidden = target.id !== "spotify";
  $("vibeConnect").hidden = target.id !== "spotify" || !!spotify.hostClientId();
  $("vibeHow").innerHTML = target.steps.map((s) => `<li>${s}</li>`).join("");
}
function renderPrompt() {
  const p = prompt(), text = V.form === "short" ? p.short : p.full;
  $("vibePrompt").value = text;
  $("vibeCount").textContent = `${text.length} characters`;
  $("vibeFull").setAttribute("aria-selected", String(V.form !== "short"));
  $("vibeShort").setAttribute("aria-selected", String(V.form === "short"));
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
  const ta = $("vibePrompt");
  ta.focus(); ta.select();
  try { return document.execCommand("copy"); } catch (e) { return false; }
}
export async function copyPrompt() {
  if (!V) return;
  const ok = await copyText($("vibePrompt").value);
  V.toast(ok ? `Prompt copied. Paste it into ${target.where}` : "Select the prompt and copy it");
}

/* ------------------------------------------------ Spotify */
const status = (html) => ($("vibeStatus").innerHTML = html);

/* the tracks worth sending: named ones Shazam is fairly sure of, plus the visitor's own names */
function exportTracks() {
  const out = [], doubtful = [];
  V.Ds.tracks.forEach((tr) => {
    const own = V.names[tr.n];
    if (own && !tr.identified) {
      const m = String(own).split(/\s+[–—-]\s+/);
      out.push(m.length > 1 ? { n: tr.n, artist: m[0], title: m.slice(1).join(" - ") } : { n: tr.n, title: own });
    } else if (tr.identified) {
      const t = { n: tr.n, title: own || tr.title, artist: tr.artist, isrc: !own && tr.meta ? tr.meta.isrc : null };
      (trust(tr) >= 0.35 || own ? out : doubtful).push(t);
    }
  });
  return { out, doubtful };
}

async function saveToSpotify() {
  if (!spotify.clientId()) {
    $("vibeConnect").open = true;
    $("vibeClientId").focus();
    status("To save to Spotify, add a Spotify app's Client ID first (it takes two minutes, steps below).");
    return;
  }
  if (!spotify.canRedirect()) {
    status(`Spotify only signs in on <b>https</b> pages or <b>http://127.0.0.1</b>. Open this page at <a href="${esc(location.href.replace("//localhost", "//127.0.0.1"))}">127.0.0.1</a> instead of localhost.`);
    return;
  }
  if (!spotify.token()) {
    status("Taking you to Spotify to sign in…");
    try { await spotify.beginAuth({ action: "save" }); } catch (e) { status(esc(e.message)); }
    return;
  }
  const { out, doubtful } = exportTracks();
  if (!out.length) { status("None of this set's tracks are named yet, so there's nothing to look up. The prompt still works on its own."); return; }
  const btn = $("vibeSave");
  btn.disabled = true;
  try {
    const name = V.scope < 0 ? `${V.title} · Set Replay` : `${V.title} · ${V.phases[V.scope].label} · Set Replay`;
    const r = await spotify.savePlaylist({ name, description: prompt().short, tracks: out }, (m) => status(esc(m)));
    const miss = r.missed.length ? ` Not on Spotify: ${r.missed.map((t) => esc([t.artist, t.title].filter(Boolean).join(" – "))).join("; ")}.` : "";
    const skip = doubtful.length ? ` Left out ${doubtful.length} doubtful Shazam match${doubtful.length > 1 ? "es" : ""}.` : "";
    status(`Saved <b>${r.found.length}</b> track${r.found.length === 1 ? "" : "s"} to <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(name)}</a>.${miss}${skip} Open it in Spotify and use the prompt to grow it.`);
  } catch (e) {
    if (e.status === 401) status("The Spotify session ran out. Press <b>Save the set to Spotify</b> again to sign back in.");
    else if (e.status === 403) status("Spotify refused: in Development Mode an app only serves the users listed in its dashboard (up to five). Add your Spotify account under <i>User Management</i>.");
    else status(`Saving failed: ${esc(e.message)}`);
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------ wiring */
let bound = false, pending = null, notice = "";
function bind() {
  if (bound) return;
  bound = true;
  $("vibeChips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const id = b.dataset.id;
    V.off.has(id) ? V.off.delete(id) : V.off.add(id);
    b.setAttribute("aria-pressed", String(!V.off.has(id)));
    save(); renderPrompt();
  });
  $("vibeScope").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) vibeScope(+b.dataset.i);
  });
  $("vibeFull").addEventListener("click", () => { V.form = "full"; save(); renderPrompt(); });
  $("vibeShort").addEventListener("click", () => { V.form = "short"; save(); renderPrompt(); });
  $("vibeExtra").addEventListener("input", () => { V.extra = $("vibeExtra").value; save(); renderPrompt(); });
  $("vibePrompt").addEventListener("input", () => ($("vibeCount").textContent = `${$("vibePrompt").value.length} characters`));
  $("vibeCopy").addEventListener("click", copyPrompt);
  $("vibeOpen").addEventListener("click", () => { copyText($("vibePrompt").value).then((ok) => ok && V.toast(`Prompt copied. Paste it into ${target.where}`)); });
  $("vibeTarget").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    target = TARGETS.find((t) => t.id === b.dataset.t) || TARGETS[0];
    try { localStorage.setItem(K_TARGET, target.id); } catch (err) { /* private mode */ }
    renderTarget(); renderPrompt();
  });
  $("vibeReset").addEventListener("click", () => { V.off = defaultOff(V.P); delete V.offs[V.scope]; V.extra = ""; $("vibeExtra").value = ""; save(); renderChips(); renderPrompt(); });
  $("vibeSave").addEventListener("click", saveToSpotify);
  $("vibeUri").textContent = spotify.redirectUri();
  $("vibeUriCopy").addEventListener("click", () => copyText(spotify.redirectUri()).then(() => V.toast("Redirect URI copied")));
  $("vibeClientId").value = spotify.hostClientId() ? "" : spotify.clientId();
  $("vibeIdSave").addEventListener("click", () => {
    spotify.setOwnClientId($("vibeClientId").value);
    status($("vibeClientId").value.trim() ? "Client ID saved in this browser. Now press <b>Save the set to Spotify</b>." : "Client ID removed.");
  });

}

/* the part of the set the prompt is about: the whole set (-1) or one chapter */
const scopeName = () => (V.scope < 0 ? "Whole set" : esc(V.phases[V.scope].label));
function scoped() {
  const p = V.phases[V.scope];
  V.Ds = p ? slicePayload(V.D, p) : V.D;
  const inScope = new Set(V.Ds.tracks.map((t) => String(t.n)));
  V.P = p ? vibeProfile(V.Ds, Object.fromEntries(Object.entries(V.names).filter(([n]) => inScope.has(n)))) : V.Pall;
  if (p) {
    // a chapter with few named tracks borrows the set's leading artists, so Spotify still has names to go on
    const have = V.P.chips.filter((c) => c.group === "Artists");
    const add = V.Pall.chips.filter((c) => c.group === "Artists" && c.on && !have.some((h) => h.id === c.id)).slice(0, Math.max(0, 4 - have.length));
    if (have.length < 3 && add.length) {
      const at = V.P.chips.findIndex((c) => c.group === "Labels" || c.group === "Era" || c.group === "Flow");
      V.P.chips.splice(at < 0 ? V.P.chips.length : at, 0, ...add.map((c) => ({ ...c, hint: "From the whole set: this chapter has few named tracks" })));
    }
  }
}
/* each scope keeps its own switched-off chips; a scope never touched starts at the defaults */
function useOff() {
  const k = String(V.scope);
  V.off = V.offs[k] ? new Set(V.offs[k]) : defaultOff(V.P);
}
function renderScope() {
  const el = $("vibeScope");
  el.hidden = V.phases.length < 2;
  el.innerHTML = [`<span class="v-gl">Prompt for</span><button class="ghost" role="tab" data-i="-1" aria-selected="${V.scope < 0}">Whole set</button>`,
    ...V.phases.map((p, i) => `<button class="ghost" role="tab" data-i="${i}" aria-selected="${V.scope === i}" title="Tracks ${p.from}–${p.to}">${esc(p.label)}</button>`)].join("");
}
export function vibeScope(i) {
  if (!V) return;
  V.scope = i >= 0 && i < V.phases.length ? i : -1;
  scoped();
  useOff();
  save();
  renderScope(); renderRadar(); renderChips(); renderPrompt();
}

/* the whole-set chips switched off, for the set card */
export function vibeOffWhole() {
  if (!V) return undefined;
  return V.offs && V.offs["-1"] ? new Set(V.offs["-1"]) : V.scope < 0 ? V.off : undefined;
}

/* app.js → here */
export function mountVibe(ctx) {
  bind();
  const Pall = vibeProfile(ctx.D, ctx.names);
  V = { phases: [], ...ctx, Pall, P: Pall, Ds: ctx.D, cur: Math.max(0, ctx.cur || 0) };
  const saved = restore();
  V.scope = saved && saved.scope != null && saved.scope < V.phases.length ? saved.scope : -1;
  scoped();
  V.offs = (saved && saved.offs) || {};
  useOff();
  V.extra = (saved && saved.extra) || "";
  V.form = (saved && saved.form) || "full";
  $("vibeExtra").value = V.extra;
  renderTarget(); renderScope(); renderRadar(); renderChips(); renderPrompt();
  if (!pending) status(notice);
  notice = "";
  if (pending && pending.action === "save") { pending = null; target = TARGETS[0]; renderTarget(); saveToSpotify(); }
}
export function vibeTrack(i) {
  if (!V || i === V.cur) return;
  V.cur = i;
  updateRadar();
}
/* the visitor renamed something: names can add artists */
export function vibeNames(names, title) {
  if (!V) return;
  mountVibe({ ...V, names, title });
}
/* app.js calls this before routing: a Spotify sign-in may have just come back */
export async function vibeAuthReturn() {
  const r = await spotify.finishAuth();
  if (!r) return;
  if (r.error) { notice = esc(r.error); return; }
  pending = r.pending;
}
