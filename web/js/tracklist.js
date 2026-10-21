/* ============================================================
   Set Replay — the tracklist in the formats people paste it into.

   tracklist(D, opts) returns { text, youtube, tl1001, cue, entries }:
     text     "0:00  Artist – Title", an unnamed track keeping its key and
              tempo as clues ("ID – ID (4A, 177 BPM)")
     youtube  a video description's chapter list. YouTube only turns it into
              chapters if the first stamp is 0:00, there are at least three,
              and each is at least 10 s long, so the first is pinned to 0:00
              and stamps closer than 10 s are merged
     tl1001   1001Tracklists' style, "[mm:ss] Artist - Title"
     cue      a CUE sheet (players and DJ tools split the recording by it):
              INDEX times in mm:ss:ff, 75 frames a second
   opts: { title, name(tr), artist(tr), file, hint(tr) }; hint adds a clue to
   an unnamed track, e.g. "sounds like Artist – Title". No DOM: tools/analysis-test.mjs.
   ============================================================ */

const pad = (n) => String(n).padStart(2, "0");
export function stamp(t) {
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
const cueTime = (t) => {
  const f = Math.max(0, Math.round(t * 75));
  return `${pad(Math.floor(f / 4500))}:${pad(Math.floor(f / 75) % 60)}:${pad(f % 75)}`;
};
const q = (s) => String(s).replace(/"/g, "'");

export function tracklist(D, { title = D.title, name, artist, file = D.file, hint } = {}) {
  const named = (tr) => (name ? name(tr) : tr.identified ? tr.title : "ID");
  const who = (tr) => (artist ? artist(tr) : tr.identified ? tr.artist : "ID");
  const entries = (D.tracks || []).map((tr) => {
    const unnamed = named(tr) === "ID";
    const clues = unnamed ? [tr.key && tr.key.camelot, tr.bpm ? `${Math.round(tr.bpm)} BPM` : null, hint ? hint(tr) : null].filter(Boolean) : [];
    return { n: tr.n, t: tr.start, artist: who(tr), title: named(tr), clues };
  });
  const line = (e, sep) => `${e.artist}${sep}${e.title}${e.clues.length ? ` (${e.clues.join(", ")})` : ""}`;

  const text = `${title}\n\n${entries.map((e) => `${stamp(e.t)}  ${line(e, " – ")}`).join("\n")}\n`;

  // YouTube chapters: first at 0:00, each at least 10 s, at least three of them
  const chapters = [];
  entries.forEach((e, i) => {
    const t = i === 0 ? 0 : e.t;
    if (chapters.length && t - chapters[chapters.length - 1].t < 10) chapters[chapters.length - 1].label += ` / ${line(e, " – ")}`;
    else chapters.push({ t, label: line(e, " – ") });
  });
  const youtube = `Tracklist:\n${chapters.map((c) => `${stamp(c.t)} ${c.label}`).join("\n")}\n`;

  const tl1001 = `${entries.map((e) => `[${stamp(e.t)}] ${line(e, " - ")}`).join("\n")}\n`;

  const kind = /\.mp3$/i.test(file || "") ? "MP3" : "WAVE";      // what players expect for anything else
  const cue = [
    `TITLE "${q(title)}"`,
    `FILE "${q(file || "set.m4a")}" ${kind}`,
    ...entries.flatMap((e, i) => [
      `  TRACK ${pad(i + 1)} AUDIO`,
      `    TITLE "${q(e.title)}${e.clues.length ? ` (${e.clues.join(", ")})` : ""}"`,
      `    PERFORMER "${q(e.artist)}"`,
      `    INDEX 01 ${cueTime(i === 0 ? 0 : e.t)}`,
    ]),
  ].join("\r\n") + "\r\n";

  return { text, youtube, tl1001, cue, entries, chapters: chapters.length };
}
