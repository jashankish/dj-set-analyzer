#!/usr/bin/env node
/* End-to-end test of the packaged website in a real (headless) browser.

     bash tools/build-site.sh && node tools/e2e.mjs [--browser chromium|firefox|webkit] [--chrome]
     node tools/e2e.mjs --url https://example.com/set-replay/      (any served copy, e.g. a deployment)

   Serves dist/set-replay/ from a sub-folder on a tiny static server, opens the
   landing page, gives the file input the synthetic set (tools/synth.mjs),
   presses Analyze, waits for the result page and checks it, then exercises
   play/pause, Space, the mix inspector, download + import and two-click delete,
   and finally naming through a stand-in naming helper with known answers. Uses Playwright's
   Chromium (npx playwright install chromium), or with --chrome your installed
   Chrome. Always a fresh temporary profile. Exits non-zero on failure. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, "dist", "set-replay");
const args = process.argv.slice(2);
const useChrome = args.includes("--chrome");
const engine = args.includes("--browser") ? args[args.indexOf("--browser") + 1] : "chromium";   // chromium | firefox | webkit
const pwDir = args.includes("--pw") ? args[args.indexOf("--pw") + 1] : null;
// --url: test an already-served copy (e.g. http://localhost:8080/set-replay/ or the live site) instead of dist/
const remote = args.includes("--url") ? args[args.indexOf("--url") + 1].replace(/\/?$/, "/") : null;
if (!remote && !fs.existsSync(path.join(SITE, "index.html"))) { console.error("Build the site first: bash tools/build-site.sh"); process.exit(2); }

const require = createRequire(pwDir ? path.join(path.resolve(pwDir), "x.js") : import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("playwright-core"); }

/* wait for the analysis to open its result page; if the queue shows an error
   instead, or time runs out, fail with what the page says rather than a bare timeout */
async function waitForResult(pg, consoleErrs) {
  try {
    await Promise.race([
      pg.waitForURL(/set\.html\?id=/, { timeout: 240000 }),
      pg.waitForSelector(".q-state.err", { timeout: 240000 }).then(async () => { throw new Error("the analysis failed"); }),
    ]);
  } catch (e) {
    const queue = await pg.locator(".q-state").allTextContents().catch(() => []);
    throw new Error(`${String(e.message).split("\n")[0]} | queue: ${queue.join(" / ") || "—"} | console: ${consoleErrs.slice(-3).join(" / ") || "—"}`);
  }
}

/* ---------------- static server: /set-replay/ → dist/set-replay */
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".onnx": "application/octet-stream", ".wav": "audio/wav", ".py": "text/x-python", ".md": "text/markdown" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!u.startsWith("/set-replay/")) { res.writeHead(404); return res.end(); }
  let f = path.join(SITE, u.slice("/set-replay/".length));
  if (!f.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(f).pipe(res);
});
let BASE = remote;
if (!remote) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  BASE = `http://127.0.0.1:${server.address().port}/set-replay/`;
}
console.log(`site: ${BASE}`);

/* ---------------- the synthetic set as a WAV file */
const { makeSet, wavBytes, SYNTH } = await import(pathToFileURL(path.join(ROOT, "tools/synth.mjs")));
const wav = path.join(os.tmpdir(), "set-replay-e2e.wav");
fs.writeFileSync(wav, wavBytes(makeSet(16000), 16000));

if (!pw[engine]) { console.error(`Unknown --browser ${engine}`); process.exit(2); }
// On a public site Chrome asks the visitor before a page may reach 127.0.0.1 (Local Network
// Access); headless can't click Allow, so switch the check off to stand in for that click.
const lnaArgs = remote && engine === "chromium" && !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(remote) ? ["--disable-features=LocalNetworkAccessChecks"] : [];
const browser = await pw[engine].launch(useChrome && engine === "chromium" ? { channel: "chrome", headless: true, args: lnaArgs } : { headless: true, args: lnaArgs });
console.log(`browser: ${engine} ${browser.version()}`);
const context = await browser.newContext({ acceptDownloads: true });
// only Chromium lets a test grant clipboard access; elsewhere that check is skipped
const canClip = engine === "chromium";
if (canClip) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
const where = () => { try { return new URL(page.url()).pathname.split("/").pop() || "index"; } catch (e) { return "?"; } };
page.on("pageerror", (e) => errors.push(`${where()}: ${String(e)}`));
const consoleErrs = [];
page.on("console", (m) => m.type() === "error" && consoleErrs.push(m.text().slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push(`${where()}: ${m.text()}`); });

const checks = [];
const check = (name, value, ok) => checks.push([name, value, ok(value)]);
const T = Date.now();
try {
  await page.goto(BASE);
  await page.waitForSelector("#demoList .card");
  check("landing shows the demos", await page.locator("#demoList .card").count(), (n) => n >= 1);
  const naming = page.locator("#nameTracks");
  if (await naming.count() && await naming.isChecked()) await naming.uncheck();
  await page.setInputFiles("#fileInput", wav);
  await page.waitForSelector(".q-item");
  check("queue shows the file", await page.locator(".q-name b").first().textContent(), (t) => t === "set-replay-e2e.wav");
  await page.click("#analyzeBtn");
  await waitForResult(page, consoleErrs);
  await page.waitForSelector(".trk");
  const story = await page.locator("#story").textContent();
  check("result page tells the story", story.slice(0, 60), (t) => /tracks in \d+ minutes/.test(t));
  check("finds the track change", await page.locator(".trk").count(), (n) => n >= 2);
  // the section bar, on a fresh result page (smooth scroll, no other interaction yet)
  await page.click('#pnav button[data-to="vibe"]');
  // wait for the section to arrive (headless Chrome can pause a smooth scroll mid-way;
  // the bar then corrects once the scroll stops), not merely for the scrolling to pause
  // arrived: the section sits just under the bar, or (a short page: the last section can't
  // rise that far) the page is scrolled to its bottom with the section in view
  const arrived = () => { const t = document.getElementById("vibe").getBoundingClientRect().top, end = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    return (t > 0 && t < 160) || (end && t > 0 && t < innerHeight * 0.6); };
  await page.waitForFunction((src) => (0, eval)(src)() && document.querySelector('#pnav [aria-current="true"]')?.dataset.to === "vibe", `(${arrived})`, { timeout: 6000 }).catch(() => {});
  check("the section bar smooth-scrolls to a section and marks it current", await page.evaluate((src) => [(0, eval)(src)(), Math.round(document.getElementById("vibe").getBoundingClientRect().top), document.querySelector('#pnav [aria-current="true"]')?.dataset.to], `(${arrived})`), ([ok, , cur]) => ok && cur === "vibe");
  await page.evaluate(() => window.scrollTo(0, 0));

  const bpm = await page.locator(".facts dd").nth(2).textContent();
  check(`tempo spans ${SYNTH.parts[0].bpm}-${SYNTH.parts[1].bpm} BPM`, bpm, (t) => { const m = t.match(/(\d+)\D+(\d+)/); return !!m && Math.abs(+m[1] - 128) <= 3 && Math.abs(+m[2] - 140) <= 3; });
  const keys = await page.locator(".trk .key-chip").allTextContents();
  check("keys A minor then D minor", keys.join(" "), (t) => t.startsWith("8A") && t.trim().endsWith("7A"));

  /* the replay controls (regressions: icon never switched; Space handling) */
  await page.click("#playBtn");
  await page.waitForFunction(() => !document.getElementById("audio").paused, null, { timeout: 15000 });
  check("Play plays and shows the pause icon", await page.evaluate(() => [
    document.querySelector(".i-play").hasAttribute("hidden"), !document.querySelector(".i-pause").hasAttribute("hidden"),
    document.getElementById("playBtn").getAttribute("aria-label")]), (v) => v[0] && v[1] && v[2] === "Pause");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("]");
  const fast = await page.evaluate(() => [document.getElementById("speedBtn").textContent, document.getElementById("audio").playbackRate]);
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  check("[ and ] change the playback speed (pitch kept)", [fast, await page.evaluate(() => [document.getElementById("speedBtn").textContent, document.getElementById("audio").playbackRate, document.getElementById("audio").preservesPitch !== false])], ([f, s]) => f[0] === "1.25×" && f[1] === 1.25 && s[0] === "0.75×" && s[1] === 0.75 && s[2]);
  await page.keyboard.press("]");
  check("Space pauses (nothing focused)", await page.evaluate(() => [document.getElementById("audio").paused, !document.querySelector(".i-play").hasAttribute("hidden")]), (v) => v[0] && v[1]);
  if (canClip) {
  await page.click("#copyBtn");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  await page.click("#tlMore summary");
  await page.click('#tlMore [data-f="youtube"]');
  check("YouTube chapters start at 0:00", (await page.evaluate(() => navigator.clipboard.readText())).split("\n").slice(0, 2), (l) => l[0] === "Tracklist:" && /^0:00 ID – ID \(8A, 12\d BPM\)$/.test(l[1]));
  await page.click("#tlMore summary");
  const [cueFile] = await Promise.all([page.waitForEvent("download"), page.click('#tlMore [data-f="cue"]')]);
  check("the CUE sheet downloads", cueFile.suggestedFilename(), (n) => n.endsWith(".cue"));
  check("Copy tracklist lists each ID with its key and tempo", copied.split("\n").slice(2, 4), (l) => /^0:00  ID – ID \(8A, 12\d BPM\)$/.test(l[0]) && /ID – ID \(7A, 1[34]\d BPM\)$/.test(l[1]));
  }
  await page.locator(".seam").first().click();
  check("a transition row opens the mix inspector", await page.locator("#mixTitle").textContent(), (t) => /^Mix 1: /.test(t));
  check("the vibe section writes a Spotify prompt", await page.locator("#vibePrompt").inputValue(), (t) => /^A .*playlist \(\d+–\d+ BPM\)/.test(t));
  await page.click("#cardBtn");
  const [cardFile] = await Promise.all([page.waitForEvent("download"), page.click("#cardDl")]);
  check("the set card downloads as a PNG", cardFile.suggestedFilename(), (n) => n.endsWith("set card.png"));
  await page.click("#cardClose");
  check("highlights pick moments from the short test set", await page.locator(".hl-card").count(), (n) => n >= 2);
  await page.click("#hlPlay");
  await page.waitForTimeout(1200);
  check("Play the highlights starts the reel at the first moment", await page.evaluate(() => [document.getElementById("hlPlay").textContent, !document.getElementById("audio").paused, !!document.querySelector(".hl-card.on")]), ([t, playing, on]) => /^Stop the reel \(1 of \d+\)$/.test(t) && playing && on);
  await page.evaluate(() => { document.getElementById("audio").currentTime = +document.querySelector(".hl-card.on").dataset.end - 0.3; });
  await page.waitForTimeout(1500);
  check("the reel moves on to the next moment when one ends", await page.locator("#hlPlay").textContent(), (t) => /^Stop the reel \(2 of \d+\)$/.test(t));
  await page.click("#hlPlay");
  await page.evaluate(() => document.getElementById("audio").pause());
  check("pressing it again stops the reel", await page.locator("#hlPlay").textContent(), (t) => t === "Play the highlights");
  check("one mix is too few for the mixing breakdown, so it hides", await page.locator("#craft").isHidden(), (h) => h === true);
  check("two tracks are too few for the mood map, so it hides", await page.locator("#moodmap").isHidden(), (h) => h === true);
  check("a 3-minute set is one chapter, so the chapters strip hides", await page.locator("#phases").evaluate((el) => el.closest(".j-block").hidden), (h) => h === true);
  check("the vibe radar has the whole set and the live track", await page.locator("#vibeRadar .vr-set, #vibeRadar .vr-now").count(), (n) => n === 2);

  /* download the analysis, then import it on the landing page */
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
  const exported = path.join(os.tmpdir(), "set-replay-e2e.setreplay.json");
  await download.saveAs(exported);
  check("Download the analysis gives a .setreplay.json", download.suggestedFilename(), (n) => n.endsWith(".setreplay.json"));

  await page.goto(BASE);
  await page.waitForSelector("#libList .card");
  check("set is saved in the library", await page.locator("#libList .card h3").first().textContent(), (t) => t === "set-replay-e2e");
  await page.setInputFiles("#fileInput", exported);
  await page.waitForFunction(() => document.querySelectorAll("#libList .card").length === 2, null, { timeout: 10000 });
  check("dropping the .setreplay.json imports it", await page.locator("#libList .card").count(), (n) => n === 2);
  await page.waitForFunction(() => !document.getElementById("taste").hidden && document.getElementById("tasteText").textContent.length > 20, null, { timeout: 8000 }).catch(() => {});
  check("with two sets saved, the landing writes one prompt across them", [await page.locator("#tasteTitle").textContent(), await page.locator("#tasteText").textContent()], ([h, t]) => h === "Your taste, across your sets" && /^A .* playlist/.test(t));
  fs.rmSync(exported, { force: true });

  /* deleting takes two clicks */
  const del = page.locator("#libList .card .del").first();
  await del.click({ force: true });
  check("first Delete click only arms it", [await page.locator("#libList .card").count(), await del.textContent()], (v) => v[0] === 2 && v[1] === "Click again to delete");
  await del.click({ force: true });
  await page.waitForFunction(() => document.querySelectorAll("#libList .card").length === 1, null, { timeout: 10000 });
  check("second click deletes", await page.locator("#libList .card").count(), (n) => n === 1);
  check("no page errors", errors, (e) => e.length === 0);
} catch (e) {
  checks.push(["flow completed", String(e).split("\n")[0], false]);
  // say where it got stuck: the queue's state and anything the page logged
  const q = await page.locator("#qList").textContent().catch(() => "(no queue)");
  console.log(`  queue: ${(q || "").replace(/\s+/g, " ").slice(0, 200)}`);
  console.log(`  page errors: ${JSON.stringify(errors).slice(0, 600)}`);
}

/* ---------------- a video of the set: only its soundtrack is analyzed and kept */
try {
  const ctxV = await browser.newContext();
  const pv = await ctxV.newPage();
  const errsV = [], consoleV = [];
  pv.on("pageerror", (e) => errsV.push(String(e)));
  pv.on("console", (m) => m.type() === "error" && consoleV.push(m.text().slice(0, 200)));
  await pv.goto(BASE);
  await pv.waitForSelector("#demoList .card");
  const naming = pv.locator("#nameTracks");
  if (await naming.count() && await naming.isChecked()) await naming.uncheck();
  await pv.setInputFiles("#fileInput", path.join(ROOT, "tools/fixtures/set-replay-e2e.mov"));
  await pv.waitForSelector(".q-item");
  check("video: a .mov is accepted into the queue", await pv.locator(".q-name b").first().textContent(), (t) => t === "set-replay-e2e.mov");
  // open-source browser builds (Playwright's Chromium, Linux Firefox without system codecs)
  // can't decode AAC at all: there, check the soundtrack is still taken out and the
  // visitor is told why it stopped, instead of failing on the browser's missing codec
  const aac = await pv.evaluate(() => !!document.createElement("audio").canPlayType('audio/mp4; codecs="mp4a.40.2"'));
  await pv.click("#analyzeBtn");
  if (!aac) {
    await pv.waitForSelector(".q-state.err", { timeout: 60000 });
    check("video (this browser build has no AAC decoder): the soundtrack is taken out and the visitor told why it stops", await pv.locator(".q-state").first().textContent(), (t) => /taken out of “set-replay-e2e\.mov”, but this browser can't decode its AAC/.test(t));
    await ctxV.close();
    throw Object.assign(new Error("skip"), { skip: true });
  }
  await waitForResult(pv, consoleV);
  await pv.waitForSelector(".trk");
  check("video: the set is found in its soundtrack", await pv.locator(".trk").count(), (n) => n >= 2);
  check("video: the set keeps the video's name", await pv.locator("#title").textContent(), (t) => t === "set-replay-e2e");
  const kept = await pv.evaluate(async () => { const b = await (await fetch(document.getElementById("audio").src)).blob(); return [b.type, b.size]; });
  check("video: what's stored is the extracted audio, not the video", kept, ([type, size]) => type === "audio/mp4" && size > 1e6 && size < fs.statSync(path.join(ROOT, "tools/fixtures/set-replay-e2e.mov")).size);
  check("video: no page errors", errsV, (e) => e.length === 0);
  // leave nothing stored: a context closing with a set (and its audio) in IndexedDB can
  // hold up browser.close() for minutes while the browser cleans up the blobs
  await pv.goto(BASE);
  await pv.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("set-replay"); q.onsuccess = q.onerror = q.onblocked = r; }));
  await ctxV.close();
} catch (e) {
  if (!e.skip) checks.push(["video flow completed", String(e).split("\n")[0], false]);
}

/* ---------------- on a phone: 390 x 844 with touch */
try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
  const p3 = await phone.newPage();
  const errs3 = [];
  p3.on("pageerror", (e) => errs3.push(String(e)));
  const overflow = () => p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await p3.goto(BASE);
  await p3.waitForSelector("#demoList .card");
  check("phone: landing has no sideways scroll", await overflow(), (px) => px <= 0);
  await p3.locator("#taste").scrollIntoViewIfNeeded();
  await p3.waitForFunction(() => document.getElementById("tasteText").textContent.length > 20, null, { timeout: 8000 }).catch(() => {});
  check("phone: with no sets saved, the landing shows one prompt across the demos", [await p3.locator("#tasteTitle").textContent(), await p3.locator("#tasteText").textContent()], ([h, t]) => h === "One playlist from several sets" && /drum & bass/.test(t));
  check("phone: the landing page links nine features to a demo", await p3.locator(".more-grid a").evaluateAll((as) => as.map((x) => x.getAttribute("href"))), (h) => h.length === 9 && h.every((x) => /^set\.html\?demo=[\w-]+#\w+$/.test(x)));
  await p3.goto(BASE + "set.html?demo=worship-part-2");
  await p3.waitForSelector(".trk");
  check("phone: replay page has no sideways scroll", await overflow(), (px) => px <= 0);
  check("phone: ribbon track numbers aren't cut off", await p3.evaluate(() =>
    [...document.querySelectorAll(".r-label")].filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent)), (v) => v.length === 0);
  const box = await p3.locator("#ribbon").boundingBox();
  await p3.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await p3.waitForTimeout(300);
  check("phone: tapping the ribbon moves the playhead", await p3.locator("#tCur").textContent(), (t) => t !== "0:00");
  check("phone: the demo's prompt reads as drum & bass, naming Sub Focus", await p3.locator("#vibePrompt").inputValue(), (t) => t.includes("drum & bass") && t.includes("Sub Focus"));
  await p3.locator('.chip[data-id="a:Sub Focus"]').tap();
  check("phone: tapping a keyword takes it out of the prompt", await p3.locator("#vibePrompt").inputValue(), (t) => !t.split("Start from")[0].includes("Sub Focus"));
  await p3.locator("#vibeShort").tap();
  check("phone: keywords-only prompt fits Spotify's 300 characters", (await p3.locator("#vibePrompt").inputValue()).length, (n) => n > 20 && n <= 300);
  check("phone: the mixing breakdown names a style", await p3.locator("#craftName").textContent(), (t) => /^The /.test(t));
  await p3.locator(".cc-col").nth(3).tap();
  check("phone: tapping a mix column opens that mix in the inspector", await p3.locator("#mixTitle").textContent(), (t) => /^Mix 4: /.test(t));
  await p3.locator("#reorder").scrollIntoViewIfNeeded();
  await p3.waitForFunction(() => document.querySelectorAll("#roSvg rect:not(.ro-clash)").length > 0, null, { timeout: 5000 }).catch(() => {});
  check("phone: a smoother running order is drawn when it comes into view (two rows of 19)", await p3.locator("#roSvg rect:not(.ro-clash)").count(), (n) => n === 38);
  await p3.locator("#roSave").tap();
  check("phone: saving the suggested order without a Spotify app explains what's needed", await p3.locator("#roStatus").textContent(), (t) => /Client ID/.test(t));
  check("phone: setlist transition rows show smoothness", await p3.locator(".seam-sm").count(), (n) => n === 18);
  check("phone: the inspector scores the mix's smoothness", await p3.locator("#mixNote").textContent(), (t) => /Smoothness \d+ of 100/.test(t));
  await p3.locator('#vibeTarget [data-t="youtube"]').tap();
  check("phone: sending to YouTube Music relabels Open and hides Save", [await p3.locator("#vibeOpen").textContent(), await p3.locator("#vibeSave").isHidden()], ([t, h]) => t === "Open YouTube Music" && h);
  await p3.locator('#vibeTarget [data-t="chat"]').tap();
  check("phone: the AI-chat prompt asks for a track list", await p3.locator("#vibePrompt").inputValue(), (t) => t.startsWith("Make me a playlist of about"));
  await p3.locator('#vibeTarget [data-t="spotify"]').tap();
  check("phone: time in key names the home key", await p3.locator(".kt-home").textContent(), (t) => /^Home key \d+[AB]/.test(t));
  await p3.locator("#cardBtn").tap();
  await p3.waitForTimeout(600);
  check("phone: the set card draws (dialog open, canvas filled)", await p3.evaluate(() => [document.getElementById("cardDlg").open, document.getElementById("cardCanvas").toDataURL().length]), ([o, n]) => o && n > 50000);
  await p3.locator("#cardClose").tap();
  await p3.waitForFunction(() => document.getElementById("cmpScore").textContent !== "", null, { timeout: 10000 }).catch(() => {});
  check("phone: compares with the other demo and writes a blend prompt", [await p3.locator("#cmpScore").textContent(), await p3.locator("#cmpPrompt").inputValue()], ([s, p]) => +s > 0 && +s <= 100 && /^A .* playlist/.test(p));
  check("phone: the vibe section lists the most typical tracks and the curveballs", await p3.locator("#vibeFit").textContent(), (t) => t.includes("Most like the set") && t.includes("Curveballs"));
  check("phone: drop anatomy describes the drops", await p3.locator("#dropLine").textContent(), (t) => /^\d+ drops, about one every/.test(t));
  check("phone: the demo's highlights are listed", await p3.locator(".hl-card").count(), (n) => n >= 5);
  await p3.locator(".hl-card").nth(2).tap();
  check("phone: tapping a highlight jumps to it", [await p3.locator("#tCur").textContent(), await p3.locator(".hl-card .hl-meta b").nth(2).textContent()], ([now, at]) => now === at);
  check("phone: the review scores the set and writes three paragraphs", [await p3.locator("#rvOverall").textContent(), await p3.locator("#rvText p").count()], ([o, n]) => /^\d+\.\d$/.test(o) && n === 3);
  check("phone: setlist rows carry track roles (Peak, Lift, Curveball…)", await p3.locator(".trk .role").allTextContents(), (v) => v.length >= 5 && v.includes("Peak"));
  check("phone: an ID's setlist subtitle names what it sounds like", await p3.locator('.trk[data-i="3"]').textContent(), (t) => /Unidentified · sounds like \S/.test(t));
  check("phone: track by track draws the matrix and three insights", [await p3.locator("#sxCanvas").count(), await p3.locator("#sxNotes .cb-mo").count()], ([c, n]) => c === 1 && n === 3);
  check("phone: the key journey counts the key changes", await p3.locator("#kjLine").textContent(), (t) => /^\d+ key changes?: \d+ up the wheel/.test(t));
  check("phone: the mood map places every track", await p3.locator(".mm-pt").count(), (n) => n === 19);
  await p3.locator(".mm-pt").nth(9).dispatchEvent("click");
  check("phone: tapping a track on the mood map plays it", await p3.locator(".mm-pt.now").getAttribute("data-i"), (i) => i === "9");
  check("phone: the section bar lists the page's sections", await p3.locator("#pnav button").allTextContents(), (v) => v.includes("Highlights") && v.includes("Spotify") && v.includes("Compare"));
  await p3.locator('#pnav button[data-to="vibe"]').tap();
  await p3.waitForTimeout(1200);
  check("phone: tapping a section jumps there and marks it current", await p3.evaluate(() => [Math.round(document.getElementById("vibe").getBoundingClientRect().top), document.querySelector('#pnav [aria-current="true"]')?.dataset.to]), ([top, cur]) => top > 0 && top < 160 && cur === "vibe");
  await p3.locator('#vibeRange [data-r="discover"]').tap();
  check("phone: Discover asks for new names and drops the set's own songs", await p3.locator("#vibePrompt").inputValue(), (t) => /lesser-known/.test(t) && !/Start from songs/.test(t));   // full or keywords-only, whichever is showing
  await p3.locator('#vibeRange [data-r="balanced"]').tap();
  check("phone: the prompt strength meter rates the demo's prompt", await p3.locator("#vibeStrength .vs-v").textContent(), (t) => /^\d+ (Strong|Good|Loose|Vague)$/.test(t.trim()));
  const idea = await p3.locator("#vibeOcc .chip").first().textContent();
  await p3.locator("#vibeOcc .chip").first().tap();
  check("phone: tapping an idea adds it to the prompt", await p3.locator("#vibePrompt").inputValue(), (t) => t.endsWith(`${idea}.`) || t.includes(idea));
  await p3.locator("#vibeOcc .chip").first().tap();
  await p3.goto(BASE + "set.html?demo=worship-part-2#vibe");
  await p3.waitForSelector(".trk");
  await p3.waitForFunction(() => { const t = document.getElementById("vibe").getBoundingClientRect().top; return t > 0 && t < 160; }, null, { timeout: 5000 }).catch(() => {});
  check("phone: a link to a section (#vibe) opens the set there", await p3.evaluate(() => Math.round(document.getElementById("vibe").getBoundingClientRect().top)), (t) => t > 0 && t < 160);
  check("phone: the demo plays in chapters", await p3.locator(".ph").count(), (n) => n >= 2);
  await p3.locator(".ph-vibe").last().tap();
  check("phone: a chapter's Spotify prompt button scopes the prompt to it", await p3.locator("#vibeScope [aria-selected=true]").textContent(), (t) => t !== "Whole set");
  check("phone: no page errors", errs3, (e) => e.length === 0);
  await phone.close();
} catch (e) {
  checks.push(["phone checks completed", String(e).split("\n")[0], false]);
}

/* ---------------- naming through the helper, with a stand-in helper that
   knows the answer: clips before 90 s are "Track A", later ones "Track B" */
const probeTimes = [];
for (let t = 4; t <= SYNTH.duration - 12; t += 24) probeTimes.push(t);
let asked = 0;
const mock = http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": req.headers.origin || "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Private-Network": "true" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const json = (o) => { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.url.startsWith("/health")) return json({ ok: true, name: "set-replay-helper", version: 1 });
  req.resume();
  req.on("end", () => {
    const t = probeTimes[Math.min(asked, probeTimes.length - 1)];
    asked++;
    const first = t + 6 < SYNTH.change;
    json({ track: { id: first ? "A" : "B", title: first ? "Track A" : "Track B", artist: "Test Artist" }, offset: first ? t : t - SYNTH.change });
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const helperUrl = `http://127.0.0.1:${mock.address().port}`;
try {
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript((url) => {
    localStorage.setItem("set-replay:helper-url", url);
    localStorage.setItem("set-replay:naming-helper", "1");    // as if the visitor had opened the pop-up
  }, helperUrl);
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on("pageerror", (e) => errs2.push(String(e)));
  const consoleErrs2 = [];
  p2.on("console", (m) => m.type() === "error" && consoleErrs2.push(m.text().slice(0, 200)));
  await p2.goto(BASE);
  await p2.waitForSelector("#nameTracks", { timeout: 10000 });
  check("naming bar finds the helper", await p2.locator("#naming").textContent(), (t) => /connected/i.test(t));
  await p2.setInputFiles("#fileInput", wav);
  await p2.click("#analyzeBtn");
  await waitForResult(p2, consoleErrs2);
  await p2.waitForSelector(".trk");
  check("the helper was asked once per probe", asked, (n) => n === probeTimes.length);
  check("story credits the names", (await p2.locator("#story").textContent()).slice(0, 120), (t) => /Shazam named (2|every one)/.test(t));
  check("tracks carry the helper's names", await p2.locator(".trk .name .t").allTextContents(), (v) => v.length === 2 && v[0].startsWith("Track A") && v[1].startsWith("Track B"));
  check("named swap lands near 90 s", await p2.locator(".trk .when").nth(1).textContent(), (t) => { const [m, sec] = t.split(":").map(Number); return Math.abs(m * 60 + sec - SYNTH.change) <= 20; });
  check("no page errors while naming", errs2, (e) => e.length === 0);
} catch (e) {
  checks.push(["naming flow completed", String(e).split("\n")[0], false]);
} finally {
  // every check is in by now; Chrome sometimes takes ~30 s (once ~300 s) to shut down
  // after the video flow, so don't let teardown hold the run up (the process exit ends it)
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
  server.close();
  mock.close();
  fs.rmSync(wav, { force: true });
}
let failed = 0;
for (const [name, value, ok] of checks) { failed += ok ? 0 : 1; console.log(`${ok ? "ok  " : "FAIL"}  ${name}  (got ${JSON.stringify(value)})`); }
console.log(`${checks.length - failed}/${checks.length} checks passed in ${((Date.now() - T) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
