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
import type { ModelSemanticsVersion } from './modelVersion'
import type { LoopEdge, LoopNode } from './types'

// ── the kinds table ───────────────────────────────────────────────────────

export type ResourceKindDecl = {
  /** the kind's name — a `resourceType` as §M4.1 identifies it (trim + NFC) */
  name: string
  /** C1 — opt-in: every Converter recipe balances in this kind */
  conserved: boolean
  /** U1 stage 1 — the base unit's label (`m³`, `kWh`); the input unit. Display only. */
  baseUnit?: string
}

export const KIND_BASE_UNIT_MAX_BYTES = 32

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
    const o = entry as { name?: unknown; conserved?: unknown; baseUnit?: unknown }
    const name = normalizeResourceType(o.name).value
    if (name === null || seen.has(name)) continue
    seen.add(name)
    const decl: ResourceKindDecl = { name, conserved: o.conserved === true }
    if (typeof o.baseUnit === 'string') {
      const unit = trimUnicodeWhitespace(o.baseUnit).normalize('NFC')
      if (unit !== '' && utf8Len(unit) <= KIND_BASE_UNIT_MAX_BYTES) decl.baseUnit = unit
    }
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
  /** a Gate whose connections carry two or more determined kinds */
  | { kind: 'gateMixes'; nodeId: string; kinds: string[] }

export type KindResolution = {
  /** every resource connection → its kind, or `null` when undetermined */
  edgeKind: Map<string, string | null>
  how: Map<string, KindHow>
  /** every Gate → the determined kinds among its connections, sorted */
  gateKinds: Map<string, string[]>
  /** in a stable order: Pool-end and annotation conflicts by edge id, then Gates by node id */
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
  /** a Converter whose computable balance in a conserved kind differs */
  | { cls: 'broken'; converterId: string; kind: string; inRate: number; outRate: number; refuses: boolean }

export const KIND_BALANCE_EPSILON = 1e-9

const rawFlow = (e: LoopEdge) => String((e.data as { flow?: unknown } | undefined)?.flow ?? '1')
const numeric = (fx: FlowExpr | undefined): number | null => (fx && fx.kind === 'const' && Number.isFinite(fx.value) ? fx.value : null)

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
 */
export function kindFindings(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  kinds: readonly ResourceKindDecl[],
  modelVersion: ModelSemanticsVersion,
): KindFinding[] {
  const conserved = conservedKinds(kinds)
  const r = resolveKinds(nodes, edges)
  const out: KindFinding[] = []
  for (const c of r.conflicts) {
    const ks = c.kind === 'poolEnds' ? c.kinds : c.kind === 'annotation' ? [c.edgeKind, c.poolKind] : c.kinds
    out.push({ cls: 'conflict', conflict: c, refuses: ks.some((k) => conserved.has(k)) })
  }
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
    for (const e of lines) {
      const k = r.edgeKind.get(e.id) ?? null
      const fx = flowOf.get(e.id) ?? parseFlow(rawFlow(e), modelVersion)
      if (numeric(fx) === null) {
        out.push({ cls: 'notComputable', converterId: c, edgeId: e.id, reason: 'rate', rate: rawFlow(e).trim(), kind: k, refuses: involved })
        computable = false
      } else if (k === null && involved) {
        out.push({ cls: 'notComputable', converterId: c, edgeId: e.id, reason: 'noKind', rate: rawFlow(e).trim(), kind: null, refuses: true })
        computable = false
      }
    }
    if (!involved || !computable) continue
    const kindsHere = [...new Set(lines.map((e) => r.edgeKind.get(e.id)).filter((k): k is string => k !== null && k !== undefined && conserved.has(k)))].sort()
    for (const k of kindsHere) {
      let inRate = 0
      let outRate = 0
      for (const e of lines) {
        if (r.edgeKind.get(e.id) !== k) continue
        const v = numeric(flowOf.get(e.id)) ?? 0
        if (e.target === c) inRate += v
        else outRate += v
      }
      if (Math.abs(inRate - outRate) > KIND_BALANCE_EPSILON) out.push({ cls: 'broken', converterId: c, kind: k, inRate, outRate, refuses: true })
    }
  }
  return out
}

/** The findings that stop a run (D1): those where a conserved kind is involved. */
export function refusingKindFindings(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  kinds: readonly ResourceKindDecl[],
  modelVersion: ModelSemanticsVersion,
): KindFinding[] {
  if (!kinds.some((k) => k.conserved)) return []
  return kindFindings(nodes, edges, kinds, modelVersion).filter((f) => f.refuses)
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
      return `Can't run: Gate "${label(c.nodeId)}" carries ${c.kinds.map(q).join(' and ')}. A Gate carries one kind, so nothing moved.`
    }
    case 'notComputable':
      return f.reason === 'rate'
        ? `Can't run: the rate "${f.rate}" on ${conn(f.edgeId)} is not a number, so the ${f.kind === null ? '' : `${q(f.kind)} `}balance of Converter "${label(f.converterId)}" cannot be computed and nothing moved.`
        : `Can't run: ${conn(f.edgeId)} has no kind, so the balance of Converter "${label(f.converterId)}" cannot be computed and nothing moved.`
    case 'broken':
      return `Can't run: Converter "${label(f.converterId)}" takes in ${f.inRate} ${q(f.kind)} and puts out ${f.outRate}. A conserved kind must balance, so nothing moved.`
  }
}

/** docs/module-system.md §MS3.4 under loop-model/3 — the kinds table of a host
 *  after a module insert: the host's entries as they are, then the module's
 *  entries the host did not declare, in the module's order. The host's word on
 *  a kind both declare wins. */
export function mergeKinds(host: readonly ResourceKindDecl[], mod: readonly ResourceKindDecl[]): ResourceKindDecl[] {
  const have = new Set(host.map((k) => k.name))
  return canonicalKinds([...host, ...mod.filter((k) => !have.has(k.name))])
}

/** The node a finding is about (for Show / the Inspector): the Converter, the
 *  Gate, or the Pool end of a conflicting connection. */
export function kindFindingNodeId(f: KindFinding): string | null {
  if (f.cls === 'conflict') return f.conflict.kind === 'poolEnds' ? null : f.conflict.nodeId
  return f.converterId
}

/** The connection a finding is about, when it is about one. */
export function kindFindingEdgeId(f: KindFinding): string | null {
  if (f.cls === 'conflict') return f.conflict.kind === 'gateMixes' ? null : f.conflict.edgeId
  return f.cls === 'notComputable' ? f.edgeId : null
}
