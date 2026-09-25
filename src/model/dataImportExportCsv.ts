// docs/data-import.md §DI12.2/§DI12.3 -- Phase 2: the change-proposal CSV, a
// new from-scratch writer (unlike the already-shipped Pool CSVs in
// `TimelineChart.tsx`/`montecarlo.ts`, §DI12.1). Takes the host graph's
// nodes too -- a stored `ImportSourceTable` only ever holds the BASE, never
// a Parameter's current live value (§DI-D1: only CHANGED rows are listed).

import { toCsv } from './csv'
import type { DuplicateTripleError } from './dataImportRefresh'
import type { ImportSourceTable } from './serialize'
import type { LoopNode, ParameterData } from './types'

function paramData(n: LoopNode): ParameterData | null {
  return n.data.kind === 'parameter' ? n.data : null
}

/** §DI-D18 -- every text field gets EXACTLY ONE leading `'` prepended,
 *  always, never conditional on whether the value "looks dangerous" (the
 *  only way to make the guard losslessly reversible: strip exactly one
 *  leading `'`, no judgment call). This guard is THIS export's own: the
 *  spreadsheet it is pasted back into would otherwise read a leading `=`,
 *  `+`, `-` or `@` as a formula. Quoting itself is not — `csvField` in
 *  `./csv` is now the one RFC 4180 writer for every CSV this product
 *  downloads. */
const guardedTextField = (raw: string): string => `'${raw}`

export function buildChangeProposalCsv(
  tables: readonly ImportSourceTable[],
  hostNodes: readonly LoopNode[],
): { ok: true; csv: string } | { ok: false; duplicateTriples: DuplicateTripleError[] } {
  type Candidate = { table: ImportSourceTable; sourceKey: string; sourceColumnId: string; header: string; base: number }
  const candidates: Candidate[] = []
  for (const table of tables) {
    const numberColumns = table.columns.filter((c) => c.role === 'number')
    if (numberColumns.length === 0) continue
    for (const row of table.rows) {
      for (const col of numberColumns) {
        const base = row.number[col.sourceColumnId]
        if (base === undefined) continue // no base for this cell -- nothing live to compare (already-discarded / not yet materialized)
        candidates.push({ table, sourceKey: row.sourceKey, sourceColumnId: col.sourceColumnId, header: col.header, base })
      }
    }
  }

  // -- duplicate-triple guard, run FIRST, over every candidate cell at once
  // -- mirrors `diffRefresh`'s own "refuse the whole batch, never silently
  // exclude" discipline for the exact same data-integrity condition
  // (§DI-D15), using the identical `DuplicateTripleError` shape so a
  // consumer can show one message regardless of which entry point hit it.
  const duplicateTriples: DuplicateTripleError[] = []
  for (const c of candidates) {
    const matches = hostNodes.filter((n) => {
      const d = paramData(n)
      return d?.sourceTableId === c.table.sourceTableId && d.sourceKey === c.sourceKey && d.sourceColumnId === c.sourceColumnId
    })
    if (matches.length >= 2) {
      duplicateTriples.push({ sourceTableId: c.table.sourceTableId, sourceKey: c.sourceKey, sourceColumnId: c.sourceColumnId, nodeIds: matches.map((n) => n.id) })
    }
  }
  if (duplicateTriples.length > 0) return { ok: false, duplicateTriples }

  const rows: (string | number)[][] = [['source_table', 'source_key', 'source_column', 'previous_value', 'new_value']]
  for (const c of candidates) {
    const match = hostNodes.find((n) => {
      const d = paramData(n)
      return d?.sourceTableId === c.table.sourceTableId && d.sourceKey === c.sourceKey && d.sourceColumnId === c.sourceColumnId
    })
    if (!match) continue // zero Parameters carrying this triple -- locally-deleted-but-unresolved, or already-discarded; nothing live to report
    const value = paramData(match)!.value
    if (value === c.base) continue // unchanged -- §DI-D1 scopes this export to changed rows only
    rows.push([
      guardedTextField(c.table.label),
      guardedTextField(c.sourceKey),
      guardedTextField(c.header),
      c.base,
      value,
    ])
  }

  // §DI12.3's CRLF line endings, for the Windows/Excel round trip this export
  // exists for, are now `CSV_EOL` — the same separator every CSV this product
  // downloads carries, rather than this one writer's private choice. §DI12.3's
  // product decision is unchanged; only its scope widened to all six.
  //
  // The Excel-compatibility BOM that §DI12.3 also calls for is added at the
  // shared DOWNLOAD boundary (`downloadCsv`, src/ui/download.ts), not here, so
  // a serializer's output stays a plain document. `withCsvBom` is idempotent,
  // so this function's output is correct whether or not a caller re-adds one.
  return { ok: true, csv: toCsv(rows) }
}
