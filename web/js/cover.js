/* ============================================================
   Set Replay — a cover image for a playlist saved to Spotify.

   coverJpeg(D, { title, sub, keyColor }) draws a 640 × 640 square in the
   page's look: the set's waveform as columns in the color of the track
   playing there, over the booth-dark background, with the title and a
   line under it (a chapter, "Tracks 8–10", or the set's length). Spotify
   takes a base64 JPEG of 256 KB at most (PUT /playlists/{id}/images,
   scope ugc-image-upload), so it lowers the quality until it fits.
   Returns the base64 text without the data: prefix, or null.
   ============================================================ */
const SIZE = 640, MAX = 256 * 1024;

export async function coverJpeg(D, { title = D.title, sub = "", keyColor }) {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#16151E"; g.fillRect(0, 0, SIZE, SIZE);

  // the waveform: 64 columns rising from the bottom, each in the key color of its moment
  const w = D.curves && D.curves.wave, fps = D.curves && D.curves.wave_fps;
  const s0 = (D.summary && D.summary.set_start) || 0, s1 = (D.summary && D.summary.set_end) || D.duration;
  const N = 64, cw = SIZE / N;
  for (let i = 0; i < N; i++) {
    const a = s0 + ((s1 - s0) * i) / N, b = s0 + ((s1 - s0) * (i + 1)) / N;
    let v = 0.3;
    if (w && fps) { v = 0; for (let k = Math.floor(a * fps); k < Math.floor(b * fps); k++) v = Math.max(v, w.low[k] || 0, w.mid[k] || 0); v /= 99; }
    const tr = (D.tracks || []).find((t) => (a + b) / 2 >= t.start && (a + b) / 2 < t.end) || (D.tracks || [])[0];
    const h = 40 + Math.min(1, v) * 300;
    g.fillStyle = keyColor ? keyColor(tr && tr.key && tr.key.camelot, "base") : "#9085E9";
    g.fillRect(i * cw + 1.5, SIZE - h, cw - 3, h);
  }
  // fade the top of the columns into the background so the words stay readable
  const fade = g.createLinearGradient(0, 0, 0, SIZE);
  fade.addColorStop(0, "rgba(22,21,30,1)"); fade.addColorStop(0.45, "rgba(22,21,30,.92)"); fade.addColorStop(0.75, "rgba(22,21,30,.15)"); fade.addColorStop(1, "rgba(22,21,30,0)");
  g.fillStyle = fade; g.fillRect(0, 0, SIZE, SIZE);

  g.fillStyle = "#9792AB"; g.font = "700 22px Archivo, system-ui, sans-serif"; g.textBaseline = "top";
  g.fillText("SET REPLAY", 48, 48);
  g.fillStyle = "#EFECF5"; g.font = "800 58px Archivo, system-ui, sans-serif";
  const lines = wrap(g, String(title || "A DJ set"), SIZE - 96).slice(0, 3);
  lines.forEach((l, i) => g.fillText(l, 48, 92 + i * 64));
  if (sub) { g.fillStyle = "#C3BED3"; g.font = "600 28px Archivo, system-ui, sans-serif"; g.fillText(sub, 48, 104 + lines.length * 64); }

  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const blob = c.convertToBlob ? await c.convertToBlob({ type: "image/jpeg", quality: q }) : await new Promise((r) => c.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= MAX * 0.74) {             // base64 grows it by a third
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }
  }
  return null;
}

function wrap(g, text, max) {
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > max && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
