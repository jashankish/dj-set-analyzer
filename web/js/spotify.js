/* ============================================================
   Set Replay — save a set to Spotify, straight from the page.

   Spotify's Prompted Playlist has no public API, so the page can't make
   the AI playlist itself. What it can do, with the visitor's permission:
   create a private playlist of the set's named tracks (matched by ISRC
   first, then by title and artist) and put the vibe prompt in its
   description, ready to grow in the Spotify app.

   Authorization is OAuth 2 with PKCE, entirely in the browser: no secret,
   no server. It needs a Spotify app's Client ID, from either
     <meta name="set-replay-spotify-client-id" content="…">  (the host's app), or
     the visitor's own app, pasted on the page (kept in localStorage).
   Since February 2026 a Spotify app in Development Mode serves at most
   five listed users, so a public host either gets Extended Quota or lets
   visitors bring their own app. The redirect URI is this page's address
   without the query (https://…/set.html, or http://127.0.0.1:<port>/set.html
   locally: Spotify refuses "localhost").
   ============================================================ */

const AUTH = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = "playlist-modify-private playlist-modify-public";
const K_ID = "set-replay:spotify-client-id";
const K_FLOW = "set-replay:spotify-flow";        // sessionStorage: verifier, state, where to come back to
const K_TOKEN = "set-replay:spotify-token";      // sessionStorage: access token + expiry

const ss = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch (e) { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage refused */ } },
};

export function hostClientId() {
  const m = document.querySelector('meta[name="set-replay-spotify-client-id"]');
  return (m && m.content.trim()) || "";
}
export function clientId() {
  let own = "";
  try { own = localStorage.getItem(K_ID) || ""; } catch (e) { /* private mode */ }
  return hostClientId() || own;
}
export function setOwnClientId(id) {
  try { id ? localStorage.setItem(K_ID, id.trim()) : localStorage.removeItem(K_ID); } catch (e) { /* private mode */ }
}
export const redirectUri = () => `${location.origin}${location.pathname}`;
/* Spotify only accepts https, or http on a loopback IP */
export const canRedirect = () => location.protocol === "https:" || /^http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?$/.test(location.origin);

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/* leave for Spotify's consent page; `pending` comes back from finishAuth() */
export async function beginAuth(pending) {
  const id = clientId();
  if (!id) throw new Error("No Spotify Client ID");
  const verifier = random(48), state = random(12);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  ss.set(K_FLOW, { verifier, state, back: location.href, pending, id });
  const q = new URLSearchParams({
    client_id: id, response_type: "code", redirect_uri: redirectUri(), scope: SCOPES,
    code_challenge_method: "S256", code_challenge: challenge, state,
  });
  location.assign(`${AUTH}?${q}`);
}

/* on page load, before anything reads the URL: if Spotify just sent the
   visitor back, swap the code for a token and restore the original address.
   Returns null (not a callback), { pending } or { error }. */
export async function finishAuth() {
  const q = new URLSearchParams(location.search);
  const flow = ss.get(K_FLOW);
  if (!flow || !q.has("state") || !(q.has("code") || q.has("error"))) return null;
  ss.set(K_FLOW, null);
  history.replaceState(null, "", flow.back);
  if (q.get("state") !== flow.state) return { error: "Spotify's reply didn't match this tab. Try again." };
  if (q.has("error")) return { error: q.get("error") === "access_denied" ? "Spotify access wasn't granted." : `Spotify said: ${q.get("error")}` };
  try {
    const r = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(),
        client_id: flow.id, code_verifier: flow.verifier,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) return { error: `Spotify sign-in failed (${j.error_description || j.error || r.status}).` };
    ss.set(K_TOKEN, { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 });
    return { pending: flow.pending };
  } catch (e) {
    return { error: "Couldn't reach Spotify to finish signing in." };
  }
}

export function token() {
  const t = ss.get(K_TOKEN);
  return t && t.until > Date.now() ? t.token : null;
}

async function api(path, opt = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(path.startsWith("http") ? path : API + path, {
      ...opt, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(opt.headers || {}) },
    });
    if (r.status === 429) {                       // rate limited: wait as told, then retry
      await new Promise((res) => setTimeout(res, 1000 * Math.min(10, +(r.headers.get("Retry-After") || 2))));
      continue;
    }
    if (r.status === 401) { ss.set(K_TOKEN, null); throw Object.assign(new Error("Spotify session expired"), { status: 401 }); }
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || `Spotify error ${r.status}`), { status: r.status });
    return j;
  }
  throw new Error("Spotify is rate-limiting this app; try again in a minute.");
}

/* "Out the Blue (feat. Alice Gold)" → "Out the Blue"; mix names stay out of the query */
const bare = (t) => String(t || "").replace(/\s*[([][^)\]]*(feat|ft\.|with|mix|edit|remaster|version)[^)\]]*[)\]]/gi, "").trim();
const quote = (s) => String(s).replace(/"/g, "");

/* one track → a Spotify URI, or null */
export async function findTrack({ title, artist, isrc }) {
  if (isrc) {
    const j = await api(`/search?${new URLSearchParams({ q: `isrc:${isrc}`, type: "track", limit: "1" })}`);
    const hit = j.tracks && j.tracks.items[0];
    if (hit) return { uri: hit.uri, how: "isrc", name: hit.name, artist: hit.artists.map((a) => a.name).join(", ") };
  }
  const lead = String(artist || "").split(/\s*(?:,|&|feat\.?|ft\.?)\s*/i)[0];
  const q = lead ? `track:"${quote(bare(title))}" artist:"${quote(lead)}"` : quote(title);
  const j = await api(`/search?${new URLSearchParams({ q, type: "track", limit: "5" })}`);
  const items = (j.tracks && j.tracks.items) || [];
  const want = bare(title).toLowerCase();
  const hit = items.find((x) => x.name.toLowerCase().startsWith(want.slice(0, 12))) || items[0];
  return hit ? { uri: hit.uri, how: "search", name: hit.name, artist: hit.artists.map((a) => a.name).join(", ") } : null;
}

/* the whole export: returns { url, found: [...], missed: [...] } */
export async function savePlaylist({ name, description, tracks }, progress = () => {}) {
  const found = [], missed = [];
  for (let i = 0; i < tracks.length; i++) {
    progress(`Finding track ${i + 1} of ${tracks.length} on Spotify…`);
    const m = await findTrack(tracks[i]).catch((e) => { if (e.status === 401) throw e; return null; });
    if (m && !found.some((f) => f.uri === m.uri)) found.push({ ...tracks[i], ...m }); else if (!m) missed.push(tracks[i]);
  }
  progress("Creating the playlist…");
  const pl = await api("/me/playlists", {
    method: "POST",
    body: JSON.stringify({ name: name.slice(0, 100), description: description.replace(/[\r\n]+/g, " ").slice(0, 300), public: false }),
  });
  for (let i = 0; i < found.length; i += 100) {
    await api(`/playlists/${pl.id}/items`, { method: "POST", body: JSON.stringify({ uris: found.slice(i, i + 100).map((f) => f.uri) }) });
  }
  return { url: (pl.external_urls && pl.external_urls.spotify) || `https://open.spotify.com/playlist/${pl.id}`, found, missed };
}
