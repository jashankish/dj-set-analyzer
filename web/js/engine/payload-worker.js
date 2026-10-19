/* Builds the set JSON off the main thread, so the page stays responsive while
   the setlist, transitions and curves are computed (a few hundred ms on a
   laptop, seconds on a phone). */
import { buildPayload } from "./payload.js";

self.onmessage = (e) => {
  const { F, classes, meta } = e.data;
  try {
    self.postMessage({ payload: buildPayload(F, classes, meta) });
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
