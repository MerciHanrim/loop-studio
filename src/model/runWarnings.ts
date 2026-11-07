// SEMANTICS-M6.md §M6-9 — what a rule's numbers ask of the step length. A rule is read
// once a step, so a rule that was calm can hunt or stall after the step changes. These
// are warnings, not refusals: the run still goes, and says what held it.
import { classifyLabelTiming, parseLabelExpr, ROUTER_KINDS } from '../engine/stateExpr'
import { resolveKinds, type ResourceKindDecl } from './kinds'
import { parseDecimal, toDouble } from './rational'
import { groupLines, ruleOf, RUN_REACHED, runGroupOf } from './runRule'
import { peakPlan, timetableRateFactor, timetableRef, type Timetable } from './timetable'
import type { LoopEdge, LoopNode } from './types'
import { engineValue, poolKindName, resolveFieldUnit, type DocTime } from './units'

export type RunWarning =
  /** the stage moves more into or out of the tank in one full step than the band */
  | { code: 'band-under-step'; stage: string; tank: string; band: number; amount: number }
  /** one step of what others pull from the tank is more than the target level */
  | { code: 'level-under-pull'; stage: string; tank: string; level: number; amount: number }
  /** a `pull all` take of one step is more than the Pool can hold */
  | { code: 'tank-under-take'; stage: string; tank: string; capacity: number; amount: number }
  /** a Pool a `pull all` group takes from starts under one full step's take, and only
   *  the group refills it, so the group may never start. `taker` is a member that takes. */
  | { code: 'start-under-take'; stage: string; taker: string; tank: string; start: number; amount: number }

/** a line's amount in one full step, in the base unit: a number's rate, or a table's
 *  highest. `null` for what has no one amount, such as `all` or a dice roll. */
function stepAmount(e: LoopEdge, decl: ResourceKindDecl | undefined, tables: ReadonlyMap<string, Timetable>, time: DocTime | undefined): number | null {
  const d = e.data as { flow?: unknown; unit?: unknown }
  const raw = String(d.flow ?? '').trim()
  const tableId = timetableRef(raw)
  if (tableId !== null) {
    const table = tables.get(tableId)
    const factor = table ? timetableRateFactor(table, decl, time) : null
    return table && factor && time ? toDouble(peakPlan(table, factor, time)) : null
  }
  return parseDecimal(raw) === null ? null : engineValue(raw, resolveFieldUnit(d.unit, decl, time, 'rate'), time)
}

/** can this line, from outside a group, put stock into a Pool? Held to what the engine
 *  does, and one hop deep: what feeds a Source or a Converter upstream is not followed.
 *  A state line fills only as a `label` that can raise the balance; an activator or a
 *  trigger never does. A resource line from a Pool moves nothing by itself. */
function canFill(e: LoopEdge, nodes: readonly LoopNode[], edges: readonly LoopEdge[], need: number, amountOf: (e: LoopEdge) => number | null): boolean {
  const from = nodes.find((n) => n.id === e.source)
  if (!from) return false
  if (e.data?.kind === 'state') {
    if (e.data.mode !== 'label') return false
    const timing = classifyLabelTiming(e.data.timing, e.data.when)
    const reads = timing === 'phase0' ? from.data.kind === 'pool' : timing === 'afterPull' && ROUTER_KINDS.has(from.data.kind)
    const label = parseLabelExpr(e.data.expr ?? '')
    if (!reads || !label.ok || label.op === '-') return false
    if (label.token === 'S') return true // the source's stock can change, so this may fill
    return label.op === '+' ? label.n > 0 : label.n >= need * RUN_REACHED
  }
  if (amountOf(e) === 0 || from.data.kind === 'pool') return false
  const waits = (from.data.kind === 'source' || from.data.kind === 'converter') && from.data.activation === 'passive'
  return !waits || edges.some((x) => x.target === from.id && x.data?.kind === 'state' && x.data.mode === 'trigger')
}

/** one stage's warnings. Takes the authored graph, and reads the rule as it stands: a
 *  rule the run refuses gets its refusal, and may get these too. A Converter with no
 *  rule gets `start-under-take` only. */
export function runWarnings(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  timetables: readonly Timetable[] | undefined,
  kinds: readonly ResourceKindDecl[] | undefined,
  time: DocTime | undefined,
  stage: string,
): RunWarning[] {
  const node = nodes.find((n) => n.id === stage)
  if (node?.data.kind !== 'converter') return []
  const rule = ruleOf(node)
  const { members } = runGroupOf(nodes, edges, stage)
  const edgeKind = resolveKinds(nodes as LoopNode[], edges as LoopEdge[]).edgeKind
  const declOf = new Map((kinds ?? []).map((k) => [k.name, k]))
  const tables = new Map((timetables ?? []).map((t) => [t.id, t]))
  const lines = edges.filter((e) => (e.data?.kind ?? 'resource') === 'resource')
  const amountOf = (e: LoopEdge) => stepAmount(e, declOf.get(edgeKind.get(e.id) ?? ''), tables, time)
  const sum = (list: readonly LoopEdge[]) => list.reduce((a, e) => a + (amountOf(e) ?? 0), 0)
  const out: RunWarning[] = []

  const tank = rule?.tank === undefined ? undefined : nodes.find((n) => n.id === rule.tank)
  if (rule && tank?.data.kind === 'pool') {
    const fu = resolveFieldUnit(rule.unit ?? tank.data.unit, declOf.get(poolKindName(tank.data) ?? ''), time, 'stock')
    const band = engineValue(rule.band!, fu, time)
    const level = engineValue(rule.level!, fu, time)
    const between = groupLines(lines, members)
    const moved = Math.max(sum(between.filter((e) => e.target === tank.id)), sum(between.filter((e) => e.source === tank.id)))
    if (moved > band) out.push({ code: 'band-under-step', stage, tank: tank.id, band, amount: moved })
    const pull = sum(lines.filter((e) => e.source === tank.id && !members.includes(e.target)))
    if (pull > level) out.push({ code: 'level-under-pull', stage, tank: tank.id, level, amount: pull })
  }

  const pullsAll = members.some((m) => (nodes.find((n) => n.id === m)?.data as { mode?: string } | undefined)?.mode === 'pullAll')
  if (pullsAll && rule) {
    for (const e of lines.filter((x) => members.includes(x.target))) {
      const from = nodes.find((n) => n.id === e.source)
      if (from?.data.kind !== 'pool' || from.data.capacity === null) continue
      const fu = resolveFieldUnit(from.data.unit, declOf.get(poolKindName(from.data) ?? ''), time, 'stock')
      const capacity = engineValue(from.data.capacity, fu, time)
      const amount = amountOf(e)
      if (amount !== null && amount > capacity) out.push({ code: 'tank-under-take', stage, tank: from.id, capacity, amount })
    }
  }

  // #520 — a shape, not a number: a Pool that something else can fill gets there in a
  // later step, so its low start costs a step or two. One that only the group refills
  // waits for a run that waits for it.
  if (pullsAll) {
    const takes = lines.filter((x) => members.includes(x.target))
    for (const id of new Set(takes.map((x) => x.source))) {
      const from = nodes.find((n) => n.id === id)
      if (from?.data.kind !== 'pool') continue
      const own = takes.filter((x) => x.source === id)
      const amount = sum(own)
      if (edges.some((e) => e.target === id && !members.includes(e.source) && canFill(e, nodes, edges, amount, amountOf))) continue
      const fu = resolveFieldUnit(from.data.unit, declOf.get(poolKindName(from.data) ?? ''), time, 'stock')
      const start = engineValue(from.data.initial, fu, time)
      if (start < amount * RUN_REACHED) out.push({ code: 'start-under-take', stage, taker: own[0]!.target, tank: id, start, amount })
    }
  }
  return out
}

/** the stages whose rule gains a warning between two step lengths (§M4-4's announcement) */
export function stagesNewlyWarned(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  timetables: readonly Timetable[] | undefined,
  kinds: readonly ResourceKindDecl[] | undefined,
  before: DocTime | undefined,
  after: DocTime | undefined,
): string[] {
  const keys = (time: DocTime | undefined, stage: string) => new Set(runWarnings(nodes, edges, timetables, kinds, time, stage).filter((w) => w.code !== 'start-under-take').map((w) => `${w.code}\n${w.tank}`))
  return nodes
    .filter((n) => ruleOf(n) !== null)
    .map((n) => n.id)
    .filter((stage) => {
      const was = keys(before, stage)
      return [...keys(after, stage)].some((k) => !was.has(k))
    })
}

/** the stages that take from a Pool a step length newly leaves short at the start: one
 *  per Pool, whether or not a rule is there (§M4-4's announcement) */
export function stagesNewlyStalled(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  timetables: readonly Timetable[] | undefined,
  kinds: readonly ResourceKindDecl[] | undefined,
  before: DocTime | undefined,
  after: DocTime | undefined,
): string[] {
  const stalls = (time: DocTime | undefined) => {
    const byTank = new Map<string, string>()
    for (const n of nodes) {
      for (const w of runWarnings(nodes, edges, timetables, kinds, time, n.id)) if (w.code === 'start-under-take') byTank.set(w.tank, w.taker)
    }
    return byTank
  }
  const was = stalls(before)
  return [...new Set([...stalls(after)].filter(([tank]) => !was.has(tank)).map(([, taker]) => taker))]
}
