#!/usr/bin/env node
/* End-to-end test of the packaged website in a real (headless) browser.

     bash tools/build-site.sh && node tools/e2e.mjs [--chrome]

   Serves dist/set-replay/ from a sub-folder on a tiny static server, opens the
   landing page, gives the file input the synthetic set (tools/synth.mjs),
   presses Analyse, waits for the result page and checks it, then exercises
   play/pause, Space, the mix inspector, download + import and two-click delete. Uses Playwright's
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
const pwDir = args.includes("--pw") ? args[args.indexOf("--pw") + 1] : null;
if (!fs.existsSync(path.join(SITE, "index.html"))) { console.error("Build the site first: bash tools/build-site.sh"); process.exit(2); }

const require = createRequire(pwDir ? path.join(path.resolve(pwDir), "x.js") : import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("playwright-core"); }

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
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/set-replay/`;

/* ---------------- the synthetic set as a WAV file */
const { makeSet, wavBytes, SYNTH } = await import(pathToFileURL(path.join(ROOT, "tools/synth.mjs")));
const wav = path.join(os.tmpdir(), "set-replay-e2e.wav");
fs.writeFileSync(wav, wavBytes(makeSet(16000), 16000));

const browser = await pw.chromium.launch(useChrome ? { channel: "chrome", headless: true } : { headless: true });
const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

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
  await page.click("#analyseBtn");
  await page.waitForURL(/set\.html\?id=/, { timeout: 240000 });
  await page.waitForSelector(".trk");
  const story = await page.locator("#story").textContent();
  check("result page tells the story", story.slice(0, 60), (t) => /tracks in \d+ minutes/.test(t));
  check("finds the track change", await page.locator(".trk").count(), (n) => n >= 2);
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
  check("Space pauses (nothing focused)", await page.evaluate(() => [document.getElementById("audio").paused, !document.querySelector(".i-play").hasAttribute("hidden")]), (v) => v[0] && v[1]);
  await page.locator(".seam").first().click();
  check("a transition row opens the mix inspector", await page.locator("#mixTitle").textContent(), (t) => /^Mix 1: /.test(t));

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
} finally {
  await browser.close();
  server.close();
  fs.rmSync(wav, { force: true });
}
let failed = 0;
for (const [name, value, ok] of checks) { failed += ok ? 0 : 1; console.log(`${ok ? "ok  " : "FAIL"}  ${name}  (got ${JSON.stringify(value)})`); }
console.log(`${checks.length - failed}/${checks.length} checks passed in ${((Date.now() - T) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
