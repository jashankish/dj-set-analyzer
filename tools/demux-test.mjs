#!/usr/bin/env node
/* Checks the video soundtrack extractor (web/js/engine/demux.js) in plain Node:
     node tools/demux-test.mjs
   on tools/fixtures/set-replay-e2e.mov (3 min of H.264 video + AAC audio, written
   by ffmpeg with a QuickTime version 1 sound entry, the case WebKit can't decode
   until it's rewritten). The browser test decodes and analyzes the same file. */
import fs from "node:fs";
import path from "node:path";
import { File } from "node:buffer";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { extractAudio, isVideo } = await import(pathToFileURL(path.join(ROOT, "web/js/engine/demux.js")));
const checks = [];
const check = (name, value, ok) => checks.push([name, JSON.stringify(value), !!ok(value)]);

const movPath = path.join(ROOT, "tools/fixtures/set-replay-e2e.mov");
const movBytes = fs.readFileSync(movPath);
const mov = new File([movBytes], "set-replay-e2e.mov", { type: "video/quicktime" });
const out = await extractAudio(mov);
const b = new Uint8Array(await out.arrayBuffer());
const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const tag = (o) => String.fromCharCode(...b.subarray(o, o + 4));
const at = (t) => { const i = Buffer.from(b).indexOf(t); return i < 0 ? -1 : i - 4; };   // box start

check("a .mov counts as a video", isVideo(mov), (v) => v === true);
check("an .m4a doesn't", isVideo(new File([], "set.m4a", { type: "audio/mp4" })), (v) => v === false);
check("the result is an audio/mp4 named .m4a", [out.type, out.name], ([t, n]) => t === "audio/mp4" && n === "set-replay-e2e.m4a");
check("it's a fraction of the video's size", out.size / mov.size, (r) => r > 0.5 && r < 1);   // tiny 64×64 video here; phone video shrinks ~100×
check("boxes are ftyp, moov, mdat in that order", [tag(4), tag(u32(0) + 4), tag(u32(0) + u32(u32(0)) + 4)], (v) => v.join() === "ftyp,moov,mdat");
check("only one track is kept", Buffer.from(b).toString("latin1").split("trak").length - 1, (n) => n === 1);
const e = at("mp4a");
check("the sound entry is ISO version 0 with esds directly inside (WebKit decodes this)", [(b[e + 16] << 8) | b[e + 17], tag(e + 36 + 4)], ([v, child]) => v === 0 && child === "esds");
// every chunk offset points into mdat, and the bytes there are the original chunk's bytes
const stco = at("stco"), n = u32(stco + 12);
const mdat = u32(0) + u32(u32(0)), mdatEnd = mdat + u32(mdat);
const offs = Array.from({ length: n }, (_, i) => u32(stco + 16 + i * 4));
check("every chunk offset lands inside mdat, in order", offs.every((o, i) => o > mdat && o < mdatEnd && (!i || o > offs[i - 1])), (ok) => ok);
const src = Buffer.from(movBytes), first = src.indexOf(Buffer.from(b.subarray(offs[0], offs[0] + 64)));
check("the first chunk's bytes are copied from the video unchanged", first, (i) => i > 0);
check("not an MP4/MOV (a WAV): null, so the caller decodes it whole", await extractAudio(new File([Buffer.from("RIFF\0\0\0\0WAVEfmt ")], "x.wav")), (v) => v === null);
check("extracting the extracted file gives the same audio", (await extractAudio(new File([b], "x.m4a"))).size, (s) => s === out.size);

let bad = 0;
for (const [name, v, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : v}`); if (!ok) bad++; }
console.log(bad ? `\n${bad} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
