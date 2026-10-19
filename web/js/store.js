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
export async function saveSet(payload, audio) {
  const id = newId();
  payload.slug = id;
  await tx("readwrite", (s) => s.put({ id, created: Date.now(), title: payload.title, payload, audio }));
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* optional */ }
  return id;
}

export const getSet = (id) => tx("readonly", (s) => s.get(id));
export const deleteSet = (id) => tx("readwrite", (s) => s.delete(id));

export async function updatePayload(id, patch) {
  const rec = await getSet(id);
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
    hasAudio: !!r.audio,
  }));
}

export async function storageEstimate() {
  try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { return null; }
}
