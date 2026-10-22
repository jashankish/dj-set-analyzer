/* ============================================================
   Set Replay — "Take the vibe to Spotify" (the section under the journey).
   The vibe fingerprint radar, the keyword chips, the prompt, and the
   Spotify actions. Words come from vibe.js, Spotify calls from spotify.js;
   app.js owns the set and tells this module when the set or track changes.
   Per-set choices (chips switched off, per scope; own direction; prompt
   length; scope) are kept in localStorage under set-replay:vibe:<slug>.
   ============================================================ */
import { vibeProfile, buildPrompt, defaultOff, AXES, trust, trackFit, promptStrength, occasions, LENGTHS } from "./vibe.js";
import { slicePayload, around } from "./phases.js";
import { promptLink, qrSvg } from "./handoff.js";
import * as spotify from "./spotify.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const R = 112;                                   // radar radius in viewBox units
const GROUPS = ["Genre", "Tempo", "Mood", "Sound", "Artists", "Tracks", "Labels", "Era", "Flow", "Avoid"];

/* where the prompt goes. Every service builds its own playlist from the text;
   only Spotify can also take a saved playlist from this page. */
const TARGETS = [
  { id: "spotify", name: "Spotify", open: "https://open.spotify.com/", where: "Prompted Playlist in Spotify",
    steps: ["Copy the prompt, or use <b>Send to your phone</b>: Prompted Playlist is made in the phone app.", "In the Spotify app, go to <b>Your Library</b>, tap <b>Create</b>, then <b>Prompted Playlist</b> (Premium, in English; a beta, so it may not be on your account yet). Pick daily or weekly refresh if you like.",
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

let V = null;      // { D, phases, scope, here, Ds, P, Pall, offs, off, extra, form, names, title, cur, keyColor, toast }
// scope: -1 the whole set, 0… a chapter, HERE the few tracks around a moment (V.here, from around())
const HERE = -2;

function storeKey() { return `set-replay:vibe:${V.D.slug}`; }
function save() {
  try { localStorage.setItem(storeKey(), JSON.stringify({ offs: Object.assign(V.offs, { [V.scope]: [...V.off] }), extra: V.extra, form: V.form, scope: V.scope, here: V.here && V.here.center, range: V.range, length: V.length })); } catch (e) { /* private mode */ }
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

/* ------------------------------------------------ most like the set / curveballs */
function renderFit() {
  const T = V.Ds.tracks, F = trackFit(V.Ds).sort((a, b) => b.fit - a.fit);
  const el = $("vibeFit");
  el.hidden = T.length < 4 || !V.seek;
  if (el.hidden) return;
  const row = (f) => {
    const tr = V.D.tracks[f.n - 1];
    return `<button class="vf-row" data-t="${tr.start}"><span class="vf-n">${f.n}</span><span class="vf-t">${esc(V.nameOf(tr))}${f.why.length ? `<small>${esc(f.why.join(", "))}</small>` : ""}</span><span class="vf-bar"><i style="width:${Math.round(f.fit * 100)}%"></i></span><span class="vf-v">${Math.round(f.fit * 100)}</span></button>`;
  };
  const curve = F.slice(-2).filter((f) => f.fit < 0.7).reverse();
  const part = V.scope === -1 ? "set" : V.scope === HERE ? "part" : "chapter";
  el.innerHTML = `<h3 class="h3">Most like the ${part}</h3>${F.slice(0, 3).map(row).join("")}` +
    (curve.length ? `<h3 class="h3">Curveballs</h3>${curve.map(row).join("")}` : "") +
    `<p class="vf-note">Fit out of 100: how close a track's feel (the axes above) and styles are to the ${part === "set" ? "whole set" : part}'s. The song anchors in the prompt are the best-fitting named tracks.</p>`;
  el.querySelectorAll(".vf-row").forEach((b) => b.addEventListener("click", () => V.seek(+b.dataset.t + 0.05, true)));
}

/* ------------------------------------------------ chips + prompt */
function renderChips() {
  const { P, off } = V;
  $("vibeChips").innerHTML = GROUPS.filter((g) => P.chips.some((c) => c.group === g)).map((g) =>
    `<div class="v-group"><span class="v-gl">${g}</span>${P.chips.filter((c) => c.group === g).map((c) =>
      `<button class="chip" data-id="${esc(c.id)}" aria-pressed="${!off.has(c.id)}"${c.hint ? ` title="${esc(c.hint)}"` : ""}>${esc(c.text)}</button>`).join("")}</div>`).join("");
}

function prompt() {
  const p = buildPrompt(V.P, V.off, V.extra, { range: V.range, length: target.id === "chat" ? "auto" : V.length });
  if (target.id !== "chat") return p;
  const ask = `Make me a playlist of about ${LENGTHS[V.length] || V.P.songs} songs, as a numbered list of "Artist – Title", using only real, released tracks.`;
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
function renderStrength() {
  const S = promptStrength(V.P, V.off, { range: V.range });
  $("vibeStrength").innerHTML = `<span class="vs-k">How well this prompt pins the set down</span>
    <span class="vs-bar">${S.parts.map((p) => `<i style="flex:${p.weight}" class="${p.got >= 1 ? "on" : p.got > 0 ? "half" : ""}" title="${esc(p.label)}"></i>`).join("")}</span>
    <span class="vs-v"><b>${S.score}</b> ${S.label}</span>
    ${S.tip ? `<span class="vs-tip">To get closer: ${esc(S.tip)}.</span>` : ""}`;
}
function renderOccasions() {
  $("vibeOcc").innerHTML = `<span class="v-gl">Ideas</span>` + occasions(V.P).map((o) => `<button class="chip" aria-pressed="${V.extra === o}" data-o="${esc(o)}">${esc(o)}</button>`).join("");
}
function renderPrompt() {
  renderStrength();
  $("vibeRange").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.r === V.range)));
  $("vibeLength").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.l === V.length)));
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

/* the prompt as it stands (with any edits) as a QR code: Prompted Playlist is made in the phone app */
async function sendToPhone() {
  const L = promptLink($("vibePrompt").value, target.id);
  const dlg = $("phoneDlg");
  $("phoneQr").innerHTML = "";
  $("phoneLine").textContent = "";
  dlg.showModal();
  try {
    const Q = await qrSvg(L.data);
    $("phoneQr").innerHTML = Q.svg;
    // whole pixels per module: fractional ones come out uneven, and some cameras then miss the code
    const k = Math.max(2, Math.floor(Math.min(320, innerWidth * 0.8) / Q.size));
    $("phoneQr").style.width = $("phoneQr").style.height = `${k * Q.size}px`;
    $("phoneQr").querySelector("svg").setAttribute("aria-label", L.kind === "link" ? "QR code: a link that opens this prompt on your phone" : "QR code holding the prompt's text");
    const app = target.id === "chat" ? "your AI assistant" : `the ${target.name} app`;
    $("phoneLine").innerHTML = L.kind === "link"
      ? `Point your phone's camera at the code. It opens the prompt with a <b>Copy</b> button; then paste it into ${esc(app)}. The prompt travels in the link itself: nothing is uploaded.`
      : `Point your phone's camera at the code: it holds the prompt's text (this page is running on this computer, so a link wouldn't reach your phone). Copy it there, then paste it into ${esc(app)}.`;
  } catch (e) {
    $("phoneLine").textContent = "Couldn't make the code. Copy the prompt and send it to yourself instead.";
  }
}

/* ------------------------------------------------ Spotify */
const status = (html) => ($("vibeStatus").innerHTML = html);

/* the tracks worth sending: named ones Shazam is fairly sure of, plus the visitor's own names */
function exportTracks(trackList, names = {}) {
  const out = [], doubtful = [];
  trackList.forEach((tr) => {
    const own = names[tr.n];
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

/* Save named tracks to a new Spotify playlist. Shared by this section, the
   two-set blend and the suggested running order (app.js): `say` shows status
   where the button is, `pending` is what to resume after Spotify's sign-in. */
export async function spotifySave({ tracks: trackList, names = {}, name, description, say, btn, pending }) {
  if (!spotify.clientId()) {
    $("vibeConnect").hidden = false;
    $("vibeConnect").open = true;
    say(pending.action === "save" ? "To save to Spotify, add a Spotify app's Client ID first (it takes two minutes, steps below)."
      : "To save to Spotify, add a Spotify app's Client ID first: see <b>Use your own Spotify app</b> in the Spotify section below.");
    if (pending.action === "save") $("vibeClientId").focus();
    return;
  }
  if (!spotify.canRedirect()) {
    say(`Spotify only signs in on <b>https</b> pages or <b>http://127.0.0.1</b>. Open this page at <a href="${esc(location.href.replace("//localhost", "//127.0.0.1"))}">127.0.0.1</a> instead of localhost.`);
    return;
  }
  if (!spotify.token()) {
    say("Taking you to Spotify to sign in…");
    try { await spotify.beginAuth(pending); } catch (e) { say(esc(e.message)); }
    return;
  }
  const { out, doubtful } = exportTracks(trackList, names);
  if (!out.length) { say("None of these tracks are named yet, so there's nothing to look up. The prompt still works on its own."); return; }
  if (btn) btn.disabled = true;
  try {
    const r = await spotify.savePlaylist({ name, description, tracks: out }, (m) => say(esc(m)));
    const miss = r.missed.length ? ` Not on Spotify: ${r.missed.map((t) => esc([t.artist, t.title].filter(Boolean).join(" – "))).join("; ")}.` : "";
    const skip = doubtful.length ? ` Left out ${doubtful.length} doubtful Shazam match${doubtful.length > 1 ? "es" : ""}.` : "";
    say(`Saved <b>${r.found.length}</b> track${r.found.length === 1 ? "" : "s"} to <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(name)}</a>.${miss}${skip} Open it in Spotify and use the prompt to grow it.`);
  } catch (e) {
    if (e.status === 401) say("The Spotify session ran out. Press the button again to sign back in.");
    else if (e.status === 403) say("Spotify refused: in Development Mode an app only serves the users listed in its dashboard (up to five). Add your Spotify account under <i>User Management</i>.");
    else say(`Saving failed: ${esc(e.message)}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}
export const hasPending = (action) => !!pending && pending.action === action;
/* after Spotify's sign-in: the save that was waiting, if it's this kind */
export function takePending(action) {
  if (!pending || pending.action !== action) return null;
  const p = pending; pending = null;
  return p;
}

function saveToSpotify() {
  const part = V.scope === -1 ? null : V.scope === HERE ? V.here.label : V.phases[V.scope].label;
  const name = part ? `${V.title} · ${part} · Set Replay` : `${V.title} · Set Replay`;
  return spotifySave({ tracks: V.Ds.tracks, names: V.names, name, description: prompt().short, say: status, btn: $("vibeSave"), pending: { action: "save" } });
}

/* ------------------------------------------------ wiring */
let bound = false, notice = "";
let pending = null;
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
    if (b) +b.dataset.i === HERE ? vibeHere(V.cur) : vibeScope(+b.dataset.i);
  });
  $("vibeFull").addEventListener("click", () => { V.form = "full"; save(); renderPrompt(); });
  $("vibeShort").addEventListener("click", () => { V.form = "short"; save(); renderPrompt(); });
  $("vibeExtra").addEventListener("input", () => { V.extra = $("vibeExtra").value; save(); renderPrompt(); renderOccasions(); });
  $("vibeRange").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    V.range = b.dataset.r;
    save(); renderPrompt();
  });
  $("vibeLength").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    V.length = b.dataset.l;
    save(); renderPrompt();
  });
  $("vibeOcc").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    V.extra = V.extra === b.dataset.o ? "" : b.dataset.o;      // a second click takes it out again
    $("vibeExtra").value = V.extra;
    save(); renderPrompt(); renderOccasions();
  });
  $("vibePrompt").addEventListener("input", () => ($("vibeCount").textContent = `${$("vibePrompt").value.length} characters`));
  $("vibeCopy").addEventListener("click", copyPrompt);
  $("vibePhone").addEventListener("click", sendToPhone);
  $("phoneClose").addEventListener("click", () => $("phoneDlg").close());
  $("phoneDlg").addEventListener("click", (e) => { if (e.target === $("phoneDlg")) $("phoneDlg").close(); });
  $("vibeCopyAll").addEventListener("click", async () => {
    const ok = await copyText(`${V.title}: ${V.phases.length} playlists, one per chapter\n\n${chapterPrompts()}`);
    V.toast(ok ? `${V.phases.length} prompts copied: make one playlist from each` : "Couldn't copy");
  });
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

/* the part of the set the prompt is about: the whole set, one chapter, or the tracks around a moment */
const part = () => (V.scope === HERE ? V.here : V.phases[V.scope]);
const scopeName = () => (V.scope === -1 ? "Whole set" : esc(part().label));
function scoped() {
  const p = part();
  ({ Ds: V.Ds, P: V.P } = profileFor(p));
}
/* the payload and profile for one part of the set (none: the whole set) */
function profileFor(p) {
  const Ds = p ? slicePayload(V.D, p) : V.D;
  const inScope = new Set(Ds.tracks.map((t) => String(t.n)));
  const P = p ? vibeProfile(Ds, Object.fromEntries(Object.entries(V.names).filter(([n]) => inScope.has(n)))) : V.Pall;
  if (p) {
    // a chapter (or a moment) with few named tracks borrows the set's leading artists, so Spotify still has names to go on
    const have = P.chips.filter((c) => c.group === "Artists");
    const add = V.Pall.chips.filter((c) => c.group === "Artists" && c.on && !have.some((h) => h.id === c.id)).slice(0, Math.max(0, 4 - have.length));
    if (have.length < 3 && add.length) {
      const at = P.chips.findIndex((c) => c.group === "Labels" || c.group === "Era" || c.group === "Flow");
      P.chips.splice(at < 0 ? P.chips.length : at, 0, ...add.map((c) => ({ ...c, hint: "From the whole set: this chapter has few named tracks" })));
    }
  }
  return { Ds, P };
}
/* one prompt per chapter, numbered, each with the chips switched off in that chapter (or its defaults) */
export function chapterPrompts() {
  if (!V || V.phases.length < 2) return "";
  return V.phases.map((p, i) => {
    const { P } = profileFor(p);
    const off = V.offs[String(i)] ? new Set(V.offs[String(i)]) : defaultOff(P);
    const pr = buildPrompt(P, off, V.extra, { range: V.range, length: V.length });
    return `${i + 1}. ${p.label} (tracks ${p.from}–${p.to}): ${V.form === "short" ? pr.short : pr.full}`;
  }).join("\n\n");
}
/* each scope keeps its own switched-off chips; a scope never touched starts at the defaults */
function useOff() {
  const k = String(V.scope);
  V.off = V.offs[k] ? new Set(V.offs[k]) : defaultOff(V.P);
  // a few tracks have no arc to follow: no running order, mood route or set length by default
  if (!V.offs[k] && V.scope === HERE) ["f:flow", "f:mood"].forEach((id) => V.off.add(id));
}
function renderScope() {
  $("vibeCopyAll").hidden = V.phases.length < 2;
  const el = $("vibeScope");
  el.hidden = V.D.tracks.length < 3;
  const here = V.scope === HERE;
  el.innerHTML = [`<span class="v-gl">Prompt for</span><button class="ghost" role="tab" data-i="-1" aria-selected="${V.scope === -1}">Whole set</button>`,
    ...(V.phases.length > 1 ? V.phases.map((p, i) => `<button class="ghost" role="tab" data-i="${i}" aria-selected="${V.scope === i}" title="Tracks ${p.from}–${p.to}">${esc(p.label)}</button>`) : []),
    `<button class="ghost v-here" role="tab" data-i="${HERE}" aria-selected="${here}" title="The track playing now and one either side${here ? `. Press again to move it to where you are now` : ""}">Around now${here ? ` · ${esc(V.here.label.replace(/^Tracks? /, ""))}` : ""}</button>`].join("");
}
export function vibeScope(i) {
  if (!V) return;
  V.scope = i >= 0 && i < V.phases.length ? i : i === HERE && V.here ? HERE : -1;
  scoped();
  useOff();
  save();
  renderScope(); renderRadar(); renderFit(); renderChips(); renderPrompt(); renderOccasions();
}

/* a prompt for the tracks around track index i (the deck's "Playlist like this part") */
export function vibeHere(i) {
  if (!V) return;
  V.here = around(V.D, i);
  vibeScope(V.here ? HERE : -1);
}

/* the whole-set chips switched off, for the set card */
export function vibeOffWhole() {
  if (!V) return undefined;
  return V.offs && V.offs["-1"] ? new Set(V.offs["-1"]) : V.scope === -1 ? V.off : undefined;
}

/* app.js → here */
export function mountVibe(ctx) {
  bind();
  const Pall = vibeProfile(ctx.D, ctx.names);
  V = { phases: [], ...ctx, Pall, P: Pall, Ds: ctx.D, cur: Math.max(0, ctx.cur || 0) };
  const saved = restore();
  V.here = saved && saved.scope === HERE && saved.here ? around(ctx.D, ctx.D.tracks.findIndex((t) => t.n === saved.here)) : null;
  V.scope = saved && saved.scope === HERE && V.here ? HERE : saved && saved.scope != null && saved.scope >= 0 && saved.scope < V.phases.length ? saved.scope : -1;
  scoped();
  V.offs = (saved && saved.offs) || {};
  useOff();
  V.extra = (saved && saved.extra) || "";
  V.form = (saved && saved.form) || "full";
  V.range = (saved && saved.range) || "balanced";
  V.length = saved && saved.length in LENGTHS ? saved.length : "auto";
  $("vibeExtra").value = V.extra;
  renderTarget(); renderScope(); renderRadar(); renderFit(); renderChips(); renderPrompt(); renderOccasions();
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
