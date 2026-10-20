#!/usr/bin/env node
/* Checks the page's own analyses on the bundled demo sets and on edge cases:
   the Spotify prompt writer (web/js/vibe.js), the chapter finder
   (web/js/phases.js) and the mixing breakdown (web/js/craft.js).
   No dependencies: node tools/analysis-test.mjs

   The demos are phone recordings of drum & bass sets (Sub Focus, Culture
   Shock, Dimension…) that the style model partly hears as "hardcore": the
   prompt must still lead with drum & bass, name the right artists, and
   leave out the Shazam matches that are clearly wrong (library music). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { vibeProfile, buildPrompt, defaultOff, artistsOf, trust, AXES } = await import(pathToFileURL(path.join(ROOT, "web/js/vibe.js")));
const { findPhases, slicePayload } = await import(pathToFileURL(path.join(ROOT, "web/js/phases.js")));
const { craftProfile, relationClass } = await import(pathToFileURL(path.join(ROOT, "web/js/craft.js")));
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
  const off = defaultOff(P);
  off.add("f:flow"); off.add("g:Drum n Bass");
  const p2 = buildPrompt(P, off, "for a late-night drive");
  check(`${slug}: switching chips off removes them`, p2.full, (t) => !t.includes("drum & bass") && !t.includes("Order it like"));
  check(`${slug}: own direction is appended`, p2.full, (t) => t.endsWith("for a late-night drive."));
}
check("part 2: hardcore (a room-noise artefact) is left out", vibeProfile(demo("worship-part-2")).genres.map((g) => g.style), (g) => !g.includes("Hardcore"));

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
check("no transitions, no profile", craftProfile({ tracks: [], transitions: [] }), (v) => v === null);

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
