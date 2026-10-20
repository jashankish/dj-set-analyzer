/* ============================================================
   Set Replay — take the soundtrack out of a video, without loading the video.

   A phone video of a set runs to gigabytes, far more than a browser will
   decode in one go (an hour of 1080p is 5–8 GB; the audio in it is ~60 MB).
   MP4 and MOV (what phones record) are both ISO base media files: a "moov"
   box indexes where every chunk of every track sits in the file. So:

     1. walk the top-level boxes with small Blob.slice() reads to find moov;
     2. read only moov, find the sound track (hdlr "soun") whose sample entry
        is AAC ("mp4a"), and from its sample table (stsc, stsz, stco/co64)
        work out where each audio chunk is and how long it is;
     3. build a new, audio-only .m4a: ftyp + a moov holding just that track
        (its chunk offsets rewritten) + an mdat made of slices of the
        original file, chunk by chunk.

   Step 3 reads only the audio chunks (Blob slices of the video) into one
   buffer, so memory stays at the audio's size. The result is a normal M4A,
   which every browser decodes (WebKit can't decode a .mov container itself).
   No re-encoding, so nothing is lost. Returns null when the file isn't an
   MP4/MOV with an AAC soundtrack (e.g. WebM, or a fragmented MP4); the
   caller then falls back to decoding the whole file.
   No DOM: tools/demux-test.mjs runs it in Node on a real MOV.
   ============================================================ */

const VIDEO_EXT = /\.(mp4|m4v|mov|qt|3gp|webm|mkv)$/i;
export const isVideo = (file) => (file.type || "").startsWith("video/") || VIDEO_EXT.test(file.name || "");

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const type = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const bytes = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());

/* top-level boxes of the file: [{ type, start, size, header }] */
async function topBoxes(file) {
  const out = [];
  for (let pos = 0; pos + 8 <= file.size;) {
    const h = await bytes(file, pos, Math.min(file.size, pos + 16));
    let size = u32(h, 0), header = 8;
    const t = type(h, 4);
    if (size === 1) { size = u32(h, 8) * 4294967296 + u32(h, 12); header = 16; }
    else if (size === 0) size = file.size - pos;
    if (size < header || !/^[\x20-\x7e]{4}$/.test(t)) return null;     // not an ISO media file
    out.push({ type: t, start: pos, size, header });
    pos += size;
  }
  return out;
}

/* child boxes inside buf[from, to) */
function children(b, from, to) {
  const out = [];
  for (let p = from; p + 8 <= to;) {
    let size = u32(b, p), header = 8;
    if (size === 1) { size = u32(b, p + 8) * 4294967296 + u32(b, p + 12); header = 16; }
    if (size === 0) size = to - p;
    if (size < header || p + size > to) break;
    out.push({ type: type(b, p + 4), start: p, size, body: p + header, end: p + size });
    p += size;
  }
  return out;
}
const find = (b, box, t) => children(b, box.body, box.end).find((c) => c.type === t);

function box(t, ...parts) {
  const len = 8 + parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set([...t].map((c) => c.charCodeAt(0)), 4);
  let at = 8;
  parts.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
}
/* the first box of type t anywhere inside buf[from, to) */
function deep(b, from, to, t) {
  for (const c of children(b, from, to)) {
    if (c.type === t) return c;
    const inner = deep(b, c.body, c.end, t);
    if (inner) return inner;
  }
  return null;
}
/* QuickTime describes AAC with a version 1 or 2 sound entry (esds tucked in a
   "wave" box); an M4A needs the plain ISO version 0 entry, or WebKit won't
   decode it. Rebuild the entry from its channels, rate and esds. */
function isoEntry(b, e) {
  const version = (b[e.start + 16] << 8) | b[e.start + 17];
  if (version === 0) return null;                          // already ISO
  let channels, rate;
  if (version === 2) {
    rate = new DataView(b.buffer, b.byteOffset).getFloat64(e.start + 40);
    channels = u32(b, e.start + 48);
  } else {
    channels = (b[e.start + 24] << 8) | b[e.start + 25];
    rate = u32(b, e.start + 32) / 65536;
  }
  const kids = e.start + (version === 2 ? 72 : 52);
  const esds = deep(b, kids, e.end, "esds");
  if (!esds) return null;
  const fixed = new Uint8Array(28), dv = new DataView(fixed.buffer);
  dv.setUint16(6, 1);                                      // data reference index
  dv.setUint16(16, channels); dv.setUint16(18, 16);        // channels, sample size
  dv.setUint32(24, Math.round(rate) * 65536);              // 16.16 sample rate
  return box("mp4a", fixed, b.subarray(esds.start, esds.end));
}
/* trak with the boxes along path rebuilt around a replacement leaf */
function rebuild(b, node, path, leaf) {
  if (!path.length) return leaf;
  const [t, ...rest] = path;
  const parts = children(b, node.body, node.end).map((c) => (c.type === t ? rebuild(b, c, rest, leaf) : b.subarray(c.start, c.end)));
  return box(node.type, ...parts);
}

export async function extractAudio(file) {
  const top = await topBoxes(file);
  if (!top) return null;
  const moovBox = top.find((x) => x.type === "moov");
  if (!moovBox || top.some((x) => x.type === "moof")) return null;    // no index, or fragmented
  const b = await bytes(file, moovBox.start, moovBox.start + moovBox.size);
  const moov = { start: 0, body: moovBox.header, end: b.length };
  const mvhd = find(b, moov, "mvhd");
  // the sound track, as long as it's AAC
  let trak = null, stbl = null;
  for (const t of children(b, moov.body, moov.end).filter((c) => c.type === "trak")) {
    const mdia = find(b, t, "mdia"), hdlr = mdia && find(b, mdia, "hdlr");
    if (!hdlr || type(b, hdlr.body + 8) !== "soun") continue;
    const minf = find(b, mdia, "minf"), st = minf && find(b, minf, "stbl"), stsd = st && find(b, st, "stsd");
    if (!stsd || type(b, stsd.body + 12) !== "mp4a") continue;
    trak = t; stbl = st; break;
  }
  if (!trak || !mvhd) return null;
  const stsc = find(b, stbl, "stsc"), stsz = find(b, stbl, "stsz"), stco = find(b, stbl, "stco") || find(b, stbl, "co64");
  if (!stsc || !stsz || !stco) return null;

  // where each chunk is and how many bytes it holds
  const wide = stco.type === "co64";
  const nChunks = u32(b, stco.body + 4);
  const offsets = [];
  for (let i = 0; i < nChunks; i++) {
    const p = stco.body + 8 + i * (wide ? 8 : 4);
    offsets.push(wide ? u32(b, p) * 4294967296 + u32(b, p + 4) : u32(b, p));
  }
  const fixed = u32(b, stsz.body + 4), nSamples = u32(b, stsz.body + 8);
  const sampleSize = (i) => (fixed || u32(b, stsz.body + 12 + i * 4));
  const runs = [];
  for (let i = 0, n = u32(b, stsc.body + 4); i < n; i++) {
    const p = stsc.body + 8 + i * 12;
    runs.push({ first: u32(b, p), per: u32(b, p + 4) });
  }
  const sizes = [];
  let sample = 0;
  for (let c = 1, r = 0; c <= nChunks; c++) {
    while (r + 1 < runs.length && runs[r + 1].first <= c) r++;
    let bytesIn = 0;
    for (let k = 0; k < runs[r].per && sample < nSamples; k++) bytesIn += sampleSize(sample++);
    sizes.push(bytesIn);
  }

  // the new file: ftyp, moov (mvhd + the sound trak), mdat of the chunks in order
  const ftyp = new Uint8Array([0, 0, 0, 28, ...[..."ftypM4A "].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...[..."M4A isommp42"].map((c) => c.charCodeAt(0))]);
  // the sound trak, with a QuickTime-style sample entry turned into the ISO one
  let trakBytes = b.slice(trak.start, trak.end);
  const stsd = find(b, stbl, "stsd"), entry = children(b, stsd.body + 8, stsd.end)[0];
  const iso = entry && isoEntry(b, entry);
  if (iso) {
    const newStsd = box("stsd", b.subarray(stsd.body, stsd.body + 8), iso);
    trakBytes = rebuild(b, trak, ["mdia", "minf", "stbl", "stsd"], newStsd);
  }
  // find the chunk-offset table in the (possibly rebuilt) trak
  const tb = { start: 0, body: 8, end: trakBytes.length };
  const path = ["mdia", "minf", "stbl"].reduce((n, t) => find(trakBytes, n, t), tb);
  const coBox = find(trakBytes, path, wide ? "co64" : "stco");
  const mvhdBytes = b.subarray(mvhd.start, mvhd.end);
  const moovSize = 8 + mvhdBytes.length + trakBytes.length;
  const head = new Uint8Array(moovSize);
  new DataView(head.buffer).setUint32(0, moovSize);
  head.set([..."moov"].map((c) => c.charCodeAt(0)), 4);
  head.set(mvhdBytes, 8);
  head.set(trakBytes, 8 + mvhdBytes.length);
  const total = sizes.reduce((a, x) => a + x, 0);
  let at = ftyp.length + moovSize + 8;                           // first byte of audio in the new file
  const dv = new DataView(head.buffer), coAt = 8 + mvhdBytes.length + coBox.start + 16;
  for (let i = 0; i < nChunks; i++) {
    if (wide) { dv.setUint32(coAt + i * 8, Math.floor(at / 4294967296)); dv.setUint32(coAt + i * 8 + 4, at >>> 0); }
    else dv.setUint32(coAt + i * 4, at);
    at += sizes[i];
  }
  const mdat = new Uint8Array(8);
  new DataView(mdat.buffer).setUint32(0, 8 + total);
  mdat.set([..."mdat"].map((c) => c.charCodeAt(0)), 4);
  const parts = [ftyp, head, mdat, ...offsets.map((o, i) => file.slice(o, o + sizes[i]))];
  const name = (file.name || "set").replace(/\.[^.]+$/, "") + ".m4a";
  // read the slices into one buffer (the audio's size, ~60 MB an hour), so the stored
  // recording stands alone instead of pointing into the video file
  return new File([await new Blob(parts).arrayBuffer()], name, { type: "audio/mp4" });
}
