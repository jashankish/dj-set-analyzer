#!/usr/bin/env node
/* Accessibility check: runs axe-core (WCAG 2.1 A and AA rules) over the
   landing page and a demo's set page, in a desktop and a phone viewport.

     npm i --no-save playwright@1.55.0 axe-core@4.14.0 jsqr@1.4.0   (jsqr: for tools/e2e.mjs)
     bash tools/build-site.sh && node tools/a11y.mjs [--chrome] [--pw DIR]

   Serves dist/set-replay/ like tools/e2e.mjs, scrolls each page to the bottom
   so lazily drawn sections render, and fails on any violation. --pw: a folder
   with node_modules/playwright and node_modules/axe-core. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, "dist", "set-replay");
const args = process.argv.slice(2);
const pwDir = args.includes("--pw") ? args[args.indexOf("--pw") + 1] : null;
const require = createRequire(pwDir ? path.join(path.resolve(pwDir), "x.js") : import.meta.url);
const { chromium } = require("playwright");
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".onnx": "application/octet-stream" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = path.join(SITE, u.replace(/^\/set-replay\//, ""));
  if (!f.startsWith(SITE) || !u.startsWith("/set-replay/")) { res.writeHead(404); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/set-replay/`;

const browser = await chromium.launch(args.includes("--chrome") ? { channel: "chrome" } : {});
let total = 0;
for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  for (const url of ["index.html", "set.html?demo=fred-again-rooftop-live", `prompt.html#${new URLSearchParams({ t: "spotify", p: "A dark, high-tempo drum & bass playlist" })}`]) {
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    await page.waitForSelector(url.startsWith("set") ? ".trk" : url.startsWith("prompt") ? "#how li" : "#demoList .card");
    // scroll through so lazy sections (the running order) draw, then back up
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
    await page.waitForTimeout(400);
    await page.addScriptTag({ content: AXE });
    const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
    const v = res.violations;
    total += v.length;
    console.log(`${v.length ? "FAIL" : "ok  "}  ${label} ${url}: ${v.length} violation${v.length === 1 ? "" : "s"} (${res.passes.length} rules pass)`);
    for (const x of v) {
      console.log(`      ${x.id} [${x.impact}] ${x.help} — ${x.nodes.length} element${x.nodes.length === 1 ? "" : "s"}`);
      x.nodes.slice(0, 4).forEach((n) => console.log(`        ${n.target.join(" ")}  ${(n.failureSummary || "").split("\n").slice(1, 2).join(" ").trim().slice(0, 140)}`));
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log(total ? `\n${total} violation group(s)` : "\nno accessibility violations");
process.exit(total ? 1 : 0);
