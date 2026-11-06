// loop-model/6 (SEMANTICS-M6.md) — a run rule: a fixed rule on a Converter that reads
// one tank and one timetable and sets the fraction its group may run at. A recipe is
// never rewritten: a rule limits the run, so every line of a group keeps its ratio.
//
// A rule's result depends only on the step's start state and the step number, so the
// state alone still decides the next step (I6′).
import { converterGroups } from '../engine/converterGroups'
import { parseFlow, type ModelVersion } from '../engine/flow'
import { EPSILON, type FlowEvent, type RunGroupReport, type RunLimit, type StateEvent } from '../engine/types'
import { resolveKinds, type ResourceKindDecl } from './kinds'
import { cmp, div, fromInt, parseDecimal, toDouble, type Rational } from './rational'
import { exactPlan, firstUncoveredStep, MAX_TIMETABLE_DECIMAL, timetableLines, timetableRateFactor, type Timetable } from './timetable'
import type { LoopEdge, LoopNode } from './types'
import { engineValue, fieldRational, poolKindName, resolveFieldUnit, type DocTime } from './units'

export type RunSide = 'fill' | 'empty'

/** the stored rule. Numbers are decimal text, as a table's are. `level` and `band`
 *  are in `unit` when it is set, and otherwise in the tank's own unit. */
export type RunRule = {
  tank?: string
  level?: string
  band?: string
  side?: RunSide
  unit?: string
  table?: string
  rated?: string
  lowest?: string
}

const PLAIN = /^\d+(?:\.\d+)?$/
/** a decimal text under the §M5-2 bound, or `null` */
function decimal(v: unknown): Rational | null {
  if (typeof v !== 'string' || !PLAIN.test(v)) return null
  const r = parseDecimal(v)
  return r !== null && cmp(r, MAX_TIMETABLE_DECIMAL) <= 0 ? r : null
}

const isId = (v: unknown): v is string => typeof v === 'string' && v !== ''

export type RunRuleRead = { ok: true; rule: RunRule } | { ok: false; detail: string }

/** §M6-1 — the read of a stored rule: its canonical form, or why the file is refused.
 *  A rule that cannot mean anything is never kept: a plant that quietly ran at a
 *  default would look like a result. */
export function readRunRule(raw: unknown): RunRuleRead {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, detail: 'it is not a rule' }
  const o = raw as Record<string, unknown>
  const rule: RunRule = {}
  if (o.tank !== undefined) {
    if (!isId(o.tank)) return { ok: false, detail: '"tank" is not a node id' }
    const level = decimal(o.level)
    const band = decimal(o.band)
    if (level === null) return { ok: false, detail: '"level" is not a decimal in range' }
    if (band === null || cmp(band, fromInt(0)) <= 0) return { ok: false, detail: '"band" must be a decimal above 0' }
    if (o.side !== 'fill' && o.side !== 'empty') return { ok: false, detail: '"side" must be "fill" or "empty"' }
    rule.tank = o.tank
    rule.level = o.level as string
    rule.band = o.band as string
    rule.side = o.side
    if (o.unit !== undefined) {
      if (typeof o.unit !== 'string' || o.unit === '') return { ok: false, detail: '"unit" is not a unit name' }
      rule.unit = o.unit
    }
  } else if (o.level !== undefined || o.band !== undefined || o.side !== undefined || o.unit !== undefined) {
    return { ok: false, detail: 'a level needs a tank' }
  }
  if (o.table !== undefined) {
    if (!isId(o.table)) return { ok: false, detail: '"table" is not a timetable id' }
    rule.table = o.table
  }
  if (o.rated !== undefined) {
    if (!isId(o.rated)) return { ok: false, detail: '"rated" is not a line id' }
    rule.rated = o.rated
  }
  if (o.lowest !== undefined) {
    const lowest = decimal(o.lowest)
    if (lowest === null || cmp(lowest, fromInt(1)) > 0) return { ok: false, detail: '"lowest" must be a decimal from 0 to 1' }
    rule.lowest = o.lowest as string
  }
  if (rule.tank === undefined && rule.table === undefined) return { ok: false, detail: 'a rule needs a tank, a table, or both' }
  return { ok: true, rule }
}

/** the rule a node holds, read: `null` when it holds none or an unreadable one */
export function ruleOf(n: LoopNode): RunRule | null {
  const raw = (n.data as { run?: unknown }).run
  if (raw === undefined) return null
  const read = readRunRule(raw)
  return read.ok ? read.rule : null
}

/** a hand-made file can hold a node with no data, and the read must reach its own
 *  refusal of that node */
const holdsRule = (n: LoopNode): boolean => (n.data as { run?: unknown } | undefined)?.run !== undefined

/** `true` when any node holds a `run` key */
export const anyRunRule = (nodes: readonly LoopNode[]): boolean => nodes.some(holdsRule)

/** a document's nodes with every `run` key dropped: the same array when none holds one */
export function stripRunRules<T extends LoopNode>(nodes: T[]): T[] {
  if (!anyRunRule(nodes)) return nodes
  return nodes.map((n) => {
    if (!holdsRule(n)) return n
    const { run: _r, ...rest } = n.data as unknown as Record<string, unknown>
    return { ...n, data: rest } as unknown as T
  })
}

const resourceLines = (edges: readonly LoopEdge[]): LoopEdge[] => edges.filter((e) => (e.data?.kind ?? 'resource') === 'resource')

/** §M6-3 — the group a Converter runs in, and whether a rule may steer it. A rule is
 *  measured on one Converter and on a chain of them. A Gate anywhere in the group, or
 *  on a line of a lone Converter, or a `multi` group, is refused as `group-shape`: a
 *  router-fed Converter takes its Pools on a path a target does not hold, so no rule
 *  may reach it until that path is measured. */
export function runGroupOf(nodes: readonly LoopNode[], edges: readonly LoopEdge[], id: string): { members: string[]; ok: boolean } {
  const live = resourceLines(edges)
  const isGate = (x: string) => nodes.find((n) => n.id === x)?.data.kind === 'gate'
  const g = converterGroups(nodes as LoopNode[], live).find((x) => x.members.includes(id))
  if (!g) return { members: [id], ok: !live.some((e) => (e.source === id && isGate(e.target)) || (e.target === id && isGate(e.source))) }
  return { members: g.members, ok: g.cls === 'tree' && !g.members.some(isGate) }
}

/** the resource lines that touch a group */
export const groupLines = <E extends LoopEdge>(edges: readonly E[], members: readonly string[]): E[] =>
  edges.filter((e) => (e.data?.kind ?? 'resource') === 'resource' && (members.includes(e.source) || members.includes(e.target)))

export type RunFindingCode =
  | 'not-a-converter'
  | 'bad-rule'
  | 'group-shape'
  | 'unknown-tank'
  | 'bad-tank'
  | 'unknown-table'
  | 'rated-needed'
  | 'rated-unused'
  | 'rated-missing'
  | 'rated-outside'
  | 'rated-not-a-number'
  | 'rated-no-time'
  | 'rated-zero'
  | 'rated-out-of-range'
  | 'no-step'
  | 'no-kind'
  | 'bad-unit'
  | 'two-kinds'

export type RunFinding = { code: RunFindingCode; stage: string }

/** the exact rate of a `rated` line in the base unit per step, or the reason it has
 *  none. The tests read the exact value, so no step length can refuse a line (§M6-2). */
function ratedRate(e: LoopEdge, decl: ResourceKindDecl | undefined, time: DocTime, modelVersion: ModelVersion): Rational | RunFindingCode {
  const raw = String((e.data as { flow?: unknown }).flow ?? '').trim()
  if (parseDecimal(raw) === null || parseFlow(raw, modelVersion).kind !== 'const') return 'rated-not-a-number'
  const fu = resolveFieldUnit((e.data as { unit?: unknown }).unit, decl, time, 'rate')
  const per = fu.kind === 'base' ? null : fu.kind === 'rate' ? fu.unit.per : fu.per
  if (!per) return 'rated-no-time'
  const r = fieldRational(raw, fu, time)
  if (r === null || r.num <= 0n) return 'rated-zero'
  const d = toDouble(r)
  return Number.isFinite(d) && d !== 0 ? r : 'rated-out-of-range'
}

/** every reason a run cannot use its rules (§M6-3), first per stage. The run bars
 *  refuse before Play with these, and `step` refuses with them for a caller that
 *  steps anyway. Reads the authored graph. */
export function runFindings(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  timetables: readonly Timetable[] | undefined,
  kinds: readonly ResourceKindDecl[] | undefined,
  time: DocTime | undefined,
  modelVersion: ModelVersion,
): RunFinding[] {
  const stages = nodes.filter(holdsRule)
  if (stages.length === 0) return []
  const declOf = new Map((kinds ?? []).map((k) => [k.name, k]))
  const edgeKind = resolveKinds(nodes as LoopNode[], edges as LoopEdge[]).edgeKind
  const tables = new Map((timetables ?? []).map((t) => [t.id, t]))
  const kindOfTable = new Map<string, string>()
  for (const { edge, tableId } of timetableLines(edges)) {
    const k = edgeKind.get(edge.id)
    if (k != null && !kindOfTable.has(tableId)) kindOfTable.set(tableId, k)
  }
  const out: RunFinding[] = []
  for (const n of stages) {
    const found = (code: RunFindingCode) => out.push({ code, stage: n.id })
    if (n.data.kind !== 'converter') {
      found('not-a-converter')
      continue
    }
    const rule = ruleOf(n)
    if (!rule) {
      found('bad-rule')
      continue
    }
    const group = runGroupOf(nodes, edges, n.id)
    if (!group.ok) {
      found('group-shape')
      continue
    }
    if (rule.tank !== undefined) {
      const tank = nodes.find((x) => x.id === rule.tank)
      if (!tank) {
        found('unknown-tank')
        continue
      }
      if (tank.data.kind !== 'pool') {
        found('bad-tank')
        continue
      }
    }
    if (rule.table === undefined) {
      if (rule.rated !== undefined) found('rated-unused')
      continue
    }
    const t = tables.get(rule.table)
    if (!t) {
      found('unknown-table')
      continue
    }
    if (rule.rated === undefined) {
      found('rated-needed')
      continue
    }
    const e = edges.find((x) => x.id === rule.rated)
    if (!e || (e.data?.kind ?? 'resource') !== 'resource') {
      found('rated-missing')
      continue
    }
    if (!groupLines(edges, group.members).includes(e)) {
      found('rated-outside')
      continue
    }
    if (!time) {
      found('no-step')
      continue
    }
    const kind = edgeKind.get(e.id) ?? null
    if (kind === null) {
      found('no-kind')
      continue
    }
    const seen = kindOfTable.get(rule.table)
    if (seen !== undefined && seen !== kind) {
      found('two-kinds')
      continue
    }
    kindOfTable.set(rule.table, kind)
    const decl = declOf.get(kind)
    if (timetableRateFactor(t, decl, time) === null) {
      found('bad-unit')
      continue
    }
    const r = ratedRate(e, decl, time, modelVersion)
    if (typeof r === 'string') found(r)
  }
  return out
}

/** a finding as the engine's own refusal says it. The run bars word the same
 *  findings in the user's language. */
export function runFindingText(f: RunFinding, nodes: readonly LoopNode[]): string {
  const label = nodes.find((n) => n.id === f.stage)?.data.label ?? f.stage
  const why: Record<RunFindingCode, string> = {
    'not-a-converter': 'only a Converter can hold a run rule',
    'bad-rule': 'its run rule cannot be read',
    'group-shape': 'a run rule cannot steer a group with a Gate, or one with two supplies',
    'unknown-tank': 'its run rule names a tank this document does not hold',
    'bad-tank': 'its run rule names a tank that is not a Pool',
    'unknown-table': 'its run rule names a timetable this document does not hold',
    'rated-needed': 'its run rule reads a table and names no 100 % line',
    'rated-unused': 'its run rule names a 100 % line and reads no table',
    'rated-missing': 'its run rule names a 100 % line this document does not hold',
    'rated-outside': 'the 100 % line of its run rule is not a line of its own group',
    'rated-not-a-number': 'the 100 % line of its run rule has no number for a rate',
    'rated-no-time': 'the 100 % line of its run rule names no time',
    'rated-zero': 'the 100 % line of its run rule has no rate above 0',
    'rated-out-of-range': 'the 100 % line of its run rule has a rate out of range',
    'no-step': 'its run rule reads a table, and the document has no step length',
    'no-kind': 'its run rule reads a table, and the 100 % line has no kind',
    'bad-unit': 'its run rule reads a table whose unit is not a rate of the line’s kind',
    'two-kinds': 'its run rule reads a table another line uses with a different kind',
  }
  return `Can't run "${label}": ${why[f.code]}. Nothing moved.`
}

/** a rule's reading of one step */
export type RuleTarget = { stage: string; wanted: number; target: number; cut: 'rule' | 'lowest' | 'capped' | null }

/** §M6-4 — the step's rules: each one's target, the group's smallest, or the rule whose
 *  fraction is not finite. Assumes `runFindings` found nothing. */
export type RunPlan = {
  rules: RuleTarget[]
  /** a Converter's target, by id, for the step's `runTargets` */
  targets: Record<string, number>
  /** the `stop` table that does not cover this step, when one ends the run */
  endedBy: Timetable | null
  /** the stage whose fraction is not finite */
  outOfRange: string | null
}

export function planRuns(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  timetables: readonly Timetable[] | undefined,
  kinds: readonly ResourceKindDecl[] | undefined,
  time: DocTime | undefined,
  values: Readonly<Record<string, number>>,
  k: number,
  modelVersion: ModelVersion,
): RunPlan {
  const plan: RunPlan = { rules: [], targets: {}, endedBy: null, outOfRange: null }
  const stages = nodes.filter(holdsRule)
  const tables = new Map((timetables ?? []).map((t) => [t.id, t]))
  const declOf = new Map((kinds ?? []).map((d) => [d.name, d]))
  // a `stop` table ends the run before any rule is used
  for (const n of stages) {
    const id = ruleOf(n)?.table
    const t = id === undefined ? undefined : tables.get(id)
    const first = t && time ? firstUncoveredStep(t, time) : null
    if (t && first !== null && k >= first) return { ...plan, endedBy: t }
  }
  const edgeKind = stages.some((n) => ruleOf(n)?.table !== undefined) ? resolveKinds(nodes as LoopNode[], edges as LoopEdge[]).edgeKind : null
  for (const n of stages) {
    const rule = ruleOf(n)!
    let t = 0
    if (rule.table !== undefined) {
      const line = edges.find((e) => e.id === rule.rated)!
      const decl = declOf.get(edgeKind?.get(line.id) ?? '')
      const table = tables.get(rule.table)!
      const rate = ratedRate(line, decl, time!, modelVersion) as Rational
      t = toDouble(div(exactPlan(table, k, timetableRateFactor(table, decl, time)!, time!), rate))
    }
    let e = 0
    if (rule.tank !== undefined) {
      const tankData = nodes.find((x) => x.id === rule.tank)!.data as { resourceType?: unknown; unit?: unknown }
      const decl = declOf.get(poolKindName(tankData) ?? '')
      const fu = resolveFieldUnit(rule.unit ?? tankData.unit, decl, time, 'stock')
      e = (engineValue(rule.level!, fu, time) - (values[rule.tank] ?? 0)) / engineValue(rule.band!, fu, time)
    }
    const wanted = rule.side === 'empty' ? t - e : t + e
    if (!Number.isFinite(wanted)) return { ...plan, outOfRange: n.id }
    const lowest = rule.lowest === undefined ? 0 : Number(rule.lowest)
    let target: number
    let cut: RuleTarget['cut'] = null
    if (wanted <= 0) {
      target = 0
      cut = 'rule'
    } else if (wanted < lowest) {
      target = 0
      cut = 'lowest'
    } else {
      target = Math.min(1, wanted)
      if (wanted > 1) cut = 'capped'
    }
    plan.rules.push({ stage: n.id, wanted, target, cut })
    plan.targets[n.id] = target
  }
  return plan
}

/** the share of a target a group must reach to read `met`, and `pull all` to run. It
 *  scales with the target, so a small target cannot pass with nothing moved. */
const RUN_REACHED = 1 - EPSILON

const lowestId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** §M6-5 — the step's report: one entry per group that holds a rule, read from what
 *  the engine did. Takes the derived graph, whose lines hold engine rates. */
export function runReports(
  rules: readonly RuleTarget[],
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  events: readonly FlowEvent[],
  stateEvents: readonly StateEvent[],
  limits: ReadonlyMap<string, RunLimit>,
): RunGroupReport[] {
  const groups = new Map<string, { members: string[]; rules: RuleTarget[] }>()
  for (const r of rules) {
    const { members } = runGroupOf(nodes, edges, r.stage)
    const key = members.join('\n')
    const g = groups.get(key) ?? { members, rules: [] }
    g.rules.push(r)
    groups.set(key, g)
  }
  const out: RunGroupReport[] = []
  for (const { members, rules: held } of groups.values()) {
    const target = Math.min(...held.map((r) => r.target))
    const decider = held.filter((r) => r.target === target).sort((a, b) => lowestId(a.stage, b.stage))[0]!
    const rateOf = (e: LoopEdge) => Number((e.data as { flow?: unknown }).flow)
    // the largest line is the last to fall under the engine's amount floor, so `moved`
    // is 0 only when no line of the group moved
    const basis = groupLines(edges, members)
      .filter((e) => rateOf(e) > 0)
      .sort((a, b) => rateOf(b) - rateOf(a) || lowestId(a.id, b.id))[0]
    const moved = basis ? events.filter((x) => x.edgeId === basis.id).reduce((a, x) => a + x.amount, 0) / rateOf(basis) : 0
    const limit = members.map((m) => limits.get(m)).find((l) => l !== undefined) ?? null
    const heldOff = stateEvents.some((x) => x.effect.kind === 'activator' && !x.effect.satisfied && members.includes(x.to))
    const pullsAll = members.some((m) => (nodes.find((n) => n.id === m)?.data as { mode?: string } | undefined)?.mode === 'pullAll')
    let state: RunGroupReport['state']
    let why: RunGroupReport['why'] = null
    let cause: RunGroupReport['cause'] = null
    if (heldOff) {
      state = 'off'
      why = 'activator'
    } else if (target === 0) {
      state = 'off'
      why = decider.cut === 'lowest' ? 'lowest' : 'rule'
    } else if (moved === 0) {
      state = 'stopped'
      why = !limit ? 'floor' : pullsAll ? 'pullAll' : limit.why
      cause = limit?.why ?? null
    } else if (moved >= target * RUN_REACHED) {
      state = 'met'
    } else {
      state = 'short'
      why = limit?.why ?? null
    }
    const named = state === 'met' || state === 'off' ? null : limit
    out.push({
      members,
      rules: held.map(({ stage, wanted, target: t }) => ({ stage, wanted, target: t })),
      target,
      decidedBy: decider.stage,
      capped: decider.cut === 'capped',
      moved,
      basis: basis?.id ?? null,
      state,
      why,
      cause,
      pool: named?.pool ?? null,
      needed: named?.needed ?? null,
      had: named?.had ?? null,
    })
  }
  return out.sort((a, b) => lowestId(a.members[0]!, b.members[0]!))
}
