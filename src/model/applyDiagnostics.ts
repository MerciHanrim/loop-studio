// #558 — what a CHOSEN Apply would do to the document besides what its lines say.
//
// "Choose changes" can take a line or a rule without the table it reads, a value
// without the unit it is written in, a kinds table without the values written for
// it. Three things can follow, and each is told before the Apply:
//
//   - a UNIT MISREAD: a value whose unit would be read another way than on the side
//     the value came from (`0.9 bag` taken into a document that does not declare
//     `bag` reads as 0.9 of the base unit). Nothing in the document would say so
//     afterwards, so the Apply is REFUSED;
//   - a NEW REFUSAL: the run checks would refuse the result for a reason the open
//     document does not have now (a table it does not hold, a table whose unit is no
//     rate of the line's kind). The document says why and one Undo takes it back, so
//     the Apply is allowed and the reason is shown first, with the lines that would
//     resolve it;
//   - a TABLE SPLIT: a taken line or rule reads a timetable both sides hold under
//     different definitions, and the open document's is kept. The run works, on
//     amounts the proposal did not plan: the two plans are shown.
//
// Pure functions of the three documents; nothing here changes one.
import { refusingKindFindings, resolveKinds, type KindFinding, type ResourceKindDecl } from './kinds'
import { hasRunRules, hasTimetables, type ModelSemanticsVersion } from './modelVersion'
import { add, equals, fromInt, type Rational } from './rational'
import type { HunkSelection, ThreeWayPlan } from './revision'
import { groupLines, ruleOf, runFindings, runGroupOf, type RunFinding } from './runRule'
import { exactPlan, timetableFindings, timetableRateFactor, timetableRef, type Timetable, type TimetableFinding } from './timetable'
import type { LoopEdge, LoopNode } from './types'
import { poolKindName, resolveFieldUnit, stepSeconds, TIME_UNIT_SECONDS, type DocTime, type FieldRole } from './units'

/** a document as the run reads it */
export type DiagDoc = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  kinds: readonly ResourceKindDecl[]
  time: DocTime | undefined
  timetables: readonly Timetable[]
  modelVersion: ModelSemanticsVersion
}

/** a graph-level line of "choose changes" */
export type UnitLine = 'kinds' | 'time' | 'timetables'
const UNIT_LINES: readonly UnitLine[] = ['timetables', 'kinds', 'time']

export type ElementRef = { elementType: 'node' | 'edge'; id: string }

export type RunRefusal = { from: 'timetable'; finding: TimetableFinding } | { from: 'rule'; finding: RunFinding } | { from: 'kind'; finding: KindFinding }
/** `resolvedBy`: the fewest lines not taken whose taking removes the refusal; empty when none does */
export type NewRefusal = RunRefusal & { resolvedBy: UnitLine[] }

/** `origin`: the side the value came from, where its unit reads another way */
export type UnitMisread = ElementRef & { unit: string; origin: 'proposed' | 'yours' }

export type TableSplit = {
  tableId: string
  label: string
  /** which side the readers and the table come from:
   *  - `'taken'` — lines and rules taken from the proposal read the open document's
   *    definition, which is kept;
   *  - `'kept'` — lines and rules the user keeps, where the proposal has another
   *    version of them, read the proposal's definition, which is taken. */
  direction: 'taken' | 'kept'
  /** the lines and rules that read the table from the other side */
  readers: ElementRef[]
  /** what the table plans under each definition, in the base unit of the reading
   *  line's kind, over steps 1 to `lastStep`; absent when it cannot be computed */
  amounts?: { lastStep: number; unit: string; theirs: Rational; yours: Rational; firstStep: number; theirsAt: Rational; yoursAt: Rational }
}

export type ApplyDiagnostics = { unitMisreads: UnitMisread[]; newRefusals: NewRefusal[]; tableSplits: TableSplit[] }

/** how many steps of a table the two plans are compared over, at most */
export const TABLE_SPLIT_MAX_STEPS = 2000

const isResource = (e: LoopEdge) => (e.data?.kind ?? 'resource') === 'resource'

// ── the run's own refusals ────────────────────────────────────────────────

function refusals(d: DiagDoc): RunRefusal[] {
  return [
    ...(hasTimetables(d.modelVersion) ? timetableFindings(d.nodes, d.edges, d.timetables, d.kinds, d.time) : []).map((finding) => ({ from: 'timetable' as const, finding })),
    ...(hasRunRules(d.modelVersion) ? runFindings(d.nodes, d.edges, d.timetables, d.kinds, d.time, d.modelVersion) : []).map((finding) => ({ from: 'rule' as const, finding })),
    ...refusingKindFindings(d.nodes, d.edges, d.kinds, d.modelVersion, d.time).map((finding) => ({ from: 'kind' as const, finding })),
  ]
}
const refusalKey = (r: RunRefusal): string => `${r.from}:${JSON.stringify(r.finding)}`

/** every non-empty subset of `lines`, the smallest first */
function subsets(lines: readonly UnitLine[]): UnitLine[][] {
  const out: UnitLine[][] = []
  for (let mask = 1; mask < 1 << lines.length; mask++) out.push(lines.filter((_, i) => mask & (1 << i)))
  return out.sort((a, b) => a.length - b.length)
}

// ── a unit read another way ───────────────────────────────────────────────

type UnitField = ElementRef & { unit: string; signature: string; reading: string }

/** every Pool and resource line written in a unit, with what it holds and how the
 *  document reads that unit (the declaration, never the per-step ratio: a rate per
 *  minute is the same rate under another step length) */
function unitFields(d: DiagDoc): Map<string, UnitField> {
  const declOf = new Map(d.kinds.map((k) => [k.name, k]))
  const out = new Map<string, UnitField>()
  const reading = (unit: string, kind: string | null, role: FieldRole): string => {
    const decl = kind === null ? undefined : declOf.get(kind)
    const fu = resolveFieldUnit(unit, decl, d.time, role)
    const read = fu.kind === 'base' ? { as: 'base' } : fu.kind === 'rate' ? { as: 'rate', name: fu.unit.name, factor: fu.unit.factor, per: fu.unit.per } : { as: 'amount', name: fu.unit.name, factor: fu.unit.factor, per: fu.per ?? null }
    return JSON.stringify({ read, base: decl?.baseUnit ?? null })
  }
  for (const n of d.nodes) {
    const data = n.data as { kind?: unknown; unit?: unknown; initial?: unknown; capacity?: unknown; resourceType?: unknown } | undefined
    if (data?.kind !== 'pool' || typeof data.unit !== 'string' || data.unit === '') continue
    out.set(`node:${n.id}`, {
      elementType: 'node',
      id: n.id,
      unit: data.unit,
      signature: JSON.stringify([data.initial ?? null, data.capacity ?? null, data.unit, poolKindName(data)]),
      reading: reading(data.unit, poolKindName(data), 'stock'),
    })
  }
  const lines = d.edges.filter((e) => isResource(e) && typeof (e.data as { unit?: unknown } | undefined)?.unit === 'string' && (e.data as { unit?: unknown }).unit !== '')
  if (lines.length === 0) return out
  const edgeKind = resolveKinds(d.nodes, d.edges).edgeKind
  for (const e of lines) {
    const data = e.data as { unit: string; flow?: unknown }
    out.set(`edge:${e.id}`, {
      elementType: 'edge',
      id: e.id,
      unit: data.unit,
      signature: JSON.stringify([String(data.flow ?? ''), data.unit]),
      reading: reading(data.unit, edgeKind.get(e.id) ?? null, 'rate'),
    })
  }
  return out
}

function unitMisreads(target: DiagDoc, proposed: DiagDoc, result: DiagDoc): UnitMisread[] {
  const after = unitFields(result)
  if (after.size === 0) return []
  const yours = unitFields(target)
  const theirs = unitFields(proposed)
  const out: UnitMisread[] = []
  for (const [key, f] of after) {
    // the side(s) this value and its unit came from: the same value in the same unit
    const fromYours = yours.get(key)?.signature === f.signature ? yours.get(key)! : null
    const fromTheirs = theirs.get(key)?.signature === f.signature ? theirs.get(key)! : null
    // a value and a unit the user put together field by field belong to neither side
    if (!fromYours && !fromTheirs) continue
    if (fromYours?.reading === f.reading || fromTheirs?.reading === f.reading) continue
    out.push({ elementType: f.elementType, id: f.id, unit: f.unit, origin: fromTheirs ? 'proposed' : 'yours' })
  }
  return out.sort((a, b) => (a.elementType === b.elementType ? (a.id < b.id ? -1 : 1) : a.elementType === 'node' ? -1 : 1))
}

// ── a table read under another definition ─────────────────────────────────

/** what the run reads of a table: its label and its source are not part of it */
const definition = (t: Timetable): string => JSON.stringify([t.unit, t.timeUnit, t.read, t.end, t.after, t.means ?? 'plan', t.points])

/** the steps a table describes under a step length */
function stepsOf(t: Timetable, time: DocTime): number {
  const seconds = Number(t.end) * TIME_UNIT_SECONDS[t.timeUnit]
  const steps = Math.ceil(seconds / stepSeconds(time)!)
  return Number.isFinite(steps) && steps > 0 ? steps : 1
}

/**
 * A table is split when a line or a rule of one side reads it under the other side's
 * definition. Which way depends on the Timetables line alone, since the tables are one
 * unit: kept ⇒ what was TAKEN from the proposal reads the open document's tables;
 * taken ⇒ what was KEPT against the proposal reads the proposal's tables. A line the
 * two sides hold alike is on both sides and is never a reader: taking the proposal's
 * tables under lines the proposal did not touch is exactly the proposal.
 */
function tableSplits(target: DiagDoc, proposed: DiagDoc, result: DiagDoc, tablesTaken: boolean, changed: { taken: readonly ElementRef[]; kept: readonly ElementRef[] }): TableSplit[] {
  const direction: TableSplit['direction'] = tablesTaken ? 'kept' : 'taken'
  const candidates = tablesTaken ? changed.kept : changed.taken
  if (candidates.length === 0 || result.timetables.length === 0) return []
  // the same table on the side the readers come from
  const theirs = new Map((tablesTaken ? target : proposed).timetables.map((t) => [t.id, t]))
  const split = new Map(result.timetables.flatMap((t) => (theirs.has(t.id) && definition(theirs.get(t.id)!) !== definition(t) ? [[t.id, t] as const] : [])))
  if (split.size === 0) return []

  // the tables a line reads: its own `~table`, and the table of every rule whose group it is a line of
  const stages = result.nodes.flatMap((n) => {
    const rule = ruleOf(n)
    return rule?.table !== undefined && split.has(rule.table) ? [{ id: n.id, table: rule.table, rated: rule.rated, lines: new Set(groupLines(result.edges, runGroupOf(result.nodes, result.edges, n.id).members).map((e) => e.id)) }] : []
  })
  const readers = new Map<string, ElementRef[]>()
  const reads = (table: string | null | undefined, who: ElementRef) => {
    if (table == null || !split.has(table)) return
    const list = readers.get(table) ?? []
    if (!list.some((x) => x.elementType === who.elementType && x.id === who.id)) list.push(who)
    readers.set(table, list)
  }
  for (const c of candidates) {
    if (c.elementType === 'edge') {
      const e = result.edges.find((x) => x.id === c.id)
      if (!e || !isResource(e)) continue
      reads(timetableRef((e.data as { flow?: unknown }).flow), c)
      for (const s of stages) if (s.lines.has(e.id)) reads(s.table, c)
    } else {
      const n = result.nodes.find((x) => x.id === c.id)
      if (n) reads(ruleOf(n)?.table, c)
    }
  }
  if (readers.size === 0) return []

  const edgeKind = resolveKinds(result.nodes, result.edges).edgeKind
  const declOf = new Map(result.kinds.map((k) => [k.name, k]))
  const out: TableSplit[] = []
  for (const [tableId, who] of [...readers].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    // `mine` is the open document's definition and `other` the proposal's, whichever of the two the result holds
    const mine = tablesTaken ? theirs.get(tableId)! : split.get(tableId)!
    const other = tablesTaken ? split.get(tableId)! : theirs.get(tableId)!
    const entry: TableSplit = { tableId, label: split.get(tableId)!.label, direction, readers: who }
    // the line whose kind the table's unit is a rate of: a line that reads it, else a rule's 100 % line
    const line = result.edges.find((e) => isResource(e) && timetableRef((e.data as { flow?: unknown }).flow) === tableId)?.id ?? stages.find((s) => s.table === tableId)?.rated
    const decl = line === undefined ? undefined : declOf.get(edgeKind.get(line) ?? '')
    const time = result.time
    const fMine = time ? timetableRateFactor(mine, decl, time) : null
    const fOther = time ? timetableRateFactor(other, decl, time) : null
    if (time && fMine !== null && fOther !== null) {
      const lastStep = Math.min(TABLE_SPLIT_MAX_STEPS, Math.max(stepsOf(mine, time), stepsOf(other, time)))
      let sumMine: Rational = fromInt(0)
      let sumOther: Rational = fromInt(0)
      let first: { step: number; theirsAt: Rational; yoursAt: Rational } | null = null
      for (let k = 1; k <= lastStep; k++) {
        const a = exactPlan(mine, k, fMine, time)
        const b = exactPlan(other, k, fOther, time)
        sumMine = add(sumMine, a)
        sumOther = add(sumOther, b)
        if (first === null && !equals(a, b)) first = { step: k, theirsAt: b, yoursAt: a }
      }
      // two definitions that plan the same amount at every step compared are no split to tell
      if (first === null) continue
      entry.amounts = { lastStep, unit: decl?.baseUnit ?? '', theirs: sumOther, yours: sumMine, firstStep: first.step, theirsAt: first.theirsAt, yoursAt: first.yoursAt }
    }
    out.push(entry)
  }
  return out
}

// ── the whole ─────────────────────────────────────────────────────────────

/**
 * The lines and nodes whose run-relevant content a selection splits from the other
 * side. A field counts when it is engine-tagged or names a unit or a kind.
 *   - `taken`: an accepted `add`, and a `change` with such a field taken from the
 *     proposal;
 *   - `kept`: a `change` with such a field the proposal holds another way and the
 *     user keeps, and a `remove` the user does not accept (the proposal has no such
 *     line at all).
 */
export function splitEngineChanges(plan: ThreeWayPlan, selection: HunkSelection): { taken: ElementRef[]; kept: ElementRef[] } {
  const taken: ElementRef[] = []
  const kept: ElementRef[] = []
  for (const h of plan.hunks) {
    const ref: ElementRef = { elementType: h.elementType, id: h.id }
    if (h.kind === 'add') {
      if (selection.accept[h.id]) taken.push(ref)
    } else if (h.kind === 'remove') {
      if (!selection.accept[h.id] && h.verdict !== 'noop') kept.push(ref)
    } else {
      const choices = selection.fieldChoices[h.id] ?? {}
      const runRelevant = (h.fields ?? []).filter((f) => f.verdict !== 'noop' && (f.tag === 'engine' || f.field === 'data.unit' || f.field === 'data.resourceType'))
      if (runRelevant.some((f) => choices[f.field] === 'proposed')) taken.push(ref)
      if (h.yours !== null && runRelevant.some((f) => choices[f.field] !== 'proposed')) kept.push(ref)
    }
  }
  return { taken, kept }
}

/** the document a chosen Apply makes: the built graph, and each graph-level unit from
 *  the proposal when its line was taken, else from the open document */
export function chosenResultDoc(
  target: DiagDoc,
  built: { nodes: LoopNode[]; edges: LoopEdge[]; kinds?: readonly ResourceKindDecl[]; time?: DocTime | null; timetables?: readonly Timetable[] },
): { result: DiagDoc; taken: Record<UnitLine, boolean> } {
  return {
    result: {
      nodes: built.nodes,
      edges: built.edges,
      kinds: built.kinds ?? target.kinds,
      time: built.time !== undefined ? (built.time ?? undefined) : target.time,
      timetables: built.timetables ?? target.timetables,
      modelVersion: target.modelVersion,
    },
    taken: { kinds: built.kinds !== undefined, time: built.time !== undefined, timetables: built.timetables !== undefined },
  }
}

export function applyDiagnostics(input: {
  /** the open document */
  target: DiagDoc
  /** the proposal's own document */
  proposed: DiagDoc
  /** the document the selection would make */
  result: DiagDoc
  /** the graph-level lines the selection takes */
  taken: Readonly<Record<UnitLine, boolean>>
  /** {@link splitEngineChanges} */
  changed: { taken: readonly ElementRef[]; kept: readonly ElementRef[] }
}): ApplyDiagnostics {
  const { target, proposed, result, taken, changed } = input

  const before = new Set(refusals(target).map(refusalKey))
  const fresh = refusals(result).filter((r) => !before.has(refusalKey(r)))
  // a line helps only if it is not taken and the proposal's value is another one
  const differs: Record<UnitLine, boolean> = {
    kinds: JSON.stringify(result.kinds) !== JSON.stringify(proposed.kinds),
    time: JSON.stringify(result.time ?? null) !== JSON.stringify(proposed.time ?? null),
    timetables: JSON.stringify(result.timetables) !== JSON.stringify(proposed.timetables),
  }
  const open = UNIT_LINES.filter((l) => !taken[l] && differs[l])
  const tries = fresh.length > 0 ? subsets(open).map((lines) => ({ lines, keys: new Set(refusals({ ...result, ...Object.fromEntries(lines.map((l) => [l, proposed[l]])) }).map(refusalKey)) })) : []
  const newRefusals: NewRefusal[] = fresh.map((r) => ({ ...r, resolvedBy: tries.find((x) => !x.keys.has(refusalKey(r)))?.lines ?? [] }))

  return { unitMisreads: unitMisreads(target, proposed, result), newRefusals, tableSplits: tableSplits(target, proposed, result, taken.timetables, changed) }
}
