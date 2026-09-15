import { useId, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useT, type MessageKey } from '../../i18n'
import type { CsvParseError } from '../../model/csv'
import { detectDelimiter, parseDelimitedText, stripBom } from '../../model/csv'
import {
  createTableDraft,
  setColumnRole,
  validateDrafts,
  type DraftColumnRole,
  type Issue,
  type IssueCode,
  type TableDraft,
} from '../../model/dataImportValidate'
import type { CommitFailureCode, PlacementChoice } from '../../model/dataImportCommit'
import { useFrameStore } from '../../store/frameStore'
import { useGraphStore } from '../../store/graphStore'
import { useDialogFocus } from '../useDialogFocus'

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

// docs/data-import.md §DI16 Phase 1B -- the CSV/TSV import wizard. Four
// steps: configure every bound table (paste/upload, delimiter, header row,
// column roles, FK targets, group-by), validate the whole batch together
// (§DI-D10 -- nothing touches the graph until every table is clean),
// choose a placement destination, then commit as ONE atomic history entry
// (`graphStore.commitDataImport`).

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

type Step = 'tables' | 'validate' | 'placement' | 'review'

export function DataImportWizard({
  open,
  onClose,
  returnFocusTo,
}: {
  open: boolean
  onClose: () => void
  /** review condition 3 — resolves to the ⋯ trigger when Data was collapsed
   *  at open time, since `document.activeElement` may already have moved
   *  on by the time this dialog's own focus effect runs. */
  returnFocusTo?: () => HTMLElement | null | undefined
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, ref, onClose, returnFocusTo)
  const { screenToFlowPosition } = useReactFlow()

  const [step, setStep] = useState<Step>('tables')
  const [tables, setTables] = useState<DraftUI[]>([newDraftUI()])
  const [validation, setValidation] = useState<
    ReturnType<typeof validateDrafts> | null
  >(null)
  const [placementKind, setPlacementKind] = useState<'none' | 'framePerTable' | 'existingFrame'>('none')
  const [existingFrameId, setExistingFrameId] = useState<string>('')
  const [commitError, setCommitError] = useState<{ code: CommitFailureCode; detail?: Record<string, unknown> } | null>(null)
  const frames = useFrameStore((s) => s.frames)
  const commitDataImport = useGraphStore((s) => s.commitDataImport)

  if (!open) return null

  const reset = () => {
    setStep('tables')
    setTables([newDraftUI()])
    setValidation(null)
    setPlacementKind('none')
    setExistingFrameId('')
    setCommitError(null)
  }
  const close = () => {
    reset()
    onClose()
  }

  const updateTable = (idx: number, patch: Partial<DraftUI>) => {
    setTables((prev) => prev.map((ui, i) => (i === idx ? reparse({ ...ui, ...patch }) : ui)))
  }
  const updateDraft = (idx: number, patch: Partial<TableDraft>) => {
    setTables((prev) => prev.map((ui, i) => (i === idx ? { ...ui, draft: { ...ui.draft, ...patch } } : ui)))
  }
  const setRole = (tableIdx: number, columnIdx: number, role: DraftColumnRole) => {
    setTables((prev) =>
      prev.map((ui, i) => (i === tableIdx ? { ...ui, draft: setColumnRole(ui.draft, columnIdx, role) } : ui)),
    )
  }
  const setFkTarget = (tableIdx: number, columnIdx: number, refDraftId: string) => {
    setTables((prev) =>
      prev.map((ui, i) => {
        if (i !== tableIdx) return ui
        const columns = ui.draft.columns.slice()
        columns[columnIdx] = { ...columns[columnIdx], refDraftId: refDraftId || undefined }
        return { ...ui, draft: { ...ui.draft, columns } }
      }),
    )
  }

  const addTable = () => setTables((prev) => [...prev, newDraftUI()])
  const removeTable = (idx: number) => setTables((prev) => prev.filter((_, i) => i !== idx))

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
  // real validation step is never reached with a table that couldn't
  // possibly pass it yet.
  const nameEmpty = (ui: DraftUI) => ui.draft.label.trim() === ''
  const dataEmpty = (ui: DraftUI) => ui.pasteText.trim() === ''
  const hasIncompleteTable = tables.some((ui) => nameEmpty(ui) || dataEmpty(ui))

  const runValidate = () => {
    if (hasParseError || hasIncompleteTable) return
    const result = validateDrafts(tables.map((ui) => ui.draft))
    setValidation(result)
    if (result.ok) setStep('placement')
    else setStep('validate')
  }

  const commit = () => {
    if (!validation?.ok) return
    let placement: PlacementChoice
    if (placementKind === 'none') {
      const rect = document.querySelector('.canvas')?.getBoundingClientRect()
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      placement = { kind: 'none', origin: screenToFlowPosition({ x, y }) }
    } else if (placementKind === 'framePerTable') {
      const rect = document.querySelector('.canvas')?.getBoundingClientRect()
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      placement = { kind: 'framePerTable', origin: screenToFlowPosition({ x, y }) }
    } else {
      if (!existingFrameId) return
      placement = { kind: 'existingFrame', frameId: existingFrameId }
    }
    const result = commitDataImport(validation.plan, placement)
    if (!result.ok) {
      setCommitError({ code: result.reason, detail: result.detail })
      return
    }
    close()
  }

  const issueLocation = (issue: Issue): string | null => {
    if (issue.tableIndex < 0) return null
    const ui = tables[issue.tableIndex]
    const table = ui?.draft.label || `#${issue.tableIndex + 1}`
    // `issue.rowIndex` counts from 0 within the EFFECTIVE (post header-row,
    // post ignore-last-N-rows) data rows -- it is NOT the row's position in
    // the raw pasted/uploaded text. Add back the header row itself (and
    // anything before it) so the number shown matches what the user sees
    // by counting lines in their own source text, 1-based.
    const headerRowIndex = ui?.draft.headerRowIndex ?? 1
    if (issue.rowIndex !== undefined && issue.columnIndex !== undefined) {
      return t('import.loc.tableRowColumn', { table, row: headerRowIndex + issue.rowIndex + 1, column: issue.columnIndex + 1 })
    }
    if (issue.rowIndex !== undefined) {
      return t('import.loc.tableRow', { table, row: headerRowIndex + issue.rowIndex + 1 })
    }
    return t('import.loc.table', { table })
  }

  const issueText = (issue: Issue): string => {
    const desc = t(ISSUE_KEY[issue.code], issue.detail as Record<string, string | number> | undefined)
    const loc = issueLocation(issue)
    return loc ? `${loc}: ${desc}` : desc
  }

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
              {tables.map((ui, ti) => (
                <div className="import__table" key={ti}>
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
                  {ui.draft.columns.length > 0 && (
                    <table className="import__preview">
                      <thead>
                        <tr>
                          {ui.draft.columns.map((c, ci) => (
                            <th key={ci}>
                              <div>{c.header}</div>
                              <select value={c.role} onChange={(e) => setRole(ti, ci, e.target.value as DraftColumnRole)}>
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
                          ))}
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
                              {ui.draft.columns.map((_, ci) => (
                                <td key={ci}>{row[ci]}</td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn--sm import__addTable" onClick={addTable}>
                {t('import.addTable')}
              </button>
              {hasParseError && <p className="import__error">{t('import.parseErrorsBlockValidation')}</p>}
            </div>
          )}

          {step === 'validate' && validation && !validation.ok && (
            <div className="import__issues">
              <p>{t('import.errorsFound', { n: validation.errors.length })}</p>
              <ul>
                {validation.errors.map((issue, i) => (
                  <li key={i}>{issueText(issue)}</li>
                ))}
              </ul>
            </div>
          )}

          {step === 'placement' && validation?.ok && (
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
              <label>
                <input type="radio" checked={placementKind === 'none'} onChange={() => setPlacementKind('none')} />
                {t('import.placement.none')}
              </label>
              <label>
                <input
                  type="radio"
                  checked={placementKind === 'framePerTable'}
                  onChange={() => setPlacementKind('framePerTable')}
                />
                {t('import.placement.framePerTable')}
              </label>
              <label>
                <input
                  type="radio"
                  checked={placementKind === 'existingFrame'}
                  onChange={() => setPlacementKind('existingFrame')}
                  disabled={frames.length === 0}
                />
                {t('import.placement.existingFrame')}
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

          {step === 'review' && validation?.ok && (
            <div className="import__review">
              <p>
                {t('import.summary', {
                  tables: validation.plan.tables.length,
                  parameters: validation.plan.tables.reduce(
                    (sum, tbl) => sum + tbl.rows.length * tbl.columns.filter((c) => c.role === 'number').length,
                    0,
                  ),
                })}
              </p>
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
          {step === 'validate' && (
            <button type="button" className="btn" onClick={() => setStep('tables')}>
              {t('import.backToInput')}
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
