// docs/data-import.md §DI9/§DI11/§DI-D7 -- Phase 2: the refresh trust
// boundary. Mirrors Phase 1B's `dataImportValidate.ts` split exactly --
// `validateRefreshSnapshot` is the ONLY producer of a branded
// `ValidatedRefreshSnapshot`, and `diffRefresh` (`dataImportRefresh.ts`)
// accepts nothing else, so a caller cannot skip validation, not just
// "shouldn't." `analyzeRefreshColumns` is a SEPARATE, always-succeeding
// step the UI calls first, before any pairing exists, to render the
// column-events screen -- `validateRefreshSnapshot` alone could never do
// this, since it can only return a complete snapshot once every event is
// already resolved.

import { deepEq } from './revision'
import { SOURCE_KEY_MAX_BYTES, utf8Len } from './model'
import { parseNumberCell } from './dataImportValidate'
import {
  DI_COLUMNS_MAX,
  DI_HEADER_MAX,
  DI_ROWS_MAX,
  readDataImports,
  type ImportColumn,
  type ImportColumnRole,
  type ImportSourceTable,
} from './serialize'

// -- column analysis (pure, always succeeds) --------------------------------

export type ColumnEvent =
  | { kind: 'unrecognized-header'; incomingColumnIndex: number; header: string }
  | { kind: 'missing-header'; sourceColumnId: string; role: ImportColumnRole; header: string }
  | { kind: 'ambiguous-match'; sourceColumnId: string; header: string; candidateIncomingColumnIndexes: number[] }

export type ColumnAnalysis = {
  autoMatched: { sourceColumnId: string; incomingColumnIndex: number }[]
  /** EVERY event, including `unrecognized-header` -- "hidden by default in
   *  the UI" is a UI display choice (the "map more columns..." affordance),
   *  never a reason to drop it here, or that affordance would have nothing
   *  to show. */
  events: ColumnEvent[]
}

/** 1-based `headerRowIndex`, same convention as Phase 1B's drafts. An
 *  invalid (non-integer / out-of-range) index degrades to an empty header
 *  row rather than throwing -- this runs BEFORE validation, so it cannot
 *  assume its inputs are already sane. */
function incomingHeaderRow(parsedRows: string[][], headerRowIndex: number): string[] {
  const valid = Number.isInteger(headerRowIndex) && headerRowIndex >= 1
  return valid ? (parsedRows[headerRowIndex - 1] ?? []) : []
}

/** The auto-match rule, shared verbatim between `analyzeRefreshColumns` and
 *  `validateRefreshSnapshot` -- two independent implementations of "what
 *  counts as an obvious match" could silently drift apart over time. */
function computeColumnAnalysis(columns: readonly ImportColumn[], headers: readonly string[]): ColumnAnalysis {
  const headerToIndexes = new Map<string, number[]>()
  headers.forEach((h, i) => {
    const arr = headerToIndexes.get(h) ?? []
    arr.push(i)
    headerToIndexes.set(h, arr)
  })
  const byHeader = new Map<string, ImportColumn[]>()
  for (const c of columns) {
    const arr = byHeader.get(c.header) ?? []
    arr.push(c)
    byHeader.set(c.header, arr)
  }

  const autoMatched: { sourceColumnId: string; incomingColumnIndex: number }[] = []
  const events: ColumnEvent[] = []
  const claimedIndexes = new Set<number>()

  for (const col of columns) {
    const candidates = headerToIndexes.get(col.header) ?? []
    const contestants = byHeader.get(col.header)!.length
    if (candidates.length === 0) {
      events.push({ kind: 'missing-header', sourceColumnId: col.sourceColumnId, role: col.role, header: col.header })
    } else if (candidates.length === 1 && contestants === 1) {
      autoMatched.push({ sourceColumnId: col.sourceColumnId, incomingColumnIndex: candidates[0] })
      claimedIndexes.add(candidates[0])
    } else {
      events.push({ kind: 'ambiguous-match', sourceColumnId: col.sourceColumnId, header: col.header, candidateIncomingColumnIndexes: candidates })
    }
  }

  const ambiguousCandidateIndexes = new Set(
    events.flatMap((e) => (e.kind === 'ambiguous-match' ? e.candidateIncomingColumnIndexes : [])),
  )
  headers.forEach((h, i) => {
    if (claimedIndexes.has(i) || ambiguousCandidateIndexes.has(i)) return
    events.push({ kind: 'unrecognized-header', incomingColumnIndex: i, header: h })
  })

  return { autoMatched, events }
}

/** Pure, always succeeds -- reports facts about the incoming header row vs.
 *  `table`'s currently-stored columns. The UI calls this FIRST, before any
 *  pairing exists, to render the column-events screen; a parse error is
 *  still a caller-level concern before this ever runs (`parsedRows` is
 *  already past `stripBom`/`detectDelimiter`/`parseDelimitedText`). */
export function analyzeRefreshColumns(table: ImportSourceTable, parsedRows: string[][], headerRowIndex: number): ColumnAnalysis {
  return computeColumnAnalysis(table.columns, incomingHeaderRow(parsedRows, headerRowIndex))
}

// -- column pairings (the user's resolutions) --------------------------------

/** Only `number | label | foreignKey` are offered for a NEW mapping --
 *  `ignored` is pointless (the user only reaches this by explicitly
 *  choosing to map a column) and `key` is FORBIDDEN (a table's row
 *  identity was fixed at first import; it can never gain or change its
 *  key column on a refresh). */
export type NewColumnRole = 'number' | 'label' | 'foreignKey'

export type ColumnPairing =
  | { kind: 'matched'; sourceColumnId: string; incomingColumnIndex: number } // disambiguates an `ambiguous-match` event
  | { kind: 'rename'; sourceColumnId: string; incomingColumnIndex: number } // resolves a `missing-header` event
  | { kind: 'new-column'; sourceColumnId: string; incomingColumnIndex: number; role: NewColumnRole; refTableId?: string } // sourceColumnId minted BY THE CALLER at selection time, never here
  | { kind: 'column-removed'; sourceColumnId: string }

// -- the validated, branded snapshot -----------------------------------------

export type RefreshIssueCode =
  | 'invalid-header-row'
  | 'invalid-ignore-rows'
  | 'table-not-found'
  | 'unresolved-column-event'
  | 'key-column-cannot-be-removed'
  | 'duplicate-column-pairing'
  | 'invalid-new-column-pairing'
  | 'column-limit-exceeded'
  | 'empty-column-header'
  | 'header-too-long'
  | 'duplicate-source-column-id'
  | 'missing-key-column'
  | 'multiple-key-columns'
  | 'row-limit-exceeded'
  | 'ragged-row'
  | 'empty-key'
  | 'key-too-long'
  | 'key-control-char'
  | 'duplicate-key'
  | 'empty-number'
  | 'invalid-number'
  | 'orphan-foreign-key'
  | 'invalid-fk-target'
  | 'round-trip-mismatch'
  | 'label-fallback'

export type RefreshIssue = {
  code: RefreshIssueCode
  rowIndex?: number
  incomingColumnIndex?: number
  sourceColumnId?: string
  detail?: Record<string, unknown>
}

// A REAL runtime symbol (not just a `declare const` type ascription --
// that would have no actual value and throw at runtime the moment it's
// used as a computed property key, exactly the trap Phase 1B's own
// `PLAN_BRAND` avoids). Never exported, so no external module can spell
// this property's key.
const REFRESH_BRAND: unique symbol = Symbol('ValidatedRefreshSnapshot')
export type ValidatedRefreshSnapshot = {
  readonly refreshingTableId: string
  readonly rows: readonly { sourceKey: string; number: Record<string, number>; label: Record<string, string>; foreignKey: Record<string, string> }[]
  /** columns minted BY THIS refresh (a `new-column` pairing just resolved,
   *  using the id the CALLER already minted). `diffRefresh` uses this to
   *  tell "a cell under a column that only now started existing"
   *  (`added-cell`) apart from "a cell under a column that has always
   *  existed but lost its link" (`already-discarded`) -- both would
   *  otherwise look identical (no base, no node). */
  readonly newSourceColumnIds: ReadonlySet<string>
  /** The FULL resolved column list this refresh will store: existing
   *  columns (renamed header applied, if any), newly-mapped columns
   *  (id/role/`refTableId` from their pairing), with removed columns
   *  already dropped. Nothing downstream re-derives this from the raw
   *  pairings. */
  readonly resolvedColumns: readonly ImportColumn[]
  readonly [REFRESH_BRAND]: true
}

function normalizeKey(raw: string): string {
  return raw.trim().normalize('NFC')
}
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c <= 0x1f || c === 0x7f) return true
  }
  return false
}

/** `validateRefreshSnapshot` -- the ACTUAL trust boundary. Validates not
 *  just the incoming cells but the RESULTING STORED TABLE RECORD itself
 *  (storage limits, header validity, id uniqueness, FK/round-trip
 *  soundness) -- exactly the same discipline Phase 1B's `validateDrafts`
 *  applies to a fresh table. Assumes every `ColumnEvent`
 *  `analyzeRefreshColumns` found already has a matching `ColumnPairing`;
 *  one that doesn't is itself a blocking error here, not something this
 *  function discovers fresh (it reruns the SAME auto-match rule via
 *  `computeColumnAnalysis` to know which events exist). */
export function validateRefreshSnapshot(
  tables: readonly ImportSourceTable[],
  refreshingTableId: string,
  parsedRows: string[][],
  headerRowIndex: number,
  ignoreLastNRows: number,
  columnPairings: readonly ColumnPairing[],
): { ok: true; snapshot: ValidatedRefreshSnapshot; warnings: RefreshIssue[] } | { ok: false; errors: RefreshIssue[]; warnings: RefreshIssue[] } {
  const errors: RefreshIssue[] = []
  const warnings: RefreshIssue[] = []

  const table = tables.find((t) => t.sourceTableId === refreshingTableId)
  if (!table) return { ok: false, errors: [{ code: 'table-not-found', sourceColumnId: refreshingTableId }], warnings }

  const headerRowValid = Number.isInteger(headerRowIndex) && headerRowIndex >= 1
  if (!headerRowValid) errors.push({ code: 'invalid-header-row' })
  const ignoreRowsValid = Number.isInteger(ignoreLastNRows) && ignoreLastNRows >= 0
  if (!ignoreRowsValid) errors.push({ code: 'invalid-ignore-rows' })

  const headers = headerRowValid ? incomingHeaderRow(parsedRows, headerRowIndex) : []
  const { autoMatched, events } = computeColumnAnalysis(table.columns, headers)

  // -- resolve every event against the supplied pairings ---------------
  const indexBySourceColumnId = new Map<string, number>(autoMatched.map((m) => [m.sourceColumnId, m.incomingColumnIndex]))
  const removedSourceColumnIds = new Set<string>()
  const newColumns: { sourceColumnId: string; incomingColumnIndex: number; role: NewColumnRole; refTableId?: string }[] = []
  const usedIncomingIndexes = new Set<number>(autoMatched.map((m) => m.incomingColumnIndex))
  const usedSourceColumnIds = new Set<string>(autoMatched.map((m) => m.sourceColumnId))

  for (const p of columnPairings) {
    if (p.kind === 'matched' || p.kind === 'rename') {
      if (usedIncomingIndexes.has(p.incomingColumnIndex) || usedSourceColumnIds.has(p.sourceColumnId)) {
        errors.push({ code: 'duplicate-column-pairing', sourceColumnId: p.sourceColumnId, incomingColumnIndex: p.incomingColumnIndex })
        continue
      }
      usedIncomingIndexes.add(p.incomingColumnIndex)
      usedSourceColumnIds.add(p.sourceColumnId)
      indexBySourceColumnId.set(p.sourceColumnId, p.incomingColumnIndex)
    } else if (p.kind === 'new-column') {
      if (usedIncomingIndexes.has(p.incomingColumnIndex) || usedSourceColumnIds.has(p.sourceColumnId)) {
        errors.push({ code: 'duplicate-column-pairing', sourceColumnId: p.sourceColumnId, incomingColumnIndex: p.incomingColumnIndex })
        continue
      }
      if (table.columns.some((c) => c.sourceColumnId === p.sourceColumnId)) {
        errors.push({ code: 'duplicate-source-column-id', sourceColumnId: p.sourceColumnId })
        continue
      }
      if (p.role === 'foreignKey') {
        if (!p.refTableId || !tables.some((t) => t.sourceTableId === p.refTableId)) {
          errors.push({ code: 'invalid-new-column-pairing', sourceColumnId: p.sourceColumnId, detail: { reason: 'bad-fk-target' } })
          continue
        }
        // §DI-D2 -- foreign keys are cross-table only, even for a column minted on a refresh.
        if (p.refTableId === refreshingTableId) {
          errors.push({ code: 'invalid-new-column-pairing', sourceColumnId: p.sourceColumnId, detail: { reason: 'self-reference' } })
          continue
        }
      }
      usedIncomingIndexes.add(p.incomingColumnIndex)
      usedSourceColumnIds.add(p.sourceColumnId)
      newColumns.push({ sourceColumnId: p.sourceColumnId, incomingColumnIndex: p.incomingColumnIndex, role: p.role, refTableId: p.refTableId })
      indexBySourceColumnId.set(p.sourceColumnId, p.incomingColumnIndex)
    } else {
      // column-removed
      const col = table.columns.find((c) => c.sourceColumnId === p.sourceColumnId)
      if (col?.role === 'key') {
        errors.push({ code: 'key-column-cannot-be-removed', sourceColumnId: p.sourceColumnId })
        continue
      }
      removedSourceColumnIds.add(p.sourceColumnId)
      usedSourceColumnIds.add(p.sourceColumnId)
    }
  }

  for (const e of events) {
    if (e.kind === 'unrecognized-header') continue // never REQUIRES a resolution
    const sourceColumnId = e.sourceColumnId
    if (!usedSourceColumnIds.has(sourceColumnId)) {
      errors.push({ code: 'unresolved-column-event', sourceColumnId })
    }
  }

  const resolvedColumns: ImportColumn[] = [
    ...table.columns
      .filter((c) => !removedSourceColumnIds.has(c.sourceColumnId))
      .map((c) => {
        const idx = indexBySourceColumnId.get(c.sourceColumnId)
        const header = idx !== undefined ? (headers[idx] ?? c.header) : c.header
        return { ...c, header }
      }),
    ...newColumns.map((n) => ({
      sourceColumnId: n.sourceColumnId,
      role: n.role as ImportColumnRole,
      header: headers[n.incomingColumnIndex] ?? '',
      ...(n.refTableId ? { refTableId: n.refTableId } : {}),
    })),
  ]

  if (resolvedColumns.length > DI_COLUMNS_MAX) {
    errors.push({ code: 'column-limit-exceeded', detail: { count: resolvedColumns.length, max: DI_COLUMNS_MAX } })
  }
  const seenIds = new Set<string>()
  for (const c of resolvedColumns) {
    if (normalizeKey(c.header) === '') errors.push({ code: 'empty-column-header', sourceColumnId: c.sourceColumnId })
    if (c.header.length > DI_HEADER_MAX) errors.push({ code: 'header-too-long', sourceColumnId: c.sourceColumnId, detail: { length: c.header.length, max: DI_HEADER_MAX } })
    if (seenIds.has(c.sourceColumnId)) errors.push({ code: 'duplicate-source-column-id', sourceColumnId: c.sourceColumnId })
    seenIds.add(c.sourceColumnId)
  }
  const keyCols = resolvedColumns.filter((c) => c.role === 'key')
  if (keyCols.length === 0) errors.push({ code: 'missing-key-column' })
  if (keyCols.length > 1) errors.push({ code: 'multiple-key-columns' })

  // -- rows -------------------------------------------------------------
  const start = Math.max(0, headerRowIndex)
  const end = parsedRows.length - Math.max(0, ignoreLastNRows)
  const rawRows = headerRowValid && ignoreRowsValid ? parsedRows.slice(start, Math.max(start, end)) : []
  if (rawRows.length > DI_ROWS_MAX) errors.push({ code: 'row-limit-exceeded', detail: { count: rawRows.length, max: DI_ROWS_MAX } })

  const keyCol = keyCols[0]
  const rows: { sourceKey: string; number: Record<string, number>; label: Record<string, string>; foreignKey: Record<string, string> }[] = []
  const seenKeys = new Set<string>()
  for (let ri = 0; ri < rawRows.length; ri++) {
    const raw = rawRows[ri]
    if (raw.length !== headers.length) {
      errors.push({ code: 'ragged-row', rowIndex: ri, detail: { actual: raw.length, expected: headers.length } })
      continue
    }
    let sourceKey: string | null = null
    if (keyCol) {
      const idx = indexBySourceColumnId.get(keyCol.sourceColumnId)
      const cell = idx !== undefined ? normalizeKey(raw[idx] ?? '') : ''
      if (cell === '') errors.push({ code: 'empty-key', rowIndex: ri })
      else if (utf8Len(cell) > SOURCE_KEY_MAX_BYTES) errors.push({ code: 'key-too-long', rowIndex: ri, detail: { max: SOURCE_KEY_MAX_BYTES } })
      else if (hasControlChar(cell)) errors.push({ code: 'key-control-char', rowIndex: ri })
      else if (seenKeys.has(cell)) errors.push({ code: 'duplicate-key', rowIndex: ri })
      else {
        seenKeys.add(cell)
        sourceKey = cell
      }
    }
    if (sourceKey === null) continue

    const number: Record<string, number> = {}
    const label: Record<string, string> = {}
    const foreignKey: Record<string, string> = {}
    for (const c of resolvedColumns) {
      if (c.role === 'key') continue
      const idx = indexBySourceColumnId.get(c.sourceColumnId)
      const cellRaw = idx !== undefined ? (raw[idx] ?? '') : ''
      if (c.role === 'number') {
        const parsed = parseNumberCell(cellRaw)
        if (parsed.ok) number[c.sourceColumnId] = parsed.value
        else errors.push({ code: parsed.code, rowIndex: ri, sourceColumnId: c.sourceColumnId })
      } else if (c.role === 'label') {
        const v = normalizeKey(cellRaw)
        if (v !== '') label[c.sourceColumnId] = v
      } else if (c.role === 'foreignKey') {
        const v = normalizeKey(cellRaw)
        if (v !== '') foreignKey[c.sourceColumnId] = v
      }
    }
    rows.push({ sourceKey, number, label, foreignKey })
  }

  // -- FK-target validation -- this table's OWN outgoing FK cells only.
  // NEVER the reverse ("does some other table still point at a row going
  // missing here") -- that check belongs entirely to
  // `findImportForeignKeyDependents` (dataImportRefresh.ts), run per
  // `missing` row during `diffRefresh`, never here. Merging the two
  // directions into one validation pass would fail a genuinely
  // disappearing lookup row as a generic orphan-FK error before it ever
  // reaches that specific, actionable check.
  for (const c of resolvedColumns) {
    if (c.role !== 'foreignKey' || !c.refTableId) continue
    const target = tables.find((t) => t.sourceTableId === c.refTableId)
    for (let ri = 0; ri < rows.length; ri++) {
      const value = rows[ri].foreignKey[c.sourceColumnId]
      if (value === undefined) continue
      const targetRow = target?.rows.find((r) => r.sourceKey === value)
      if (!targetRow) {
        errors.push({ code: 'orphan-foreign-key', rowIndex: ri, sourceColumnId: c.sourceColumnId, detail: { value } })
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings }

  // -- round-trip-losslessness gate, over the WHOLE batch (this table's
  // candidate final record + every other table unchanged) -- same
  // discipline as Phase 1B's `validateDrafts`.
  const candidateTable: ImportSourceTable = {
    sourceTableId: refreshingTableId,
    label: table.label,
    columns: resolvedColumns,
    rows,
  }
  const wireTables = tables.map((t) => (t.sourceTableId === refreshingTableId ? candidateTable : t))
  const wireBack = readDataImports(wireTables)
  if (wireBack.length !== wireTables.length || !deepEq(wireBack, wireTables)) {
    errors.push({ code: 'round-trip-mismatch' })
  }
  if (errors.length > 0) return { ok: false, errors, warnings }

  const newSourceColumnIds = new Set(newColumns.map((n) => n.sourceColumnId))
  const snapshot = {
    refreshingTableId,
    rows,
    newSourceColumnIds,
    resolvedColumns,
    [REFRESH_BRAND]: true,
  } as ValidatedRefreshSnapshot
  return { ok: true, snapshot, warnings }
}
