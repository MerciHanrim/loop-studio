// loop-model/3 (SEMANTICS-M3.md) — resource kinds and per-kind conservation
// (#471, `kinds-units-design.md` rev 3). A document may carry a KINDS TABLE: per
// kind (a `resourceType` name, §M4.1 identity) whether it is CONSERVED and its
// base unit. The engine then reads the kind of every resource connection (K1),
// checks each Converter's recipe per conserved kind (C1, I1-K), and refuses the
// run where a conserved kind is involved and the recipe is broken, cannot be
// computed, or the kinds conflict (D1). A document with no kinds table is a
// loop-model/2 document in every number it computes.
import { parseFlow, type FlowExpr } from '../engine/flow'
import { resolveFlowExprs } from '../engine/gateChance'
import { normalizeResourceType } from './model/resourceType'
import { trimUnicodeWhitespace, utf8Len } from './model/text'
import { hasUnits, type ModelSemanticsVersion } from './modelVersion'
import { add, displayRational, equals, fromInt, parseDecimal, sub, toDouble, type Rational } from './rational'
import type { LoopEdge, LoopNode } from './types'
import { engineValueRunnable, fieldRational, readRateUnitList, readUnitList, resolveFieldUnit, type DocTime, type RateUnitDecl, type UnitDecl } from './units'

// ── the kinds table ───────────────────────────────────────────────────────

export type ResourceKindDecl = {
  /** the kind's name — a `resourceType` as §M4.1 identifies it (trim + NFC) */
  name: string
  /** C1 — opt-in: every Converter recipe balances in this kind */
  conserved: boolean
  /** U1 stage 1 — the base unit's label (`m³`, `kWh`); the unit of every
   *  field that names no other. */
  baseUnit?: string
  /** loop-model/4 (SEMANTICS-M4.md §M4-1) — the kind's amount units, each a
   *  scale of the base unit; a stock or a rate may be authored in one */
  units?: UnitDecl[]
  /** loop-model/4 — the kind's rate units, each an amount per time; a rate
   *  field may be authored in one once the document declares its step length */
  rateUnits?: RateUnitDecl[]
}

export const KIND_BASE_UNIT_MAX_BYTES = 32

/** `true` when a kinds table declares any unit list (⇒ loop-model/4 content) */
export const kindsDeclareUnits = (kinds: readonly ResourceKindDecl[]): boolean =>
  kinds.some((k) => (k.units?.length ?? 0) > 0 || (k.rateUnits?.length ?? 0) > 0)

/** the table without its unit lists — what a document of a version before
 *  loop-model/4 can carry (§M4-1: the lists are not read from one) */
export function stripUnits(kinds: readonly ResourceKindDecl[]): ResourceKindDecl[] {
  return kinds.map((k) => {
    const { units: _u, rateUnits: _r, ...rest } = k
    return rest
  })
}

/** `readKinds` at a declared version: the unit lists only from loop-model/4 */
export function readKindsAt(raw: unknown, modelVersion: ModelSemanticsVersion | number | undefined): ResourceKindDecl[] {
  const kinds = readKinds(raw)
  return hasUnits(modelVersion) ? kinds : stripUnits(kinds)
}

/** The §M3-1 defensive read of a file's `kinds` array: a non-array or an
 *  entry that is not an object with a usable name is dropped; names normalise
 *  as `resourceType` does and the first of two equal names wins; `conserved`
 *  is `true` only when literally `true`; a base unit is a trimmed NFC string
 *  of at most 32 UTF-8 bytes, dropped (not truncated) over the cap. File order
 *  is kept. */
export function readKinds(raw: unknown): ResourceKindDecl[] {
  if (!Array.isArray(raw)) return []
  const out: ResourceKindDecl[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const o = entry as { name?: unknown; conserved?: unknown; baseUnit?: unknown; units?: unknown; rateUnits?: unknown }
    const name = normalizeResourceType(o.name).value
    if (name === null || seen.has(name)) continue
    seen.add(name)
    const decl: ResourceKindDecl = { name, conserved: o.conserved === true }
    if (typeof o.baseUnit === 'string') {
      const unit = trimUnicodeWhitespace(o.baseUnit).normalize('NFC')
      if (unit !== '' && utf8Len(unit) <= KIND_BASE_UNIT_MAX_BYTES) decl.baseUnit = unit
    }
    // §M4-1 — the unit lists: names unique across both lists and apart from
    // the base unit (the base unit's name wins, then file order); a bad entry
    // is dropped; an empty list is no key
    const taken = new Set<string>(decl.baseUnit !== undefined ? [decl.baseUnit] : [])
    const units = readUnitList(o.units, taken)
    const rateUnits = readRateUnitList(o.rateUnits, taken)
    if (units.length > 0) decl.units = units
    if (rateUnits.length > 0) decl.rateUnits = rateUnits
    out.push(decl)
  }
  return out
}

/** The canonical form a kinds table is written with: the §M3-1 read applied,
 *  so a file and its digest never carry an entry the reader would drop. */
export function canonicalKinds(kinds: readonly ResourceKindDecl[]): ResourceKindDecl[] {
  return readKinds(kinds)
}

export function conservedKinds(kinds: readonly ResourceKindDecl[]): Set<string> {
  return new Set(kinds.filter((k) => k.conserved).map((k) => k.name))
}

// ── K1 — the kind of every resource connection ────────────────────────────

export type KindHow = 'pool' | 'annotation' | 'gate' | 'none'

export type KindConflict =
  /** a connection whose two Pool ends carry two kinds */
  | { kind: 'poolEnds'; edgeId: string; kinds: [string, string] }
  /** a connection annotated with one kind on a Pool of another (the §M4.3 mismatch) */
  | { kind: 'annotation'; edgeId: string; nodeId: string; edgeKind: string; poolKind: string }
  /** a connection of a determined kind whose Pool end declares no kind — the
   *  kind would enter or leave a Pool that is not counted as that kind
   *  (reached by its other Pool end, or by a Gate's propagation) */
  | { kind: 'poolNoKind'; edgeId: string; nodeId: string; edgeKind: string }
  /** a Gate whose connections carry two or more determined kinds */
  | { kind: 'gateMixes'; nodeId: string; kinds: string[] }

export type KindResolution = {
  /** every resource connection → its kind, or `null` when undetermined */
  edgeKind: Map<string, string | null>
  how: Map<string, KindHow>
  /** every Gate → the determined kinds among its connections, sorted */
  gateKinds: Map<string, string[]>
  /** in a stable order: Pool-end and annotation conflicts by edge id, then
   *  no-kind Pool conflicts by edge id, then Gates by node id */
  conflicts: KindConflict[]
}

const byIdAsc = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const isResource = (e: LoopEdge) => (e.data?.kind ?? 'resource') === 'resource'

/**
 * §M3-2 (design §3.1, K1) — in this order: (1) a Pool end gives its kind;
 * (2) with no Pool end — and only then — the connection's own `resourceType`
 * annotation; (3) in synchronous rounds to a fixpoint, a Gate carrying exactly
 * one kind gives it to its undetermined connections — a Gate carries one kind
 * on every connection, through chains of Gates; a connection two Gates offer
 * two kinds to in the same round stays undetermined and both Gates carry
 * both kinds; (4) what none reaches has no kind. Converters, Sources, Drains
 * and Ends propagate nothing. A Gate carrying two kinds is a conflict and
 * propagates nothing. The result does not depend on the order of ids.
 * After 1–3, a determined connection whose Pool end has no kind is a
 * conflict: the kind would move into or out of a Pool that is not of it.
 */
export function resolveKinds(nodes: readonly LoopNode[], edges: readonly LoopEdge[]): KindResolution {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const nodeKind = (id: string) => byId.get(id)?.data.kind
  const poolKind = (id: string): string | null => {
    const n = byId.get(id)
    if (!n || n.data.kind !== 'pool') return null
    return normalizeResourceType((n.data as { resourceType?: unknown }).resourceType).value
  }
  const res = edges.filter(isResource).slice().sort(byIdAsc)
  const edgeKind = new Map<string, string | null>()
  const how = new Map<string, KindHow>()
  const conflicts: KindConflict[] = []

  for (const e of res) {
    const annotation = normalizeResourceType((e.data as { resourceType?: unknown } | undefined)?.resourceType).value
    const ends = [e.source, e.target].filter((id) => nodeKind(id) === 'pool')
    const poolKinds = ends.map(poolKind).filter((k): k is string => k !== null)
    const distinct = [...new Set(poolKinds)]
    if (distinct.length > 1) conflicts.push({ kind: 'poolEnds', edgeId: e.id, kinds: [distinct[0], distinct[1]] })
    if (distinct.length >= 1) {
      edgeKind.set(e.id, distinct[0])
      how.set(e.id, 'pool')
      if (annotation !== null) {
        for (const id of ends) {
          const pk = poolKind(id)
          if (pk !== null && pk !== annotation) conflicts.push({ kind: 'annotation', edgeId: e.id, nodeId: id, edgeKind: annotation, poolKind: pk })
        }
      }
    } else if (ends.length === 0 && annotation !== null) {
      edgeKind.set(e.id, annotation)
      how.set(e.id, 'annotation')
    } else {
      // a Pool end whose Pool has no kind leaves the line undetermined: rule 2
      // reads the annotation on Pool-less lines only; beside a Pool it is a note
      edgeKind.set(e.id, null)
      how.set(e.id, 'none')
    }
  }

  // rule 3, in synchronous rounds so the result does not depend on the order
  // of Gate ids: every Gate carrying exactly one kind proposes it to its
  // undetermined lines, all proposals of a round reading the state at the
  // round's start. A line two Gates propose two kinds to in one round is
  // CONTESTED: it stays undetermined for good, and both Gates carry both
  // kinds from then on (so neither propagates further and both are conflicts).
  const gates = nodes.filter((n) => n.data.kind === 'gate').map((n) => n.id).sort()
  const linesOf = new Map<string, LoopEdge[]>(gates.map((g) => [g, res.filter((e) => e.source === g || e.target === g)]))
  const contested = new Set<string>()
  const contestKinds = new Map<string, Set<string>>()
  const carried = (g: string) =>
    [...new Set([...(linesOf.get(g) ?? []).map((e) => edgeKind.get(e.id)).filter((k): k is string => k !== null), ...(contestKinds.get(g) ?? [])])].sort()
  for (let round = 0; round < 1 + res.length; round++) {
    const proposals = new Map<string, Map<string, string[]>>()
    for (const g of gates) {
      const ks = carried(g)
      if (ks.length !== 1) continue
      for (const e of linesOf.get(g) ?? []) {
        if (edgeKind.get(e.id) !== null || contested.has(e.id)) continue
        const byKind = proposals.get(e.id) ?? new Map<string, string[]>()
        byKind.set(ks[0], [...(byKind.get(ks[0]) ?? []), g])
        proposals.set(e.id, byKind)
      }
    }
    if (proposals.size === 0) break
    // the contests of this round first: a Gate that turns out to carry two
    // kinds propagates nothing, so its other offers of the round are dropped
    const contestants = new Set<string>()
    for (const [id, byKind] of proposals) {
      if (byKind.size === 1) continue
      contested.add(id)
      const ks = [...byKind.keys()].sort()
      for (const gs of byKind.values()) {
        for (const g of gs) {
          contestants.add(g)
          const s = contestKinds.get(g) ?? new Set<string>()
          for (const k of ks) s.add(k)
          contestKinds.set(g, s)
        }
      }
    }
    for (const [id, byKind] of proposals) {
      if (byKind.size !== 1) continue
      const [k, gs] = [...byKind.entries()][0]
      if (gs.every((g) => contestants.has(g))) continue
      edgeKind.set(id, k)
      how.set(id, 'gate')
    }
  }
  // a determined kind at a Pool that declares none (review 3): rule 1 gave the
  // kind from the other Pool end, or rule 3 carried it through a Gate; either
  // way the kind would enter or leave a Pool that is not counted as that kind,
  // which no per-kind sum can hold (M3-INV-2)
  for (const e of res) {
    const k = edgeKind.get(e.id)
    if (k === null || k === undefined) continue
    for (const id of [e.source, e.target]) {
      if (nodeKind(id) === 'pool' && poolKind(id) === null) conflicts.push({ kind: 'poolNoKind', edgeId: e.id, nodeId: id, edgeKind: k })
    }
  }
  const gateKinds = new Map<string, string[]>()
  for (const g of gates) {
    const ks = carried(g)
    gateKinds.set(g, ks)
    if (ks.length > 1) conflicts.push({ kind: 'gateMixes', nodeId: g, kinds: ks })
  }
  return { edgeKind, how, gateKinds, conflicts }
}

// ── C1 + D1 — findings ────────────────────────────────────────────────────

export type KindFinding =
  | { cls: 'conflict'; conflict: KindConflict; refuses: boolean }
  /** a Converter whose balance in a conserved kind cannot be computed: a
   *  connection whose rate is not a number (`all`, a percent, a random form,
   *  a reference that does not resolve), or a connection with no kind */
  | { cls: 'notComputable'; converterId: string; edgeId: string; reason: 'rate' | 'noKind'; rate: string; kind: string | null; refuses: boolean }
  /** a Converter whose computable balance in a conserved kind differs.
   *  `inRate` / `outRate` are the nearest doubles of the two exact sums (in
   *  the base unit per step); `inText` / `outText` / `diffText` are what a
   *  surface prints for them under R≈ (§M4-5), `approx` whether any of the
   *  three is an approximation. The verdict came from the rationals. */
  | { cls: 'broken'; converterId: string; kind: string; inRate: number; outRate: number; inText: string; outText: string; diffText: string; approx: boolean; refuses: boolean }
  /** loop-model/4 (§M4-2.5) — a field whose engine value is not a finite
   *  number: its authored value in its unit is beyond what a run can hold.
   *  Always refuses, whether or not a kind is conserved. `value` is the
   *  authored text, `unit` the field's unit text. */
  | { cls: 'outOfRange'; nodeId: string | null; edgeId: string | null; value: string; unit: string; refuses: true }

/** §M4-2.5 — every unit-bearing field whose engine value is not finite, the
 *  Pools first (ascending id, `initial` before `capacity`), then the resource
 *  connections (ascending id) */
export function unitRangeFindings(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  kinds: readonly ResourceKindDecl[],
  time: DocTime | undefined,
): KindFinding[] {
  const declOf = new Map(kinds.map((k) => [k.name, k]))
  const out: KindFinding[] = []
  const unitOf = (d: unknown) => (d as { unit?: unknown } | undefined)?.unit
  for (const n of [...nodes].sort(byIdAsc)) {
    if (n.data?.kind !== 'pool' || typeof unitOf(n.data) !== 'string') continue
    const d = n.data as { initial: number; capacity: number | null; resourceType?: unknown; unit: string }
    const fu = resolveFieldUnit(d.unit, declOf.get(normalizeResourceType(d.resourceType).value ?? ''), time, 'stock')
    for (const v of [d.initial, d.capacity]) {
      if (v == null || engineValueRunnable(v, fu, time)) continue
      out.push({ cls: 'outOfRange', nodeId: n.id, edgeId: null, value: String(v), unit: d.unit, refuses: true })
    }
  }
  const res = edges.filter((e) => isResource(e) && typeof unitOf(e.data) === 'string')
  if (res.length === 0) return out
  const r = resolveKinds(nodes, edges)
  for (const e of res.slice().sort(byIdAsc)) {
    const raw = rawFlow(e).trim()
    const k = r.edgeKind.get(e.id) ?? null
    if (k === null || parseDecimal(raw) === null) continue
    const fu = resolveFieldUnit(unitOf(e.data), declOf.get(k), time, 'rate')
    if (!engineValueRunnable(raw, fu, time)) out.push({ cls: 'outOfRange', nodeId: null, edgeId: e.id, value: raw, unit: String(unitOf(e.data)), refuses: true })
  }
  return out
}

const rawFlow = (e: LoopEdge) => String((e.data as { flow?: unknown } | undefined)?.flow ?? '1')
const numeric = (fx: FlowExpr | undefined): number | null => (fx && fx.kind === 'const' && Number.isFinite(fx.value) ? fx.value : null)

/** §M4-2.4 — the AUTHORED decimal of a computable rate: the field's own text
 *  when it is a plain decimal (`7`, `0.25`), else the shortest form of the
 *  value the engine resolved it to (a `@param` reference → the Parameter's
 *  value, which has no unit). `null` when the rate is not computable. */
function authoredRate(e: LoopEdge, fx: FlowExpr | undefined): string | null {
  const raw = rawFlow(e).trim()
  if (parseDecimal(raw) !== null) return raw
  const v = numeric(fx)
  return v === null ? null : String(v)
}

/**
 * §M3-3 / §M3-4 (design §3.2, §3.5) — the findings of a graph under its kinds
 * table, a pure function in a stable order: every conflict of `resolveKinds`;
 * then per Converter (ascending id) each connection (ascending id) whose rate
 * is not a number, each connection with no kind when a conserved kind is
 * involved at the Converter, and each conserved kind whose computable balance
 * differs. `refuses` is `true` exactly where a conserved kind is involved: at
 * a conflict, one of its kinds is conserved; at a Converter, one of its
 * connections has a determined conserved kind. With an empty table nothing
 * refuses and only the rate findings remain.
 *
 * loop-model/4 (SEMANTICS-M4.md §M4-2.4, D4) — the balance is EXACT: every
 * computable rate is its authored decimal times its field unit's ratio to the
 * base unit per step, as a rational; the two sides are summed exactly and
 * must be equal. No epsilon, no double. A document without units is the same
 * test over its plain decimals, so `100 = 45 + 53 + 2` and `0.1 + 0.2 = 0.3`
 * balance and `100 ≠ 50 + 55` by exactly 5.
 */
export function kindFindings(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  kinds: readonly ResourceKindDecl[],
  modelVersion: ModelSemanticsVersion,
  time?: DocTime,
): KindFinding[] {
  const conserved = conservedKinds(kinds)
  const declOf = new Map(kinds.map((k) => [k.name, k]))
  const r = resolveKinds(nodes, edges)
  const out: KindFinding[] = []
  for (const c of r.conflicts) {
    const ks = c.kind === 'poolEnds' ? c.kinds : c.kind === 'annotation' ? [c.edgeKind, c.poolKind] : c.kind === 'poolNoKind' ? [c.edgeKind] : c.kinds
    out.push({ cls: 'conflict', conflict: c, refuses: ks.some((k) => conserved.has(k)) })
  }
  // loop-model/4 (§M4-2.5) — a field the engine cannot hold refuses the run
  out.push(...unitRangeFindings(nodes, edges, kinds, time))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const res = edges.filter(isResource).slice().sort(byIdAsc)
  // the resolved rates: a `@param` reference becomes its Parameter's value, as step() resolves it
  const { flowOf } = resolveFlowExprs(byId, res as LoopEdge[], modelVersion)
  const converters = nodes.filter((n) => n.data.kind === 'converter').map((n) => n.id).sort()
  for (const c of converters) {
    const lines = res.filter((e) => e.source === c || e.target === c)
    const involved = lines.some((e) => {
      const k = r.edgeKind.get(e.id)
      return k !== null && k !== undefined && conserved.has(k)
    })
    let computable = true
    const authored = new Map<string, string>()
    for (const e of lines) {
      const k = r.edgeKind.get(e.id) ?? null
      const fx = flowOf.get(e.id) ?? parseFlow(rawFlow(e), modelVersion)
      const a = authoredRate(e, fx)
      if (a === null) {
        out.push({ cls: 'notComputable', converterId: c, edgeId: e.id, reason: 'rate', rate: rawFlow(e).trim(), kind: k, refuses: involved })
        computable = false
      } else if (k === null && involved) {
        out.push({ cls: 'notComputable', converterId: c, edgeId: e.id, reason: 'noKind', rate: rawFlow(e).trim(), kind: null, refuses: true })
        computable = false
      } else authored.set(e.id, a)
    }
    if (!involved || !computable) continue
    const kindsHere = [...new Set(lines.map((e) => r.edgeKind.get(e.id)).filter((k): k is string => k !== null && k !== undefined && conserved.has(k)))].sort()
    for (const k of kindsHere) {
      let inSum: Rational = fromInt(0)
      let outSum: Rational = fromInt(0)
      for (const e of lines) {
        if (r.edgeKind.get(e.id) !== k) continue
        // a unit scales only a rate authored as a plain decimal — the engine
        // reads a resolved `@param` (which has no unit) in the base unit, and
        // the balance must be the one the engine runs (engineValues.ts)
        const plain = parseDecimal(rawFlow(e).trim()) !== null
        const fu = plain ? resolveFieldUnit((e.data as { unit?: unknown } | undefined)?.unit, declOf.get(k), time, 'rate') : ({ kind: 'base' } as const)
        const v = fieldRational(authored.get(e.id) ?? '0', fu, time) ?? fromInt(0)
        if (e.target === c) inSum = add(inSum, v)
        else outSum = add(outSum, v)
      }
      if (!equals(inSum, outSum)) {
        const i = displayRational(inSum)
        const o = displayRational(outSum)
        const d = displayRational(sub(outSum, inSum))
        out.push({ cls: 'broken', converterId: c, kind: k, inRate: toDouble(inSum), outRate: toDouble(outSum), inText: i.text, outText: o.text, diffText: d.text, approx: i.approx || o.approx || d.approx, refuses: true })
      }
    }
  }
  return out
}

/** §M4-4 — the Converters whose balance verdict differs between two finding
 *  lists (one before an edit, one after it), by id, ascending: what a unit
 *  change, a step change or a factor change announces before it is applied. */
export function convertersWhoseVerdictChanges(before: readonly KindFinding[], after: readonly KindFinding[]): string[] {
  const broken = (fs: readonly KindFinding[]) => new Set(fs.filter((f) => f.cls === 'broken').map((f) => `${f.converterId}\u0001${f.kind}`))
  const a = broken(before)
  const b = broken(after)
  const changed = new Set<string>()
  for (const key of a) if (!b.has(key)) changed.add(key.split('\u0001')[0]!)
  for (const key of b) if (!a.has(key)) changed.add(key.split('\u0001')[0]!)
  return [...changed].sort()
}

/** The findings that stop a run (D1): those where a conserved kind is
 *  involved, and (§M4-2.5) every field whose engine value is not finite. */
export function refusingKindFindings(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  kinds: readonly ResourceKindDecl[],
  modelVersion: ModelSemanticsVersion,
  time?: DocTime,
): KindFinding[] {
  if (!kinds.some((k) => k.conserved)) return unitRangeFindings(nodes, edges, kinds, time)
  return kindFindings(nodes, edges, kinds, modelVersion, time).filter((f) => f.refuses)
}

/** The engine's English diagnostic for a refusing finding — what `step` reports
 *  to a caller that steps a refused document anyway (the split-rejoin refusal's
 *  posture). The run bars and the Inspector word the same findings from the
 *  data, in the user's language; this text never reaches them. */
export function kindFindingText(f: KindFinding, nodes: readonly LoopNode[], edges: readonly LoopEdge[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const label = (id: string) => byId.get(id)?.data.label ?? id
  const edgeOf = new Map(edges.map((e) => [e.id, e]))
  const conn = (edgeId: string) => {
    const e = edgeOf.get(edgeId)
    return e ? `the connection from "${label(e.source)}" to "${label(e.target)}"` : `connection "${edgeId}"`
  }
  const q = (k: string) => `"${k}"`
  switch (f.cls) {
    case 'conflict': {
      const c = f.conflict
      if (c.kind === 'poolEnds')
        return `Can't run: ${conn(c.edgeId)} joins a ${q(c.kinds[0])} Pool and a ${q(c.kinds[1])} Pool. A connection carries one kind, so nothing moved.`
      if (c.kind === 'annotation')
        return `Can't run: ${conn(c.edgeId)} is marked ${q(c.edgeKind)} on the ${q(c.poolKind)} Pool "${label(c.nodeId)}", so nothing moved.`
      if (c.kind === 'poolNoKind')
        return `Can't run: ${conn(c.edgeId)} is ${q(c.edgeKind)}, but its Pool "${label(c.nodeId)}" has no kind. A conserved kind moves between Pools that declare it, so nothing moved.`
      return `Can't run: Gate "${label(c.nodeId)}" carries ${c.kinds.map(q).join(' and ')}. A Gate carries one kind, so nothing moved.`
    }
    case 'notComputable':
      return f.reason === 'rate'
        ? `Can't run: the rate "${f.rate}" on ${conn(f.edgeId)} is not a number, so the ${f.kind === null ? '' : `${q(f.kind)} `}balance of Converter "${label(f.converterId)}" cannot be computed and nothing moved.`
        : `Can't run: ${conn(f.edgeId)} has no kind, so the balance of Converter "${label(f.converterId)}" cannot be computed and nothing moved.`
    case 'broken':
      return `Can't run: Converter "${label(f.converterId)}" takes in ${f.inText} ${q(f.kind)} and puts out ${f.outText} (out − in ${f.diffText}). A conserved kind must balance, so nothing moved.`
    case 'outOfRange':
      return `Can't run: ${f.edgeId !== null ? conn(f.edgeId) : `Pool "${label(f.nodeId ?? '')}"`} holds ${f.value} ${f.unit}, which is beyond the numbers a run can hold, so nothing moved.`
  }
}

/** docs/module-system.md §MS3.4 under loop-model/3 and /4 — the kinds table of
 *  a host after a module insert: the host's entries, then the module's entries
 *  the host did not declare, in the module's order. On a kind both declare the
 *  host's word wins on `conserved` and the base unit, and (loop-model/4) the
 *  module's units the host does not name join the host's lists, so a field of
 *  the module keeps the unit it was written in. A unit the two declare
 *  differently is a conflict (`kindMergeConflicts`), refused before a merge. */
export function mergeKinds(host: readonly ResourceKindDecl[], mod: readonly ResourceKindDecl[]): ResourceKindDecl[] {
  const modOf = new Map(mod.map((k) => [k.name, k]))
  const have = new Set(host.map((k) => k.name))
  const merged = host.map((h) => {
    const m = modOf.get(h.name)
    if (!m) return h
    const taken = new Set([...(h.baseUnit !== undefined ? [h.baseUnit] : []), ...(h.units ?? []).map((u) => u.name), ...(h.rateUnits ?? []).map((u) => u.name)])
    const units = [...(h.units ?? []), ...(m.units ?? []).filter((u) => !taken.has(u.name))]
    const rateUnits = [...(h.rateUnits ?? []), ...(m.rateUnits ?? []).filter((u) => !taken.has(u.name))]
    return { ...h, ...(units.length > 0 ? { units } : {}), ...(rateUnits.length > 0 ? { rateUnits } : {}) }
  })
  return canonicalKinds([...merged, ...mod.filter((k) => !have.has(k.name))])
}

/** §M4-4 — what a module insert would silently change in a kind both sides
 *  declare, as English sentences (the module-insert refusal posture): two
 *  different base units (the numbers count different amounts), and a unit
 *  name the two declare with a different factor, a different time or in the
 *  other list. Empty ⇒ `mergeKinds` keeps every field's meaning. */
export function kindMergeConflicts(host: readonly ResourceKindDecl[], mod: readonly ResourceKindDecl[]): string[] {
  const hostOf = new Map(host.map((k) => [k.name, k]))
  const out: string[] = []
  const q = (s: string) => `"${s}"`
  for (const m of mod) {
    const h = hostOf.get(m.name)
    if (!h) continue
    if (h.baseUnit !== undefined && m.baseUnit !== undefined && h.baseUnit !== m.baseUnit) {
      out.push(`Kind ${q(m.name)} is counted in ${q(m.baseUnit)} in the structure and in ${q(h.baseUnit)} in this document.`)
    }
    const hostUnit = new Map<string, string>([
      ...(h.baseUnit !== undefined ? [[h.baseUnit, 'the base unit'] as [string, string]] : []),
      ...(h.units ?? []).map((u) => [u.name, `${u.factor}`] as [string, string]),
      ...(h.rateUnits ?? []).map((u) => [u.name, `${u.factor}/${u.per}`] as [string, string]),
    ])
    for (const u of [...(m.units ?? []).map((x) => [x.name, x.factor] as const), ...(m.rateUnits ?? []).map((x) => [x.name, `${x.factor}/${x.per}`] as const)]) {
      const theirs = hostUnit.get(u[0])
      if (theirs !== undefined && theirs !== u[1]) out.push(`Unit ${q(u[0])} of ${q(m.name)} is ${u[1]} in the structure and ${theirs} in this document.`)
    }
  }
  return out
}

/** The node a finding is about (for Show / the Inspector): the Converter, the
 *  Gate, the Pool end of a conflicting connection, or the Pool out of range. */
export function kindFindingNodeId(f: KindFinding): string | null {
  if (f.cls === 'conflict') return f.conflict.kind === 'poolEnds' ? null : f.conflict.nodeId
  if (f.cls === 'outOfRange') return f.nodeId
  return f.converterId
}

/** The connection a finding is about, when it is about one. */
export function kindFindingEdgeId(f: KindFinding): string | null {
  if (f.cls === 'conflict') return f.conflict.kind === 'gateMixes' ? null : f.conflict.edgeId
  if (f.cls === 'outOfRange') return f.edgeId
  return f.cls === 'notComputable' ? f.edgeId : null
}
