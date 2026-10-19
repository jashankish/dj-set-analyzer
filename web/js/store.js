/* The visitor's library: analysed sets kept in this browser (IndexedDB),
   each with its audio file so the replay works on the next visit too.
   Nothing here is ever uploaded. */
const DB = "set-replay", VERSION = 1, STORE = "sets";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }).createIndex("created", "created");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    const r = fn(s);
    t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Storage was refused"));
  });
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Save an analysed set with its audio. Returns the new id. */
/* Put a record, storing its recording the best way this browser allows:
   as a File/Blob; else as raw bytes (WebKit refuses Blobs in IndexedDB in
   private/ephemeral sessions but takes ArrayBuffers); else without the audio
   ("Add the recording" can attach it later). A full quota still throws. */
async function putWithAudio(rec, audio) {
  const isQuota = (e) => /quota/i.test(String(e && (e.name || e.message || e)));
  try {
    return await tx("readwrite", (s) => s.put({ ...rec, audio }));
  } catch (e) {
    if (!audio || isQuota(e)) throw e;
  }
  try {
    const bytes = await audio.arrayBuffer();
    return await tx("readwrite", (s) => s.put({ ...rec, audio: null, audioBytes: bytes, audioName: audio.name || "set", audioType: audio.type || "" }));
  } catch (e) {
    if (isQuota(e)) throw e;
  }
  return tx("readwrite", (s) => s.put({ ...rec, audio: null }));
}

/* the recording as a File, whichever way it was stored */
function withAudio(rec) {
  if (rec && !rec.audio && rec.audioBytes) {
    rec.audio = new File([rec.audioBytes], rec.audioName || "set", { type: rec.audioType || "" });
  }
  return rec;
}

export async function saveSet(payload, audio) {
  const id = newId();
  payload.slug = id;
  await putWithAudio({ id, created: Date.now(), title: payload.title, payload }, audio);
  // ask the browser not to evict the library; best effort. Catch the promise
  // too: Firefox rejects it when the page navigates on before it settles.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* optional */ }
  return id;
}

export const getSet = async (id) => withAudio(await tx("readonly", (s) => s.get(id)));
export const deleteSet = (id) => tx("readwrite", (s) => s.delete(id));

/** Attach (or replace) the recording for a saved set. */
export async function attachAudio(id, file) {
  const rec = await tx("readonly", (s) => s.get(id));
  if (!rec) return;
  const { audio, audioBytes, audioName, audioType, ...rest } = rec;
  await putWithAudio(rest, file);
}

/** Import a downloaded .setreplay.json (no audio). Returns the new id. */
export async function importSet(json) {
  const payload = typeof json === "string" ? JSON.parse(json) : json;
  if (!payload || !Array.isArray(payload.tracks) || !payload.curves || !payload.summary) {
    throw new Error("That file isn't a Set Replay analysis.");
  }
  const names = payload.user_names || {};
  delete payload.user_names;
  const id = await saveSet(payload, null);
  try { localStorage.setItem(`djsa:${id}`, JSON.stringify({ title: payload.title, names })); } catch (e) { /* private mode */ }
  return id;
}

/** Replace a set's analysis (e.g. after naming its tracks), keeping its id and audio. */
export async function replacePayload(id, payload) {
  const rec = await tx("readonly", (s) => s.get(id));   // raw: keep the audio as stored
  if (!rec) return;
  payload.slug = id;
  rec.payload = payload;
  await tx("readwrite", (s) => s.put(rec));
}

export async function updatePayload(id, patch) {
  const rec = await tx("readonly", (s) => s.get(id));   // raw: keep the audio as stored
  if (!rec) return;
  Object.assign(rec.payload, patch);
  if (patch.title) rec.title = patch.title;
  await tx("readwrite", (s) => s.put(rec));
}

/** Lightweight listing (no audio) for menus, newest first. */
export async function listSets() {
  const all = await tx("readonly", (s) => s.getAll());
  return (all || []).sort((a, b) => b.created - a.created).map((r) => ({
    id: r.id, created: r.created, title: r.title, file: r.payload.file,
    duration: r.payload.duration, set_length: r.payload.summary.set_length,
    tracks: r.payload.summary.tracks, bpm_avg: r.payload.summary.bpm_avg,
    keys: r.payload.tracks.map((t) => (t.key ? t.key.camelot : null)),
    segs: r.payload.tracks.map((t) => [t.start, t.end, t.key ? t.key.camelot : null]),
    hasAudio: !!(r.audio || r.audioBytes),
  }));
}

export async function storageEstimate() {
  try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { return null; }
}
