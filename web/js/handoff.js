/* ============================================================
   Set Replay — hand a prompt to your phone.

   Spotify's Prompted Playlist (and the other services' AI playlists) are
   made in the phone app, so a prompt written on a computer has to get to
   the phone. promptLink() puts it in the fragment of a link to prompt.html
   next to this page (the fragment never leaves the phone: it isn't sent
   to any server), which shows it with a big Copy button and Open Spotify.
   On localhost the phone can't reach this computer, so the code carries
   the text itself. qrSvg() draws either as an SVG QR code (vendor/qrcode.js,
   loaded on first use; UTF-8, error correction L: a screen is a clean surface).
   ============================================================ */
const LOCAL = /^(localhost|127\.|\[?::1\]?|0\.0\.0\.0)/;

export function promptLink(text, target = "spotify", loc = location) {
  if (LOCAL.test(loc.hostname)) return { kind: "text", data: text };
  const base = new URL("prompt.html", loc.href);
  base.hash = new URLSearchParams({ t: target, p: text }).toString();
  return { kind: "link", data: base.href };
}

export async function qrSvg(data) {
  const { default: qrcode } = await import("./vendor/qrcode.js");
  qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
  const q = qrcode(0, "L");
  q.addData(data, "Byte");
  q.make();
  const n = q.getModuleCount(), m = 4;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  return { size: n + 2 * m, svg: `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`, modules: n };
}
