import type { MessageKey } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import type { ApplyDiagnostics, DiagDoc, ElementRef, NewRefusal, TableSplit, UnitLine, UnitMisread } from '../model/applyDiagnostics'
import { displayRational, type Rational } from '../model/rational'
import { runRefusalText, timetableRefusalText } from './runMessages'

// #558 — the findings of `applyDiagnostics` in the user's language: what the review says
// under the list of changes before a chosen Apply.

type TFn = (key: MessageKey, params?: Record<string, string | number>) => string

/** a graph-level line is named as the panel that edits it */
export const LINE_TITLE = { kinds: 'panels.kinds.title', time: 'panels.time.title', timetables: 'panels.timetables.title' } as const satisfies Record<UnitLine, MessageKey>

/** a node by its label; a line by the labels of its two ends, as the Inspector names one */
function elementName(ref: ElementRef, docs: readonly DiagDoc[], t: TFn): string {
  const label = (id: string) => docs.flatMap((d) => d.nodes).find((n) => n.id === id)?.data.label ?? id
  if (ref.elementType === 'node') return label(ref.id)
  const e = docs.flatMap((d) => d.edges).find((x) => x.id === ref.id)
  return e ? t('inspector.ends.summary', { from: isolateAuto(label(e.source)), to: isolateAuto(label(e.target)) }) : ref.id
}

const amount = (r: Rational, unit: string): string => `${displayRational(r).text}${unit === '' ? '' : ` ${unit}`}`

/** a value whose unit would be read another way: the Apply is refused with this */
export function unitMisreadText(m: UnitMisread, docs: readonly DiagDoc[], t: TFn): string {
  return m.origin === 'proposed'
    ? t('review.fail.unitProposed', { name: isolateAuto(elementName(m, docs, t)), unit: isolateAuto(m.unit) })
    : t('review.fail.unitYours', { name: isolateAuto(elementName(m, docs, t)), unit: isolateAuto(m.unit) })
}

/** a refusal the run would newly have, with the lines that would resolve it */
function refusalText(r: NewRefusal, result: DiagDoc, theirs: DiagDoc, t: TFn): string {
  const reason =
    r.from === 'timetable'
      ? timetableRefusalText(r.finding, [...result.timetables, ...theirs.timetables], t)
      : r.from === 'rule'
        ? runRefusalText(r.finding, result.nodes, t)
        : t('playbar.refused.kinds', { n: 1 })
  if (r.resolvedBy.length === 0) return t('review.diag.refused', { reason })
  return t('review.diag.refusedResolved', { reason, lines: isolateAuto(r.resolvedBy.map((l) => t(LINE_TITLE[l])).join(', ')) })
}

/** a table read from the other side: what was taken reads the open document's
 *  definition, or what was kept reads the proposal's */
function tableSplitText(s: TableSplit, docs: readonly DiagDoc[], t: TFn): string {
  const readers = s.readers.map((r) => elementName(r, docs, t)).join(', ')
  const a = s.amounts
  if (!a) {
    return s.direction === 'taken'
      ? t('review.diag.tableSplitPlain', { table: isolateAuto(s.label), readers: isolateAuto(readers) })
      : t('review.diag.tableKeptPlain', { table: isolateAuto(s.label), readers: isolateAuto(readers) })
  }
  return s.direction === 'taken'
    ? t('review.diag.tableSplit', {
        table: isolateAuto(s.label),
        readers: isolateAuto(readers),
        last: a.lastStep,
        theirs: isolateAuto(amount(a.theirs, a.unit)),
        yours: isolateAuto(amount(a.yours, a.unit)),
        step: a.firstStep,
        theirsAt: isolateAuto(amount(a.theirsAt, a.unit)),
        yoursAt: isolateAuto(amount(a.yoursAt, a.unit)),
      })
    : t('review.diag.tableKept', {
        table: isolateAuto(s.label),
        readers: isolateAuto(readers),
        last: a.lastStep,
        theirs: isolateAuto(amount(a.theirs, a.unit)),
        yours: isolateAuto(amount(a.yours, a.unit)),
        step: a.firstStep,
        theirsAt: isolateAuto(amount(a.theirsAt, a.unit)),
        yoursAt: isolateAuto(amount(a.yoursAt, a.unit)),
      })
}

export type DiagnosticLine = { key: string; kind: 'refuse' | 'warn'; text: string }

/** Every finding as one line, the refusing ones first; two findings worded alike are said once. */
export function diagnosticLines(d: { findings: ApplyDiagnostics; result: DiagDoc; theirs: DiagDoc }, t: TFn): DiagnosticLine[] {
  const docs = [d.result, d.theirs]
  const seen = new Set<string>()
  const once = (line: DiagnosticLine): DiagnosticLine[] => {
    if (seen.has(line.text)) return []
    seen.add(line.text)
    return [line]
  }
  return [
    ...d.findings.unitMisreads.flatMap((m) => once({ key: `unit:${m.elementType}:${m.id}`, kind: 'refuse', text: unitMisreadText(m, docs, t) })),
    ...d.findings.newRefusals.flatMap((r, i) => once({ key: `refusal:${i}`, kind: 'warn', text: refusalText(r, d.result, d.theirs, t) })),
    ...d.findings.tableSplits.flatMap((s) => once({ key: `table:${s.tableId}`, kind: 'warn', text: tableSplitText(s, docs, t) })),
  ]
}
