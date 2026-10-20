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
const { vibeProfile, buildPrompt, defaultOff, artistsOf, trust, AXES, trackFit } = await import(pathToFileURL(path.join(ROOT, "web/js/vibe.js")));
const { findPhases, slicePayload } = await import(pathToFileURL(path.join(ROOT, "web/js/phases.js")));
const { craftProfile, relationClass, mixScore } = await import(pathToFileURL(path.join(ROOT, "web/js/craft.js")));
const { moodMap } = await import(pathToFileURL(path.join(ROOT, "web/js/moodmap.js")));
const { cardData } = await import(pathToFileURL(path.join(ROOT, "web/js/card.js")));
const { compareSets, mergePayloads } = await import(pathToFileURL(path.join(ROOT, "web/js/compare.js")));
const demo = (s) => JSON.parse(fs.readFileSync(path.join(ROOT, "web/demo", `${s}.json`)));

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
check("part 2: hardcore (a room-noise artefact) is left out", vibeProfile(demo("worship-part-2")).genres.map((g) => g.style), (g) => !g.includes("Hardcore"));

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
  check("card: facts are length, tracks, tempo, in-key share", C.facts, (f) => f.length === 4 && f[1] === "19 tracks" && /BPM/.test(f[2]) && /% in key/.test(f[3]));
  check("card: home key is 4A F minor", C.home, (h) => h.key === "4A" && /F minor/.test(h.name) && h.pct > 20);
  check("card: carries the mixing style, mood route and chapters", [C.style, C.route, C.chapters.length], ([s, r, n]) => /^The /.test(s) && / → /.test(r) && n >= 2);
  check("card: chips lead with the trusted genre and stay ≤ 9", C.chips, (c) => c[0] === "drum & bass" && c.length <= 9);
  check("card: radar has 8 axes in 0–1", C.axes, (a) => a.length === 8 && a.every((x) => x.v >= 0 && x.v <= 1));
  check("card: the prompt is the keywords-only one (≤ 300)", C.prompt.length, (n) => n > 20 && n <= 300);
  const off = new Set(["g:Drum n Bass"]);
  check("card: follows the chips switched off on the page", cardData(D, { off }).chips, (c) => !c.includes("drum & bass"));
}

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

let bad = 0;
for (const [name, v, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : v}`); if (!ok) bad++; }
console.log(bad ? `\n${bad} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
