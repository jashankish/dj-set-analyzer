/* ============================================================
   Set Replay — The set card dialog: draw, download, share.
   Moved out of app.js as is: cardSection(ctx) receives the app's shared state
   and helpers (see the ctx object at the end of app.js) and returns what the
   rest of the page calls.
   ============================================================ */
import { cardData, drawCard } from "../card.js";
import { vibeOffWhole } from "../vibe-ui.js";

export function cardSection(ctx) {
  const { $, S, keyColor } = ctx;

  async function openCard() {
    const dlg = $("cardDlg");
    if (!dlg.open) dlg.showModal();
    // the canvas only uses Archivo once those weights are loaded
    try { await Promise.all(["400 25px Archivo", "700 20px Archivo", "900 74px Archivo"].map((f) => document.fonts.load(f))); } catch (e) { /* system font */ }
    const c = $("cardCanvas");
    drawCard(c.getContext("2d"), cardData(S.D, { title: S.title || S.D.title, names: S.names, off: vibeOffWhole() }), keyColor);
    $("cardShare").hidden = !(navigator.canShare && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] }));
  }
  const cardBlob = () => new Promise((res) => $("cardCanvas").toBlob(res, "image/png"));

  return { cardBlob, openCard };
}
