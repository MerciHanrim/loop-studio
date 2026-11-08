// SEMANTICS-M6.md §M6-9 — what a rule's numbers ask of the step length. A rule is read
// once a step, so a rule that was calm can hunt or stall after the step changes. These
// are warnings, not refusals: the run still goes, and says what held it.
import { classifyLabelTiming, parseLabelExpr, ROUTER_KINDS } from '../engine/stateExpr'
import { resolveKinds, type ResourceKindDecl } from './kinds'
import { parseDecimal, toDouble } from './rational'
import { groupLines, planRuns, ruleOf, RUN_REACHED, runFindings, runGroupOf } from './runRule'
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

/** #520 — what, outside a group, can ever put stock into a Pool, decided over the whole
 *  graph and held to what the engine does. A least fixed point: a node joins `live` once
 *  it can fire without the group firing first, and a Pool can reach an amount once its
 *  start holds it or something live fills it. The group's own members never count, so
 *  a supply that waits on the group (its store, or another group it alone refills) is no
 *  supply. Measured on main 776c0870 (#520, 2026-11-08): one hop counted an outside
 *  Converter with empty inputs, a label `=S` on an empty Pool and two groups refilling
 *  each other as supplies, and each stalled for good unwarned.
 *
 *  - A Source fires when `automatic` or `onStart`. `passive` and `interactive` fire only
 *    on a trigger from a live node: nothing in the app presses a node (SEMANTICS.md §4,
 *    `state.test.ts`), so an interactive Source is a passive one.
 *  - A Converter or Gate outside the group fires the same way, and only with input: pull
 *    all needs every input Pool to reach its line's amount, otherwise one input will do.
 *  - A resource line fills a Pool from a live non-Pool node with an amount above 0. A line
 *    from a Pool moves nothing by itself.
 *  - A `label` state line fills as before: `+N` above 0, `=N` of the need or more, and
 *    `=S` only from a Pool that can reach the need. One read after a pull needs its
 *    router live. An activator or a trigger never fills.
 *  - Capacity is not followed: a live line is taken to fill a Pool over enough steps. */
function supplyChain(nodes: readonly LoopNode[], edges: readonly LoopEdge[], members: readonly string[], amountOf: (e: LoopEdge) => number | null, startOf: (n: LoopNode) => number) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const outside = (id: string) => !members.includes(id)
  const resIn = (id: string) => edges.filter((e) => e.target === id && (e.data?.kind ?? 'resource') === 'resource')
  const live = new Set<string>()
  /** can Pool `id` ever hold `need` or more, with `live` as it stands */
  const reaches = (id: string, need: number): boolean => {
    const pool = byId.get(id)
    if (pool?.data.kind !== 'pool') return false
    if (startOf(pool) >= need * RUN_REACHED && need > 0) return true
    if (need <= 0) return startOf(pool) > 0 || edges.some((e) => e.target === id && fills(e, Number.MIN_VALUE))
    return edges.some((e) => e.target === id && fills(e, need))
  }
  /** can line `e` put stock into its Pool, toward `need` */
  const fills = (e: LoopEdge, need: number): boolean => {
    const from = byId.get(e.source)
    if (!from || !outside(from.id)) return false
    if (e.data?.kind === 'state') {
      if (e.data.mode !== 'label') return false
      const timing = classifyLabelTiming(e.data.timing, e.data.when)
      const reads = timing === 'phase0' ? from.data.kind === 'pool' : timing === 'afterPull' && ROUTER_KINDS.has(from.data.kind) && live.has(from.id)
      const label = parseLabelExpr(e.data.expr ?? '')
      if (!reads || !label.ok || label.op === '-') return false
      if (label.token === 'S') return from.data.kind === 'pool' && from.id !== e.target && reaches(from.id, need)
      return label.op === '+' ? label.n > 0 : label.n >= need * RUN_REACHED
    }
    if (amountOf(e) === 0 || from.data.kind === 'pool') return false
    return live.has(from.id)
  }
  const triggered = (id: string) => edges.some((x) => x.target === id && x.data?.kind === 'state' && x.data.mode === 'trigger' && live.has(x.source) && outside(x.source))
  const canFire = (n: LoopNode): boolean => {
    const act = (n.data as { activation?: string }).activation
    const awake = act === 'passive' || act === 'interactive' ? triggered(n.id) : true
    if (!awake) return false
    if (n.data.kind === 'source') return true
    if (n.data.kind !== 'converter' && n.data.kind !== 'gate') return false
    const inputs = resIn(n.id)
    if (inputs.length === 0) return false
    const has = (e: LoopEdge, need: number) => {
      const from = byId.get(e.source)
      if (!from || !outside(from.id)) return false
      return from.data.kind === 'pool' ? reaches(from.id, need) : live.has(from.id)
    }
    const all = (n.data as { mode?: string }).mode === 'pullAll'
    return all ? inputs.every((e) => has(e, amountOf(e) ?? 0)) : inputs.some((e) => has(e, 0))
  }
  for (let grew = true; grew; ) {
    grew = false
    for (const n of nodes) {
      if (live.has(n.id) || !outside(n.id) || n.data.kind === 'pool') continue
      if (canFire(n)) {
        live.add(n.id)
        grew = true
      }
    }
  }
  return { fills }
}

/** #520 — the share of a full run a ruled group asks for at step 1: a rule reads its tank
 *  as the run starts, so the first step's take is known before the run. 1 with no rule,
 *  or when the rule asks for nothing then (it may ask for more later). */
function firstShare(nodes: readonly LoopNode[], edges: readonly LoopEdge[], members: readonly string[], timetables: readonly Timetable[] | undefined, kinds: readonly ResourceKindDecl[] | undefined, time: DocTime | undefined, startOf: (n: LoopNode) => number): number {
  if (!members.some((m) => ruleOf(nodes.find((n) => n.id === m)!) !== null)) return 1
  // a refused rule refuses the run before any plan (step.ts); planRuns assumes none
  if (runFindings(nodes, edges, timetables, kinds, time, 6).length > 0) return 1
  const values = Object.fromEntries(nodes.filter((n) => n.data.kind === 'pool').map((n) => [n.id, startOf(n)]))
  const plan = planRuns(nodes, edges, timetables, kinds, time, values, 1, 6)
  const share = Math.min(...members.map((m) => plan.targets[m]).filter((x): x is number => x !== undefined))
  return Number.isFinite(share) && share > 0 ? Math.min(1, share) : 1
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
    const startOf = (n: LoopNode) => (n.data.kind === 'pool' ? engineValue(n.data.initial, resolveFieldUnit(n.data.unit, declOf.get(poolKindName(n.data) ?? ''), time, 'stock'), time) : 0)
    const { fills } = supplyChain(nodes, edges, members, amountOf, startOf)
    // #520 — a rule that asks for a small first run takes less at step 1 (measured: it
    // runs exactly when that share of the take is within the start)
    const share = firstShare(nodes, edges, members, timetables, kinds, time, startOf)
    const takes = lines.filter((x) => members.includes(x.target))
    for (const id of new Set(takes.map((x) => x.source))) {
      const from = nodes.find((n) => n.id === id)
      if (from?.data.kind !== 'pool') continue
      const own = takes.filter((x) => x.source === id)
      const amount = sum(own)
      if (edges.some((e) => e.target === id && fills(e, amount))) continue
      const start = startOf(from)
      if (start < amount * share * RUN_REACHED) out.push({ code: 'start-under-take', stage, taker: own[0]!.target, tank: id, start, amount })
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
