import type { RunGroupReport, RunNotice, TimetableEndedNotice, TimetableUnmetNotice } from '../engine/types'
import type { MessageKey } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import type { ResourceKindDecl } from '../model/kinds'
import { div, exactDouble, plainDecimal, toDouble } from '../model/rational'
import type { RunFinding } from '../model/runRule'
import type { RunWarning } from '../model/runWarnings'
import type { Timetable, TimetableFinding } from '../model/timetable'
import type { LoopNode } from '../model/types'
import { fieldUnitText, poolKindName, resolveFieldUnit, unitRatio, type DocTime } from '../model/units'
import { useGraphStore } from '../store/graphStore'

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

/** the steps in a row, ending at the head, a group has been held. By the group, named
 *  by its first member: which of its rules decides can change at any step. */
export function runStreak(series: readonly { runs?: readonly RunGroupReport[] }[], group: string): number {
  let n = 0
  for (let i = series.length - 1; i >= 0; i--) {
    const r = series[i]!.runs?.find((x) => x.members[0] === group)
    if (!r || (r.state !== 'short' && r.state !== 'stopped')) break
    n++
  }
  return Math.max(n, 1)
}

/** a Pool's amount as a person reads it: from the engine's base unit into the unit the
 *  Pool is authored in, with the unit's name */
export type PoolAmount = (pool: string, base: number) => string

/** §M6-5 — the reader of a document's Pool amounts. A Pool in no unit reads in its
 *  kind's base unit when the kind names one, and as a bare number when it does not. */
export function poolAmounts(nodes: readonly LoopNode[], kinds: readonly ResourceKindDecl[] | undefined, time: DocTime | undefined): PoolAmount {
  return (pool, base) => {
    const data = nodes.find((n) => n.id === pool)?.data as { resourceType?: unknown; unit?: unknown } | undefined
    const decl = kinds?.find((k) => k.name === poolKindName(data))
    const fu = resolveFieldUnit(data?.unit, decl, time, 'stock')
    const value = plainDecimal(shown(toDouble(div(exactDouble(base), unitRatio(fu, time)))))
    const unit = fieldUnitText(fu) || decl?.baseUnit
    return unit ? `${value} ${unit}` : value
  }
}

/** the open document's reader, for a run bar that words its notices outside a render */
export const documentPoolAmounts = (): PoolAmount => {
  const { nodes, kinds, time } = useGraphStore.getState()
  return poolAmounts(nodes, kinds, time)
}

/** a share of a full run as percent text, in full: the Inspector's figure, for what a
 *  tag's bounded number cannot say */
export const fullPercent = (fraction: number): string => plainDecimal(shown(fraction * 100))

/** a run rule's notice in the user's language. `met` and `off` raise none. */
export function runNoticeText(x: RunNotice, steps: number, t: T, amount: PoolAmount): string {
  if (x.kind === 'runCapped') return t('playbar.diag.runCapped', { label: isolateAuto(x.label), percent: shown(x.wanted * 100) })
  if (x.limit === null) return t('playbar.diag.runStoppedFloor', { label: isolateAuto(x.label), steps })
  const { why, pool, poolId } = x.limit
  const had = amount(poolId, x.limit.had)
  const needed = amount(poolId, x.limit.needed)
  if (x.state === 'short' && why === 'room') return t('playbar.diag.runShortRoom', { label: isolateAuto(x.label), pool: isolateAuto(pool), had: isolateAuto(had), needed: isolateAuto(needed), steps })
  if (x.state === 'short') return t('playbar.diag.runShortSupply', { label: isolateAuto(x.label), pool: isolateAuto(pool), had: isolateAuto(had), needed: isolateAuto(needed), steps })
  if (why === 'room') return t('playbar.diag.runStoppedRoom', { label: isolateAuto(x.label), pool: isolateAuto(pool), had: isolateAuto(had), needed: isolateAuto(needed), steps })
  return t('playbar.diag.runStoppedSupply', { label: isolateAuto(x.label), pool: isolateAuto(pool), had: isolateAuto(had), needed: isolateAuto(needed), steps })
}

/** a step-length warning (§M6-9), with both numbers in the tank's unit */
export function runWarningText(w: RunWarning, nodes: readonly LoopNode[], t: T, amount: PoolAmount): string {
  const tank = nodes.find((n) => n.id === w.tank)?.data.label ?? w.tank
  const step = amount(w.tank, w.amount)
  if (w.code === 'band-under-step') return t('inspector.run.warn.band', { band: isolateAuto(amount(w.tank, w.band)), tank: isolateAuto(tank), step: isolateAuto(step) })
  if (w.code === 'level-under-pull') return t('inspector.run.warn.level', { level: isolateAuto(amount(w.tank, w.level)), tank: isolateAuto(tank), step: isolateAuto(step) })
  if (w.code === 'start-under-take') return t('inspector.run.warn.start', { start: isolateAuto(amount(w.tank, w.start)), tank: isolateAuto(tank), step: isolateAuto(step) })
  return t('inspector.run.warn.take', { capacity: isolateAuto(amount(w.tank, w.capacity)), tank: isolateAuto(tank), step: isolateAuto(step) })
}

/** why a report's group is off, in words: nothing is wrong, so it is no notice. `lowest`
 *  is the deciding rule's. */
export function runOffText(r: RunGroupReport, lowest: string | undefined, t: T): string {
  if (r.why === 'activator') return t('inspector.run.off.activator')
  if (r.why === 'lowest') {
    const wanted = r.rules.find((x) => x.stage === r.decidedBy)?.wanted ?? 0
    return t('inspector.run.off.lowest', { wanted: isolateAuto(fullPercent(wanted)), lowest: isolateAuto(fullPercent(Number(lowest ?? 0))) })
  }
  return t('inspector.run.off.rule')
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
