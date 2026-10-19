/* Browser-storage keys for Set Replay. On yappertech.com every product shares
   one origin (and so one localStorage), so every key carries the app's slug.
   Importing this module also migrates keys from the old "djsa:" prefix once. */
export const KEY = "set-replay:";

try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith("djsa:")) continue;
    const renamed = KEY + k.slice("djsa:".length);
    if (localStorage.getItem(renamed) == null) localStorage.setItem(renamed, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
} catch (e) {
  /* no localStorage (private mode, Node): nothing to migrate */
}
