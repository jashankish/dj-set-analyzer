#!/usr/bin/env node
/* Checks the page's own analyses on the bundled demo sets and on edge cases:
   the Spotify prompt writer (web/js/vibe.js), the chapter finder
   (web/js/phases.js), the mixing breakdown (web/js/craft.js) and the
   mood map (web/js/moodmap.js).
   No dependencies: node tools/analysis-test.mjs

   The demos are phone recordings of drum & bass sets (Sub Focus, Culture
   Shock, Dimension…) that the style model partly hears as "hardcore": the
   prompt must still lead with drum & bass, name the right artists, and
   leave out the Shazam matches that are clearly wrong (library music). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { vibeProfile, buildPrompt, defaultOff, artistsOf, trust, AXES, trackFit, promptStrength, occasions } = await import(pathToFileURL(path.join(ROOT, "web/js/vibe.js")));
const { findPhases, slicePayload, around } = await import(pathToFileURL(path.join(ROOT, "web/js/phases.js")));
const { craftProfile, relationClass, mixScore, mixTips, bridgeKeys, reorder } = await import(pathToFileURL(path.join(ROOT, "web/js/craft.js")));
const { moodMap } = await import(pathToFileURL(path.join(ROOT, "web/js/moodmap.js")));
const { cardData } = await import(pathToFileURL(path.join(ROOT, "web/js/card.js")));
const { tracklist, stamp } = await import(pathToFileURL(path.join(ROOT, "web/js/tracklist.js")));
const { trackTable, toCSV } = await import(pathToFileURL(path.join(ROOT, "web/js/table.js")));
const { tempoJourney } = await import(pathToFileURL(path.join(ROOT, "web/js/tempo.js")));
const { vocalMap } = await import(pathToFileURL(path.join(ROOT, "web/js/vocals.js")));
const { pacing } = await import(pathToFileURL(path.join(ROOT, "web/js/pacing.js")));
const { setShape, SHAPES } = await import(pathToFileURL(path.join(ROOT, "web/js/shape.js")));
const { soundBalance } = await import(pathToFileURL(path.join(ROOT, "web/js/balance.js")));
const { keyTimeline } = await import(pathToFileURL(path.join(ROOT, "web/js/keyline.js")));
const { taste } = await import(pathToFileURL(path.join(ROOT, "web/js/taste.js")));
const { roles } = await import(pathToFileURL(path.join(ROOT, "web/js/roles.js")));
const { review } = await import(pathToFileURL(path.join(ROOT, "web/js/review.js")));
const { similarity, idClues } = await import(pathToFileURL(path.join(ROOT, "web/js/similarity.js")));
const { highlights } = await import(pathToFileURL(path.join(ROOT, "web/js/highlights.js")));
const { dropAnatomy } = await import(pathToFileURL(path.join(ROOT, "web/js/drops.js")));
const { compareSets, mergePayloads } = await import(pathToFileURL(path.join(ROOT, "web/js/compare.js")));
// the two worship sets the checks were written against (the site's demo is now another set)
const demo = (s) => JSON.parse(fs.readFileSync(path.join(ROOT, "tools/fixtures", `${s}.json`)));

const checks = [];
const check = (name, value, ok) => checks.push([name, JSON.stringify(value), !!ok(value)]);

/* ---------------- the demos */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const P = vibeProfile(demo(slug));
  const { full, short } = buildPrompt(P);
  check(`${slug}: drum & bass is the lead genre`, P.genres[0].style, (s) => s === "Drum n Bass");
  check(`${slug}: tempo said as ~175 BPM`, full.match(/around \d+ BPM/)?.[0], (t) => /around 17[5-7] BPM/.test(t || ""));
  check(`${slug}: Sub Focus is among the artists`, P.artists, (a) => a.includes("Sub Focus"));
  check(`${slug}: no library-music misfires among the artists`, P.artists, (a) => !a.some((x) => /Sandy Khippal|Elizabeth Franklin|Adriel Fair/.test(x)));
  check(`${slug}: every axis is 0–1`, AXES.map(([k]) => P.axes[k]), (v) => v.every((x) => x >= 0 && x <= 1));
  check(`${slug}: one radar outline per track`, P.trackAxes.length, (n) => n === demo(slug).tracks.length);
  check(`${slug}: short prompt ≤ 300 characters`, short.length, (n) => n > 20 && n <= 300);
  check(`${slug}: full prompt asks for DJ-set ordering`, full, (t) => t.includes("Order it like a DJ set"));
  check(`${slug}: anchors on two trusted named tracks`, P.chips.filter((c) => c.group === "Tracks" && c.on).map((c) => c.text), (t) => t.length === 2 && t.every((x) => / by /.test(x) && !/\((Edit|Extended)/i.test(x)));
  check(`${slug}: full prompt names its anchor songs`, full, (t) => /Start from songs like .+ by /.test(t));
  check(`${slug}: keeps the tempo floor (nothing under 170 BPM)`, full, (t) => t.includes("Leave out tracks under 170 BPM"));
  check(`${slug}: short prompt words the avoids as "no …"`, short, (t) => t.includes("no tracks under 170 BPM") && !t.includes("no anything"));
  check(`${slug}: a discounted hard style is offered to avoid, but off`, P.chips.filter((c) => c.id === "x:hard").map((c) => c.on), (v) => v.length === 1 && v[0] === false);
  check(`${slug}: the mood route becomes an ordering line`, full, (t) => /Let the mood move as the set does: (open .+ and end .+|keep the mood .+ throughout)\./.test(t));
  const off = defaultOff(P);
  off.add("f:flow"); off.add("f:mood"); off.add("g:Drum n Bass");
  const p2 = buildPrompt(P, off, "for a late-night drive");
  check(`${slug}: switching chips off removes them`, p2.full, (t) => !t.includes("drum & bass") && !t.includes("Order it like") && !t.includes("Let the mood"));
  check(`${slug}: own direction is appended`, p2.full, (t) => t.endsWith("for a late-night drive."));
}
check("part 2: hardcore (a room-noise artifact) is left out", vibeProfile(demo("worship-part-2")).genres.map((g) => g.style), (g) => !g.includes("Hardcore"));

/* ---------------- range: close / balanced / discover */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const P = vibeProfile(demo(slug)), off = defaultOff(P);
  const [close, bal, disc] = ["close", "balanced", "discover"].map((range) => buildPrompt(P, off, "", { range }));
  check(`${slug}: balanced is the default prompt`, bal.full, (t) => t === buildPrompt(P, off).full);
  check(`${slug}: close asks to stay with the set's artists and keeps its songs`, close.full, (t) => /Stay close to these artists/.test(t) && /Start from songs like/.test(t));
  check(`${slug}: length asks for a number of songs only when chosen`, [buildPrompt(P, off).full, buildPrompt(P, off, "", { length: "two" }).full, buildPrompt(P, off, "", { length: "three" }).short], ([a, b, c]) => !/songs\.$/.test(a) && !/about \d+ songs/.test(a) && /Make it about 35 songs\.$/.test(b) && /, about 50 songs$/.test(c));
  check(`${slug}: discover keeps the sound, drops the set's songs, asks for new names`, disc.full, (t) => /drum & bass/.test(t) && !/Start from songs/.test(t) && /lesser-known names and deeper cuts/.test(t));
  check(`${slug}: every range's keywords-only prompt fits in 300 characters`, [close.short, disc.short].map((x) => x.length), (v) => v.every((n) => n > 20 && n <= 300));
  check(`${slug}: in discover the strength meter doesn't count or tip about songs`, promptStrength(P, off, { range: "discover" }), (S) => !S.parts.some((p) => p.id === "songs") && S.score >= 85);
}

/* ---------------- prompt strength and occasion ideas */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const P = vibeProfile(demo(slug));
  check(`${slug}: the default prompt pins the set down strongly`, promptStrength(P), (S) => S.score >= 85 && S.label === "Strong" && S.tip === null);
  const off = defaultOff(P); P.chips.filter((c) => c.group === "Artists" || c.group === "Tracks").forEach((c) => off.add(c.id));
  const weak = promptStrength(P, off);
  check(`${slug}: with no artists or songs it drops, and the tip is about switching artists back on`, weak, (S) => S.score <= 55 && /switch some back on/.test(S.tip));
  check(`${slug}: occasion ideas are 1–4 phrases that complete "a playlist …"`, occasions(P), (o) => o.length >= 1 && o.length <= 4 && o.every((x) => /^(for|to) /.test(x)));
}
check("occasions: a fast, energetic set suggests a run", occasions(vibeProfile(demo("worship-part-2"))), (o) => o.includes("for a run"));

/* ---------------- how typical each track is (vibe.trackFit) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), F = trackFit(D);
  check(`${slug}: a fit for every track, 0–1`, F.map((f) => f.fit), (v) => v.length === D.tracks.length && v.every((x) => x >= 0 && x <= 1));
  const low = [...F].sort((a, b) => a.fit - b.fit)[0];
  check(`${slug}: the least typical track says why`, low.why, (w) => w.length >= 1);
  const anchors = vibeProfile(D).anchors.map((a) => a.split(" by ")[0]);
  const trusted = D.tracks.filter((t) => t.identified && trust(t) >= 0.6);
  const fitOf = (t) => F[t.n - 1].fit;
  const med = [...trusted.map(fitOf)].sort((a, b) => a - b)[Math.floor(trusted.length / 2)];
  check(`${slug}: song anchors fit the set at least as well as the median trusted track`, trusted.filter((t) => anchors.some((a) => t.title.startsWith(a))).map(fitOf), (v) => v.length >= 2 && v.slice(0, 2).every((x) => x >= med - 0.05));
}
check("worship-part-1: the noisy opening ID is the curveball", [...trackFit(demo("worship-part-1"))].sort((a, b) => a.fit - b.fit)[0].n, (n) => n === 1);

/* ---------------- chapters (web/js/phases.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), P = findPhases(D);
  check(`${slug}: 2–5 chapters`, P.length, (n) => n >= 2 && n <= 5);
  check(`${slug}: chapters tile the set's tracks in order`, P.map((p) => [p.from, p.to]), (r) => r[0][0] === 1 && r[r.length - 1][1] === D.tracks.length && r.every((x, i) => !i || x[0] === r[i - 1][1] + 1));
  check(`${slug}: one chapter is the peak, and it has the most energy`, P.map((p) => [p.role, +p.energy.toFixed(2)]), (v) => { const pk = v.filter(([r]) => r === "peak"); return pk.length === 1 && pk[0][1] === Math.max(...v.map(([, e]) => e)); });
  check(`${slug}: chapter names are unique`, P.map((p) => p.label), (l) => new Set(l).size === l.length);
  check(`${slug}: every chapter is at least 2.5 min`, P.map((p) => Math.round(p.end - p.start)), (d) => d.every((x) => x >= 150));
  const last = slicePayload(D, P[P.length - 1]);
  check(`${slug}: a chapter's slice keeps only its tracks and drops`, [last.tracks.length, last.drops.every((d) => d.t >= P[P.length - 1].start)], ([n, ok]) => n === P[P.length - 1].to - P[P.length - 1].from + 1 && ok);
  check(`${slug}: the last chapter writes its own prompt`, buildPrompt(vibeProfile(last)).full, (t) => /^A .* playlist \(/.test(t));
}
const flat = { title: "Flat", duration: 600, summary: { bpm_avg: 124, styles: [] }, drops: [], tracks: [0, 1, 2].map((i) => ({ n: i + 1, start: i * 200, end: (i + 1) * 200, identified: false, bpm: 124, energy: 6, key: { camelot: "8A" }, moods: {} })) };
check("a level set is one chapter", findPhases(flat).length, (n) => n === 1);

/* ---------------- how it was mixed (web/js/craft.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), C = craftProfile(D);
  check(`${slug}: drum & bass sets read as technicians (bass swaps)`, C.style.id, (id) => id === "technician");
  check(`${slug}: key moves and mix types each add up to the mix count`, [C.relations.reduce((a, r) => a + r.count, 0), C.types.reduce((a, r) => a + r.count, 0), D.transitions.length], ([a, b, n]) => a === n && b === n);
  check(`${slug}: harmonic share matches the summary`, [C.stats.harmonicPct, D.summary.harmonic_pct], ([a, b]) => a === b);
  check(`${slug}: signature moments are distinct mixes`, C.moments.map((m) => m.j), (j) => j.length >= 2 && new Set(j).size === j.length);
  check(`${slug}: the longest blend is the longest mix`, D.transitions[C.moments[0].j].duration, (d) => d === Math.max(...D.transitions.map((m) => m.duration)));
}
const mk = (type, bars, label, compatible, extra = {}) => ({ from: 1, to: 2, type, bars, duration: bars * 1.4, harmonic: { label, compatible }, bpm_delta: 0, energy_delta: 0, low_dip_db: 0, style_continuity: 0.3, ...extra });
const blender = { tracks: [], drops: [], transitions: [mk("Long blend", 64, "Same key", true), mk("Long blend", 48, "Energy up", true), mk("Blend", 32, "Same key", true), mk("Long blend", 40, "Relative minor", true)] };
check("long overlapping mixes read as a long blender", craftProfile(blender).style.id, (id) => id === "blender");
const cutter = { tracks: [], drops: [], transitions: [0, 1, 2, 3].map((i) => mk("Cut", 2, i % 2 ? "Key clash" : "Same key", i % 2 ? false : true)) };
check("hard cuts read as a quick cutter", craftProfile(cutter).style.id, (id) => id === "cutter");
check("relationClass sorts key moves", ["Same key", "Mood shift", "Key clash"].map(relationClass), (v) => v.join() === "good,partial,clash");
const perfect = mk("Bass swap", 16, "Same key", true, { low_dip_db: 12 });
check("smoothness: same key, same tempo, bass swapped, 16 bars → 100", mixScore(perfect), (s) => s.score === 100 && s.label === "Seamless" && s.notes.length === 0);
const rough = mk("Blend", 13, "Key clash", false, { bpm_delta: 4, energy_delta: 3.5, low_dip_db: 0 });
check("smoothness: clash + tempo jump + two bass lines + lurch → bumpy, with every reason", mixScore(rough), (s) => s.score < 55 && s.label === "Bumpy" && s.notes.length === 4);
check("smoothness: a deliberate drop isn't marked down for its energy jump", mixScore(mk("Into breakdown", 16, "Same key", true, { energy_delta: -4 })).parts.flow, (f) => f === 10);
check("smoothness: 51 bars counts as on the 48-bar phrase (room-recording slack)", mixScore(mk("Long blend", 51, "Same key", true, { low_dip_db: 9 })).parts.phrase, (p) => p === 15);
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const C = craftProfile(demo(slug));
  check(`${slug}: smoothness per mix and a mean`, [C.smooth.length, C.stats.smooth], ([n, m]) => n === demo(slug).transitions.length && m >= 0 && m <= 100);
  check(`${slug}: the roughest mix is a key clash`, C.moments.find((m) => m.what === "Roughest mix"), (m) => m && /keys clash/.test(m.detail));
}
check("bridge: 8A → 9B has a single bridging key (9A or 8B)", bridgeKeys("8A", "9B").direct, (d) => d.includes("9A") && d.includes("8B"));
check("bridge: 3A → 8A routes in key through 4A…7A", bridgeKeys("3A", "8A").via, (v) => v.join() === "4A,5A,6A,7A");
check("tips: a seamless mix needs none", mixTips(perfect), (t) => t.length === 0);
check("tips: the bumpy mix gets one per problem", mixTips(rough).length, (n) => n >= 4);
{
  const D = demo("worship-part-2"), m = D.transitions[12];       // 3A → 8A, the roughest
  check("tips: a clash names tracks from this set on the route", mixTips(m, D.tracks)[0], (t) => /via 4A, 5A, 6A, 7A/.test(t) && /track \d+/.test(t));
}
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), O = reorder(D);
  check(`${slug}: the suggested order uses every track once`, [...O.order].sort((a, b) => a - b).join(), (v) => v === D.tracks.map((t) => t.n).join());
  check(`${slug}: it never adds key clashes`, [O.before.clash, O.after.clash], ([b, a]) => a <= b);
  check(`${slug}: it's deterministic`, reorder(D).order.join(), (v) => v === O.order.join());
}
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), pin = reorder(D), free = reorder(D, { pinEnds: false });
  check(`${slug}: by default the opener and closer stay put`, [pin.order[0], pin.order.at(-1)], ([a, z]) => a === 1 && z === D.tracks.length);
  check(`${slug}: freeing the ends never makes the order worse`, [free.cost, pin.cost], ([f, p]) => f <= p + 1e-9);
}
check("worship-part-2: re-sequencing clears its four key clashes", reorder(demo("worship-part-2")), (O) => O.before.clash === 4 && O.after.clash === 0);
{
  const smooth = { tracks: ["8A", "8A", "9A", "9A", "10A"].map((k, i) => ({ n: i + 1, start: i * 200, end: (i + 1) * 200, bpm: 124, energy: 5 + i * 0.5, key: { camelot: k } })) };
  check("an already-smooth order is left alone", reorder(smooth).unchanged, (u) => u === true);
}
check("no transitions, no profile", craftProfile({ tracks: [], transitions: [] }), (v) => v === null);

/* ---------------- mood map (web/js/moodmap.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), M = moodMap(D);
  check(`${slug}: one point per track`, M.points.length, (n) => n === D.tracks.length);
  check(`${slug}: quadrant shares add up to 1`, Object.values(M.share).reduce((a, b) => a + b, 0), (x) => Math.abs(x - 1) < 1e-9);
  check(`${slug}: each point's quadrant follows the set's medians`, M.points.every((p) => p.q === (p.a >= M.median.a ? (p.v >= M.median.v ? "euphoric" : "intense") : (p.v >= M.median.v ? "warm" : "brooding"))), (ok) => ok);
  check(`${slug}: the home quadrant has the largest share`, M.share[M.home], (x) => x === Math.max(...Object.values(M.share)));
  check(`${slug}: every point is inside the drawn domain`, M.points.every((p) => p.v > M.domain.v[0] && p.v < M.domain.v[1] && p.a > M.domain.a[0] && p.a < M.domain.a[1]), (ok) => ok);
  check(`${slug}: the route sentence names where it opens and ends`, M.sentence, (t) => /opens \w+.* ends \w+|stays \w+/.test(t));
}
check("fewer than three tracks: no mood map", moodMap({ tracks: [{ n: 1, moods: {} }, { n: 2, moods: {} }] }), (v) => v === null);

/* ---------------- the set card's contents (web/js/card.js) */
{
  const D = demo("worship-part-2"), C = cardData(D, { title: "My night" });
  check("card: uses the visitor's title", C.title, (t) => t === "My night");
  check("card: facts are length, tracks, tempo, in-key share and the review score", C.facts, (f) => f.length === 5 && f[1] === "19 tracks" && /BPM/.test(f[2]) && /% in key/.test(f[3]) && /^review \d+\.\d\/10$/.test(f[4]));
  check("card: home key is 4A F minor", C.home, (h) => h.key === "4A" && /F minor/.test(h.name) && h.pct > 20);
  check("card: carries the mixing style, mood route and chapters", [C.style, C.route, C.chapters.length], ([s, r, n]) => /^The /.test(s) && / → /.test(r) && n >= 2);
  check("card: chips lead with the trusted genre and stay ≤ 9", C.chips, (c) => c[0] === "drum & bass" && c.length <= 9);
  check("card: radar has 8 axes in 0–1", C.axes, (a) => a.length === 8 && a.every((x) => x.v >= 0 && x.v <= 1));
  check("card: the prompt is the keywords-only one (≤ 300)", C.prompt.length, (n) => n > 20 && n <= 300);
  const off = new Set(["g:Drum n Bass"]);
  check("card: follows the chips switched off on the page", cardData(D, { off }).chips, (c) => !c.includes("drum & bass"));
}

/* ---------------- tracklist formats (web/js/tracklist.js) */
{
  const D = demo("worship-part-1"), L = tracklist(D);
  const yt = L.youtube.trim().split("\n").slice(1);
  check("youtube: the first chapter is 0:00", yt[0], (l) => l.startsWith("0:00 "));
  check("youtube: at least three chapters, each 10 s or more", yt.map((l) => { const p = l.split(" ")[0].split(":").map(Number); return p.reduce((a, x) => a * 60 + x, 0); }), (t) => t.length >= 3 && t.every((x, i) => !i || x - t[i - 1] >= 10));
  check("1001: [mm:ss] Artist - Title, IDs with their clues", L.tl1001.split("\n")[0], (l) => l === "[0:00] ID - ID (10A, 175 BPM)");
  check("cue: one TRACK per track, INDEX in mm:ss:ff", [L.cue.match(/TRACK \d\d AUDIO/g).length, L.cue.match(/INDEX 01 (\d\d:\d\d:\d\d)/g)[1]], ([n, idx]) => n === D.tracks.length && idx === "INDEX 01 02:01:00");
  check("cue: CRLF line ends and the recording's file", L.cue, (c) => c.includes("\r\n") && c.includes('FILE "Recording 9.m4a" WAVE'));
  const close = { title: "T", file: "x.mp3", tracks: [{ n: 1, start: 3, identified: true, title: "A", artist: "X" }, { n: 2, start: 60, identified: true, title: "B", artist: "Y" }, { n: 3, start: 65, identified: true, title: "C", artist: "Z" }, { n: 4, start: 200, identified: true, title: "D", artist: "W" }] };
  const Lc = tracklist(close);
  check("youtube: stamps under 10 s apart merge into one chapter", Lc.youtube, (y) => y.includes("1:00 Y – B / Z – C") && Lc.chapters === 3);
  check("cue: an .mp3 recording is FILE … MP3", Lc.cue, (c) => c.includes('FILE "x.mp3" MP3'));
  check("stamp: hours when the set runs past an hour", [stamp(59), stamp(3725)], ([a, b]) => a === "0:59" && b === "1:02:05");
}

/* ---------------- send to your phone (web/js/handoff.js) */
{
  const { promptLink } = await import(pathToFileURL(path.join(ROOT, "web/js/handoff.js")));
  const text = "A dark drum & bass playlist – Think “Sub Focus” & 1991. 100% vocal?";
  const L = promptLink(text, "apple", new URL("https://example.com/sets/set.html?demo=x#vibe"));
  const u = new URL(L.data), q = new URLSearchParams(u.hash.slice(1));
  check("handoff: a link to prompt.html next to the page, the prompt in its fragment only", [L.kind, u.pathname, u.search, q.get("p") === text, q.get("t")], ([k, p, s, ok, t]) => k === "link" && p === "/sets/prompt.html" && s === "" && ok && t === "apple");
  check("handoff: on localhost the code carries the text itself", [promptLink(text, "spotify", new URL("http://127.0.0.1:8791/set.html")), promptLink(text, "spotify", new URL("http://localhost/set.html"))], (v) => v.every((x) => x.kind === "text" && x.data === text));
}

/* ---------------- naming: retries, resuming (web/js/engine/naming.js), with a stand-in helper */
{
  const N = await import(pathToFileURL(path.join(ROOT, "web/js/engine/naming.js")));
  const SRATE = 16000, dur = 600, y = new Float32Array(dur * SRATE), span = [0, dur];
  const all = N.probeTimes(dur, span);
  const noWait = () => Promise.resolve();
  const realFetch = globalThis.fetch;
  // the stand-in answers every clip with "Song <t>", except as each test arranges
  const helper = (fail) => { let calls = 0; globalThis.fetch = async () => { calls++; if (fail(calls)) return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => ({ track: { id: `s${calls}`, title: `Song ${calls}`, artist: "A" }, offset: 3 }) }; }; return () => calls; };
  try {
    let waits = [];
    const calls1 = helper((c) => c >= 10 && c < 13);            // three failures in a row around the 10th clip
    const r1 = await N.identifyClips(y, span, { wait: (s) => (waits.push(s), Promise.resolve()) });
    check("naming: three failures in a row are retried, not the end (every clip named)", [r1.stopped, r1.probes.length, all.length, waits.join()], ([s, n, a, w]) => s === null && n === a && w === "5,15,30");
    helper((c) => c >= 8);                                       // Shazam never comes back after the 8th lookup
    waits = [];
    const r2 = await N.identifyClips(y, span, { wait: (s) => (waits.push(s), Promise.resolve()) });
    check("naming: a long outage stops after 5 retries, saying where", [r2.stoppedAt, r2.probes.length, waits.join(), r2.stopped], ([at, n, w, s]) => at === all[7] && n === 7 && w === "5,15,30,60,120" && /stopped answering at 2:52/.test(s));
    const calls3 = helper(() => false);
    const r3 = await N.identifyClips(y, span, { wait: noWait, known: r2.probes });
    check("naming: resuming asks only the clips not asked yet, and keeps the earlier ones", [calls3(), r3.probes.length, r3.probes[0].track.title], ([c, n, t]) => c === all.length - 7 && n === all.length && t === "Song 1");
  } finally { globalThis.fetch = realFetch; }
  // a set saved before probe_tracks existed: matched probes get their song back from the named tracks
  const saved = { probes: [{ t: 4, dur: 12, id: "111" }, { t: 28, dur: 12, id: null }, { t: 52, dur: 12, id: "222" }, { t: 76, dur: 12, id: "999" }],
    tracks: [{ meta: { id: "111", title: "One" } }, { meta: { id: "222", title: "Two" } }, { meta: null }] };
  check("naming: restoreProbes rebuilds an older set (an unknown match is left to ask again)", N.restoreProbes(saved).map((p) => `${p.t}:${p.track ? p.track.title : "-"}`).join(), (s) => s === "4:One,28:-,52:Two");
  check("naming: restoreProbes prefers the saved song table", N.restoreProbes({ ...saved, probe_tracks: { 999: { id: "999", title: "Nine" } } }).length, (n) => n === 4);
}

/* ---------------- track table (web/js/table.js) */
{
  const D = demo("worship-part-2"), T = trackTable(D);
  check("table: a row per track, every column filled where the data exists", [T.rows.length, T.rows[2].cells.title.text, T.rows[2].cells.key.v, T.rows[1].cells.smooth.v], ([n, t, k, s]) => n === 19 && t === "Renaissance (Edit)" && k === "4A" && s >= 0 && s <= 100);
  check("table: the opener has no mix in; the rest each have one", T.rows.map((r) => r.cells.mix.v != null), (v) => !v[0] && v.slice(1).every(Boolean));
  const csv = toCSV(T), lines = csv.trim().split("\r\n");
  check("CSV: a header and a row per track, CRLF, plays in seconds", [lines.length, lines[0].split(",").slice(0, 4).join(), lines[3].split(",")[2]], ([n, h, p]) => n === 20 && h === "n,start,plays_s,track" && /^\d+$/.test(p));
  const q = toCSV({ cols: [{ id: "title", label: "Track" }], rows: [{ cells: { title: { v: 'A, "B"', text: 'A, "B"' } } }] });
  check("CSV: commas and quotes are quoted", q, (s) => s === 'track\r\n"A, ""B"""\r\n');
}

/* ---------------- tempo journey (web/js/tempo.js) */
{
  for (const slug of ["worship-part-1", "worship-part-2"]) check(`${slug}: the tempo is locked near 175 BPM`, tempoJourney(demo(slug)), (T) => T.locked && /^Locked at 17[56] BPM/.test(T.sentence) && !/climb|slowdown/.test(T.sentence));
  const mk = (bp) => ({ duration: bp.length * 300, summary: {}, tracks: bp.map((b, i) => ({ n: i + 1, start: i * 300, end: (i + 1) * 300, bpm: b })) });
  const G = tempoJourney(mk(Array.from({ length: 19 }, (_, i) => (i === 12 ? 63.5 : 122 + (8 * i) / 18))));
  check("tempo: a gradual climb (0.4 BPM a track) is a ramp, through a half-time track", [Math.round(G.ramps[0].from), Math.round(G.ramps[0].to), G.ramps[0].dir], ([a, b, d]) => a === 122 && b === 130 && d === 1);
  check("tempo: half-time doesn't stretch the range; the switches are named", [Math.round(G.lo), Math.round(G.hi), G.jumps.map((j) => j.kind).join()], ([lo, hi, k]) => lo === 122 && hi === 130 && k === "half-time,double-time");
  const S2 = tempoJourney(mk([128, 128, 129, 130, 131, 132, 132, 130, 129, 128, 127, 126, 125, 124]));
  check("tempo: a climb then a longer slowdown leads with the slowdown", S2.sentence, (s) => /biggest slowdown: 132 to 124 BPM/.test(s));
  check("tempo: a 14 BPM jump is a sudden change, not a ramp", tempoJourney(mk([124, 124, 125, 140, 140, 141])), (T) => T.jumps.length === 1 && T.jumps[0].kind === "jump up" && T.ramps.every((r) => Math.abs(r.to - r.from) < 14));
  {
    const ramp = demo("worship-part-2");
    ramp.tracks.forEach((t, i) => (t.bpm = i === 12 ? 63.5 : 122 + (8 * i) / (ramp.tracks.length - 1)));
    ramp.summary.bpm_min = 63.5; ramp.summary.bpm_max = 130;
    const t = buildPrompt(vibeProfile(ramp)).full;
    check("tempo → prompt: a long climb reads as one, and half-time doesn't widen it", t, (x) => /climbing from 122 to 130 BPM/.test(x) && !/64–130|63–130/.test(x));
    check("tempo → prompt: a locked set stays 'around 175 BPM'", buildPrompt(vibeProfile(demo("worship-part-1"))).full, (x) => /around 17[56] BPM/.test(x));
  }
  check("tempo: fewer than three tracks with a tempo, none", tempoJourney(mk([128, 130])), (v) => v === null);
}

/* ---------------- vocal map (web/js/vocals.js) */
{
  const D = demo("worship-part-2"), V = vocalMap(D);
  check("vocals: windows stay inside the set, scores 0–1", V.cells, (c) => c.every((x) => x.t0 >= V.s0 && x.t1 <= V.s1 + 1e-6 && x.v >= 0 && x.v <= 1));
  check("vocals: every track tagged vocal, mixed or instrumental", V.tracks, (t) => t.length === D.tracks.length && t.every((x) => ["vocal", "mixed", "instrumental"].includes(x.tag)));
  check("vocals: part 2 sings most in its last third", [V.thirds.indexOf(Math.max(...V.thirds)), V.sentence], ([i, s]) => i === 2 && /sit in the last third/.test(s));
  const synth = { duration: 600, summary: {}, curves: { moods: { step: 10, v: { voice_instrumental: Array.from({ length: 60 }, (_, i) => (i < 30 ? 0.9 : 0.05)) } } }, tracks: [{ n: 1, start: 0, end: 300 }, { n: 2, start: 300, end: 600 }] };
  const S2 = vocalMap(synth);
  check("vocals: a sung half then an instrumental half", [S2.tracks[0].tag, S2.tracks[1].tag, S2.runs.length, Math.round(S2.longestInst.t1 - S2.longestInst.t0)], ([a, b, r, l]) => a === "vocal" && b === "instrumental" && r === 1 && l >= 280);
  check("vocals: no vocal curve, no map", vocalMap({ duration: 10, tracks: [] }), (v) => v === null);
}

/* ---------------- pacing (web/js/pacing.js) */
{
  const D = demo("worship-part-2"), P = pacing(D);
  check("pacing: every track's play time, summing to the set", [P.tracks.length, Math.round(P.tracks.reduce((a, t) => a + t.play, 0))], ([n, s]) => n === D.tracks.length && Math.abs(s - (P.s1 - P.s0)) < 5);
  check("pacing: median 1:56, shortest 0:48, longest 4:46", [Math.round(P.stats.median), Math.round(P.stats.shortest.play), Math.round(P.stats.longest.play)], ([m, a, b]) => m === 116 && a === 48 && b === 286);
  check("pacing: the quickest 8 minutes hold 6 tracks", P.quick, (q) => q.count === 6 && q.t1 - q.t0 === 480);
  const mk = (lens) => { let t = 0; return { duration: lens.reduce((a, b) => a + b, 0), summary: {}, tracks: lens.map((l, i) => ({ n: i + 1, start: t, end: (t += l), bpm: 128 })) }; };
  check("pacing: 60 s tracks are quick-fire; 5-minute ones long-form", [pacing(mk(Array(12).fill(60))).style.id, pacing(mk(Array(8).fill(300))).style.id], ([a, b]) => a === "quick" && b === "long");
  check("pacing: shorter tracks in the second half speed it up", pacing(mk([240, 240, 240, 240, 90, 90, 90, 90, 90, 90])).trend, (t) => t === "speeds up");
  check("pacing: bars at the track's tempo (120 s at 128 BPM = 64 bars)", pacing(mk([120, 120, 120, 120])).tracks[0].bars, (b) => b === 64);
}

/* ---------------- set shape (web/js/shape.js) */
{
  const B = setShape(demo("worship-part-2"));
  check("shape: worship part 2 is a wind-down", [B.best.id, B.best.match], ([id, m]) => id === "down" && m >= 70);
  check("shape: matches are ranked, 0–100, one per template", B.matches, (m) => m.length === SHAPES.length && m.every((x, i) => x.match >= 0 && x.match <= 100 && (!i || x.r <= m[i - 1].r)));
  // synthetic sets: each template played back as a set should match itself best
  const synth = (f, n = 1800) => ({ duration: n, summary: { set_start: 0, set_end: n }, curves: { energy: { step: 1, v: Array.from({ length: n }, (_, i) => 3 + 4 * f(i / (n - 1))) } }, tracks: [] });
  for (const s of SHAPES) {
    const tpl = (x) => { const k = Math.min(s.t.length - 1, Math.round(x * (s.t.length - 1))); return s.t[k]; };
    check(`shape: a set drawn as "${s.name}" matches it best`, setShape(synth(tpl)).best.id, (id) => id === s.id);
  }
  check("shape: a flat set is level, with no best shape", setShape(synth(() => 0.5 + 0.01 * Math.sin(1)) ), (x) => x.level && x.best === null);
  const waves = synth((x) => 0.5 - 0.5 * Math.cos(x * 6 * Math.PI));
  waves.tracks = [{ n: 1, start: 0, end: 1800, bpm: 128, energy: 5 }];
  check("shape: a set in waves tells the prompt to ride it in waves", vibeProfile(waves).flow.id, (id) => id === "waves");
}

/* ---------------- a prompt for the part around a moment (phases.around) */
{
  const D = demo("worship-part-2"), p = around(D, 8);
  check("around: track index 8 spans tracks 8–10, centered on 9", [p.from, p.to, p.center, p.label], ([a, b, c, l]) => a === 8 && b === 10 && c === 9 && l === "Tracks 8–10");
  check("around: the span is measured like a chapter (styles, keys)", [p.styles.length, p.keys.length, p.end > p.start], ([s, k, ok]) => s > 0 && k > 0 && ok);
  check("around: the first and last tracks clamp to two", [around(D, 0).label, around(D, 99).label], ([a, b]) => a === "Tracks 1–2" && b === "Tracks 18–19");
  const P = vibeProfile(slicePayload(D, p));
  check("around: the prompt for a moment keeps the set's genre", buildPrompt(P).full, (t) => /drum & bass/.test(t));
}

/* ---------------- frequency balance (web/js/balance.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), B = soundBalance(D);
  check(`${slug}: every balance window's three shares sum to 1`, B.bins.map((b) => b.low + b.mid + b.high), (v) => v.length > 50 && v.every((x) => Math.abs(x - 1) < 1e-9));
  check(`${slug}: windows run in order inside the set`, B.bins, (b) => b.every((x, i) => x.t0 >= B.s0 - 1e-6 && x.t1 <= B.s1 + 1e-6 && (!i || x.t0 > b[i - 1].t0)));
  check(`${slug}: every track gets a lean; the heaviest is bass-heavy`, [B.tracks.length, D.tracks.length, B.heaviest.lean], ([a, b, l]) => a === b && l === "bass-heavy");
}
{
  // a synthetic set: bass for the first half, highs for the second
  const N = 8 * 400, wave = { low: [], mid: [], high: [] };
  for (let i = 0; i < N; i++) { const late = i >= N / 2; wave.low.push(late ? 10 : 60); wave.mid.push(20); wave.high.push(late ? 60 : 10); }
  const D = { duration: 400, summary: {}, curves: { wave, wave_fps: 8 }, tracks: [{ n: 1, start: 0, end: 200 }, { n: 2, start: 200, end: 400 }] };
  const B = soundBalance(D);
  check("balance: bass then highs reads as bass-heavy, then bright, getting brighter", [B.tracks[0].lean, B.tracks[1].lean, B.trend], ([a, b, t]) => a === "bass-heavy" && b === "bright" && t === "brighter");
  check("balance: no waveform, no chart", soundBalance({ duration: 10, tracks: [] }), (v) => v === null);
}

/* ---------------- key journey (web/js/keyline.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), K = keyTimeline(D);
  check(`${slug}: stretches tile the set in order, one per run of a key`, K.segs, (s) => s.every((x, i) => x.end > x.start && (!i || (x.start >= s[i - 1].start && x.key !== s[i - 1].key))));
  check(`${slug}: unwrapping keeps every move within half the wheel`, K.moves.map((m) => Math.abs(m.step)), (v) => v.every((x) => x <= 6));
  check(`${slug}: up + down + relative moves add up to the changes`, [K.up, K.down, K.moves.filter((m) => m.step === 0).length, K.moves.length], ([u, d, r, n]) => u + d + r === n);
}
{
  const wrap = { duration: 600, summary: {}, tracks: ["11A", "12A", "1A", "2A"].map((k, i) => ({ n: i + 1, start: i * 150, end: (i + 1) * 150, key: { camelot: k } })) };
  check("key journey: 11A → 12A → 1A → 2A climbs steadily (12 → 1 is one step up)", keyTimeline(wrap).segs.map((s) => s.level), (l) => l.join() === "11,12,13,14");
}

/* ---------------- taste across sets (web/js/taste.js) */
{
  const both = ["worship-part-1", "worship-part-2"].map((s) => ({ title: s, payload: demo(s) }));
  const T = taste(both);
  check("taste: two sets, their hours and every track", [T.sets, Math.round(T.hours * 60), T.tracks], ([n, m, t]) => n === 2 && m === Math.round((demo("worship-part-1").summary.set_length + demo("worship-part-2").summary.set_length) / 60) && t === 32);
  check("taste: artists from both sets (Sub Focus, Culture Shock)", T.artists, (a) => a.includes("Sub Focus") && a.includes("Culture Shock"));
  check("taste: the prompt keeps the shared sound and drops the per-set flow lines", T.prompt.full, (t) => /drum & bass/.test(t) && !/Order it like a DJ set|Let the mood move/.test(t));
  check("taste: one set isn't enough", taste(both.slice(0, 1)), (v) => v === null);
}

/* ---------------- track roles (web/js/roles.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), R = roles(D, similarity(D)), all = Object.entries(R).flatMap(([n, rs]) => rs.map((r) => ({ n: +n, ...r })));
  const e = D.tracks.map((t) => t.energy);
  check(`${slug}: one Peak, on the most energetic track`, all.filter((r) => r.tag === "Peak").map((r) => r.n), (v) => v.length === 1 && e[v[0] - 1] === Math.max(...e));
  check(`${slug}: at most two Cores and two Curveballs, two tags a track`, [all.filter((r) => r.tag === "Core").length, all.filter((r) => r.tag === "Curveball").length, Math.max(...Object.values(R).map((v) => v.length))], ([c, cb, m]) => c <= 2 && cb <= 2 && m <= 2);
  check(`${slug}: every Lift is a real jump of 1.5+`, all.filter((r) => r.tag === "Lift").map((r) => e[r.n - 1] - e[r.n - 2]), (v) => v.every((d) => d >= 1.5));
  check(`${slug}: every tag gives a reason`, all, (v) => v.length >= 5 && v.every((r) => r.why && r.why.length > 10));
}

/* ---------------- the review (web/js/review.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), Rv = review(D);
  check(`${slug}: five scores, each 0–10, overall is their mean`, Rv, (r) => r.scores.length === 5 && r.scores.every((x) => x.v >= 0 && x.v <= 10) && Math.abs(r.overall - r.scores.reduce((a, x) => a + x.v, 0) / 5) < 0.06);
  check(`${slug}: mixing and harmony scores come straight from the mixing breakdown`, [Rv.scores[0].v, Rv.scores[1].v], ([m, h]) => { const C = craftProfile(D); return Math.abs(m - C.stats.smooth / 10) < 0.06 && Math.abs(h - (C.stats.harmonicPct + C.stats.partialPct / 2) / 10) < 0.06; });
  check(`${slug}: three paragraphs that name the genre, the chapters and the mixing style`, Rv.paragraphs, (p) => p.length === 3 && /drum & bass/.test(p[0]) && /chapters/.test(p[1]) && /technician/.test(p[2]));
  check(`${slug}: the prose draws on the shape, vocals and pacing`, Rv.paragraphs, (p) => /arc is closest to a wind-down/.test(p[1]) && /Vocals/.test(p[0]) && /The pacing is steady: a typical track gets \d+:\d\d/.test(p[2]));
  check(`${slug}: the prose reads as description, not instruction`, Rv.paragraphs.join(" "), (t) => !/, turn |and end |keep the mood|\) \(/.test(t));
}
{
  // a single short song (a SoundCloud track, say) is one chapter, not none: the page used to crash on it
  const song = { duration: 143, summary: { set_start: 0, set_end: 143 }, curves: {}, tracks: [{ n: 1, start: 0, end: 143, energy: 5, bpm: 97 }] };
  check("phases: a 2-minute single song is one chapter", findPhases(song).length, (n) => n === 1);
}
check("review: fewer than four tracks, none", review({ tracks: [{ n: 1 }], summary: {} }), (v) => v === null);

/* ---------------- track by track (web/js/similarity.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), X = similarity(D), n = D.tracks.length;
  check(`${slug}: an n × n matrix, 1 on the diagonal, symmetric, all 0–1`, X.M, (M) => M.length === n && M.every((r, i) => r.length === n && r[i] === 1 && r.every((v, j) => v >= 0 && v <= 1 && v === M[j][i])));
  check(`${slug}: the consistent stretch, the echo and the hardest turn are where they should be`, [X.run, X.echo, X.turn], ([r, e, t]) => r.to > r.from && e.b - e.a >= 4 && t.b === t.a + 1);
  check(`${slug}: the hardest turn is the least alike pair of neighbors`, X.turn.v, (v) => v === Math.min(...X.M.slice(1).map((_, i) => X.M[i][i + 1])));
}
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const X = similarity(demo(slug));
  check(`${slug}: the most consistent stretch is smoother than the set's average hand-over`, [X.run.mean, X.flowAvg], ([r, f]) => r > f);
}
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), X = similarity(D), C = idClues(D, X, trust);
  const entries = Object.entries(C);
  check(`${slug}: ID clues point only at trusted named tracks, at least 80% alike`, entries.map(([n, c]) => [D.tracks[+n - 1].identified, D.tracks[c.n - 1].identified, trust(D.tracks[c.n - 1]), c.v]), (v) => v.length >= 2 && v.every(([idd, named, t, s]) => !idd && named && t >= 0.6 && s >= 0.8));
}
check("worship-part-2: no single track is every ID's clue", new Set(Object.values(idClues(demo("worship-part-2"), similarity(demo("worship-part-2")), trust)).map((c) => c.n)).size, (n) => n >= 3);
check("tracklist: a hint joins an ID's clues", tracklist(demo("worship-part-2"), { hint: (tr) => (tr.n === 4 ? "sounds like Sub Focus – Illuminate" : null) }).text.split("\n").find((l) => /^\S+  ID – ID/.test(l) && l.includes("sounds like")), (l) => /\(4A, 17\d BPM, sounds like Sub Focus – Illuminate\)$/.test(l || ""));
check("similarity: fewer than four tracks, none", similarity({ tracks: [{ n: 1 }, { n: 2 }, { n: 3 }] }), (v) => v === null);

/* ---------------- highlights (web/js/highlights.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), H = highlights(D);
  check(`${slug}: 5–10 highlights, in time order`, H.items.map((h) => h.t), (t) => t.length >= 5 && t.length <= 10 && t.every((x, i) => !i || x > t[i - 1]));
  check(`${slug}: no two highlights within 25 s`, H.items.map((h) => h.t), (t) => t.every((x, i) => !i || x - t[i - 1] >= 25));
  check(`${slug}: every highlight is inside the set, with a 15–30 s listen`, H.items, (v) => v.every((h) => h.t >= (D.summary.set_start || 0) && h.t < D.summary.set_end && h.dur >= 15 && h.dur <= 30 && Number.isInteger(h.dur)));
  check(`${slug}: the biggest drop is among them`, H.items.map((h) => h.title), (t) => t.includes("The biggest drop"));
  check(`${slug}: the reel is a few minutes`, H.reel, (s) => s >= 90 && s <= 300);
}
check("highlights: names come from the page", highlights(demo("worship-part-2"), (n) => `#${n}`).items.some((h) => /#\d+/.test(h.why)), (v) => v === true);

/* ---------------- drop anatomy (web/js/drops.js) */
for (const slug of ["worship-part-1", "worship-part-2"]) {
  const D = demo(slug), A = dropAnatomy(D);
  check(`${slug}: one curve per drop, 97 half-second points each`, A.rows.map((r) => r.curve.length), (v) => v.length === D.drops.length && v.every((n) => n === 97));
  const at = (dt) => A.mean[A.xs.indexOf(dt)];
  check(`${slug}: on average the bass is lower just before the drop than just after`, [at(-3), at(3)], ([b, a]) => b < a);
  check(`${slug}: the biggest drop has the largest impact`, A.biggest.impact_db, (x) => x === Math.max(...D.drops.map((d) => d.impact_db)));
  check(`${slug}: the sentence counts the drops`, A.sentence, (t) => t.startsWith(`${D.drops.length} drops`));
}
check("drops: part 1 reads as quick switch-ups, part 2 as classic builds", [dropAnatomy(demo("worship-part-1")).style.id, dropAnatomy(demo("worship-part-2")).style.id], ([a, b]) => a === "switch" && b === "build");
check("drops: fewer than two drops, no anatomy", dropAnatomy({ drops: [{ t: 10 }], curves: { wave_fps: 8, wave: { low: [1, 2, 3] } } }), (v) => v === null);

/* ---------------- two sets side by side (web/js/compare.js) */
{
  const A = demo("worship-part-1"), B = demo("worship-part-2");
  const C = compareSets(A, B), self = compareSets(A, A);
  check("compare: a set against itself scores 100", self.score, (s) => s === 100);
  check("compare: the two demos (same DJ, same genre) score high", C.score, (s) => s >= 70 && s < 100);
  check("compare: every part is 0–1", Object.values(C.parts).filter((v) => v != null), (v) => v.every((x) => x >= 0 && x <= 1));
  check("compare: both demos share drum & bass and Sub Focus", [C.genres.both, C.artists], ([g, a]) => g.includes("Drum n Bass") && a.includes("Sub Focus"));
  check("compare: differences are sentences naming the first set", C.diffs, (d) => d.length >= 1 && d.every((x) => x.endsWith(".")));
  check("compare: score is symmetric", compareSets(B, A).score, (s) => s === C.score);
  const M = mergePayloads(A, B);
  check("blend: all tracks, renumbered in order", M.tracks.map((t) => t.n), (n) => n.length === A.tracks.length + B.tracks.length && n.every((x, i) => x === i + 1));
  check("blend: the second set's tracks come after the first's", M.tracks[A.tracks.length].start, (t) => t >= M.tracks[A.tracks.length - 1].end - 1);
  check("blend: length is both sets' length", M.summary.set_length, (l) => Math.abs(l - A.summary.set_length - B.summary.set_length) < 1);
  check("blend: style shares stay a distribution", M.summary.styles.reduce((s, x) => s + x.share, 0), (x) => x > 0.5 && x <= 1.0001);
  check("blend: writes one prompt naming both sets' artists", buildPrompt(vibeProfile(M)).full, (t) => t.includes("drum & bass") && t.includes("Sub Focus") && t.includes("Culture Shock"));
}

/* ---------------- pieces */
check("artistsOf splits co-artists and finds remixers", [...artistsOf("Timewarp (Dimension Remix)", "Sub Focus & Wilkinson").keys()], (a) => a.join("|") === "Sub Focus|Wilkinson|Dimension");
check("artistsOf: crowded credits get half weight", [...artistsOf("", "A, B, C & D").values()], (w) => w.every((x) => x === 0.5));
check("trust: off-genre match is discounted", [trust({ shazam_hits: 1, id_confidence: 0.1, meta: { genre: "New Age" } }), trust({ shazam_hits: 1, id_confidence: 0.1, meta: { genre: "Dance" } })], ([a, b]) => a < b / 2);

/* ---------------- a bare set: no names, no styles, no curves */
const bare = { title: "Bare", duration: 600, summary: { bpm_avg: 124, bpm_min: 122, bpm_max: 126, styles: [{ style: "Tech House", share: 0.5 }] },
  tracks: [{ n: 1, start: 0, end: 600, identified: false, bpm: 124, energy: 6, key: { camelot: "8A" }, moods: {} }], drops: [] };
const PB = vibeProfile(bare);
const pb = buildPrompt(PB);
check("bare set: still writes a prompt", pb.full, (t) => /^A driving tech house playlist \(around 124 BPM\)/.test(t));
check("bare set: no artist sentence", pb.full, (t) => !t.includes("Think"));
check("strength: a bare set without names suggests naming IDs", promptStrength(vibeProfile(bare)).tip, (t) => /name some of the set's IDs/.test(t));

let bad = 0;
for (const [name, v, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : v}`); if (!ok) bad++; }
console.log(bad ? `\n${bad} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
