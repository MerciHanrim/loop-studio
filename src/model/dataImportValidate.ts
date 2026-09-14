// docs/data-import.md -- Phase 1B: wizard-local draft types, id minting, and
// full-batch validation. This is the ONLY place a `ValidatedImportPlan` can
// be produced -- `buildImportCommit` (dataImportCommit.ts) accepts nothing
// else, so a caller cannot skip validation, not just "shouldn't."

import { nextId } from './factory'
import { SOURCE_KEY_MAX_BYTES, utf8Len } from './model'
import { deepEq } from './revision'
import {
  DI_COLUMNS_MAX,
  DI_HEADER_MAX,
  DI_LABEL_MAX,
  DI_ROWS_MAX,
  DI_TABLES_MAX,
  readDataImports,
  type ImportColumnRole,
  type ImportSourceTable,
} from './serialize'

// -- wizard-local draft state (never persisted) --------------------------

/** `'ignored'` is Phase 1B's own transient preview-selection state -- never
 *  a storage role, never reaches `ImportColumnRole` (R8-D23). */
export type DraftColumnRole = ImportColumnRole | 'ignored'

export type DraftColumn = {
  /** Minted (`nextId('srccol')`) the moment this column is FIRST given a
   *  STORAGE role (key/number/label/foreignKey) -- absent while `'ignored'`
   *  has never been left. Once minted, changing the role again keeps it. */
  sourceColumnId?: string
  role: DraftColumnRole
  /** current header text -- display only, never the identity (§DI9). */
  header: string
  /** `role: 'foreignKey'` only -- another draft's `sourceTableId`. */
  refDraftId?: string
}

export type TableDraft = {
  /** Minted (`nextId('srctable')`) the moment this draft is created. */
  sourceTableId: string
  label: string
  /** 1-based index into `parsedRows` -- the header ROW, not a boolean
   *  "has header?" toggle (a title row above the real header still works:
   *  everything before this index is discarded preamble). */
  headerRowIndex: number
  /** trailing summary rows to discard. */
  ignoreLastNRows: number
  /** the raw parsed grid, from `parseDelimitedText`. */
  parsedRows: string[][]
  /** one entry per column position in the header row. */
  columns: DraftColumn[]
  /** required once `columns` has 2+ `foreignKey`-role entries (§DI-D11) --
   *  the index (into `columns`) of the FK that drives frame grouping. */
  groupByColumnIndex?: number
}

/** §DI9 -- mint `sourceTableId` the moment a table draft is added. */
export function createTableDraft(): TableDraft {
  return {
    sourceTableId: nextId('srctable'),
    label: '',
    headerRowIndex: 1,
    ignoreLastNRows: 0,
    parsedRows: [],
    columns: [],
  }
}

/** §DI9 -- mint `sourceColumnId` the moment a column is FIRST given a
 *  storage role; changing an already-storage-roled column's role again
 *  keeps its existing id (never re-minted). Cancelling the wizard after
 *  either mint is harmless -- `nextId()` ids are never reused or checked
 *  for "was this one ever committed." */
export function setColumnRole(draft: TableDraft, columnIndex: number, role: DraftColumnRole): TableDraft {
  const columns = draft.columns.slice()
  const col = columns[columnIndex]
  if (!col) return draft
  const sourceColumnId = role === 'ignored' ? col.sourceColumnId : (col.sourceColumnId ?? nextId('srccol'))
  columns[columnIndex] = { ...col, role, sourceColumnId }
  return { ...draft, columns }
}

// -- validated, normalised output ------------------------------------------

export type ValidatedColumn = {
  sourceColumnId: string
  role: ImportColumnRole
  header: string
  refTableId?: string
}
export type ValidatedRow = {
  sourceKey: string
  number: Record<string, number>
  label: Record<string, string>
  foreignKey: Record<string, string>
}
export type ValidatedTable = {
  sourceTableId: string
  label: string
  columns: ValidatedColumn[]
  rows: ValidatedRow[]
  groupByColumnId?: string
}

// A REAL runtime symbol (not just a type declaration) -- never exported, so
// no external module can spell this property's key, making
// `ValidatedImportPlan` genuinely unconstructable outside this file (a
// plain structural type could be hand-built by any caller, which would
// defeat "the type IS the trust boundary").
const PLAN_BRAND: unique symbol = Symbol('ValidatedImportPlan')
export type ValidatedImportPlan = {
  readonly tables: readonly ValidatedTable[]
  readonly [PLAN_BRAND]: true
}

export type IssueCode =
  | 'table-limit-exceeded'
  | 'column-limit-exceeded'
  | 'row-limit-exceeded'
  | 'label-too-long'
  | 'header-too-long'
  | 'missing-key-column'
  | 'multiple-key-columns'
  | 'empty-key'
  | 'key-too-long'
  | 'key-control-char'
  | 'duplicate-key'
  | 'ragged-row'
  | 'empty-number'
  | 'invalid-number'
  | 'orphan-foreign-key'
  | 'missing-fk-target'
  | 'missing-group-by'
  | 'round-trip-mismatch'
  | 'label-fallback'

export type Issue = {
  code: IssueCode
  tableIndex: number
  rowIndex?: number
  columnIndex?: number
  detail?: Record<string, unknown>
}

// -- shared label composition (used by BOTH this file and dataImportCommit.ts) --

/** §DI10 -- a row's OWN `label`-role text(s), in column order, joined with
 *  `" · "`. `null` when the table has no `label`-role column, or none has a
 *  non-empty value for this row. Used to resolve what an FK pointing AT
 *  this row contributes to some OTHER row's label -- an FK target's own FKs
 *  are never chased transitively. */
export function composeRowLabelTerm(table: ValidatedTable, row: ValidatedRow): string | null {
  const parts: string[] = []
  for (const c of table.columns) {
    if (c.role !== 'label') continue
    const v = row.label[c.sourceColumnId]
    if (v) parts.push(v)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** §DI8/§DI10 -- resolve what one FK cell contributes to a label: the
 *  target row's OWN composed label term, or (only when the target table
 *  has no `label`-role column, or none has a value for that row) the FK's
 *  raw stored key value, with `usedFallback: true`. The target row is
 *  assumed to exist (an orphan FK is a separate, blocking error checked
 *  during `validateDrafts` and never reaches this function in that case;
 *  the `null` branch here is a pure defensive fallback). */
export function resolveForeignKeyLabelTerm(
  tables: readonly ValidatedTable[],
  refTableId: string,
  targetSourceKey: string,
): { term: string; usedFallback: boolean } {
  const target = tables.find((t) => t.sourceTableId === refTableId)
  const targetRow = target?.rows.find((r) => r.sourceKey === targetSourceKey)
  if (!target || !targetRow) return { term: targetSourceKey, usedFallback: true }
  const composed = composeRowLabelTerm(target, targetRow)
  return composed !== null ? { term: composed, usedFallback: false } : { term: targetSourceKey, usedFallback: true }
}

/** §DI10 -- the FULL label a row contributes to (via its label AND
 *  foreignKey columns, in column declaration order, joined with `" · "`);
 *  falls back to the row's own `sourceKey` when the row has neither. Also
 *  returns which `sourceColumnId`s used the raw-key fallback, for the
 *  non-blocking warning. */
export function composeFullRowLabel(
  tables: readonly ValidatedTable[],
  table: ValidatedTable,
  row: ValidatedRow,
): { text: string; fallbackColumnIds: string[] } {
  const parts: string[] = []
  const fallbackColumnIds: string[] = []
  for (const c of table.columns) {
    if (c.role === 'label') {
      const v = row.label[c.sourceColumnId]
      if (v) parts.push(v)
    } else if (c.role === 'foreignKey' && c.refTableId) {
      const key = row.foreignKey[c.sourceColumnId]
      if (key) {
        const { term, usedFallback } = resolveForeignKeyLabelTerm(tables, c.refTableId, key)
        parts.push(term)
        if (usedFallback) fallbackColumnIds.push(c.sourceColumnId)
      }
    }
  }
  const text = parts.length > 0 ? parts.join(' · ') : row.sourceKey
  return { text, fallbackColumnIds }
}

// -- number-cell rule (shared with the wizard's live cell-level feedback) --

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

/** Trim, then accept only a plain finite decimal literal. An empty string
 *  is a separate, explicit error -- never coerced to `0`. Rejects hex,
 *  `Infinity`, `NaN`, and a thousands separator, which `Number()` would
 *  otherwise wrongly accept. */
export function parseNumberCell(raw: string): { ok: true; value: number } | { ok: false; code: 'empty-number' | 'invalid-number' } {
  const t = raw.trim()
  if (t === '') return { ok: false, code: 'empty-number' }
  if (!NUMBER_RE.test(t)) return { ok: false, code: 'invalid-number' }
  const n = Number(t)
  return Number.isFinite(n) ? { ok: true, value: Object.is(n, -0) ? 0 : n } : { ok: false, code: 'invalid-number' }
}

// -- key normalisation ------------------------------------------------------

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c <= 0x1f || c === 0x7f) return true
  }
  return false
}

function normalizeKey(raw: string): string {
  return raw.trim().normalize('NFC')
}

// -- the effective (post header-row / trim) data rows of a draft -----------

function effectiveRows(draft: TableDraft): string[][] {
  const start = Math.max(0, draft.headerRowIndex) // headerRowIndex is 1-based; data starts right after it
  const end = draft.parsedRows.length - Math.max(0, draft.ignoreLastNRows)
  return draft.parsedRows.slice(start, Math.max(start, end))
}

// -- validateDrafts ----------------------------------------------------------

export function validateDrafts(
  drafts: TableDraft[],
): { ok: true; plan: ValidatedImportPlan; warnings: Issue[] } | { ok: false; errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = []
  const warnings: Issue[] = []

  if (drafts.length > DI_TABLES_MAX) {
    errors.push({ code: 'table-limit-exceeded', tableIndex: -1, detail: { count: drafts.length, max: DI_TABLES_MAX } })
  }

  // Pass A -- per-table structural + cell-content validation, independent
  // of any cross-table (FK) reference. Builds each table's normalised rows
  // and its key set, needed by pass B below.
  const built: ValidatedTable[] = []
  for (let ti = 0; ti < drafts.length; ti++) {
    const draft = drafts[ti]

    if (draft.label.length > DI_LABEL_MAX) {
      errors.push({ code: 'label-too-long', tableIndex: ti, detail: { length: draft.label.length, max: DI_LABEL_MAX } })
    }
    if (draft.columns.length > DI_COLUMNS_MAX) {
      errors.push({ code: 'column-limit-exceeded', tableIndex: ti, detail: { count: draft.columns.length, max: DI_COLUMNS_MAX } })
    }
    for (let ci = 0; ci < draft.columns.length; ci++) {
      if (draft.columns[ci].header.length > DI_HEADER_MAX) {
        errors.push({ code: 'header-too-long', tableIndex: ti, columnIndex: ci, detail: { length: draft.columns[ci].header.length, max: DI_HEADER_MAX } })
      }
    }

    const keyColumnIndexes = draft.columns.reduce<number[]>((acc, c, ci) => (c.role === 'key' ? [...acc, ci] : acc), [])
    if (keyColumnIndexes.length === 0) errors.push({ code: 'missing-key-column', tableIndex: ti })
    if (keyColumnIndexes.length > 1) errors.push({ code: 'multiple-key-columns', tableIndex: ti })

    const fkColumnIndexes = draft.columns.reduce<number[]>((acc, c, ci) => (c.role === 'foreignKey' ? [...acc, ci] : acc), [])
    if (fkColumnIndexes.length >= 2 && draft.groupByColumnIndex === undefined) {
      errors.push({ code: 'missing-group-by', tableIndex: ti })
    }
    for (const ci of fkColumnIndexes) {
      if (!draft.columns[ci].refDraftId) errors.push({ code: 'missing-fk-target', tableIndex: ti, columnIndex: ci })
    }

    const rows = effectiveRows(draft)
    if (rows.length > DI_ROWS_MAX) {
      errors.push({ code: 'row-limit-exceeded', tableIndex: ti, detail: { count: rows.length, max: DI_ROWS_MAX } })
    }

    const validatedRows: ValidatedRow[] = []
    const seenKeys = new Set<string>()
    const keyColIdx = keyColumnIndexes[0]
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri]
      if (row.length !== draft.columns.length) {
        errors.push({ code: 'ragged-row', tableIndex: ti, rowIndex: ri, detail: { actual: row.length, expected: draft.columns.length } })
        continue
      }

      let sourceKey: string | null = null
      if (keyColIdx !== undefined) {
        const raw = normalizeKey(row[keyColIdx] ?? '')
        if (raw === '') {
          errors.push({ code: 'empty-key', tableIndex: ti, rowIndex: ri })
        } else if (utf8Len(raw) > SOURCE_KEY_MAX_BYTES) {
          errors.push({ code: 'key-too-long', tableIndex: ti, rowIndex: ri, detail: { max: SOURCE_KEY_MAX_BYTES } })
        } else if (hasControlChar(raw)) {
          errors.push({ code: 'key-control-char', tableIndex: ti, rowIndex: ri })
        } else if (seenKeys.has(raw)) {
          errors.push({ code: 'duplicate-key', tableIndex: ti, rowIndex: ri })
        } else {
          seenKeys.add(raw)
          sourceKey = raw
        }
      }
      if (sourceKey === null) continue // this row can't be identified -- excluded from the built table, errors already recorded

      const number: Record<string, number> = {}
      const label: Record<string, string> = {}
      const foreignKey: Record<string, string> = {}
      for (let ci = 0; ci < draft.columns.length; ci++) {
        const col = draft.columns[ci]
        const cellRaw = row[ci] ?? ''
        if (col.role === 'number' && col.sourceColumnId) {
          const parsed = parseNumberCell(cellRaw)
          if (parsed.ok) number[col.sourceColumnId] = parsed.value
          else errors.push({ code: parsed.code, tableIndex: ti, rowIndex: ri, columnIndex: ci })
        } else if (col.role === 'label' && col.sourceColumnId) {
          const v = normalizeKey(cellRaw)
          if (v !== '') label[col.sourceColumnId] = v
        } else if (col.role === 'foreignKey' && col.sourceColumnId) {
          const v = normalizeKey(cellRaw)
          if (v !== '') foreignKey[col.sourceColumnId] = v
        }
      }
      validatedRows.push({ sourceKey, number, label, foreignKey })
    }

    const columns: ValidatedColumn[] = draft.columns
      .filter((c) => c.role !== 'ignored' && c.sourceColumnId)
      .map((c) => ({
        sourceColumnId: c.sourceColumnId!,
        role: c.role as ImportColumnRole,
        header: c.header,
        ...(c.role === 'foreignKey' && c.refDraftId ? { refTableId: c.refDraftId } : {}),
      }))
    const groupByColumnId =
      draft.groupByColumnIndex !== undefined ? draft.columns[draft.groupByColumnIndex]?.sourceColumnId : undefined

    built.push({
      sourceTableId: draft.sourceTableId,
      label: draft.label,
      columns,
      rows: validatedRows,
      ...(groupByColumnId ? { groupByColumnId } : {}),
    })
  }

  // Pass B -- cross-table foreign-key resolution (needs every table's key
  // set built in pass A) + the label-fallback warning.
  for (let ti = 0; ti < built.length; ti++) {
    const table = built[ti]
    for (let ci = 0; ci < table.columns.length; ci++) {
      const col = table.columns[ci]
      if (col.role !== 'foreignKey' || !col.refTableId) continue
      const target = built.find((t) => t.sourceTableId === col.refTableId)
      for (let ri = 0; ri < table.rows.length; ri++) {
        const row = table.rows[ri]
        const value = row.foreignKey[col.sourceColumnId]
        if (value === undefined) continue // empty FK cell -- no relation for this row, allowed
        const targetRow = target?.rows.find((r) => r.sourceKey === value)
        if (!targetRow) {
          errors.push({ code: 'orphan-foreign-key', tableIndex: ti, rowIndex: ri, columnIndex: ci, detail: { value } })
          continue
        }
        if (target && composeRowLabelTerm(target, targetRow) === null) {
          warnings.push({ code: 'label-fallback', tableIndex: ti, rowIndex: ri, columnIndex: ci })
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings }

  // Round-trip-losslessness gate -- if the wire projection of ANYTHING here
  // would be silently dropped by `readDataImports` (the same defensive
  // reader Phase 1A ships), refuse rather than let a corrupted-on-write
  // document out the door. Checked per-table so one bad table doesn't mask
  // where the mismatch is.
  for (let ti = 0; ti < built.length; ti++) {
    const table = built[ti]
    const wire: ImportSourceTable = {
      sourceTableId: table.sourceTableId,
      label: table.label,
      columns: table.columns.map((c) =>
        c.refTableId
          ? { sourceColumnId: c.sourceColumnId, role: c.role, header: c.header, refTableId: c.refTableId }
          : { sourceColumnId: c.sourceColumnId, role: c.role, header: c.header },
      ),
      rows: table.rows.map((r) => ({ sourceKey: r.sourceKey, number: { ...r.number }, label: { ...r.label }, foreignKey: { ...r.foreignKey } })),
    }
    const back = readDataImports([wire])
    if (back.length !== 1 || !deepEq(back[0], wire)) {
      errors.push({ code: 'round-trip-mismatch', tableIndex: ti })
    }
  }
  if (errors.length > 0) return { ok: false, errors, warnings }

  const plan = { tables: built, [PLAN_BRAND]: true } as ValidatedImportPlan
  return { ok: true, plan, warnings }
}
