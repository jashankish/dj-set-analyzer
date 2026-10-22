/* ============================================================
   Set Replay — every track with everything the page knows about it,
   as a table (and a CSV for a spreadsheet).

   trackTable(D, { name, artist }) returns { cols, rows }: one row per track
   with its start, time in the set (pacing.js), name, artist, key, tempo,
   energy, vocal share (vocals.js), frequency lean (balance.js), roles
   (roles.js), fit to the whole set (vibe.trackFit), and the mix into it:
   its type, key move and smoothness (craft.mixScore). Each cell holds the
   raw value (for sorting and the CSV) and the text shown.
   toCSV(table) writes it out (RFC 4180 quoting, a header row).
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
import { pacing } from "./pacing.js";
import { vocalMap } from "./vocals.js";
import { soundBalance } from "./balance.js";
import { roles } from "./roles.js";
import { trackFit } from "./vibe.js";
import { mixScore } from "./craft.js";

const clock = (t) => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`; };

export const COLS = [
  { id: "n", label: "#", num: true },
  { id: "start", label: "Start", num: true },
  { id: "play", label: "Plays", num: true, tip: "time in the set" },
  { id: "title", label: "Track" },
  { id: "artist", label: "Artist" },
  { id: "key", label: "Key" },
  { id: "bpm", label: "BPM", num: true },
  { id: "energy", label: "Energy", num: true },
  { id: "vocals", label: "Vocals", num: true, tip: "share of the track with vocals" },
  { id: "lean", label: "Lean", tip: "bass-heavy, bright or mid-forward against the set's own balance" },
  { id: "roles", label: "Role" },
  { id: "fit", label: "Fit", num: true, tip: "how close it sounds to the whole set, out of 100" },
  { id: "mix", label: "Mixed in", tip: "the transition into this track" },
  { id: "keymove", label: "Key move" },
  { id: "smooth", label: "Smooth", num: true, tip: "the mix into it, out of 100" },
];

export function trackTable(D, { name = (t) => (t.identified ? t.title : "ID"), artist = (t) => (t.identified ? t.artist : "") } = {}) {
  const T = D.tracks || [];
  if (!T.length) return null;
  const P = pacing(D), V = vocalMap(D), B = soundBalance(D), R = roles(D), F = trackFit(D);
  const by = (list, n) => (list || []).find((x) => x.n === n);
  const into = Object.fromEntries((D.transitions || []).map((m) => [m.to, m]));
  const rows = T.map((t) => {
    const p = by(P && P.tracks, t.n), v = by(V && V.tracks, t.n), b = by(B && B.tracks, t.n), f = by(F, t.n), m = into[t.n];
    const sc = m ? mixScore(m, D) : null;
    const cell = (v, text = v == null ? "" : String(v)) => ({ v, text });
    return {
      n: t.n, t: t.start,
      cells: {
        n: cell(t.n),
        start: cell(t.start, clock(t.start)),
        play: cell(p ? Math.round(p.play) : null, p ? clock(p.play) : ""),
        title: cell(name(t)),
        artist: cell(artist(t) || ""),
        key: cell(t.key ? t.key.camelot : null),
        bpm: cell(t.bpm ? Math.round(t.bpm * 10) / 10 : null, t.bpm ? t.bpm.toFixed(1) : ""),
        energy: cell(t.energy != null ? Math.round(t.energy * 10) / 10 : null, t.energy != null ? t.energy.toFixed(1) : ""),
        vocals: cell(v ? Math.round(v.share * 100) : null, v ? `${Math.round(v.share * 100)}%` : ""),
        lean: cell(b ? b.lean : null),
        roles: cell(((R && R[t.n]) || []).map((x) => x.tag).join(", ")),
        fit: cell(f ? Math.round(f.fit * 100) : null),
        mix: cell(m ? m.type : null),
        keymove: cell(m && m.harmonic ? m.harmonic.label : null),
        smooth: cell(sc ? sc.score : null),
      },
    };
  });
  return { cols: COLS, rows };
}

export function toCSV({ cols, rows }) {
  const q = (x) => { const s = x == null ? "" : String(x); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = cols.map((c) => q(c.id === "play" ? "plays_s" : c.id === "start" ? "start" : c.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || c.id));
  const body = rows.map((r) => cols.map((c) => q(c.num && c.id !== "start" ? r.cells[c.id].v : r.cells[c.id].text)).join(","));
  return [head.join(","), ...body].join("\r\n") + "\r\n";
}
