import { toCsv } from '../model/csv'

// docs/data-import.md §CSV — the Timeline's "run CSV": one row per committed
// step, one column per Pool. Pure, so the column-naming contract can be tested
// without a chart (and so `TimelineChart.tsx` keeps no CSV knowledge of its
// own beyond calling this).
//
// WHY THE COLUMN NAME CARRIES THE NODE ID
//
// It used to be the Pool's LABEL alone. A Template may give several Pools the
// same label, and the shipped 3-zone gacha Template does: MEASURED on a real
// export, 6 of its 24 column names repeated — tickets ×3, pulls-made ×3,
// SR-count ×3, R-count ×3, pity ×2, ceiling-hits ×2 — in English exactly as in
// Thai, so it was never a locale defect. The numbers were right; the NAMES were
// not usable as independent data columns. Reordering or copying columns in a
// spreadsheet, selecting a column by name in an analysis tool, or turning rows
// into objects (where duplicate keys overwrite) all break on them.
//
// The id, not a zone-name prefix, is the disambiguator:
//
//   • a frame stores NO membership — it is DERIVED from geometry (LGR-D9 /
//     R5-D3), so a zone prefix would depend on frame layout and would need a
//     decided answer for a Pool in no frame, in several overlapping frames, and
//     in a nested one. Moving a rectangle would rename a data column;
//   • it works identically in a graph with no frames at all, which is most of
//     them;
//   • it survives a rename and a locale switch — the readable half changes, the
//     identifying half does not;
//   • the schema is stable: every column is named the same way, rather than
//     only the colliding ones growing a prefix.
//
// The localized label stays in front, so the file is still readable by a person.

export type RunCsvPool = { id: string; label: string }
export type RunCsvPoint = { step: number; values: Record<string, number> }

/** `<label> [<node-id>]` — readable half first, identifying half last. */
export function runCsvColumnName(pool: RunCsvPool): string {
  return `${pool.label} [${pool.id}]`
}

/** The whole document. Quoting and the CRLF record separator come from the
 *  shared writer, so a label containing a comma, a quote or a newline survives
 *  a round trip through this product's own importer instead of being replaced
 *  by spaces. */
export function buildRunCsv(pools: readonly RunCsvPool[], series: readonly RunCsvPoint[]): string {
  const head = ['step', ...pools.map(runCsvColumnName)]
  // a Pool with no entry in a committed snapshot reads 0, exactly as the chart
  // draws it — the CSV never disagrees with what is on screen
  const rows = series.map((pt) => [pt.step, ...pools.map((p) => pt.values[p.id] ?? 0)])
  return toCsv([head, ...rows])
}
