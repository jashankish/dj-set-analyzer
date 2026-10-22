/* ============================================================
   Set Replay — the track table: every track with everything the page
   knows about it (table.js), sortable by any column, a row to play the
   track, and the whole table as a CSV.
   ============================================================ */
import { trackTable, toCSV } from "../table.js";

export function tableSection(ctx) {
  const { $, S, esc, seek, keyColor, nameOf, toast } = ctx;
  let sort = { id: "n", dir: 1 };

  function renderTable() {
    const artistOf = (t) => { const own = S.names[t.n]; if (own) { const m = own.split(/\s+[–-]\s+/); return m.length > 1 ? m[0] : ""; } return t.identified ? t.artist : ""; };
    const titleOf = (t) => { const own = S.names[t.n]; if (own) { const m = own.split(/\s+[–-]\s+/); return m.length > 1 ? m.slice(1).join(" – ") : own; } return nameOf(t); };
    const T = (S.table = trackTable(S.D, { name: titleOf, artist: artistOf }));
    $("ttab").hidden = !T;
    if (!T) return;
    draw();
    if (renderTable.bound) return;
    renderTable.bound = true;
    $("ttHead").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-c]");
      if (!b) return;
      sort = sort.id === b.dataset.c ? { id: sort.id, dir: -sort.dir } : { id: b.dataset.c, dir: S.table.cols.find((c) => c.id === b.dataset.c).num ? -1 : 1 };
      draw();
    });
    $("ttBody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-t]"); if (tr) seek(+tr.dataset.t + 0.05, true); });
    $("ttBody").addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-t]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); seek(+tr.dataset.t + 0.05, true); } });
    $("ttCsv").addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([toCSV(S.table)], { type: "text/csv" }));
      a.download = `${(S.title || S.D.title || "set").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "set"}-tracks.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("Track table downloaded as CSV");
    });
  }

  function draw() {
    const T = S.table, col = T.cols.find((c) => c.id === sort.id);
    const rows = [...T.rows].sort((a, b) => {
      const x = a.cells[sort.id].v, y = b.cells[sort.id].v;
      if (x == null && y == null) return a.n - b.n;
      if (x == null) return 1;
      if (y == null) return -1;
      return (col.num ? x - y : String(x).localeCompare(String(y))) * sort.dir || a.n - b.n;
    });
    $("ttHead").innerHTML = `<tr>${T.cols.map((c) => `<th scope="col" aria-sort="${c.id === sort.id ? (sort.dir > 0 ? "ascending" : "descending") : "none"}" class="${c.num ? "num" : ""}"><button data-c="${c.id}"${c.tip ? ` title="${esc(c.tip)}"` : ""}>${esc(c.label)}${c.id === sort.id ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("")}</tr>`;
    $("ttBody").innerHTML = rows.map((r) => `<tr data-t="${r.t}" tabindex="0">${T.cols.map((c) => {
      const cell = r.cells[c.id];
      if (c.id === "key" && cell.v) return `<td><span class="tt-key" style="background:${keyColor(cell.v, "base")}">${esc(cell.text)}</span></td>`;
      return `<td class="${c.num ? "num" : ""}${c.id === "title" ? " tt-title" : c.id === "artist" ? " tt-artist" : ""}"${c.id === "title" || c.id === "artist" ? ` title="${esc(cell.text)}"` : ""}>${esc(cell.text)}</td>`;
    }).join("")}</tr>`).join("");
  }

  return { renderTable };
}
