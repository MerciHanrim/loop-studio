import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useReactFlow, useStore as useRfStore } from '@xyflow/react'
import { useT, type MessageKey } from '../../i18n'
import type { CsvParseError } from '../../model/csv'
import { detectDelimiter, parseDelimitedText, stripBom, toCsv } from '../../model/csv'
import {
  createTableDraft,
  formatCellValueForDisplay,
  previewDraftCounts,
  setColumnRole,
  validateDrafts,
  type DraftColumnRole,
  type Issue,
  type IssueCode,
  type TableDraft,
} from '../../model/dataImportValidate'
import {
  cellLabel,
  NODE_H,
  NODE_W,
  summarizeImportPlan,
  type CommitFailureCode,
  type PlacementChoice,
} from '../../model/dataImportCommit'
import { DI_COLUMNS_MAX, DI_ROWS_MAX, DI_TABLES_MAX } from '../../model/serialize'
import { useFrameStore } from '../../store/frameStore'
import { useGraphStore } from '../../store/graphStore'
import { useUiStore } from '../../store/uiStore'
import { useIsMobile } from '../../ui/media'
import { REPO_URL } from '../AboutDialog'
import { downloadCsv } from '../../ui/download'
import { canvasFitInsets, viewportForRect } from '../canvasFit'
import { useDialogFocus } from '../useDialogFocus'
import { useQuickStartStore } from './quickStartStore'

// Static lookups, not dynamic `import.issue.` + code template strings --
// scripts/check-i18n.mjs only recognises a literal call with a quoted
// string, or a `MessageKey`-typed map like these (the same pattern
// `ThemeToggle.tsx`'s `LABEL_KEY` uses), never a computed key.
const ISSUE_KEY: Record<IssueCode, MessageKey> = {
  'table-limit-exceeded': 'import.issue.table-limit-exceeded',
  'column-limit-exceeded': 'import.issue.column-limit-exceeded',
  'row-limit-exceeded': 'import.issue.row-limit-exceeded',
  'invalid-header-row': 'import.issue.invalid-header-row',
  'invalid-ignore-rows': 'import.issue.invalid-ignore-rows',
  'empty-table-name': 'import.issue.empty-table-name',
  'label-too-long': 'import.issue.label-too-long',
  'empty-column-header': 'import.issue.empty-column-header',
  'header-too-long': 'import.issue.header-too-long',
  'missing-source-column-id': 'import.issue.missing-source-column-id',
  'duplicate-source-table-id': 'import.issue.duplicate-source-table-id',
  'missing-key-column': 'import.issue.missing-key-column',
  'multiple-key-columns': 'import.issue.multiple-key-columns',
  'empty-key': 'import.issue.empty-key',
  'key-too-long': 'import.issue.key-too-long',
  'key-control-char': 'import.issue.key-control-char',
  'duplicate-key': 'import.issue.duplicate-key',
  'ragged-row': 'import.issue.ragged-row',
  'empty-number': 'import.issue.empty-number',
  'invalid-number': 'import.issue.invalid-number',
  'orphan-foreign-key': 'import.issue.orphan-foreign-key',
  'missing-fk-target': 'import.issue.missing-fk-target',
  'invalid-fk-target': 'import.issue.invalid-fk-target',
  'missing-group-by': 'import.issue.missing-group-by',
  'invalid-group-by': 'import.issue.invalid-group-by',
  'round-trip-mismatch': 'import.issue.round-trip-mismatch',
  'label-fallback': 'import.issue.label-fallback',
}
const COMMIT_ERROR_KEY: Record<CommitFailureCode, MessageKey> = {
  'source-table-id-collision': 'import.commitError.source-table-id-collision',
  'parameter-id-collision': 'import.commitError.parameter-id-collision',
  'frame-placement-failed': 'import.commitError.frame-placement-failed',
  'frame-not-found': 'import.commitError.frame-not-found',
  'frame-insufficient-space': 'import.commitError.frame-insufficient-space',
  'invalid-result-graph': 'import.commitError.invalid-result-graph',
}
// `CsvParseError.kind` is an internal code, never shown to the user
// untranslated -- same static-lookup discipline as ISSUE_KEY/COMMIT_ERROR_KEY.
const PARSE_ERROR_KIND_KEY: Record<CsvParseError['kind'], MessageKey> = {
  'unterminated-quote': 'import.parseErrorKind.unterminated-quote',
  'text-after-quote': 'import.parseErrorKind.text-after-quote',
  'quote-in-unquoted-field': 'import.parseErrorKind.quote-in-unquoted-field',
}

// docs/data-import.md §DI16 Phase 1B -- the CSV/TSV import wizard. Three
// steps: configure every bound table (paste/upload, delimiter, header row,
// column roles, FK targets, group-by) with the whole batch validated
// together on Next (§DI-D10 -- nothing touches the graph until every table
// is clean; §DI17 -- validation problems render INLINE on this same step,
// never on a separate screen), choose a placement destination, review the
// breakdown, then commit as ONE atomic history entry
// (`graphStore.commitDataImport`).
//
// §DI17 -- the in-tool guide: a collapsible quick start with a one-click
// example, the shared role help every role select is described by, a
// per-table count line, and the post-commit view (first Parameter
// selected, the created area framed inside the usable canvas, a one-shot
// canvas hint).

type DraftUI = {
  draft: TableDraft
  pasteText: string
  delimiter: ',' | '\t'
  delimiterAuto: boolean
  parseError: CsvParseError | null
}

const ROLE_OPTIONS: DraftColumnRole[] = ['ignored', 'key', 'number', 'label', 'foreignKey']
// A static lookup, not a dynamic `import.role.` + role template string --
// the project's i18n call-site checker (scripts/check-i18n.mjs) only
// recognises a literal call with a quoted string, or a `MessageKey`-typed
// map like this one (the same pattern `ThemeToggle.tsx`'s `LABEL_KEY`
// uses), never a computed template-literal message key.
const ROLE_LABEL_KEY: Record<DraftColumnRole, MessageKey> = {
  ignored: 'import.role.ignored',
  key: 'import.role.key',
  number: 'import.role.number',
  label: 'import.role.label',
  foreignKey: 'import.role.foreignKey',
}
const ROLE_HELP_KEY: Record<DraftColumnRole, MessageKey> = {
  key: 'import.roleHelp.key',
  label: 'import.roleHelp.label',
  number: 'import.roleHelp.number',
  foreignKey: 'import.roleHelp.foreignKey',
  ignored: 'import.roleHelp.ignored',
}
// the order the shared role help lists them in -- Key first (the one
// required choice), Ignore last
const ROLE_HELP_ORDER: DraftColumnRole[] = ['key', 'number', 'label', 'foreignKey', 'ignored']

// §DI17 -- the quick-start example. The SAME three rows the handover and
// docs/import-guide.md show, so a reader can recognise them everywhere.
export const EXAMPLE_TABLE_NAME = 'Items'
export const EXAMPLE_CSV = 'item_id,item_name,price,drop_rate\nsword,Steel Sword,4900,10\npotion,Health Potion,300,25'
const EXAMPLE_ROLES: DraftColumnRole[] = ['key', 'label', 'number', 'number']
const SAMPLE_FILE_NAME = 'loop-studio-sample.csv'
export const IMPORT_GUIDE_URL = `${REPO_URL}/blob/main/docs/import-guide.md`

// §DI17 -- post-commit view. The created batch is framed inside the USABLE
// canvas (pane minus Controls / minimap / the top-center hint slot) at a
// zoom in [IMPORT_FIT_FLOOR, IMPORT_FIT_CEIL]; a batch too large for the
// floor is never shrunk further -- the view anchors its top-left corner at
// the floor zoom instead (the "start here" a large import needs, not a
// dot). Measured constants, mirrored by e2e/data-import-guide.spec.ts: the
// top inset is the `top-center` hint slot at its tallest — the 15 px panel
// margin plus a three-line note (the "2,400 Parameters added from …" text
// wraps to three lines at the note's 360 px max width), measured at 86 px
// on the 1280×800 e2e viewport.
export const IMPORT_FIT_FLOOR = 0.5
export const IMPORT_FIT_CEIL = 1
export const IMPORT_HINT_INSET_TOP = 88

function newDraftUI(): DraftUI {
  return { draft: createTableDraft(), pasteText: '', delimiter: ',', delimiterAuto: true, parseError: null }
}

/** A row-count field (header row index, ignore-last-N-rows) must be a
 *  genuine non-negative INTEGER at or above `min` -- a raw `Number(input)`
 *  accepts a fraction (`2.5`) or a non-finite value (`Infinity`, from
 *  `1e999`) unnoticed, which then silently mis-slices `parsedRows`. Anything
 *  that isn't a finite integer falls back to `min`, exactly like the empty-
 *  input case already does. */
function sanitizeRowCount(raw: string, min: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && Number.isInteger(n) ? Math.max(min, n) : min
}

/** Re-parse `pasteText` and re-derive `draft.columns` to match the header
 *  row's cell count. Column configuration is preserved by POSITION when the
 *  count is unchanged; otherwise columns reset to `'ignored'` (a column
 *  count change invalidates any prior role mapping by index). */
function reparse(ui: DraftUI): DraftUI {
  const text = stripBom(ui.pasteText)
  if (text.trim() === '') {
    return { ...ui, parseError: null, draft: { ...ui.draft, parsedRows: [], columns: [] } }
  }
  const delimiter = ui.delimiterAuto ? detectDelimiter(text) : ui.delimiter
  const result = parseDelimitedText(text, delimiter)
  if (!result.ok) {
    return { ...ui, delimiter, parseError: result.error }
  }
  const header = result.rows[Math.max(0, ui.draft.headerRowIndex - 1)] ?? []
  const columns =
    ui.draft.columns.length === header.length
      ? ui.draft.columns.map((c, i) => ({ ...c, header: header[i] ?? c.header }))
      : header.map((h) => ({ role: 'ignored' as const, header: h }))
  return {
    ...ui,
    delimiter,
    parseError: null,
    draft: { ...ui.draft, parsedRows: result.rows, columns },
  }
}

/** The quick-start example as a fully configured table card. */
function exampleDraftUI(): DraftUI {
  let ui = reparse({ ...newDraftUI(), pasteText: EXAMPLE_CSV })
  ui = { ...ui, draft: { ...ui.draft, label: EXAMPLE_TABLE_NAME } }
  EXAMPLE_ROLES.forEach((role, i) => {
    ui = { ...ui, draft: setColumnRole(ui.draft, i, role) }
  })
  return ui
}
const isExampleCard = (ui: DraftUI): boolean => ui.draft.label === EXAMPLE_TABLE_NAME && ui.pasteText === EXAMPLE_CSV
const nameEmpty = (ui: DraftUI) => ui.draft.label.trim() === ''
const dataEmpty = (ui: DraftUI) => ui.pasteText.trim() === ''

/** The sample file a user downloads, edits in their sheet and pastes back.
 *  `EXAMPLE_CSV` is also the text shown in the paste box (and the identity
 *  `isExampleCard` compares against), so it stays LF in the app and is written
 *  through the shared writer only for the DOWNLOAD — the same CRLF records and
 *  RFC 4180 quoting as the other five. */
function downloadSampleCsv(): void {
  // parsed with this product's own parser rather than a naive split, so the
  // constant can grow a quoted field later without this silently mangling it
  const parsed = parseDelimitedText(EXAMPLE_CSV, ',')
  downloadCsv(parsed.ok ? toCsv(parsed.rows) : EXAMPLE_CSV, SAMPLE_FILE_NAME)
}

type Step = 'tables' | 'placement' | 'review'
type Validation = ReturnType<typeof validateDrafts>

export function DataImportWizard({
  open,
  forceQuickStart = false,
  onClose,
  returnFocusTo,
}: {
  open: boolean
  /** docs/data-import.md §DI17 -- the Data menu's "How to prepare a
   *  spreadsheet…" entry: show the quick start expanded regardless of the
   *  persisted collapsed state (the persisted state itself is untouched). */
  forceQuickStart?: boolean
  onClose: () => void
  /** review condition 3 — resolves to the ⋯ trigger when Data was collapsed
   *  at open time, since `document.activeElement` may already have moved
   *  on by the time this dialog's own focus effect runs. */
  returnFocusTo?: () => HTMLElement | null | undefined
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const roleHelpId = useId()
  const qsTitleId = useId()
  const qsBodyId = useId()
  useDialogFocus(open, ref, onClose, returnFocusTo)
  const { screenToFlowPosition, setViewport } = useReactFlow()
  const paneW = useRfStore((s) => s.width)
  const paneH = useRfStore((s) => s.height)
  const isMobile = useIsMobile()
  const minimapCollapsed = useUiStore((s) => s.minimapCollapsed)
  const setLastImportBatch = useUiStore((s) => s.setLastImportBatch)

  const [step, setStep] = useState<Step>('tables')
  const [tables, setTables] = useState<DraftUI[]>([newDraftUI()])
  const [validation, setValidation] = useState<Validation | null>(null)
  // §DI17 -- once the input changes after a failed check, the recorded
  // problems are STALE: still listed (so the user keeps the context) but no
  // longer marked as active errors, until Next re-checks.
  const [validationStale, setValidationStale] = useState(false)
  const [placementKind, setPlacementKind] = useState<'none' | 'framePerTable' | 'existingFrame'>('none')
  const [existingFrameId, setExistingFrameId] = useState<string>('')
  const [commitError, setCommitError] = useState<{ code: CommitFailureCode; detail?: Record<string, unknown> } | null>(null)
  const frames = useFrameStore((s) => s.frames)
  const commitDataImport = useGraphStore((s) => s.commitDataImport)

  // §DI17 -- quick start open/closed. `forceQuickStart` is a per-open
  // override that never writes the persisted state.
  const qsCollapsed = useQuickStartStore((s) => s.collapsed)
  // the header toggle ends the per-open override; `reset()` (every close)
  // re-arms it for the next open
  const [qsOverrideEnded, setQsOverrideEnded] = useState(false)
  const qsExpanded = (forceQuickStart && !qsOverrideEnded) || !qsCollapsed
  const summaryRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const [focusSummaryTick, setFocusSummaryTick] = useState(0)

  // §DI17 -- "Use this example" asks for ONE card to be scrolled to and
  // focused, and the request carries the generation that made it.
  const focusReqRef = useRef<{ gen: number; idx: number } | null>(null)
  const focusGenRef = useRef(0)
  const [focusGen, setFocusGen] = useState(0)

  useEffect(() => {
    // the previous import's hint retires the moment the wizard opens again
    // (its trigger goes false) -- the next commit is no longer the "first"
    if (open) setLastImportBatch(null)
  }, [open, setLastImportBatch])

  // §DI17 -- after a failed check, move focus to the summary (screen readers
  // announce it; sighted users are scrolled to it)
  useEffect(() => {
    if (focusSummaryTick > 0) summaryRef.current?.focus()
  }, [focusSummaryTick])

  // §DI17 -- the card the example landed on is scrolled to and focused INSIDE
  // the commit that created or filled it.
  //
  // It must not be a `requestAnimationFrame` from the click handler. React
  // commits the new card synchronously inside the click, so between that
  // commit and the frame there is a window -- measured at 1.4-15 ms, and only
  // bounded by how busy the main thread is -- in which the user is looking at
  // a finished card and acting on it. Whatever they did was then undone: the
  // frame pulled focus out of the role select they had tabbed to, out of the
  // `role="alert"` summary a failed check had just announced, and, worst,
  // out of the data box mid-sentence, so the rest of what they typed went
  // into the table NAME (`a,b` stayed in the data, `1,2Items` became the
  // name). A layout effect runs inside that same commit, before paint, so
  // there is no window at all and nothing stale to cancel.
  //
  // The generation is what makes the no-op path work: reusing an existing
  // example card changes no state, so an effect keyed on `tables` alone would
  // never run.
  useLayoutEffect(() => {
    const req = focusReqRef.current
    if (!req || req.gen !== focusGenRef.current) return
    focusReqRef.current = null // consumed exactly once, StrictMode included
    const card = cardRefs.current[req.idx]
    if (!card) return
    // the card is the anchor -- name field, data box and count line together --
    // so the input must not scroll itself somewhere else afterwards
    card.scrollIntoView({ block: 'nearest' })
    card.querySelector<HTMLInputElement>('.import__nameField input')?.focus({ preventScroll: true })
  }, [tables, focusGen])

  if (!open) return null

  const reset = () => {
    setStep('tables')
    setTables([newDraftUI()])
    setValidation(null)
    setValidationStale(false)
    setPlacementKind('none')
    setExistingFrameId('')
    setCommitError(null)
    setQsOverrideEnded(false)
  }
  const close = () => {
    reset()
    onClose()
  }

  // every input change after a failed check marks it stale (§DI17)
  const touch = () => {
    if (validation && !validation.ok) setValidationStale(true)
  }
  const updateTable = (idx: number, patch: Partial<DraftUI>) => {
    touch()
    setTables((prev) => prev.map((ui, i) => (i === idx ? reparse({ ...ui, ...patch }) : ui)))
  }
  const updateDraft = (idx: number, patch: Partial<TableDraft>) => {
    touch()
    setTables((prev) => prev.map((ui, i) => (i === idx ? { ...ui, draft: { ...ui.draft, ...patch } } : ui)))
  }
  const setRole = (tableIdx: number, columnIdx: number, role: DraftColumnRole) => {
    touch()
    setTables((prev) =>
      prev.map((ui, i) => (i === tableIdx ? { ...ui, draft: setColumnRole(ui.draft, columnIdx, role) } : ui)),
    )
  }
  const setFkTarget = (tableIdx: number, columnIdx: number, refDraftId: string) => {
    touch()
    setTables((prev) =>
      prev.map((ui, i) => {
        if (i !== tableIdx) return ui
        const columns = ui.draft.columns.slice()
        columns[columnIdx] = { ...columns[columnIdx], refDraftId: refDraftId || undefined }
        return { ...ui, draft: { ...ui.draft, columns } }
      }),
    )
  }

  const addTable = () => {
    touch()
    setTables((prev) => [...prev, newDraftUI()])
  }
  const removeTable = (idx: number) => {
    touch()
    setTables((prev) => prev.filter((_, i) => i !== idx))
  }

  /** Ask for `idx` to be scrolled to and focused by the commit this render
   *  produces. Batched with the `setTables` beside it, so both land together. */
  const focusCard = (idx: number) => {
    focusGenRef.current += 1
    focusReqRef.current = { gen: focusGenRef.current, idx }
    setFocusGen(focusGenRef.current)
  }

  // §DI17 -- "Use this example" is IDEMPOTENT: an existing example card is
  // reused (focused), an empty card is filled in place, and only otherwise
  // is a new card added -- never past DI_TABLES_MAX, never over a card the
  // user already filled.
  const exampleIdx = tables.findIndex(isExampleCard)
  const emptyIdx = tables.findIndex((ui) => nameEmpty(ui) && dataEmpty(ui))
  const exampleBlocked = exampleIdx < 0 && emptyIdx < 0 && tables.length >= DI_TABLES_MAX
  const useExample = () => {
    if (exampleIdx >= 0) return focusCard(exampleIdx)
    touch()
    if (emptyIdx >= 0) {
      setTables((prev) => prev.map((ui, i) => (i === emptyIdx ? exampleDraftUI() : ui)))
      return focusCard(emptyIdx)
    }
    if (tables.length >= DI_TABLES_MAX) return
    setTables((prev) => [...prev, exampleDraftUI()])
    focusCard(tables.length)
  }

  const pickFile = (idx: number) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,.tsv,.txt'
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (file) file.text().then((text) => updateTable(idx, { pasteText: text }))
    })
    window.addEventListener('focus', () => setTimeout(() => input.remove(), 200), { once: true })
    document.body.appendChild(input)
    input.click()
  }

  const hasParseError = tables.some((ui) => ui.parseError !== null)
  // Neither `validateDrafts()` nor its downstream errors (e.g.
  // `missing-key-column`) mean anything before a table has BOTH a name and
  // some pasted/uploaded content -- with zero parsed columns, that error is
  // a DERIVED consequence of there being no data at all, not a real
  // configuration problem. Gate `Next` on this basic completeness so the
  // real validation is never run with a table that couldn't possibly pass
  // it yet.
  const hasIncompleteTable = tables.some((ui) => nameEmpty(ui) || dataEmpty(ui))

  const runValidate = () => {
    if (hasParseError || hasIncompleteTable) return
    const result = validateDrafts(tables.map((ui) => ui.draft))
    setValidation(result)
    setValidationStale(false)
    if (result.ok) setStep('placement')
    else setFocusSummaryTick((n) => n + 1)
  }

  const minimapVisible = !isMobile && paneW >= 640 && paneH >= 380 && !minimapCollapsed

  const commit = () => {
    if (!validation?.ok) return
    let placement: PlacementChoice
    if (placementKind === 'none' || placementKind === 'framePerTable') {
      const rect = document.querySelector('.canvas')?.getBoundingClientRect()
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      placement = { kind: placementKind, origin: screenToFlowPosition({ x, y }) }
    } else {
      if (!existingFrameId) return
      placement = { kind: 'existingFrame', frameId: existingFrameId }
    }
    const result = commitDataImport(validation.plan, placement)
    if (!result.ok) {
      setCommitError({ code: result.reason, detail: result.detail })
      return
    }
    // §DI17 -- post-commit view: select ONLY the first Parameter (O(1),
    // whatever the batch size), frame the created area inside the usable
    // canvas, and arm the one-shot hint.
    const created = result.createdNodes
    if (created.length > 0) {
      useGraphStore.getState().setSelection(created[0].id, null)
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of created) {
        // one pass over the created nodes -- positions + the fixed node
        // footprint, no DOM measurement (fresh nodes are unmeasured anyway)
        if (n.position.x < minX) minX = n.position.x
        if (n.position.y < minY) minY = n.position.y
        if (n.position.x + NODE_W > maxX) maxX = n.position.x + NODE_W
        if (n.position.y + NODE_H > maxY) maxY = n.position.y + NODE_H
      }
      const vp = viewportForRect(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        { width: paneW, height: paneH },
        canvasFitInsets(minimapVisible, IMPORT_HINT_INSET_TOP),
        { floor: IMPORT_FIT_FLOOR, ceil: IMPORT_FIT_CEIL },
      )
      if (vp) setViewport(vp, { duration: 0 })
      setLastImportBatch({ count: created.length, firstId: created[0].id, tables: validation.plan.tables.map((tb) => tb.label) })
    }
    useQuickStartStore.getState().markFirstSuccess()
    close()
  }

  // -- issue text ---------------------------------------------------------

  const issueLocation = (issue: Issue): string | null => {
    if (issue.tableIndex < 0) return null
    const ui = tables[issue.tableIndex]
    const table = ui?.draft.label || `#${issue.tableIndex + 1}`
    const header = typeof issue.detail?.header === 'string' ? issue.detail.header : null
    // `issue.rowIndex` counts from 0 within the EFFECTIVE (post header-row,
    // post ignore-last-N-rows) data rows -- it is NOT the row's position in
    // the raw pasted/uploaded text. Add back the header row itself (and
    // anything before it) so the number shown matches what the user sees
    // by counting lines in their own source text, 1-based.
    const headerRowIndex = ui?.draft.headerRowIndex ?? 1
    if (issue.rowIndex !== undefined && issue.columnIndex !== undefined) {
      const row = headerRowIndex + issue.rowIndex + 1
      const column = issue.columnIndex + 1
      return header
        ? t('import.loc.tableRowColumnHeader', { table, row, column, header })
        : t('import.loc.tableRowColumn', { table, row, column })
    }
    if (issue.rowIndex !== undefined) {
      return t('import.loc.tableRow', { table, row: headerRowIndex + issue.rowIndex + 1 })
    }
    if (issue.columnIndex !== undefined && header) {
      return t('import.loc.tableColumnHeader', { table, column: issue.columnIndex + 1, header })
    }
    return t('import.loc.table', { table })
  }

  const issueText = (issue: Issue): string => {
    // §DI17 -- a user cell shown inside a message is display-formatted
    // (length-capped, control characters made visible); `detail.value`
    // itself stays raw.
    const detail = { ...(issue.detail ?? {}) } as Record<string, string | number>
    if (typeof detail.value === 'string') detail.value = formatCellValueForDisplay(detail.value)
    const desc = t(ISSUE_KEY[issue.code], detail)
    const loc = issueLocation(issue)
    return loc ? `${loc}: ${desc}` : desc
  }

  // §DI17 -- inline error bookkeeping for the input step
  const errors = validation && !validation.ok ? validation.errors : []
  const activeErrors = validationStale ? [] : errors
  const badCells = new Set(activeErrors.filter((e) => e.columnIndex !== undefined).map((e) => `${e.tableIndex}:${e.rowIndex ?? 'h'}:${e.columnIndex}`))
  const errorTableCount = new Set(errors.map((e) => e.tableIndex)).size
  const cellId = (ti: number, ri: number | 'h', ci: number) => `import-cell-${ti}-${ri}-${ci}`
  const jumpTo = (issue: Issue) => {
    const ti = issue.tableIndex
    if (ti < 0) return
    const target =
      issue.columnIndex !== undefined
        ? document.getElementById(cellId(ti, issue.rowIndex ?? 'h', issue.columnIndex))
        : null
    const el = target ?? cardRefs.current[ti]?.querySelector<HTMLElement>('.import__paste') ?? null
    el?.scrollIntoView({ block: 'nearest' })
    el?.focus()
  }

  // -- counts (all from the ONE plan summary once validated) ---------------
  const planSummary = validation?.ok ? summarizeImportPlan(validation.plan, placementKind) : null

  return (
    <div className="mcdlg__scrim" onMouseDown={close}>
      <div
        ref={ref}
        className="mcdlg mcdlg--dataimport"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{t('import.title')}</span>
        </div>
        <div className="mcdlg__body">
          {step === 'tables' && (
            <div className="import__tables">
              {/* §DI17 -- quick start */}
              <section className="import__quickstart" aria-labelledby={qsTitleId}>
                <button
                  type="button"
                  className="import__quickstartToggle"
                  aria-expanded={qsExpanded}
                  aria-controls={qsBodyId}
                  aria-label={t('import.qs.toggleAria')}
                  onClick={() => {
                    setQsOverrideEnded(true)
                    useQuickStartStore.getState().setCollapsed(qsExpanded)
                  }}
                >
                  <span id={qsTitleId}>{t('import.qs.title')}</span>
                  <span aria-hidden="true">{qsExpanded ? '▾' : '▸'}</span>
                </button>
                <div id={qsBodyId} className="import__quickstartBody" hidden={!qsExpanded}>
                  <p className="import__quickstartLead">{t('import.qs.lead')}</p>
                  <p>{t('import.qs.body')}</p>
                  <p className="import__quickstartHeading">{t('import.qs.exampleHeading')}</p>
                  <pre className="import__example">{EXAMPLE_CSV}</pre>
                  <p className="import__quickstartMapping">
                    {t('import.qs.mapping', {
                      key: t('import.role.key'),
                      label: t('import.role.label'),
                      number: t('import.role.number'),
                    })}
                  </p>
                  <p className="import__quickstartResult">{t('import.qs.result')}</p>
                  <div className="import__quickstartActions">
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={exampleBlocked}
                      title={exampleBlocked ? t('import.qs.tableLimit', { max: DI_TABLES_MAX }) : undefined}
                      onClick={useExample}
                    >
                      {t('import.qs.useExample')}
                    </button>
                    <button type="button" className="btn btn--sm" onClick={downloadSampleCsv}>
                      {t('import.qs.download')}
                    </button>
                    <a
                      className="import__guideLink"
                      href={IMPORT_GUIDE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('import.qs.fullGuideAria')}
                    >
                      {t('import.qs.fullGuide')} <span className="menu__ext" aria-hidden="true">↗</span>
                    </a>
                  </div>
                  <details>
                    <summary>{t('import.qs.sources.summary')}</summary>
                    <p>{t('import.qs.sources.sheets')}</p>
                    <p>{t('import.qs.sources.excel')}</p>
                    <p>{t('import.qs.sources.privacy')}</p>
                  </details>
                  <details>
                    <summary>{t('import.qs.notImported.summary')}</summary>
                    <p>{t('import.qs.notImported.formulas')}</p>
                    <p>{t('import.qs.notImported.list')}</p>
                    <p>{t('import.qs.limits', { tables: DI_TABLES_MAX, columns: DI_COLUMNS_MAX, rows: DI_ROWS_MAX })}</p>
                  </details>
                </div>
              </section>

              {/* §DI17 -- the shared role help, rendered ONCE; every role
                  select points at its role's line via aria-describedby */}
              <div className="import__roleHelp" id={roleHelpId}>
                <span className="import__roleHelpTitle">{t('import.roleHelp.title')}</span>
                <dl>
                  {ROLE_HELP_ORDER.map((role) => (
                    <div key={role} id={`${roleHelpId}-${role}`}>
                      <dt>{t(ROLE_LABEL_KEY[role])}</dt>
                      <dd>{t(ROLE_HELP_KEY[role])}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* §DI17 -- inline validation summary (no separate step) */}
              {errors.length > 0 && (
                <div
                  ref={summaryRef}
                  tabIndex={-1}
                  role={validationStale ? undefined : 'alert'}
                  className={`import__issueSummary${validationStale ? ' is-stale' : ''}`}
                >
                  {validationStale ? t('import.issueSummaryStale') : t('import.issueSummary', { n: errors.length, m: Math.max(1, errorTableCount) })}
                  {errors.some((e) => e.tableIndex < 0) && (
                    <ul className={`import__issues${validationStale ? ' is-stale' : ''}`}>
                      {errors
                        .filter((e) => e.tableIndex < 0)
                        .map((issue, i) => (
                          <li key={i}>{issueText(issue)}</li>
                        ))}
                    </ul>
                  )}
                </div>
              )}

              {tables.map((ui, ti) => {
                const counts = previewDraftCounts(ui.draft)
                const tableErrors = errors.filter((e) => e.tableIndex === ti)
                const keyText =
                  counts.keyCount === 1 && counts.keyHeader !== null
                    ? t('import.status.key', { header: counts.keyHeader })
                    : counts.keyCount === 0
                      ? t('import.status.keyNone')
                      : t('import.status.keyMany', { n: counts.keyCount })
                return (
                  <div
                    className="import__table"
                    key={ti}
                    ref={(el) => {
                      cardRefs.current[ti] = el
                    }}
                  >
                    <div className="import__tableHead">
                      <label className="import__nameField">
                        <span className="import__nameLabel">{t('import.tableName')}</span>
                        <input type="text" value={ui.draft.label} onChange={(e) => updateDraft(ti, { label: e.target.value })} />
                      </label>
                      {tables.length > 1 && (
                        <button type="button" className="btn btn--sm" onClick={() => removeTable(ti)}>
                          {t('import.removeTable')}
                        </button>
                      )}
                    </div>
                    {nameEmpty(ui) && <p className="import__error">{t('import.tableNameRequired')}</p>}
                    <textarea
                      className="import__paste"
                      placeholder={t('import.pastePlaceholder')}
                      aria-label={t('import.pasteAria')}
                      value={ui.pasteText}
                      onChange={(e) => updateTable(ti, { pasteText: e.target.value })}
                      rows={4}
                    />
                    {dataEmpty(ui) && <p className="import__error">{t('import.pasteDataRequired')}</p>}
                    <div className="import__settingsGroup">
                      <button type="button" className="btn btn--sm" onClick={() => pickFile(ti)}>
                        {t('import.uploadFile')}
                      </button>
                      <label>
                        {t('import.delimiter')}
                        <select
                          value={ui.delimiterAuto ? 'auto' : ui.delimiter}
                          onChange={(e) =>
                            updateTable(
                              ti,
                              e.target.value === 'auto'
                                ? { delimiterAuto: true }
                                : { delimiterAuto: false, delimiter: e.target.value as ',' | '\t' },
                            )
                          }
                        >
                          <option value="auto">{t('import.delimiterAuto')}</option>
                          <option value=",">{t('import.delimiterComma')}</option>
                          <option value={'\t'}>{t('import.delimiterTab')}</option>
                        </select>
                      </label>
                      <label>
                        {t('import.headerRow')}
                        <input
                          type="number"
                          min={1}
                          value={ui.draft.headerRowIndex}
                          onChange={(e) => {
                            updateDraft(ti, { headerRowIndex: sanitizeRowCount(e.target.value, 1) })
                            updateTable(ti, {})
                          }}
                        />
                      </label>
                      <label>
                        {t('import.ignoreLastRows')}
                        <input
                          type="number"
                          min={0}
                          value={ui.draft.ignoreLastNRows}
                          onChange={(e) => updateDraft(ti, { ignoreLastNRows: sanitizeRowCount(e.target.value, 0) })}
                        />
                      </label>
                    </div>
                    {ui.parseError && (
                      <p className="import__error">
                        {t('import.parseError', {
                          kind: t(PARSE_ERROR_KIND_KEY[ui.parseError.kind]),
                          line: ui.parseError.line,
                          column: ui.parseError.column,
                        })}
                      </p>
                    )}
                    {tableErrors.length > 0 && (
                      <ul className={`import__issues${validationStale ? ' is-stale' : ''}`}>
                        {tableErrors.map((issue, i) => (
                          <li key={i}>
                            <button type="button" className="import__issueLink" title={t('import.issueJump')} onClick={() => jumpTo(issue)}>
                              {issueText(issue)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {ui.draft.columns.length > 0 && (
                      <>
                        <table className="import__preview">
                          <thead>
                            <tr>
                              {ui.draft.columns.map((c, ci) => {
                                const bad = badCells.has(`${ti}:h:${ci}`)
                                return (
                                  <th
                                    key={ci}
                                    id={cellId(ti, 'h', ci)}
                                    tabIndex={-1}
                                    className={bad ? 'is-bad' : undefined}
                                    aria-invalid={bad ? true : undefined}
                                  >
                                    <div>{c.header}</div>
                                    <select
                                      value={c.role}
                                      aria-label={t('import.roleAria', { header: c.header })}
                                      aria-describedby={`${roleHelpId}-${c.role}`}
                                      onChange={(e) => setRole(ti, ci, e.target.value as DraftColumnRole)}
                                    >
                                      {ROLE_OPTIONS.map((r) => (
                                        <option key={r} value={r}>
                                          {t(ROLE_LABEL_KEY[r])}
                                        </option>
                                      ))}
                                    </select>
                                    {c.role === 'foreignKey' && (
                                      <select value={c.refDraftId ?? ''} onChange={(e) => setFkTarget(ti, ci, e.target.value)}>
                                        <option value="">{t('import.selectTable')}</option>
                                        {tables
                                          .filter((_, oi) => oi !== ti)
                                          .map((other) => (
                                            <option key={other.draft.sourceTableId} value={other.draft.sourceTableId}>
                                              {other.draft.label || t('import.tableName')}
                                            </option>
                                          ))}
                                      </select>
                                    )}
                                  </th>
                                )
                              })}
                            </tr>
                            {ui.draft.columns.filter((c) => c.role === 'foreignKey').length >= 2 && (
                              <tr>
                                <th colSpan={ui.draft.columns.length}>
                                  {t('import.groupBy')}
                                  <select
                                    value={ui.draft.groupByColumnIndex ?? ''}
                                    onChange={(e) => updateDraft(ti, { groupByColumnIndex: e.target.value === '' ? undefined : Number(e.target.value) })}
                                  >
                                    <option value="">{t('import.selectColumn')}</option>
                                    {ui.draft.columns.map((c, ci) =>
                                      c.role === 'foreignKey' ? (
                                        <option key={ci} value={ci}>
                                          {c.header}
                                        </option>
                                      ) : null,
                                    )}
                                  </select>
                                </th>
                              </tr>
                            )}
                          </thead>
                          <tbody>
                            {ui.draft.parsedRows
                              .slice(ui.draft.headerRowIndex, ui.draft.headerRowIndex + 10)
                              .map((row, ri) => (
                                <tr key={ri}>
                                  {ui.draft.columns.map((_, ci) => {
                                    const bad = badCells.has(`${ti}:${ri}:${ci}`)
                                    return (
                                      <td
                                        key={ci}
                                        id={cellId(ti, ri, ci)}
                                        tabIndex={-1}
                                        className={bad ? 'is-bad' : undefined}
                                        aria-invalid={bad ? true : undefined}
                                      >
                                        {row[ci]}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {/* §DI17 -- the per-table count line */}
                        <p className={`import__status${counts.keyCount === 1 ? '' : ' is-warn'}`}>
                          {keyText} · {t('import.status.counts', { cols: counts.numberColumns, rows: counts.rows, n: counts.parameters })}
                        </p>
                      </>
                    )}
                  </div>
                )
              })}
              <div className="import__tablesFoot">
                <button type="button" className="btn btn--sm import__addTable" onClick={addTable}>
                  {t('import.addTable')}
                </button>
                <details className="import__linkTables">
                  <summary>{t('import.linkTables.summary')}</summary>
                  <p>{t('import.linkTables.body')}</p>
                </details>
              </div>
              {hasParseError && <p className="import__error">{t('import.parseErrorsBlockValidation')}</p>}
            </div>
          )}

          {step === 'placement' && validation?.ok && planSummary && (
            <div className="import__placement">
              {validation.warnings.length > 0 && (
                <div className="import__warning">
                  <p>{t('import.warningsFound', { n: validation.warnings.length })}</p>
                  <ul>
                    {validation.warnings.map((issue, i) => (
                      <li key={i}>{issueText(issue)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="import__placementHelp">{t('import.placement.frameHelp')}</p>
              <label>
                <input type="radio" checked={placementKind === 'none'} onChange={() => setPlacementKind('none')} />
                <span>
                  {t('import.placement.none')}
                  <span className="import__placementResult">{t('import.placement.noneResult', { n: planSummary.totalParameters })}</span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  checked={placementKind === 'framePerTable'}
                  onChange={() => setPlacementKind('framePerTable')}
                />
                <span>
                  {t('import.placement.framePerTable')}
                  <span className="import__placementResult">
                    {t('import.placement.framePerTableResult', {
                      n: summarizeImportPlan(validation.plan, 'framePerTable').framesToCreate,
                    })}
                  </span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  checked={placementKind === 'existingFrame'}
                  onChange={() => setPlacementKind('existingFrame')}
                  disabled={frames.length === 0}
                />
                <span>
                  {t('import.placement.existingFrame')}
                  {frames.length === 0 && <span className="import__placementResult">{t('import.placement.noFramesYet')}</span>}
                </span>
              </label>
              {placementKind === 'existingFrame' && (
                <select value={existingFrameId} onChange={(e) => setExistingFrameId(e.target.value)}>
                  <option value="">{t('import.selectFrame')}</option>
                  {frames.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label || `Group ${f.n}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {step === 'review' && validation?.ok && planSummary && (
            <div className="import__review">
              <p>
                {t('import.summary', {
                  tables: planSummary.totalTables,
                  parameters: planSummary.totalParameters,
                })}
              </p>
              <table className="import__reviewTable">
                <thead>
                  <tr>
                    <th>{t('import.review.col.table')}</th>
                    <th className="num">{t('import.review.col.rows')}</th>
                    <th className="num">{t('import.review.col.numberColumns')}</th>
                    <th className="num">{t('import.review.col.parameters')}</th>
                    <th className="num">{t('import.review.col.frames')}</th>
                  </tr>
                </thead>
                <tbody>
                  {planSummary.tables.map((tb) => (
                    <tr key={tb.sourceTableId}>
                      <td>{tb.label}</td>
                      <td className="num">{tb.rows}</td>
                      <td className="num">{tb.numberColumns}</td>
                      <td className="num">{tb.lookupOnly ? t('import.review.lookupOnly') : tb.parameters}</td>
                      <td className="num">{tb.frames}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{t('import.review.total')}</td>
                    <td className="num" />
                    <td className="num" />
                    <td className="num import__reviewTotal">{planSummary.totalParameters}</td>
                    <td className="num">{planSummary.framesToCreate}</td>
                  </tr>
                </tfoot>
              </table>
              {planSummary.cells.length > 0 && (
                <div className="import__labelsPreview">
                  {t('import.review.labelsPreview')}
                  <ul>
                    {planSummary.cells.slice(0, 3).map((cell, i) => (
                      <li key={i}>{cellLabel(validation.plan.tables, cell)}</li>
                    ))}
                    {planSummary.cells.length > 3 && <li>{t('import.review.more', { n: planSummary.cells.length - 3 })}</li>}
                  </ul>
                </div>
              )}
              {commitError && (
                <p className="import__error">
                  {t(COMMIT_ERROR_KEY[commitError.code], commitError.detail as Record<string, string | number> | undefined)}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="mcdlg__foot">
          <button type="button" className="btn" onClick={close}>
            {t('dialog.cancel')}
          </button>
          {step === 'tables' && (
            <button type="button" className="btn btn--primary" disabled={hasParseError || hasIncompleteTable} onClick={runValidate}>
              {t('import.next')}
            </button>
          )}
          {step === 'placement' && (
            <>
              <button type="button" className="btn" onClick={() => setStep('tables')}>
                {t('import.back')}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={placementKind === 'existingFrame' && !existingFrameId}
                onClick={() => setStep('review')}
              >
                {t('import.next')}
              </button>
            </>
          )}
          {step === 'review' && (
            <>
              <button type="button" className="btn" onClick={() => setStep('placement')}>
                {t('import.back')}
              </button>
              <button type="button" className="btn btn--primary" onClick={commit}>
                {t('import.commit')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
