import type { RunGroupReport, RunNotice, TimetableEndedNotice, TimetableUnmetNotice } from '../engine/types'
import type { MessageKey } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import type { RunFinding } from '../model/runRule'
import type { Timetable, TimetableFinding } from '../model/timetable'
import type { LoopNode } from '../model/types'

type T = (key: MessageKey, params?: Record<string, string | number>) => string

/** loop-model/5 — a table's run message in the user's language, with its name
 *  isolated. The desktop and the mobile run bars word it here, in one place. */
export function timetableNoticeText(x: TimetableEndedNotice | TimetableUnmetNotice, t: T): string {
  if (x.kind === 'timetableEnded') return t('playbar.diag.timetableEnded', { label: isolateAuto(x.label) })
  return t('playbar.diag.timetableUnmet', { label: isolateAuto(x.label), amount: x.amount })
}

/** why a rule refuses the run, named by its stage. One sentence serves every code with
 *  the same fix (§M6-3). */
export function runRefusalText(f: RunFinding, nodes: readonly LoopNode[], t: T): string {
  const stage = nodes.find((n) => n.id === f.stage)?.data.label ?? f.stage
  switch (f.code) {
    case 'group-shape':
      return t('playbar.refused.run.shape', { label: isolateAuto(stage) })
    case 'unknown-tank':
    case 'bad-tank':
    case 'bad-tank-unit':
      return t('playbar.refused.run.tank', { label: isolateAuto(stage) })
    case 'unknown-table':
    case 'no-step':
    case 'no-kind':
    case 'bad-unit':
    case 'two-kinds':
      return t('playbar.refused.run.table', { label: isolateAuto(stage) })
    case 'rated-needed':
    case 'rated-unused':
    case 'rated-missing':
    case 'rated-outside':
    case 'rated-not-a-number':
    case 'rated-no-time':
    case 'rated-zero':
    case 'rated-out-of-range':
      return t('playbar.refused.run.rated', { label: isolateAuto(stage) })
    case 'not-a-converter':
    case 'bad-rule':
      return t('playbar.refused.run.rule', { label: isolateAuto(stage) })
  }
}

/** a number from the report, short enough for a line of text */
const shown = (n: number): number => Number(n.toPrecision(6))

/** the steps in a row, ending at the head, this stage's group has been held */
export function runStreak(series: readonly { runs?: readonly RunGroupReport[] }[], stage: string): number {
  let n = 0
  for (let i = series.length - 1; i >= 0; i--) {
    const r = series[i]!.runs?.find((x) => x.decidedBy === stage)
    if (!r || (r.state !== 'short' && r.state !== 'stopped')) break
    n++
  }
  return Math.max(n, 1)
}

/** a run rule's notice in the user's language. `met` and `off` raise none. */
export function runNoticeText(x: RunNotice, steps: number, t: T): string {
  if (x.kind === 'runCapped') return t('playbar.diag.runCapped', { label: isolateAuto(x.label), percent: shown(x.wanted * 100) })
  if (x.limit === null) return t('playbar.diag.runStoppedFloor', { label: isolateAuto(x.label), steps })
  const { why, pool, needed, had } = x.limit
  if (x.state === 'short' && why === 'room') return t('playbar.diag.runShortRoom', { label: isolateAuto(x.label), pool: isolateAuto(pool), had: shown(had), needed: shown(needed), steps })
  if (x.state === 'short') return t('playbar.diag.runShortSupply', { label: isolateAuto(x.label), pool: isolateAuto(pool), had: shown(had), needed: shown(needed), steps })
  if (why === 'room') return t('playbar.diag.runStoppedRoom', { label: isolateAuto(x.label), pool: isolateAuto(pool), had: shown(had), needed: shown(needed), steps })
  return t('playbar.diag.runStoppedSupply', { label: isolateAuto(x.label), pool: isolateAuto(pool), had: shown(had), needed: shown(needed), steps })
}

/** why a table line refuses the run, named by its table */
export function timetableRefusalText(f: TimetableFinding, timetables: readonly Timetable[], t: T): string {
  const name = timetables.find((x) => x.id === f.tableId)?.label ?? f.tableId
  switch (f.code) {
    case 'unknown-table':
      return t('playbar.refused.timetable.unknown', { label: isolateAuto(name) })
    case 'bad-line':
      return t('playbar.refused.timetable.line', { label: isolateAuto(name) })
    case 'no-step':
      return t('playbar.refused.timetable.noStep', { label: isolateAuto(name) })
    case 'no-kind':
      return t('playbar.refused.timetable.noKind', { label: isolateAuto(name) })
    case 'bad-unit':
      return t('playbar.refused.timetable.unit', { label: isolateAuto(name) })
    case 'two-kinds':
      return t('playbar.refused.timetable.twoKinds', { label: isolateAuto(name) })
    case 'out-of-range':
      return t('playbar.refused.timetable.range', { label: isolateAuto(name) })
  }
}
