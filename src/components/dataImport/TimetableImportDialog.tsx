import { useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useT, type MessageKey } from '../../i18n'
import { fieldUnitOptions, fieldUnitText, TIME_UNITS, type TimeUnit } from '../../model/units'
import type { TimetableAfter, TimetableMeaning, TimetableProblemCode, TimetableRead } from '../../model/timetable'
import { buildTable, fillGaps, gapChoiceFits, gapRows, parseTableText, pickColumns, proposeEnd, type GapChoice } from '../../model/timetableImport'
import { useGraphStore } from '../../store/graphStore'
import { Icon } from '../../ui/icons'
import { DialogScrim } from '../DialogScrim'
import { useDialogFocus } from '../useDialogFocus'

// SEMANTICS-M5.md §M5-10 — Data ▸ New timetable. Times and rates come in by paste
// or a CSV file. A gap stops the import until the person chooses, and every choice
// writes real points and says so in the source. `end` is proposed and shown in
// its own field, never written unseen. The logic is ../../model/timetableImport.

const TIME_WORD: Record<TimeUnit, MessageKey> = { s: 'panels.time.unit.s', min: 'panels.time.unit.min', h: 'panels.time.unit.h', d: 'panels.time.unit.d' }
const GAP_WORD: Record<GapChoice, MessageKey> = { remove: 'timetable.import.gap.remove', hold: 'timetable.import.gap.hold', line: 'timetable.import.gap.line' }
const READ_WORD: Record<TimetableRead, MessageKey> = { hold: 'inspector.edge.timetable.read.hold', linear: 'inspector.edge.timetable.read.linear' }
const AFTER_WORD: Record<TimetableAfter, MessageKey> = {
  stop: 'inspector.edge.timetable.after.stop',
  hold: 'inspector.edge.timetable.after.hold',
  zero: 'inspector.edge.timetable.after.zero',
  repeat: 'inspector.edge.timetable.after.repeat',
}
const READS: readonly TimetableRead[] = ['hold', 'linear']
// SEMANTICS-M7.md §M7-4 — what the rates mean, asked once per table
const MEANS: readonly TimetableMeaning[] = ['plan', 'available']
const MEANS_WORD: Record<TimetableMeaning, MessageKey> = { plan: 'timetable.import.means.plan', available: 'timetable.import.means.available' }
const MEANS_NOTE: Record<TimetableMeaning, MessageKey> = { plan: 'timetable.import.means.planNote', available: 'timetable.import.means.availableNote' }
const AFTERS: readonly TimetableAfter[] = ['stop', 'hold', 'zero', 'repeat']
const GAPS: readonly GapChoice[] = ['remove', 'hold', 'line']

const PROBLEM_WORD: Partial<Record<TimetableProblemCode, MessageKey>> = {
  'bad-label': 'timetable.import.problem.name',
  'bad-source': 'timetable.import.problem.source',
  'bad-end': 'timetable.import.problem.end',
  'too-many-points': 'timetable.import.problem.many',
}
const ROW_PROBLEM_WORD: Partial<Record<TimetableProblemCode, MessageKey>> = {
  'bad-point': 'timetable.import.problem.point',
  'time-out-of-order': 'timetable.import.problem.order',
  'first-not-zero': 'timetable.import.problem.first',
}

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function TimetableImportDialog({ open, onClose, returnFocusTo }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null
  return (
    <DialogScrim onMouseDown={onClose}>
      <Form rootRef={ref} onClose={onClose} />
    </DialogScrim>
  )
}

function Form({ rootRef, onClose }: { rootRef: React.RefObject<HTMLDivElement | null>; onClose: () => void }) {
  const t = useT()
  const titleId = useId()
  const kinds = useGraphStore((s) => s.kinds)
  const time = useGraphStore((s) => s.time)
  const timetables = useGraphStore((s) => s.timetables)
  const setTimetables = useGraphStore((s) => s.setTimetables)

  const [text, setText] = useState('')
  const [timeColumn, setTimeColumn] = useState(0)
  const [rateColumn, setRateColumn] = useState(1)
  const [gapChoice, setGapChoice] = useState<GapChoice | null>(null)
  const [label, setLabel] = useState('')
  const [source, setSource] = useState('')
  const units = useMemo(() => {
    // a declared rate unit first: it is what a table is usually in
    const seen = new Set<string>()
    for (const k of kinds) for (const fu of fieldUnitOptions(k, time, 'rate')) if (fu.kind === 'rate') seen.add(fieldUnitText(fu))
    for (const k of kinds) for (const fu of fieldUnitOptions(k, time, 'rate')) if (fu.kind === 'amount' && fu.per) seen.add(fieldUnitText(fu))
    return [...seen]
  }, [kinds, time])
  const [unit, setUnit] = useState(units[0] ?? '')
  const [timeUnit, setTimeUnit] = useState<TimeUnit>(time?.step.unit ?? 'h')
  const [read, setRead] = useState<TimetableRead>('hold')
  const [after, setAfter] = useState<TimetableAfter>('stop')
  const [means, setMeans] = useState<TimetableMeaning>('plan')
  const [endDraft, setEndDraft] = useState<string | null>(null)

  const parsed = useMemo(() => parseTableText(text), [text])
  // another table's columns are not this one's: the column choice lasts only
  // while the columns do
  const shape = parsed ? JSON.stringify(parsed.columns) : ''
  const [seenShape, setSeenShape] = useState(shape)
  if (shape !== seenShape) {
    setSeenShape(shape)
    setTimeColumn(0)
    setRateColumn(1)
  }
  // a gap choice and a typed end were made on these rows: other rows are decided
  // again, whatever their columns, or a new file's gap would be filled unasked
  const input = JSON.stringify([text, timeColumn, rateColumn])
  const [seenInput, setSeenInput] = useState(input)
  if (input !== seenInput) {
    setSeenInput(input)
    setGapChoice(null)
    setEndDraft(null)
  }
  const rows = useMemo(() => (parsed ? pickColumns(parsed, timeColumn, rateColumn) : []), [parsed, timeColumn, rateColumn])
  const gaps = useMemo(() => gapRows(rows), [rows])
  const waiting = gaps.length > 0 && gapChoice === null
  const filled = useMemo(() => (gaps.length > 0 && gapChoice ? fillGaps(rows, gapChoice) : rows), [rows, gaps, gapChoice])
  const proposal = useMemo(() => proposeEnd(filled, read, after), [filled, read, after])
  const end = endDraft ?? proposal.end
  const closes = proposal.dropLast && end === proposal.end
  const finalRows = closes ? filled.slice(0, -1) : filled
  const taken = timetables.map((x) => x.id)
  const built = useMemo(
    () => (waiting || finalRows.length === 0 ? null : buildTable(finalRows, { label, source, unit: unit || '-', timeUnit, read, after, end, means }, taken)),
    [waiting, finalRows, label, source, unit, timeUnit, read, after, end, means, taken],
  )

  const problemText = (): string | null => {
    if (!built || built.ok) return null
    const { code, row } = built.problem
    const rowWord = ROW_PROBLEM_WORD[code]
    if (rowWord && row !== undefined) return t(rowWord, { row })
    const word = PROBLEM_WORD[code]
    return word ? t(word) : null
  }
  const problem = problemText()
  const ready = built?.ok === true && unit !== ''

  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setText(await file.text())
  }
  const note = (): string => {
    if (gaps.length === 0 || !gapChoice) return ''
    const list = gaps.join(', ')
    if (gapChoice === 'remove') return t('timetable.import.note.remove', { rows: list })
    return gapChoice === 'hold' ? t('timetable.import.note.hold', { rows: list }) : t('timetable.import.note.line', { rows: list })
  }
  const add = () => {
    if (!built?.ok) return
    const extra = note()
    setTimetables([...timetables, extra ? { ...built.table, source: `${built.table.source} (${extra})` } : built.table])
    onClose()
  }
  const columnWord = (i: number) => parsed?.columns[i] || t('timetable.import.column', { n: i + 1 })
  const columnCount = parsed?.columns.length ?? 0

  return (
    <div ref={rootRef} className="mcdlg mcdlg--timetable" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
      <div className="mcdlg__head">
        <span id={titleId}>{t('timetable.import.title')}</span>
        <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
          <Icon name="close" />
        </button>
      </div>
      <div className="mcdlg__body ttable">
        <label className="ttable__field">
          <span>{t('timetable.import.paste')}</span>
          <textarea rows={5} dir="ltr" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="ttable__field">
          <span>{t('timetable.import.file')}</span>
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={pickFile} />
        </label>
        {text.trim() !== '' && parsed === null ? <p className="ttable__problem">{t('timetable.import.unreadable')}</p> : null}
        {columnCount > 2 ? (
          <div className="ttable__row">
            <label className="ttable__field">
              <span>{t('timetable.import.timeColumn')}</span>
              <select value={timeColumn} onChange={(e) => setTimeColumn(Number(e.target.value))}>
                {Array.from({ length: columnCount }, (_, i) => <option key={i} value={i}>{columnWord(i)}</option>)}
              </select>
            </label>
            <label className="ttable__field">
              <span>{t('timetable.import.rateColumn')}</span>
              <select value={rateColumn} onChange={(e) => setRateColumn(Number(e.target.value))}>
                {Array.from({ length: columnCount }, (_, i) => <option key={i} value={i}>{columnWord(i)}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        {rows.length > 0 ? <p className="ttable__note">{t('timetable.import.count', { n: rows.length })}</p> : null}

        {gaps.length > 0 ? (
          <fieldset className="ttable__gap">
            <legend>{t('timetable.import.gap', { rows: gaps.join(', ') })}</legend>
            {GAPS.map((choice) => (
              <label key={choice}>
                <input type="radio" name="ttable-gap" disabled={!gapChoiceFits(rows, choice)} checked={gapChoice === choice} onChange={() => setGapChoice(choice)} />
                {t(GAP_WORD[choice])}
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="ttable__row">
          <label className="ttable__field">
            <span>{t('timetable.import.name')}</span>
            <input dir="auto" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="ttable__field">
            <span>{t('timetable.import.source')}</span>
            <input dir="auto" value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
        </div>
        <div className="ttable__row">
          <label className="ttable__field">
            <span>{t('timetable.import.unit')}</span>
            <select dir="ltr" value={unit} disabled={units.length === 0} onChange={(e) => setUnit(e.target.value)}>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="ttable__field">
            <span>{t('timetable.import.timeUnit')}</span>
            <select value={timeUnit} onChange={(e) => setTimeUnit(e.target.value as TimeUnit)}>
              {TIME_UNITS.map((u) => <option key={u} value={u}>{t(TIME_WORD[u])}</option>)}
            </select>
          </label>
        </div>
        {units.length === 0 ? <p className="ttable__problem">{t('timetable.import.noUnits')}</p> : null}
        <label className="ttable__field">
          <span>{t('timetable.import.means')}</span>
          <select value={means} onChange={(e) => setMeans(e.target.value as TimetableMeaning)}>
            {MEANS.map((m) => <option key={m} value={m}>{t(MEANS_WORD[m])}</option>)}
          </select>
        </label>
        <p className="ttable__note" data-means-note={means}>{t(MEANS_NOTE[means])}</p>
        <label className="ttable__field">
          <span>{t('timetable.import.read')}</span>
          <select value={read} onChange={(e) => { setRead(e.target.value as TimetableRead); setEndDraft(null) }}>
            {READS.map((r) => <option key={r} value={r}>{t(READ_WORD[r])}</option>)}
          </select>
        </label>
        <label className="ttable__field">
          <span>{t('timetable.import.after')}</span>
          <select value={after} onChange={(e) => { setAfter(e.target.value as TimetableAfter); setEndDraft(null) }}>
            {AFTERS.map((a) => <option key={a} value={a}>{t(AFTER_WORD[a])}</option>)}
          </select>
        </label>
        <label className="ttable__field">
          <span>{t('timetable.import.end')}</span>
          <input dir="ltr" inputMode="decimal" value={end} onChange={(e) => setEndDraft(e.target.value)} />
        </label>
        {rows.length > 0 && !waiting ? (
          <p className={proposal.asks ? 'ttable__problem' : 'ttable__note'}>
            {proposal.asks ? t('timetable.import.end.asks') : closes ? t('timetable.import.end.closes') : t('timetable.import.end.proposed')}
          </p>
        ) : null}
        {problem ? <p className="ttable__problem" role="status">{problem}</p> : null}
      </div>
      <div className="mcdlg__foot">
        <button type="button" className="btn" onClick={onClose}>{t('dialog.cancel')}</button>
        <button type="button" className="btn" disabled={!ready} onClick={add}>{t('timetable.import.add')}</button>
      </div>
    </div>
  )
}

