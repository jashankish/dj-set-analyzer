#!/usr/bin/env node
/* Draws the images link previews use, from a real demo set:
     web/og-image.png          1200 × 630, the card iMessage, Slack, X and others show
     web/apple-touch-icon.png  180 × 180, the icon iOS shows next to a link (it ignores SVG icons)
   They're committed; re-run only to change the design:
     node tools/make-share-images.mjs [--pw path/to/node_modules/playwright] [--chrome]
   Renders in headless Chromium (Playwright), so it uses the page's own Archivo font
   and key colors (web/js/color.js). */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const pwDir = args.includes("--pw") ? args[args.indexOf("--pw") + 1] : null;
const require = createRequire(pwDir ? path.join(path.resolve(pwDir), "x.js") : import.meta.url);
const { chromium } = require("playwright");

const D = JSON.parse(fs.readFileSync(path.join(ROOT, "web/demo/worship-part-1.json")));
const s0 = D.summary.set_start || 0, s1 = D.summary.set_end || D.duration;
const fps = D.curves.wave_fps, low = D.curves.wave.low, mid = D.curves.wave.mid;
// the set's waveform as 240 columns, each in the color of the track playing there
const cols = Array.from({ length: 240 }, (_, i) => {
  const a = Math.floor((s0 + ((s1 - s0) * i) / 240) * fps), b = Math.floor((s0 + ((s1 - s0) * (i + 1)) / 240) * fps);
  let v = 0;
  for (let k = a; k < b; k++) v = Math.max(v, low[k] || 0, mid[k] || 0);
  const t = s0 + ((s1 - s0) * (i + 0.5)) / 240;
  const tr = [...D.tracks].reverse().find((x) => x.start <= t) || D.tracks[0];
  return { v: v / 99, key: tr.key && tr.key.camelot };
});
const colorJs = fs.readFileSync(path.join(ROOT, "web/js/color.js"), "utf8");
const font = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&display=block";

const card = `<!doctype html><html><head><meta charset="utf-8"><link href="${font}" rel="stylesheet"><script>${colorJs}</script>
<style>
  html,body{margin:0;width:1200px;height:630px;background:#16151E;color:#EFECF5;font-family:Archivo,sans-serif;overflow:hidden}
  .wrap{position:absolute;inset:0;padding:60px 72px 176px;display:flex;flex-direction:column}
  .k{font-size:22px;font-weight:700;font-stretch:112%;letter-spacing:.14em;color:#9792AB}
  h1{margin:14px 0 0;font-size:118px;line-height:.95;font-weight:900;font-stretch:125%;letter-spacing:-.02em}
  p{margin:22px 0 0;font-size:31px;line-height:1.35;color:#C3BED3;max-width:980px;font-stretch:92%}
  .chips{display:flex;gap:12px;margin-top:28px}
  .chips span{font-size:22px;font-weight:600;font-stretch:90%;padding:9px 18px;border-radius:999px;background:#2A2838;color:#EFECF5}
  canvas{position:absolute;left:0;right:0;bottom:0;width:1200px;height:140px;opacity:.6}
</style></head><body>
<canvas id="c" width="2400" height="300"></canvas>
<div class="wrap">
  <div class="k">SET REPLAY</div>
  <h1>Take a DJ set apart.</h1>
  <p>Drop in a recording or a video of a set: the setlist, every mix, keys, tempo, energy, and a Spotify playlist prompt in its sound.</p>
  <div class="chips"><span>Setlist</span><span>Mixes</span><span>Keys &amp; tempo</span><span>Energy</span><span>Playlist prompt</span></div>
</div>
<script>
  const cols = ${JSON.stringify(cols)}, c = document.getElementById("c"), x = c.getContext("2d"), w = c.width / cols.length;
  cols.forEach((col, i) => { const h = Math.max(6, col.v * 280); x.fillStyle = KeyColor.keyColor(col.key, "base"); x.fillRect(i * w + 1, 300 - h, w - 2, h); });
</script></body></html>`;

const icon = `<!doctype html><html><head><script>${colorJs}</script><style>html,body{margin:0;width:180px;height:180px;background:#16151E}</style></head><body>
<canvas id="c" width="360" height="360" style="width:180px;height:180px"></canvas>
<script>
  // the favicon's idea at icon size: a key-colored waveform on the booth-dark background
  const cols = ${JSON.stringify(cols.filter((_, i) => i % 12 === 0))}, x = document.getElementById("c").getContext("2d"), w = 360 / (cols.length + 2);
  cols.forEach((col, i) => { const h = 50 + col.v * 210; x.fillStyle = KeyColor.keyColor(col.key, "base"); x.beginPath(); x.roundRect((i + 1) * w + 3, 180 - h / 2, w - 6, h, 6); x.fill(); });
</script></body></html>`;

const browser = await chromium.launch(args.includes("--chrome") ? { channel: "chrome" } : {});
for (const [html, out, size] of [[card, "web/og-image.png", [1200, 630]], [icon, "web/apple-touch-icon.png", [180, 180]]]) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(ROOT, out), type: "png" });
  console.log(`wrote ${out} (${(fs.statSync(path.join(ROOT, out)).size / 1024).toFixed(0)} KB)`);
}
await browser.close();
