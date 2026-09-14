import { useId, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useT, type MessageKey } from '../../i18n'
import { detectDelimiter, parseDelimitedText, stripBom, type CsvParseError } from '../../model/csv'
import {
  analyzeRefreshColumns,
  validateRefreshSnapshot,
  type ColumnAnalysis,
  type ColumnPairing,
  type NewColumnRole,
  type RefreshIssue,
  type RefreshIssueCode,
} from '../../model/dataImportRefreshValidate'
import { diffRefresh, type RefreshCommitResult, type RefreshDiffPlan, type RefreshResolution } from '../../model/dataImportRefresh'
import { nextId } from '../../model/factory'
import type { ImportColumnRole } from '../../model/serialize'
import { useDataImportStore } from '../../store/dataImportStore'
import { useGraphStore } from '../../store/graphStore'
import { useDialogFocus } from '../useDialogFocus'

// docs/data-import.md §DI11/§DI16 Phase 2 -- the 4-step refresh wizard for
// ONE already-bound table: paste/upload -> column events (only shown when
// there are any) -> review -> commit. Mirrors `DataImportWizard.tsx`'s own
// shape (parse -> validate -> resolve -> one atomic commit).

const PARSE_ERROR_KIND_KEY: Record<CsvParseError['kind'], MessageKey> = {
  'unterminated-quote': 'import.parseErrorKind.unterminated-quote',
  'text-after-quote': 'import.parseErrorKind.text-after-quote',
  'quote-in-unquoted-field': 'import.parseErrorKind.quote-in-unquoted-field',
}
const ROLE_LABEL_KEY: Record<ImportColumnRole, MessageKey> = {
  key: 'import.role.key',
  number: 'import.role.number',
  label: 'import.role.label',
  foreignKey: 'import.role.foreignKey',
}
// Every `RefreshIssueCode` gets a translation -- the codes this trust
// boundary shares in MEANING with Phase 1B's own `IssueCode` reuse that
// domain's existing `import.issue.*` text verbatim; the genuinely
// refresh-only codes get their own `import.refreshIssue.*` entry.
const REFRESH_ISSUE_KEY: Record<RefreshIssueCode, MessageKey> = {
  'invalid-header-row': 'import.issue.invalid-header-row',
  'invalid-ignore-rows': 'import.issue.invalid-ignore-rows',
  'table-not-found': 'import.refreshIssue.table-not-found',
  'unresolved-column-event': 'import.refreshIssue.unresolved-column-event',
  'invalid-column-pairing': 'import.refreshIssue.invalid-column-pairing',
  'key-column-cannot-be-removed': 'import.refreshIssue.key-column-cannot-be-removed',
  'duplicate-column-pairing': 'import.refreshIssue.duplicate-column-pairing',
  'invalid-new-column-pairing': 'import.refreshIssue.invalid-new-column-pairing',
  'column-limit-exceeded': 'import.issue.column-limit-exceeded',
  'empty-column-header': 'import.issue.empty-column-header',
  'header-too-long': 'import.issue.header-too-long',
  'duplicate-source-column-id': 'import.refreshIssue.duplicate-source-column-id',
  'missing-key-column': 'import.issue.missing-key-column',
  'multiple-key-columns': 'import.issue.multiple-key-columns',
  'row-limit-exceeded': 'import.issue.row-limit-exceeded',
  'ragged-row': 'import.issue.ragged-row',
  'empty-key': 'import.issue.empty-key',
  'key-too-long': 'import.issue.key-too-long',
  'key-control-char': 'import.issue.key-control-char',
  'duplicate-key': 'import.issue.duplicate-key',
  'empty-number': 'import.issue.empty-number',
  'invalid-number': 'import.issue.invalid-number',
  'orphan-foreign-key': 'import.issue.orphan-foreign-key',
  'invalid-fk-target': 'import.issue.invalid-fk-target',
  'round-trip-mismatch': 'import.issue.round-trip-mismatch',
  'label-fallback': 'import.issue.label-fallback',
}

function sanitizeRowCount(raw: string, min: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && Number.isInteger(n) ? Math.max(min, n) : min
}

type EventChoice = { kind: 'rename' | 'matched'; incomingColumnIndex: number } | { kind: 'column-removed' }
type NewColumnChoice = { sourceColumnId: string; role: NewColumnRole; refTableId?: string }

const NEW_ROLE_OPTIONS: NewColumnRole[] = ['number', 'label', 'foreignKey']

type Step = 'paste' | 'events' | 'review'

export function DataImportRefreshWizard({ sourceTableId, onClose }: { sourceTableId: string; onClose: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(true, ref, onClose)
  const { screenToFlowPosition } = useReactFlow()

  const tables = useDataImportStore((s) => s.tables)
  const hostNodes = useGraphStore((s) => s.nodes)
  const commitRefresh = useGraphStore((s) => s.commitRefresh)

  const table = tables.find((tb) => tb.sourceTableId === sourceTableId)

  const [step, setStep] = useState<Step>('paste')
  const [pasteText, setPasteText] = useState('')
  const [delimiter, setDelimiter] = useState<',' | '\t'>(',')
  const [delimiterAuto, setDelimiterAuto] = useState(true)
  const [parseError, setParseError] = useState<CsvParseError | null>(null)
  const [parsedRows, setParsedRows] = useState<string[][]>([])
  const [headerRowIndex, setHeaderRowIndex] = useState(1)
  const [ignoreLastNRows, setIgnoreLastNRows] = useState(0)

  const [analysis, setAnalysis] = useState<ColumnAnalysis | null>(null)
  const [eventChoices, setEventChoices] = useState<Record<string, EventChoice>>({})
  const [newColumnChoices, setNewColumnChoices] = useState<Record<number, NewColumnChoice>>({})
  const [showMapMore, setShowMapMore] = useState(false)

  const [issues, setIssues] = useState<RefreshIssue[] | null>(null)
  const [plan, setPlan] = useState<RefreshDiffPlan | null>(null)
  const [duplicateError, setDuplicateError] = useState(false)

  const [confirmedAdds, setConfirmedAdds] = useState<Set<string>>(new Set())
  const [missingRowChoices, setMissingRowChoices] = useState<Map<string, 'unlink' | 'delete'>>(new Map())
  const [cellChoices, setCellChoices] = useState<Map<string, 'apply-incoming' | 'keep-mine'>>(new Map())
  const [locallyDeletedChoices, setLocallyDeletedChoices] = useState<Map<string, 'recreate' | 'discard'>>(new Map())
  const [fkRepointChoices, setFkRepointChoices] = useState<Map<string, 'accept' | 'reject'>>(new Map())
  const [commitError, setCommitError] = useState<RefreshCommitResult | null>(null)

  const headers = useMemo(() => parsedRows[Math.max(0, headerRowIndex - 1)] ?? [], [parsedRows, headerRowIndex])

  if (!table) return null

  const reparse = (text: string, auto: boolean, manualDelim: ',' | '\t') => {
    const stripped = stripBom(text)
    if (stripped.trim() === '') {
      setParseError(null)
      setParsedRows([])
      return
    }
    const d = auto ? detectDelimiter(stripped) : manualDelim
    if (auto) setDelimiter(d)
    const result = parseDelimitedText(stripped, d)
    if (!result.ok) {
      setParseError(result.error)
      return
    }
    setParseError(null)
    setParsedRows(result.rows)
  }

  const pickFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,.tsv,.txt'
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (file) file.text().then((text) => {
        setPasteText(text)
        reparse(text, delimiterAuto, delimiter)
      })
    })
    window.addEventListener('focus', () => setTimeout(() => input.remove(), 200), { once: true })
    document.body.appendChild(input)
    input.click()
  }

  const goToEventsOrReview = () => {
    const a = analyzeRefreshColumns(table, parsedRows, headerRowIndex)
    setAnalysis(a)
    setEventChoices({})
    setNewColumnChoices({})
    setShowMapMore(false)
    if (a.events.length > 0) {
      setStep('events')
    } else {
      runValidateAndDiff(a, {}, {})
    }
  }

  const buildPairings = (a: ColumnAnalysis, choices: Record<string, EventChoice>, newCols: Record<number, NewColumnChoice>): ColumnPairing[] => {
    const out: ColumnPairing[] = []
    for (const ev of a.events) {
      if (ev.kind === 'unrecognized-header') continue
      const choice = choices[ev.sourceColumnId]
      if (!choice) continue
      if (choice.kind === 'column-removed') out.push({ kind: 'column-removed', sourceColumnId: ev.sourceColumnId })
      else out.push({ kind: ev.kind === 'missing-header' ? 'rename' : 'matched', sourceColumnId: ev.sourceColumnId, incomingColumnIndex: choice.incomingColumnIndex })
    }
    for (const [idx, nc] of Object.entries(newCols)) {
      out.push({ kind: 'new-column', sourceColumnId: nc.sourceColumnId, incomingColumnIndex: Number(idx), role: nc.role, ...(nc.refTableId ? { refTableId: nc.refTableId } : {}) })
    }
    return out
  }

  const runValidateAndDiff = (a: ColumnAnalysis, choices: Record<string, EventChoice>, newCols: Record<number, NewColumnChoice>) => {
    const pairings = buildPairings(a, choices, newCols)
    const v = validateRefreshSnapshot(tables, sourceTableId, parsedRows, headerRowIndex, ignoreLastNRows, pairings)
    if (!v.ok) {
      setIssues(v.errors)
      setPlan(null)
      setDuplicateError(false)
      setStep('events')
      return
    }
    const d = diffRefresh(tables, sourceTableId, hostNodes, v.snapshot)
    if (!d.ok) {
      setIssues(null)
      setPlan(null)
      setDuplicateError(true)
      setStep('review')
      return
    }
    setIssues(null)
    setDuplicateError(false)
    setPlan(d.plan)
    setConfirmedAdds(new Set())
    setMissingRowChoices(new Map())
    setCellChoices(new Map())
    setLocallyDeletedChoices(new Map())
    setFkRepointChoices(new Map())
    setCommitError(null)
    setStep('review')
  }

  const continueFromEvents = () => runValidateAndDiff(analysis!, eventChoices, newColumnChoices)

  const setNewColumnRole = (incomingColumnIndex: number, role: NewColumnRole | '') => {
    setNewColumnChoices((prev) => {
      const next = { ...prev }
      if (role === '') {
        delete next[incomingColumnIndex]
      } else {
        const existing = next[incomingColumnIndex]
        next[incomingColumnIndex] = { sourceColumnId: existing?.sourceColumnId ?? nextId('srccol'), role, refTableId: role === 'foreignKey' ? existing?.refTableId : undefined }
      }
      return next
    })
  }
  const setNewColumnFkTarget = (incomingColumnIndex: number, refTableId: string) => {
    setNewColumnChoices((prev) => {
      const existing = prev[incomingColumnIndex]
      if (!existing) return prev
      return { ...prev, [incomingColumnIndex]: { ...existing, refTableId: refTableId || undefined } }
    })
  }

  const commit = () => {
    if (!plan) return
    const resolution: RefreshResolution = { confirmedAdds, missingRowChoices, cellChoices, locallyDeletedChoices, fkRepointChoices }
    const rect = document.querySelector('.canvas')?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    const result = commitRefresh(plan, resolution, screenToFlowPosition({ x, y }))
    if (!result.ok) {
      setCommitError(result)
      return
    }
    onClose()
  }

  const counts = plan
    ? plan.rows.reduce(
        (acc, row) => {
          if (row.kind === 'added') acc.added++
          else if (row.kind === 'missing') acc.missing++
          else {
            for (const cell of row.cells) {
              if (cell.kind === 'three-way' && (cell.state === 'source-only' || cell.state === 'converged')) acc.changed++
              else if (cell.kind === 'three-way' && cell.state === 'conflict') acc.conflicts++
              else if (cell.kind === 'locally-deleted') acc.locallyDeleted++
              else if (cell.kind === 'added-cell') acc.newColumnValues++
            }
            acc.fkRepoints += row.fkChanges.length
          }
          return acc
        },
        { added: 0, missing: 0, changed: 0, conflicts: 0, locallyDeleted: 0, fkRepoints: 0, newColumnValues: 0 },
      )
    : null

  return (
    <div className="mcdlg__scrim" onMouseDown={onClose}>
      <div ref={ref} className="mcdlg mcdlg--dataimport" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mcdlg__head">
          <span id={titleId}>{t('import.refresh.title', { table: table.label })}</span>
        </div>
        <div className="mcdlg__body">
          {step === 'paste' && (
            <div className="import__table">
              <textarea
                className="import__paste"
                placeholder={t('import.pastePlaceholder')}
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value)
                  reparse(e.target.value, delimiterAuto, delimiter)
                }}
                rows={6}
              />
              <div className="import__row">
                <button type="button" className="btn" onClick={pickFile}>
                  {t('import.uploadFile')}
                </button>
                <label>
                  {t('import.delimiter')}
                  <select
                    value={delimiterAuto ? 'auto' : delimiter}
                    onChange={(e) => {
                      if (e.target.value === 'auto') {
                        setDelimiterAuto(true)
                        reparse(pasteText, true, delimiter)
                      } else {
                        setDelimiterAuto(false)
                        setDelimiter(e.target.value as ',' | '\t')
                        reparse(pasteText, false, e.target.value as ',' | '\t')
                      }
                    }}
                  >
                    <option value="auto">{t('import.delimiterAuto')}</option>
                    <option value=",">{t('import.delimiterComma')}</option>
                    <option value={'\t'}>{t('import.delimiterTab')}</option>
                  </select>
                </label>
                <label>
                  {t('import.headerRow')}
                  <input type="number" min={1} value={headerRowIndex} onChange={(e) => setHeaderRowIndex(sanitizeRowCount(e.target.value, 1))} />
                </label>
                <label>
                  {t('import.ignoreLastRows')}
                  <input type="number" min={0} value={ignoreLastNRows} onChange={(e) => setIgnoreLastNRows(sanitizeRowCount(e.target.value, 0))} />
                </label>
              </div>
              {parseError && (
                <p className="import__error">
                  {t('import.parseError', { kind: t(PARSE_ERROR_KIND_KEY[parseError.kind]), line: parseError.line, column: parseError.column })}
                </p>
              )}
            </div>
          )}

          {step === 'events' && analysis && (
            <div className="import__issues">
              <h3>{t('import.refresh.columnEvents.title')}</h3>
              {analysis.events.filter((e) => e.kind !== 'unrecognized-header').length === 0 ? (
                <p>{t('import.refresh.columnEvents.none')}</p>
              ) : (
                <ul>
                  {analysis.events.map((ev, i) => {
                    if (ev.kind === 'unrecognized-header') return null
                    const choice = eventChoices[ev.sourceColumnId]
                    const options = ev.kind === 'missing-header' ? headers.map((h, idx) => ({ idx, h })) : ev.candidateIncomingColumnIndexes.map((idx) => ({ idx, h: headers[idx] }))
                    return (
                      <li key={i}>
                        <p>{ev.kind === 'missing-header' ? t('import.refresh.columnEvents.missingHeader', { header: ev.header, role: t(ROLE_LABEL_KEY[ev.role]) }) : t('import.refresh.columnEvents.ambiguousMatch', { header: ev.header })}</p>
                        <select
                          value={choice ? (choice.kind === 'column-removed' ? 'removed' : String(choice.incomingColumnIndex)) : ''}
                          onChange={(e) => {
                            const v = e.target.value
                            setEventChoices((prev) => {
                              const next = { ...prev }
                              if (v === '') delete next[ev.sourceColumnId]
                              else if (v === 'removed') next[ev.sourceColumnId] = { kind: 'column-removed' }
                              else next[ev.sourceColumnId] = { kind: ev.kind === 'missing-header' ? 'rename' : 'matched', incomingColumnIndex: Number(v) }
                              return next
                            })
                          }}
                        >
                          <option value="">{t('import.refresh.columnEvents.unresolved')}</option>
                          {options.map(({ idx, h }) => (
                            <option key={idx} value={idx}>
                              {h}
                            </option>
                          ))}
                          {ev.kind === 'missing-header' && ev.role !== 'key' && <option value="removed">{t('import.refresh.columnEvents.removedOption')}</option>}
                        </select>
                      </li>
                    )
                  })}
                </ul>
              )}

              {analysis.events.some((e) => e.kind === 'unrecognized-header') && (
                <div className="import__row">
                  <button type="button" className="btn" onClick={() => setShowMapMore((v) => !v)}>
                    {t('import.refresh.columnEvents.mapMore')}
                  </button>
                  {showMapMore && (
                    <ul>
                      {analysis.events.map((ev, i) => {
                        if (ev.kind !== 'unrecognized-header') return null
                        const nc = newColumnChoices[ev.incomingColumnIndex]
                        return (
                          <li key={i}>
                            <p>{t('import.refresh.columnEvents.unrecognized', { header: ev.header })}</p>
                            <select value={nc?.role ?? ''} onChange={(e) => setNewColumnRole(ev.incomingColumnIndex, e.target.value as NewColumnRole | '')}>
                              <option value="">{t('import.refresh.columnEvents.doNotMap')}</option>
                              {NEW_ROLE_OPTIONS.map((r) => (
                                <option key={r} value={r}>
                                  {t(ROLE_LABEL_KEY[r])}
                                </option>
                              ))}
                            </select>
                            {nc?.role === 'foreignKey' && (
                              <select value={nc.refTableId ?? ''} onChange={(e) => setNewColumnFkTarget(ev.incomingColumnIndex, e.target.value)}>
                                <option value="">{t('import.refresh.columnEvents.fkTarget')}</option>
                                {tables
                                  .filter((tb) => tb.sourceTableId !== sourceTableId)
                                  .map((tb) => (
                                    <option key={tb.sourceTableId} value={tb.sourceTableId}>
                                      {tb.label}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}

              {issues && issues.length > 0 && (
                <ul className="import__error">
                  {issues.map((issue, i) => (
                    <li key={i}>{t(REFRESH_ISSUE_KEY[issue.code], issue.detail as Record<string, string | number> | undefined)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === 'review' && (
            <div className="import__review">
              {duplicateError && <p className="import__error">{t('import.refresh.duplicateTripleError')}</p>}
              {plan && counts && (
                <>
                  <ul>
                    {counts.added > 0 && <li>{t('import.refresh.review.added', { n: counts.added })}</li>}
                    {counts.missing > 0 && <li>{t('import.refresh.review.missing', { n: counts.missing })}</li>}
                    {counts.changed > 0 && <li>{t('import.refresh.review.changed', { n: counts.changed })}</li>}
                    {counts.conflicts > 0 && <li>{t('import.refresh.review.conflicts', { n: counts.conflicts })}</li>}
                    {counts.locallyDeleted > 0 && <li>{t('import.refresh.review.locallyDeleted', { n: counts.locallyDeleted })}</li>}
                    {counts.fkRepoints > 0 && <li>{t('import.refresh.review.fkRepoints', { n: counts.fkRepoints })}</li>}
                    {counts.newColumnValues > 0 && <li>{t('import.refresh.review.newColumnValues', { n: counts.newColumnValues })}</li>}
                  </ul>

                  <ul className="import__issues">
                    {plan.rows.map((row) => {
                      if (row.kind === 'added') {
                        return (
                          <li key={row.sourceKey}>
                            <label>
                              <input type="checkbox" checked={confirmedAdds.has(row.sourceKey)} onChange={(e) => setConfirmedAdds((prev) => { const n = new Set(prev); if (e.target.checked) n.add(row.sourceKey); else n.delete(row.sourceKey); return n })} />
                              {row.sourceKey} — {t('import.refresh.review.confirmAdd')}
                            </label>
                          </li>
                        )
                      }
                      if (row.kind === 'missing') {
                        const blocked = row.dependents.length > 0
                        return (
                          <li key={row.sourceKey}>
                            <p>{row.sourceKey}</p>
                            {blocked ? (
                              <p className="import__error">{t('import.refresh.review.missingBlocked', { table: tables.find((tb) => tb.sourceTableId === row.dependents[0].dependentTableId)?.label ?? row.dependents[0].dependentTableId })}</p>
                            ) : (
                              <select value={missingRowChoices.get(row.sourceKey) ?? ''} onChange={(e) => setMissingRowChoices((prev) => { const n = new Map(prev); const v = e.target.value; if (v === 'unlink' || v === 'delete') n.set(row.sourceKey, v); else n.delete(row.sourceKey); return n })}>
                                <option value="">{t('import.refresh.review.missingChoiceNone')}</option>
                                <option value="unlink">{t('import.refresh.review.missingChoiceUnlink')}</option>
                                <option value="delete">{t('import.refresh.review.missingChoiceDelete')}</option>
                              </select>
                            )}
                          </li>
                        )
                      }
                      // present
                      const conflictCells = row.cells.filter((c) => c.kind === 'three-way' && c.state === 'conflict')
                      const deletedCells = row.cells.filter((c) => c.kind === 'locally-deleted')
                      if (conflictCells.length === 0 && deletedCells.length === 0 && row.fkChanges.length === 0) return null
                      return (
                        <li key={row.sourceKey}>
                          <p>{row.sourceKey}</p>
                          {conflictCells.map((c) => c.kind === 'three-way' ? (
                            <div key={c.sourceColumnId} className="import__row">
                              <label>
                                <input
                                  type="radio"
                                  name={`${row.sourceKey}:${c.sourceColumnId}`}
                                  checked={cellChoices.get(`${row.sourceKey}:${c.sourceColumnId}`) === 'apply-incoming'}
                                  onChange={() => setCellChoices((prev) => new Map(prev).set(`${row.sourceKey}:${c.sourceColumnId}`, 'apply-incoming'))}
                                />
                                {t('import.refresh.review.cellChoiceApplyIncoming', { value: c.incoming })}
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name={`${row.sourceKey}:${c.sourceColumnId}`}
                                  checked={(cellChoices.get(`${row.sourceKey}:${c.sourceColumnId}`) ?? 'keep-mine') === 'keep-mine'}
                                  onChange={() => setCellChoices((prev) => new Map(prev).set(`${row.sourceKey}:${c.sourceColumnId}`, 'keep-mine'))}
                                />
                                {t('import.refresh.review.cellChoiceKeepMine', { value: c.local })}
                              </label>
                            </div>
                          ) : null)}
                          {deletedCells.map((c) => c.kind === 'locally-deleted' ? (
                            <div key={c.sourceColumnId} className="import__row">
                              <label>
                                <input
                                  type="radio"
                                  name={`ld:${row.sourceKey}:${c.sourceColumnId}`}
                                  checked={locallyDeletedChoices.get(`${row.sourceKey}:${c.sourceColumnId}`) === 'recreate'}
                                  onChange={() => setLocallyDeletedChoices((prev) => new Map(prev).set(`${row.sourceKey}:${c.sourceColumnId}`, 'recreate'))}
                                />
                                {t('import.refresh.review.locallyDeletedChoiceRecreate', { value: c.incoming })}
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name={`ld:${row.sourceKey}:${c.sourceColumnId}`}
                                  checked={locallyDeletedChoices.get(`${row.sourceKey}:${c.sourceColumnId}`) === 'discard'}
                                  onChange={() => setLocallyDeletedChoices((prev) => new Map(prev).set(`${row.sourceKey}:${c.sourceColumnId}`, 'discard'))}
                                />
                                {t('import.refresh.review.locallyDeletedChoiceDiscard')}
                              </label>
                            </div>
                          ) : null)}
                          {row.fkChanges.map((c) => (
                            <div key={c.sourceColumnId} className="import__row">
                              <label>
                                <input
                                  type="radio"
                                  name={`fk:${row.sourceKey}:${c.sourceColumnId}`}
                                  checked={fkRepointChoices.get(`${row.sourceKey}:${c.sourceColumnId}`) === 'accept'}
                                  onChange={() => setFkRepointChoices((prev) => new Map(prev).set(`${row.sourceKey}:${c.sourceColumnId}`, 'accept'))}
                                />
                                {t('import.refresh.review.fkChoiceAccept', { value: c.incoming })}
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  name={`fk:${row.sourceKey}:${c.sourceColumnId}`}
                                  checked={(fkRepointChoices.get(`${row.sourceKey}:${c.sourceColumnId}`) ?? 'reject') === 'reject'}
                                  onChange={() => setFkRepointChoices((prev) => new Map(prev).set(`${row.sourceKey}:${c.sourceColumnId}`, 'reject'))}
                                />
                                {t('import.refresh.review.fkChoiceReject', { value: c.base })}
                              </label>
                            </div>
                          ))}
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
              {commitError && !commitError.ok && (
                <p className="import__error">
                  {commitError.reason === 'referenced-node' ? t('import.refresh.commitError.referenced-node') : t('import.refresh.commitError.missing-row-dependency')}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="mcdlg__foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          {step === 'paste' && (
            <button type="button" className="btn btn--primary" disabled={parseError !== null || parsedRows.length === 0} onClick={goToEventsOrReview}>
              {t('import.next')}
            </button>
          )}
          {step === 'events' && (
            <>
              <button type="button" className="btn" onClick={() => setStep('paste')}>
                {t('import.back')}
              </button>
              <button type="button" className="btn btn--primary" onClick={continueFromEvents}>
                {t('import.next')}
              </button>
            </>
          )}
          {step === 'review' && (
            <>
              <button type="button" className="btn" onClick={() => setStep(analysis && analysis.events.length > 0 ? 'events' : 'paste')}>
                {t('import.back')}
              </button>
              <button type="button" className="btn btn--primary" disabled={!plan} onClick={commit}>
                {t('import.refresh.commit')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
