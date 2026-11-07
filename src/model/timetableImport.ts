// loop-model/5 (SEMANTICS-M5.md §M5-10) — from pasted or CSV text to a timetable.
// Pure, so every choice the screen offers can be tested without one. Nothing is
// filled silently: a gap stops the import until the person chooses, each choice
// writes real points, and `end` is proposed and shown, never written unseen.
import { detectDelimiter, parseDelimitedText, stripBom } from './csv'
import { add, cmp, div, mul, parseDecimal, roundTo15Digits, sub, terminatingDecimal, type Rational } from './rational'
import { checkTimetable, type Timetable, type TimetableAfter, type TimetableMeaning, type TimetableProblem, type TimetableRead } from './timetable'
import type { TimeUnit } from './units'

/** a data row: the file's own 1-based row number, and the two cells as text */
export type ImportRow = { row: number; time: string; rate: string }

export type ParsedTable = { columns: string[]; rows: string[][]; firstRow: number }

const NUMERIC = /^[+-]?\d+(?:\.\d+)?$/

/** the text as a grid: a first row with no number in it is a header, and a row
 *  with nothing in it is not data. `null` when the text is not readable. */
export function parseTableText(text: string): ParsedTable | null {
  const clean = stripBom(text)
  if (clean.trim() === '') return null
  const parsed = parseDelimitedText(clean, detectDelimiter(clean))
  if (!parsed.ok) return null
  const grid = parsed.rows
  const hasHeader = grid.length > 0 && !grid[0].some((c) => NUMERIC.test(c.trim()))
  const width = Math.max(...grid.map((r) => r.length))
  const columns = hasHeader ? grid[0].map((c) => c.trim()) : []
  while (columns.length < width) columns.push('')
  return { columns, rows: hasHeader ? grid.slice(1) : grid, firstRow: hasHeader ? 2 : 1 }
}

/** the two chosen columns of every row that holds anything */
export function pickColumns(t: ParsedTable, timeColumn: number, rateColumn: number): ImportRow[] {
  const out: ImportRow[] = []
  t.rows.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return
    out.push({ row: t.firstRow + i, time: (cells[timeColumn] ?? '').trim(), rate: (cells[rateColumn] ?? '').trim() })
  })
  return out
}

/** the rows with a time and no rate: the gaps the person has to decide on */
export const gapRows = (rows: readonly ImportRow[]): number[] => rows.filter((r) => r.rate === '' && r.time !== '').map((r) => r.row)

export type GapChoice = 'remove' | 'hold' | 'line'

/** whether a choice can fill these gaps: `hold` needs a value before each one,
 *  and `line` a value on both sides */
export function gapChoiceFits(rows: readonly ImportRow[], choice: GapChoice): boolean {
  if (choice === 'remove') return true
  const first = rows.findIndex((r) => r.rate !== '')
  if (first === -1) return false
  const last = rows.length - 1 - [...rows].reverse().findIndex((r) => r.rate !== '')
  return rows.every((r, i) => r.rate !== '' || (i > first && (choice === 'hold' || i < last)))
}

/** the rows with every gap resolved by `choice`, each a real point */
export function fillGaps(rows: readonly ImportRow[], choice: GapChoice): ImportRow[] {
  if (choice === 'remove') return rows.filter((r) => r.rate !== '')
  const out = rows.map((r) => ({ ...r }))
  for (let i = 0; i < out.length; i++) {
    if (out[i].rate !== '') continue
    const before = out[i - 1]
    if (!before) continue
    if (choice === 'hold') {
      out[i].rate = before.rate
      continue
    }
    const after = rows.slice(i + 1).find((r) => r.rate !== '')
    const t0 = parseDecimal(before.time)
    const t = parseDecimal(out[i].time)
    const t1 = after ? parseDecimal(after.time) : null
    const v0 = parseDecimal(before.rate)
    const v1 = after ? parseDecimal(after.rate) : null
    if (!t0 || !t || !t1 || !v0 || !v1 || cmp(t1, t0) <= 0) continue
    out[i].rate = decimalText(add(v0, mul(sub(v1, v0), div(sub(t, t0), sub(t1, t0)))))
  }
  return out
}

/** a value as a table holds it: exact when 15 digits reach it, otherwise the
 *  nearest 15-digit decimal, which is then the point the file shows */
function decimalText(r: Rational): string {
  const exact = terminatingDecimal(r)
  return exact !== null && exact.replace(/[-.]/g, '').replace(/^0+/, '').length <= 15 ? exact : roundTo15Digits(r)
}

export type EndProposal = {
  /** the proposed `end`; `''` when the person has to give one */
  end: string
  /** the last row closes the period: it is dropped and `end` takes its time */
  dropLast: boolean
  /** a repeating table's last value differs from its first, so closing it would
   *  invent a jump: the import stops and asks */
  asks: boolean
}

/** §M5-10 — what the screen proposes, for rows with no gap left */
export function proposeEnd(rows: readonly ImportRow[], read: TimetableRead, after: TimetableAfter): EndProposal {
  const none: EndProposal = { end: '', dropLast: false, asks: false }
  if (rows.length === 0) return none
  const last = rows[rows.length - 1]
  const t = parseDecimal(last.time)
  if (t === null) return none
  const interval = rows.length >= 2 ? parseDecimal(rows[rows.length - 2].time) : null
  const next = interval === null || cmp(t, interval) <= 0 ? '' : (terminatingDecimal(add(t, sub(t, interval))) ?? '')
  if (after === 'repeat') {
    const a = parseDecimal(rows[0].rate)
    const b = parseDecimal(last.rate)
    if (rows.length >= 2 && a && b && cmp(a, b) === 0) return { end: last.time, dropLast: true, asks: false }
    return read === 'linear' ? { end: '', dropLast: false, asks: true } : { end: next, dropLast: false, asks: false }
  }
  return read === 'linear' ? { end: last.time, dropLast: false, asks: false } : { end: next, dropLast: false, asks: false }
}

export type TableForm = {
  label: string
  source: string
  unit: string
  timeUnit: TimeUnit
  read: TimetableRead
  after: TimetableAfter
  end: string
  /** SEMANTICS-M7.md §M7-4 — what the rates mean; absent is a plan */
  means?: TimetableMeaning
}

/** an id from the name, unique in the document. A name with no ASCII letter in
 *  it takes a plain numbered id: the id is the file's handle, the label is the name. */
export function tableId(label: string, taken: readonly string[]): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
  const base = /^[a-z]/.test(slug) ? slug : 'table'
  if (base !== 'table' && !taken.includes(base)) return base
  for (let n = 1; ; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`
}

/** the table these rows and fields make, or why not, with the file's own row */
export function buildTable(rows: readonly ImportRow[], form: TableForm, taken: readonly string[]): { ok: true; table: Timetable } | { ok: false; problem: TimetableProblem } {
  const r = checkTimetable({
    id: tableId(form.label, taken),
    label: form.label.trim(),
    source: form.source.trim(),
    unit: form.unit,
    timeUnit: form.timeUnit,
    read: form.read,
    end: form.end.trim(),
    after: form.after,
    ...(form.means === 'available' ? { means: 'available' } : {}),
    points: rows.map((x) => [x.time, x.rate]),
  }, true)
  if (r.ok || r.problem.row === undefined) return r
  return { ok: false, problem: { ...r.problem, row: rows[r.problem.row - 1]?.row ?? r.problem.row } }
}
