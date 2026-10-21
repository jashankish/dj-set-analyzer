/* ============================================================
   Set Replay — the set's vibe, in words a playlist AI understands.

   vibeProfile(D, names) reads one set payload and returns:
     axes       the vibe fingerprint (0–1 per axis) for the whole set
     trackAxes  the same axes per track (the radar's live outline)
     chips      keywords, grouped, each one switchable on the page
     genres     the genres kept, with the evidence behind each
   buildPrompt(profile, off, extra) turns the chips that are on into
     { full, short }: a paragraph for Spotify's Prompted Playlist and a
     one-line version (≤ 300 characters, also the saved playlist's description).

   Room recordings fool the style model (a phone in a loud club hears
   drum & bass as "hardcore"), so a genre is only trusted as far as its
   evidence agrees: the model's share, how well the set's tempo fits the
   style, and the genres Shazam reports for the named tracks.
   No DOM here: tools/analysis-test.mjs runs it in Node.
   ============================================================ */
import { tempoLikelihood } from "./engine/music.js";
import { moodMap } from "./moodmap.js";

/* Discogs style → how listeners (and Spotify) say it */
const SAY = {
  "Drum n Bass": "drum & bass", "Jungle": "jungle", "Halftime": "halftime",
  "Happy Hardcore": "happy hardcore", "UK Garage": "UK garage", "Speed Garage": "speed garage",
  "Psy-Trance": "psytrance", "Hip Hop": "hip-hop", "Trip Hop": "trip-hop", "Dance-pop": "dance-pop",
  "Synth-pop": "synth-pop", "Nu-Disco": "nu-disco", "Italo-Disco": "italo disco", "Hi NRG": "hi-NRG",
  "EBM": "EBM", "Bass Music": "bass music", "Bassline": "bassline", "Afrobeat": "afrobeats",
};
export const say = (s) => SAY[s] || s.toLowerCase();

/* styles a phone in a loud room over-reports (distortion reads as "hard") */
const HARSH = new Set(["Hardcore", "Gabber", "Happy Hardcore", "Speedcore", "Breakcore", "Noise",
  "Industrial", "Punk", "Deathrock", "Goth Rock", "Hardstyle", "Power Electronics", "Thrash", "Grindcore"]);
/* styles that describe texture better than genre */
const TEXTURE = { Ambient: "atmospheric", Experimental: "experimental edges", Downtempo: "laid-back moments",
  Dub: "dub textures", Leftfield: "leftfield turns", Abstract: "abstract textures" };

/* Shazam genre labels → the Discogs style they vouch for */
const SHAZAM = [
  [/drum.?n.?bass|drum ?& ?bass|jungle/i, "Drum n Bass"], [/dubstep/i, "Dubstep"],
  [/tech ?house/i, "Tech House"], [/deep house/i, "Deep House"], [/house/i, "House"],
  [/techno/i, "Techno"], [/trance/i, "Trance"], [/garage/i, "UK Garage"], [/hardstyle/i, "Hardstyle"],
  [/hip.?hop|rap/i, "Hip Hop"], [/reggaeton|latin/i, "Reggaeton"],
  [/afro/i, "Afrobeat"], [/disco/i, "Disco"], [/breakbeat|breaks/i, "Breakbeat"],
];
const shazamStyle = (g) => (SHAZAM.find(([re]) => re.test(g || "")) || [])[1] || null;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function wmean(T, vals) {                    // duration-weighted mean over tracks
  let s = 0, w = 0;
  T.forEach((tr, i) => {
    const v = vals[i];
    if (v == null || !isFinite(v)) return;
    const d = Math.max(1, tr.end - tr.start);
    s += v * d; w += d;
  });
  return w ? s / w : null;
}
function list(xs) {                          // "a, b and c"
  return xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/* artists of a track with their share of the credit, remixers included:
   "Sub Focus & Wilkinson" → 1 and 0.7, "Timewarp (Dimension Remix)" → Dimension 0.9;
   a crowded credit (3+ names) gives each 0.5 */
export function artistsOf(title, artist) {
  const out = new Map();
  const add = (a, w) => { a = a.trim(); if (a.length > 1 && !(out.get(a) >= w)) out.set(a, w); };
  const main = String(artist || "").split(/\s*(?:,|&|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bvs\.?)\s+/i).filter(Boolean);
  main.forEach((a, i) => add(a, main.length >= 3 ? 0.5 : i ? 0.7 : 1));
  const rx = /\(([^)]+?)\s+(?:remix|edit|rework|bootleg|flip|vip)\)/gi;
  let m;
  while ((m = rx.exec(String(title || "")))) {
    m[1].split(/\s*(?:,|&|\band\b)\s*/i).forEach((a) => a && !/^(radio|extended|original|club|dub)$/i.test(a) && add(a, 0.9));
  }
  return out;
}

/* Shazam genres that rarely belong in a DJ set: a match filed under one is
   more likely a wrong guess (room noise matched to library music) */
const OFF_GENRE = /new age|soft rock|^rock|alternative|country|classical|folk|singer|christian|gospel|children|easy listening|soundtrack|instrumental|holiday|fitness|meditation/i;
/* how far to trust one Shazam name: repeat hits and confidence, less if off-genre */
export function trust(tr) {
  const t = Math.min(1, 0.25 + 0.2 * Math.min(4, tr.shazam_hits || 0) + 0.5 * (tr.id_confidence || 0));
  return OFF_GENRE.test((tr.meta && tr.meta.genre) || "") ? t * 0.35 : t;
}

/* the fingerprint's axes, each 0–1 */
export const AXES = [
  ["tempo", "Tempo"], ["energy", "Energy"], ["dance", "Danceable"], ["party", "Party"],
  ["aggr", "Aggressive"], ["happy", "Bright"], ["vocal", "Vocal"], ["minor", "Minor key"],
];
const tempoAxis = (bpm) => (bpm ? clamp01((bpm - 70) / (185 - 70)) : 0);
export function trackAxes(tr) {
  const m = tr.moods || {};
  return {
    tempo: tempoAxis(tr.bpm), energy: clamp01((tr.energy || 0) / 10), dance: m.danceability || 0,
    party: m.mood_party || 0, aggr: m.mood_aggressive || 0, happy: m.mood_happy || 0,
    vocal: m.voice_instrumental || 0, minor: tr.key && tr.key.camelot ? (tr.key.camelot.endsWith("A") ? 1 : 0) : 0.5,
  };
}

/* how typical each track is of its set: 1 = the set in miniature.
   Feel: distance from the set's mean on the vibe axes, in units of the
   set's own spread (so a steady set notices small departures). Sound:
   cosine between the track's styles and the set's. fit = 0.6 feel + 0.4 sound.
   Each track also gets the two axes it departs on most, for the outliers' "why". */
const FIT_WORDS = {
  tempo: ["faster", "slower"], energy: ["more energetic", "calmer"], dance: ["more danceable", "less danceable"],
  party: ["more party-ready", "less party-ready"], aggr: ["more aggressive", "gentler"], happy: ["brighter", "darker"],
  vocal: ["more vocal", "more instrumental"], minor: ["in a minor key", "in a major key"],
};
export function trackFit(D) {
  const T = D.tracks || [];
  if (T.length < 3) return T.map((t) => ({ n: t.n, fit: 1, why: [] }));
  const A = T.map(trackAxes), keys = AXES.map(([k]) => k);
  const mu = {}, sd = {};
  keys.forEach((k) => {
    mu[k] = wmean(T, A.map((a) => a[k])) || 0;
    sd[k] = Math.max(0.05, Math.sqrt(wmean(T, A.map((a) => (a[k] - mu[k]) ** 2)) || 0));
  });
  const setStyles = Object.fromEntries(((D.summary && D.summary.styles) || []).map((s) => [s.style, s.share]));
  const cos = (a, b) => {
    let ab = 0, aa = 0, bb = 0;
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => { const x = a[k] || 0, y = b[k] || 0; ab += x * y; aa += x * x; bb += y * y; });
    return aa && bb ? ab / Math.sqrt(aa * bb) : 0.5;
  };
  return T.map((t, i) => {
    const z = keys.map((k) => ({ k, z: (A[i][k] - mu[k]) / sd[k] }));
    const d = Math.sqrt(mean(z.map((x) => x.z * x.z)));
    const feel = 1 / (1 + d * d / 2);
    const sound = cos(Object.fromEntries((t.styles || []).map((s) => [s.style, s.p])), setStyles);
    const why = z.filter((x) => Math.abs(x.z) >= 1.2 && x.k !== "minor").sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 2)
      .map((x) => FIT_WORDS[x.k][x.z > 0 ? 0 : 1]);
    if (sound < 0.35 && t.styles && t.styles[0]) why.push(`more ${say(t.styles[0].style)}`);
    return { n: t.n, fit: Math.round((0.6 * feel + 0.4 * sound) * 100) / 100, feel, sound, why: why.slice(0, 2) };
  });
}

export function vibeProfile(D, names = {}) {
  const s = D.summary || {}, T = D.tracks || [];
  const TA = T.map(trackAxes);
  const bpm = s.bpm_avg || wmean(T, T.map((t) => t.bpm));
  const spread = Math.max(0, (s.bpm_max || bpm) - (s.bpm_min || bpm));
  const named = T.filter((t) => t.identified);
  const W = new Map(named.map((t) => [t, trust(t)]));

  /* ---------- genres, weighed by agreement */
  const votes = {}, heads = {};                      // trust-weighted and plain Shazam genre votes
  named.forEach((t) => {
    const st = shazamStyle(t.meta && t.meta.genre);
    if (st) { votes[st] = (votes[st] || 0) + W.get(t); heads[st] = (heads[st] || 0) + 1; }
  });
  const cand = {};
  (s.styles || []).forEach(({ style, share }) => {
    if (TEXTURE[style]) return;
    const fit = 0.35 + 0.65 * tempoLikelihood(style, bpm);
    const harsh = HARSH.has(style) && !votes[style] ? 0.6 : 1;
    cand[style] = { style, share, fit, harsh, shazam: heads[style] || 0, score: share * fit * harsh };
  });
  Object.entries(votes).forEach(([style, n]) => {
    const c = cand[style] || (cand[style] = { style, share: 0, fit: 0.35 + 0.65 * tempoLikelihood(style, bpm), harsh: 1, shazam: heads[style], score: 0 });
    c.score += 0.5 * (n / Math.max(1, named.length)) * c.fit;
  });
  const ranked = Object.values(cand).sort((a, b) => b.score - a.score);
  const top = ranked.length ? ranked[0].score : 0;
  const genres = ranked.filter((g, i) => i < 4 && g.score >= 0.45 * top && g.score > 0.02);
  // hard styles the model heard but the evidence didn't back: offered (off) as things to avoid
  const ruledOut = ranked.filter((g) => g.harsh < 1 && !genres.includes(g) && g.share >= 0.05).map((g) => say(g.style));
  const textures = (s.styles || []).filter((x) => TEXTURE[x.style] && x.share >= 0.07).map((x) => TEXTURE[x.style]);

  /* ---------- the feel: duration-weighted fingerprint */
  const ax = {};
  AXES.forEach(([k]) => (ax[k] = wmean(T, TA.map((a) => a[k])) || 0));
  if (s.vocal_pct != null) ax.vocal = s.vocal_pct / 100;
  ax.tempo = tempoAxis(bpm);

  /* energy arc over the set's thirds (energy is relative, so this is shape, not level) */
  const e = (D.curves && D.curves.energy && D.curves.energy.v) || [];
  const s0 = Math.round(s.set_start || 0), s1 = Math.round(s.set_end || e.length);
  const third = (k) => mean(e.slice(s0 + Math.floor(((s1 - s0) * k) / 3), s0 + Math.floor(((s1 - s0) * (k + 1)) / 3)));
  const arc = [third(0), third(1), third(2)];
  const d = 0.06;
  let flow;
  if (arc[1] < Math.min(arc[0], arc[2]) - d / 2) flow = { id: "dip", chip: "dips, then builds", say: "start strong, breathe in the middle, then build back up to a big finish" };
  else if (arc[2] > arc[0] + d && arc[2] >= arc[1] - d / 2) flow = { id: "build", chip: "builds to the end", say: "build steadily from a warm-up to a peak at the end" };
  else if (arc[0] > arc[2] + d && arc[0] >= arc[1] - d / 2) flow = { id: "comedown", chip: "winds down", say: "open at full intensity and wind down toward a calmer finish" };
  else if (arc[1] > Math.max(arc[0], arc[2]) + d / 2) flow = { id: "peak", chip: "peaks mid-set", say: "build to a peak in the middle, then ease off" };
  else flow = { id: "steady", chip: "steady and rolling", say: "keep the energy level and rolling from start to finish" };

  /* ---------- who and when */
  const credit = new Map();                          // artist → weighted credit; Map keeps first-seen order for ties
  const bump = (a, w) => credit.set(a, (credit.get(a) || 0) + w);
  named.forEach((t) => artistsOf(t.title, t.artist).forEach((w, a) => bump(a, w * W.get(t))));
  Object.values(names).forEach((v) => {               // "Artist – Title", typed by the visitor: trusted fully
    const m = String(v).split(/\s+[–—-]\s+/);
    if (m.length > 1) artistsOf("", m[0]).forEach((w, a) => bump(a, w));
  });
  const artists = [...credit.entries()].filter(([, w]) => w >= 0.45).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a]) => a);
  // the songs to start from: trusted names that sound most like the whole set
  const FIT = new Map(trackFit(D).map((f) => [f.n, f.fit]));
  const anchors = named.filter((t) => W.get(t) >= 0.6)
    .map((t) => ({ t, w: W.get(t) * (FIT.get(t.n) || 0.5) * Math.sqrt(Math.max(30, t.end - t.start)) }))
    .sort((a, b) => b.w - a.w).slice(0, 3)
    .map(({ t }) => `${t.title.replace(/\s*[([](feat|ft|with|extended|original|radio|edit|remaster)[^)\]]*[)\]]/gi, "").trim()} by ${t.artist.split(/\s*(?:,|&|feat\.?|ft\.?)\s*/i)[0]}`);
  const labelW = new Map();
  named.forEach((t) => t.meta && t.meta.label && labelW.set(t.meta.label, (labelW.get(t.meta.label) || 0) + W.get(t)));
  const labels = [...labelW.entries()].filter(([, w]) => w >= 1.4).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([l]) => l);
  const years = named.filter((t) => W.get(t) >= 0.4).map((t) => parseInt(t.meta && t.meta.released, 10)).filter((y) => y > 1950 && y < 2100).sort((a, b) => a - b);
  let era = null;
  if (years.length >= 2) {
    const lo = years[Math.floor(years.length * 0.2)], hi = years[years.length - 1];
    const recent = years.filter((y) => y >= hi - 5).length / years.length;
    const dec = (y) => `${String(Math.floor(y / 10) * 10).slice(2)}s`;
    if (recent >= 0.7) era = { say: `mostly recent releases (${hi - 5}–${hi})`, chip: "recent releases" };
    else if (dec(lo) === dec(hi)) era = { say: `mostly ${Math.floor(lo / 10) * 10}s tracks`, chip: `${dec(lo)} tracks` };
    else era = { say: `a mix of eras, from ${dec(lo)} cuts to new releases`, chip: `${dec(lo)} to now` };
  }

  /* ---------- chips */
  const chips = [];
  const chip = (id, group, text, on = true, hint = "") => chips.push({ id, group, text, on, hint });
  genres.forEach((g, i) => {
    const why = [`${Math.round(g.share * 100)}% of the style model's read`, `tempo fit ${Math.round(g.fit * 100)}%`];
    if (g.shazam) why.push(`Shazam files ${g.shazam} named track${g.shazam > 1 ? "s" : ""} under it`);
    if (g.harsh < 1) why.push("discounted: room recordings over-report hard styles");
    chip(`g:${g.style}`, "Genre", say(g.style), i < 3, why.join(" · "));
  });
  if (bpm) {
    const word = bpm >= 160 ? "high-tempo" : bpm >= 135 ? "fast" : bpm >= 118 ? "driving" : bpm >= 100 ? "mid-tempo" : "laid-back";
    chip("t:word", "Tempo", word);
    chip("t:bpm", "Tempo", spread < 6 ? `around ${Math.round(bpm)} BPM` : `${Math.round(s.bpm_min)}–${Math.round(s.bpm_max)} BPM`);
  }
  if (ax.aggr >= 0.45) chip("m:aggr", "Mood", "hard-hitting");
  else if (ax.aggr >= 0.28) chip("m:aggr", "Mood", "punchy");
  if (ax.happy >= 0.5) chip("m:bright", "Mood", "euphoric");
  else if (ax.happy <= 0.22 && ax.minor >= 0.6) chip("m:dark", "Mood", "dark");
  else if (ax.happy <= 0.22) chip("m:serious", "Mood", "brooding");
  if (ax.party >= 0.55) chip("m:party", "Mood", "rave-ready");
  else if (ax.party >= 0.38) chip("m:party", "Mood", "clubby");
  if (ax.dance >= 0.8) chip("m:dance", "Mood", "relentlessly danceable");
  if (ax.minor >= 0.75 && !chips.some((c) => c.id === "m:dark")) chip("m:minor", "Mood", "emotional", true, `${Math.round(ax.minor * 100)}% of the set in minor keys`);
  const vh = `vocals heard in ${Math.round(ax.vocal * 100)}% of the set`;
  if (ax.vocal >= 0.6) chip("s:vocal", "Sound", "big vocal hooks", true, vh);
  else if (ax.vocal >= 0.35) chip("s:vocal", "Sound", "vocal and instrumental cuts", true, vh);
  else chip("s:vocal", "Sound", "mostly instrumental tracks", true, vh);
  textures.forEach((w) => chip(`s:${w}`, "Sound", w === "atmospheric" ? "atmospheric breakdowns" : w));
  const mins = (s.set_length || D.duration || 0) / 60;
  if (D.drops && mins && D.drops.length / mins >= 0.4) chip("s:drops", "Sound", "big drops");
  artists.forEach((a, i) => chip(`a:${a}`, "Artists", a, i < 5));
  labels.forEach((l) => chip(`l:${l}`, "Labels", l));
  anchors.forEach((a, i) => chip(`k:${a}`, "Tracks", a, i < 2, "A trusted, named track that sounds most like the whole set, for the AI to start from"));
  if (era) chip("e:era", "Era", era.chip, true, era.say);
  chip("f:flow", "Flow", flow.chip, true, flow.say);
  /* the mood route from the mood map (relative to the set, so it describes the arc, not a level) */
  const mm = moodMap(D);
  const SAYQ = { intense: "dark and driving", euphoric: "euphoric", warm: "warmer and calmer", brooding: "dark and brooding" };
  let mood = null;
  if (mm) {
    const route = mm.thirds.filter((q, i) => !i || q !== mm.thirds[i - 1]);
    mood = route.length === 1
      ? { chip: `${route[0]} throughout`, say: `keep the mood ${SAYQ[route[0]]} throughout` }
      : { chip: route.join(" → "), say: `open ${SAYQ[route[0]]}${route.length > 2 ? `, turn ${SAYQ[route[1]]},` : ""} and end ${SAYQ[route[route.length - 1]]}` };
    chip("f:mood", "Flow", mood.chip, true, `the mood map's route: ${mood.say}`);
  }
  const songs = Math.max(15, Math.min(50, Math.round(mins / 3.5)));
  chip("n:len", "Length", `about ${songs} songs`, false);

  /* what the set is not, so the playlist doesn't drift */
  if (bpm && spread < 12) chip("x:slow", "Avoid", `tracks under ${Math.round(((s.bpm_min || bpm) - 6) / 5) * 5} BPM`, true, `the set never drops below ${Math.round(s.bpm_min || bpm)} BPM`);
  if (ax.happy <= 0.25) chip("x:cheese", "Avoid", "cheesy chart-pop", true, `brightness is only ${Math.round(ax.happy * 100)}%`);
  if (ax.vocal < 0.35) chip("x:vocal", "Avoid", "vocal-led pop", true, `vocals heard in ${Math.round(ax.vocal * 100)}% of the set`);
  if (ax.aggr <= 0.15) chip("x:aggr", "Avoid", "harsh, aggressive tracks", true, `aggression is only ${Math.round(ax.aggr * 100)}%`);
  if (ruledOut.length) chip("x:hard", "Avoid", list(ruledOut.slice(0, 2)), false, "the style model heard these, but tempo and Shazam didn't back them up: switch on if they're wrong for this set");

  return { title: D.title, bpm, songs, mood, anchors, ruledOut, axes: ax, trackAxes: TA, arc, flow, era, artists, labels, genres, textures, chips };
}

/* default off-set: the chips that start switched off */
export const defaultOff = (P) => new Set(P.chips.filter((c) => !c.on).map((c) => c.id));

export function buildPrompt(P, off = defaultOff(P), extra = "") {
  const live = (g) => P.chips.filter((c) => c.group === g && !off.has(c.id)).map((c) => c.text);
  const one = (id) => { const c = P.chips.find((x) => x.id === id); return c && !off.has(id) ? c : null; };
  const genres = live("Genre"), moods = live("Mood"), sound = live("Sound"), artists = live("Artists"), labels = live("Labels");
  const songs = live("Tracks"), avoid = live("Avoid");
  const tword = one("t:word") ? one("t:word").text : "", tbpm = one("t:bpm") ? one("t:bpm").text : "";
  const x = String(extra || "").trim();

  /* full: a paragraph for Prompted Playlist */
  const parts = [];
  let first = `A ${[tword, genres.length ? list(genres) : "electronic"].filter(Boolean).join(" ")} playlist`;
  if (tbpm) first += ` (${tbpm})`;
  if (moods.length) first += ` that feels ${list(moods)}`;
  if (sound.length) first += `${moods.length ? ", with" : " with"} ${list(sound)}`;
  parts.push(`${first}.`);
  if (artists.length) {
    let a = `Think ${list(artists)}`;
    if (labels.length) a += `, the ${list(labels)} sound`;
    if (one("e:era")) a += `, ${P.era.say}`;
    parts.push(`${a}.`);
  } else if (labels.length) parts.push(`The ${list(labels)} sound${one("e:era") ? `, ${P.era.say}` : ""}.`);
  else if (one("e:era")) parts.push(`${cap(P.era.say)}.`);
  if (songs.length) parts.push(`Start from songs like ${list(songs)}.`);
  if (avoid.length) parts.push(`Leave out ${list(avoid)}.`);
  if (one("f:flow")) parts.push(`Order it like a DJ set: ${P.flow.say}.`);
  if (one("f:mood")) parts.push(`Let the mood move as the set does: ${P.mood.say}.`);
  if (one("n:len")) parts.push(`${cap(one("n:len").text)}.`);
  if (x) parts.push(/[.!?]$/.test(x) ? x : `${x}.`);
  const full = parts.join(" ").replace(/\s+/g, " ").trim();

  /* short: keywords only, under Spotify's 300-character description limit */
  let short = [...moods.slice(0, 2), tword, ...genres, tbpm, ...sound.slice(0, 2)].filter(Boolean).join(", ");
  if (artists.length) short += `${short ? ", " : ""}like ${list(artists.slice(0, 4))}`;
  if (avoid.length) short += `, no ${avoid.join(", no ")}`;
  if (x) short += `, ${x.replace(/[.!?]$/, "")}`;
  if (short.length > 300) short = `${short.slice(0, 299).replace(/,?\s*\S*$/, "")}…`;
  return { full, short };
}

/* how well the prompt pins the set down for a playlist AI: what it names,
   weighted by how hard each steers (artists and songs most). Returns a
   score out of 100, the parts with whether they're in, and a tip for the
   biggest gap, so the visitor knows what would make the playlist closer. */
export function promptStrength(P, off = defaultOff(P)) {
  const on = (g) => P.chips.filter((c) => c.group === g && !off.has(c.id));
  const all = (g) => P.chips.filter((c) => c.group === g).length;
  const artists = on("Artists").length, songs = on("Tracks").length;
  const more = all("Artists") > artists ? "switch more of the set's artists back on, or name more of its IDs (double-click a track title)" : "name more of the set's IDs (double-click a track title) to add artists";
  const parts = [
    { id: "genre", label: "Genre", weight: 20, got: on("Genre").length ? 1 : 0, tip: "switch a genre on: it's the first thing the AI filters by" },
    { id: "artists", label: "Artists", weight: 25, got: Math.min(1, artists / 3), tip: artists ? `only ${artists} artist${artists > 1 ? "s" : ""}: ${more}` : all("Artists") ? "no artists switched on: they steer the AI most, so switch some back on" : "no artists: name some of the set's IDs (double-click a track title), or run the naming helper" },
    { id: "songs", label: "Songs", weight: 20, got: Math.min(1, songs / 2), tip: all("Tracks") ? "switch on a song or two under Tracks: songs steer the AI hardest" : "no song anchors yet: they come from tracks Shazam named with confidence" },
    { id: "tempo", label: "Tempo", weight: 10, got: on("Tempo").length ? 1 : 0, tip: "switch the tempo on, so the playlist stays at the set's pace" },
    { id: "mood", label: "Mood", weight: 10, got: on("Mood").length ? 1 : 0, tip: "switch a mood word on" },
    { id: "flow", label: "Flow", weight: 10, got: on("Flow").length ? 1 : 0, tip: "switch the flow on, so it's ordered like the set" },
    { id: "avoid", label: "Avoid", weight: 5, got: on("Avoid").length ? 1 : 0, tip: "add something to avoid, so the playlist doesn't drift" },
  ];
  const score = Math.round(parts.reduce((s, p) => s + p.weight * p.got, 0));
  const gap = parts.filter((p) => p.got < 1).sort((a, b) => b.weight * (1 - b.got) - a.weight * (1 - a.got))[0];
  const label = score >= 85 ? "Strong" : score >= 65 ? "Good" : score >= 40 ? "Loose" : "Vague";
  return { score, label, parts, tip: gap ? gap.tip : null };
}

/* where this set's playlist would fit, from its character: suggestions for
   the visitor's own direction (each a phrase that completes "a playlist …") */
export function occasions(P) {
  const a = P.axes, out = [];
  const fast = (P.bpm || 0) >= 160, mid = (P.bpm || 0) >= 118 && (P.bpm || 0) < 160;
  if ((fast || mid) && a.energy >= 0.5) out.push("for a run");
  if (a.aggr >= 0.3 || (fast && a.energy >= 0.55)) out.push("for the gym");
  if (a.party >= 0.4 || a.dance >= 0.8) out.push("for a pre-party");
  if (a.happy <= 0.3 && a.minor >= 0.6) out.push("for a late-night drive");
  if (a.happy >= 0.45) out.push("for a summer afternoon");
  if (a.vocal < 0.4 && a.aggr < 0.3) out.push("to focus to");
  if ((P.textures || []).includes("atmospheric")) out.push("for the after-hours");
  if (!out.length) out.push("for a night out", "for the drive home");
  return [...new Set(out)].slice(0, 4);
}
