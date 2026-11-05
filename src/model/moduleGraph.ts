// docs/module-system.md (`MS`) — impl PR 1, step 1: the model layer.
//
// A "module" is a plain Graph JSON (§MS1). Two pure operations:
//
//  - `insertGraph(host, mod, opts)` — merge a module's nodes / edges into a host
//    graph. EVERY module node / edge id is re-issued (§MS3.1 / MS7-1); every
//    internal endpoint, every `register` expr `@ref`, and every v2 `@param` flow
//    is rewritten to the new ids; the module is placed at a drop point; and the
//    WHOLE candidate is validated before anything is returned (§MS3.6 / B4).
//    A v1 host + v2 module ⇒ `promotedToV2` (the store gates consent — §MS3.4).
//
//  - `extractModule(src, selectedIds)` — copy a selection out as a self-contained
//    module. Fully-internal edges only; boundary edges dropped (§MS2.3);
//    positions normalised to origin; NO `recommendedRunConfig`, NO `frames`
//    (§MS2.2). A dangling `@ref` — a kept `register` expr or kept v2 `@param`
//    flow targeting a node OUTSIDE the selection — REFUSES the extract
//    (§MS2.4 / B1); there is no override.
//
// Neither function touches the store, the DOM, `mcStore`, or `frameStore`. The
// caller (a store action / an IO command) owns the atomic transaction, the v2
// consent dialog, the download, and the frames-exclusion notice.

import { canonicalPrint, parse, refsOf } from './expr'
import type { ExprNode } from './expr'
import { nextId } from './factory'
import { canonicalContent, validateResultGraph } from './revision'
import { normalizeGraph } from './serialize'
import type { ModelSemanticsVersion } from './serialize'
import { kindMergeConflicts, kindsDeclareUnits, mergeKinds, type ResourceKindDecl } from './kinds'
import { anyFieldUnit, applyUnits } from './engineValues'
import { normalizeResourceType } from './model/resourceType'
import type { LoopEdge, LoopNode } from './types'
import { stepSeconds, type DocTime } from './units'
import { canonicalTimetable, timetableLines, type Timetable } from './timetable'

// ── shared shapes ─────────────────────────────────────────────────────────────

export type GraphDocLike = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  modelVersion: ModelSemanticsVersion
  /** loop-model/3 (SEMANTICS-M3.md) — the kinds table; absent ⇒ none */
  kinds?: readonly ResourceKindDecl[]
  /** loop-model/4 (SEMANTICS-M4.md §M4-3) — the step length; absent ⇒ none */
  time?: DocTime
  /** loop-model/5 (SEMANTICS-M5.md) — the timetables; absent ⇒ none */
  timetables?: readonly Timetable[]
}

/** Bounding-box top-left of a node set (`{ 0, 0 }` for an empty set). */
function topLeft(ns: LoopNode[]): { x: number; y: number } {
  let x = Infinity
  let y = Infinity
  for (const n of ns) {
    if (n.position.x < x) x = n.position.x
    if (n.position.y < y) y = n.position.y
  }
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 }
}

/** Rebuild an expr AST with every `ref` id remapped through `m`. These are
 *  small, user-authored expressions — plain recursion over the three-way AST
 *  shape from `expr/ast.ts`. An unmapped ref is left as-is; callers check every
 *  ref is in the map first. */
function remapAst(n: ExprNode, m: Map<string, string>): ExprNode {
  switch (n.type) {
    case 'number':
      return n
    case 'ref': {
      const to = m.get(n.id)
      return to === undefined ? n : { type: 'ref', id: to }
    }
    case 'unary':
      return { type: 'unary', op: n.op, operand: remapAst(n.operand, m) }
    case 'binary':
      return { type: 'binary', op: n.op, left: remapAst(n.left, m), right: remapAst(n.right, m) }
  }
}

/** A v2 `flow` is a `loop-expr/1` expression iff it leads with `@`
 *  (`SEMANTICS-M2.md §M2-1.1` — the leading-`@` discriminator). A v1 `flow`
 *  ("1", "all", "2D6", "1-3", "25%") is the engine's own mini-language and is
 *  never parsed or rewritten here. */
const isParamFlow = (flow: unknown): flow is string =>
  typeof flow === 'string' && flow.trimStart().startsWith('@')

const kindOf = (data: unknown): string | undefined =>
  (data as { kind?: unknown } | undefined)?.kind as string | undefined

/**
 * docs/data-import.md §DI9 / §DI-D15 (`loop-revision/8`, SEMANTICS-R8.md) —
 * a data-import Parameter's generating triple (`sourceTableId` / `sourceKey`
 * / `sourceColumnId`) identifies AT MOST ONE active Parameter; copying it
 * (Insert, Extract) must never produce a second node carrying the same
 * triple. Strips the triple AND `labelAutoComposed` together (a "fully
 * ordinary Parameter" — the stated outcome — has neither field) from a
 * `parameter` node's data. No-op for every other node kind, and a no-op
 * (returns the same object) when the node has neither field, so a
 * provenance-free module round-trips through Insert/Extract byte-for-byte
 * unchanged.
 */
function stripDataImportProvenance(n: LoopNode): LoopNode {
  if (kindOf(n.data) !== 'parameter') return n
  const d = n.data as Record<string, unknown>
  if (
    d.sourceTableId === undefined &&
    d.sourceKey === undefined &&
    d.sourceColumnId === undefined &&
    d.labelAutoComposed === undefined
  ) {
    return n
  }
  const { sourceTableId: _t, sourceKey: _k, sourceColumnId: _c, labelAutoComposed: _l, ...rest } = d
  return { ...n, data: rest as LoopNode['data'] }
}

// ── insert ────────────────────────────────────────────────────────────────────

export type InsertOpts = {
  /** world-space point the module's bounding-box top-left should land on — a
   *  drop point, or a viewport-centre point the caller computes. */
  at: { x: number; y: number }
}

export type InsertOk = {
  ok: true
  /** host nodes first (verbatim), then the re-issued module nodes. */
  nodes: LoopNode[]
  edges: LoopEdge[]
  modelVersion: ModelSemanticsVersion
  /** the module lifted the host to a later version (§MS3.4): the version the
   *  result has, or `null` when the host already had it. */
  promotedTo: ModelSemanticsVersion | null
  /** loop-model/3 — the host's kinds table, then the module's kinds the host
   *  did not declare (`mergeKinds`). */
  kinds: ResourceKindDecl[]
  /** loop-model/4 — the host's step length; a host without one adopts the
   *  module's, so the module's per-time fields keep their meaning (§M4-3) */
  time?: DocTime
  /** loop-model/5 — the host's tables, then the module's the host did not hold */
  timetables: Timetable[]
  /** fresh ids of the inserted nodes, in module order (for selection). */
  insertedNodeIds: string[]
  insertedEdgeIds: string[]
  /** old module id → fresh id (diagnostics / tests). */
  idMap: Record<string, string>
}
export type InsertResult = InsertOk | { ok: false; reason: string }

export function insertGraph(host: GraphDocLike, mod: GraphDocLike, opts: InsertOpts): InsertResult {
  const m = normalizeGraph({ nodes: mod.nodes, edges: mod.edges })
  if (m.nodes.length === 0) return { ok: false, reason: 'The module has no nodes.' }

  // 1. a fresh id for every module node + edge (§MS3.1 / MS7-1). `nextId` is
  //    time+seq unique; the loop is a paranoia guard against a host id that was
  //    minted in the same millisecond+seq slot.
  const taken = new Set<string>([...host.nodes.map((n) => n.id), ...host.edges.map((e) => e.id)])
  const idMap = new Map<string, string>()
  for (const n of m.nodes) {
    let id = nextId(n.type ?? kindOf(n.data) ?? 'n')
    while (taken.has(id)) id = nextId(n.type ?? 'n')
    taken.add(id)
    idMap.set(n.id, id)
  }
  const edgeIdMap = new Map<string, string>()
  for (const e of m.edges) {
    let id = nextId('e')
    while (taken.has(id)) id = nextId('e')
    taken.add(id)
    edgeIdMap.set(e.id, id)
  }

  const src = topLeft(m.nodes)
  const dx = opts.at.x - src.x
  const dy = opts.at.y - src.y

  // 2. re-issue + rewrite the module content — in scratch, never in place.
  const outNodes: LoopNode[] = []
  for (const n of m.nodes) {
    let data = n.data
    if (kindOf(data) === 'register') {
      const expr = String((data as { expr?: unknown }).expr ?? '0')
      const r = parse(expr)
      if (!r.ok) return { ok: false, reason: `Register "${n.id}" has an expression that does not parse.` }
      for (const rid of refsOf(r.ast)) {
        if (!idMap.has(rid)) {
          return { ok: false, reason: `Register "${n.id}" references "${rid}", which is not part of the module.` }
        }
      }
      data = { ...data, expr: canonicalPrint(remapAst(r.ast, idMap)) } as LoopNode['data']
    }
    outNodes.push(
      stripDataImportProvenance({
        ...n,
        id: idMap.get(n.id)!,
        position: { x: n.position.x + dx, y: n.position.y + dy },
        data,
      }),
    )
  }

  const outEdges: LoopEdge[] = []
  for (const e of m.edges) {
    const source = idMap.get(e.source)
    const target = idMap.get(e.target)
    if (!source || !target) {
      // `normalizeGraph` keeps every edge; a module that still holds a boundary
      // edge (one endpoint outside the module) is malformed as a module.
      return { ok: false, reason: `Edge "${e.id}" points outside the module.` }
    }
    let data = e.data
    if (kindOf(data) === 'resource' && isParamFlow((data as { flow?: unknown }).flow)) {
      const r = parse(String((data as { flow: string }).flow))
      if (!r.ok) return { ok: false, reason: `Edge "${e.id}" has a flow expression that does not parse.` }
      for (const rid of refsOf(r.ast)) {
        if (!idMap.has(rid)) {
          return { ok: false, reason: `Edge "${e.id}" flow references "${rid}", which is not part of the module.` }
        }
      }
      data = { ...data, flow: canonicalPrint(remapAst(r.ast, idMap)) } as LoopEdge['data']
    }
    outEdges.push({ ...e, id: edgeIdMap.get(e.id)!, source, target, data })
  }

  // 3. model version (§MS3.4) — a module of a later version lifts the host to
  // it; the result is the later of the two, never the host read as v1.
  const modelVersion: ModelSemanticsVersion = Math.max(mod.modelVersion, host.modelVersion) as ModelSemanticsVersion
  const promotedTo = modelVersion > host.modelVersion ? modelVersion : null
  // loop-model/3 — the host's table first; a module's kind the host did not
  // declare joins it (a `/graph/3` module always lifts the host to 3 above).
  // loop-model/4 (SEMANTICS-M4.md §M4-4) — an insert never changes what a
  // field means. A unit both sides declare differently, or a different base
  // unit, refuses; otherwise the module's units join the host's lists.
  const unitConflicts = kindMergeConflicts(host.kinds ?? [], mod.kinds ?? [])
  if (unitConflicts.length > 0) {
    return { ok: false, reason: `The structure was not inserted, because its units differ from this document's: ${unitConflicts.join(' ')}` }
  }
  const kinds = mergeKinds(host.kinds ?? [], mod.kinds ?? [])
  // the step length is a model fact: two different declared step lengths
  // refuse (every rate would move a different amount per step); a side that
  // declares none takes the other's, guarded below
  const hostStep = stepSeconds(host.time)
  const modStep = stepSeconds(mod.time)
  if (hostStep !== undefined && modStep !== undefined && hostStep !== modStep) {
    const say = (t: DocTime) => `${t.step.value} ${t.step.unit}`
    return {
      ok: false,
      reason: `The structure was not inserted, because it was written with a step of ${say(mod.time!)} and this document's step is ${say(host.time!)}: its rates would move a different amount per step. Give both the same step length first.`,
    }
  }
  const time = host.time ?? mod.time
  // loop-model/5 (§M5-7) — a table id names one table: an id both sides hold
  // with different content refuses, because either line would change meaning
  const hostTables = new Map((host.timetables ?? []).map((t) => [t.id, t]))
  const clash = (mod.timetables ?? []).filter((t) => {
    const held = hostTables.get(t.id)
    return held !== undefined && JSON.stringify(canonicalTimetable(held)) !== JSON.stringify(canonicalTimetable(t))
  })
  if (clash.length > 0) {
    return { ok: false, reason: `The structure was not inserted, because this document already holds a different timetable with the same id: ${clash.map((t) => t.id).join(', ')}.` }
  }
  const timetables = [...(host.timetables ?? []), ...(mod.timetables ?? []).filter((t) => !hostTables.has(t.id))]

  // 4. build the full candidate, validate it whole, THEN return (§MS3.6 / B4).
  const nodes = [...host.nodes, ...outNodes]
  const edges = [...host.edges, ...outEdges]
  const v = validateResultGraph(nodes, edges)
  if (!v.ok) return { ok: false, reason: `The merged graph is not valid: ${v.reasons.join(' ')}` }
  // §M4-4 — the backstop: every field's engine value after the insert is the
  // one it had in its own document, the host's and the module's alike (a
  // per-time unit that read as the base unit for want of a step length, a
  // module unit the merge could not keep, …)
  // (the module side is its RE-ISSUED content: fresh ids, `@ref`s rewritten)
  const moved = enginesValuesMoved(
    applyUnits(outNodes, outEdges, mod.kinds, mod.time),
    applyUnits(host.nodes, host.edges, host.kinds, host.time),
    applyUnits(nodes, edges, kinds, time),
    host.nodes.length,
    host.edges.length,
  )
  if (moved.length > 0) {
    return { ok: false, reason: `The structure was not inserted, because it would change what these fields move: ${moved.join(', ')}.` }
  }
  try {
    canonicalContent({ nodes, edges, kinds, time, timetables }, { modelVersion })
  } catch {
    return { ok: false, reason: 'The merged graph holds a non-finite number.' }
  }

  return {
    ok: true,
    nodes,
    edges,
    modelVersion,
    promotedTo,
    kinds,
    ...(time !== undefined ? { time } : {}),
    timetables,
    insertedNodeIds: outNodes.map((n) => n.id),
    insertedEdgeIds: outEdges.map((e) => e.id),
    idMap: Object.fromEntries(idMap),
  }
}

/** §M4-4 — the fields whose engine value differs between their own document
 *  and the merged one, as `label.field` (the merged graph holds the host's
 *  nodes and edges first, then the module's, in order) */
function enginesValuesMoved(
  modAlone: { nodes: LoopNode[]; edges: LoopEdge[] },
  hostAlone: { nodes: LoopNode[]; edges: LoopEdge[] },
  merged: { nodes: LoopNode[]; edges: LoopEdge[] },
  hostNodes: number,
  hostEdges: number,
): string[] {
  const out: string[] = []
  const label = (n: { id: string; data?: unknown }) => String((n.data as { label?: unknown } | undefined)?.label || n.id)
  const nodeOf = (i: number) => (i < hostNodes ? hostAlone.nodes[i] : modAlone.nodes[i - hostNodes])
  merged.nodes.forEach((n, i) => {
    const before = nodeOf(i)?.data as { initial?: unknown; capacity?: unknown } | undefined
    const after = n.data as { initial?: unknown; capacity?: unknown }
    if (n.data?.kind !== 'pool' || !before) return
    if (!Object.is(before.initial, after.initial)) out.push(`${label(n)}.initial`)
    if (!Object.is(before.capacity, after.capacity)) out.push(`${label(n)}.capacity`)
  })
  const edgeOf = (i: number) => (i < hostEdges ? hostAlone.edges[i] : modAlone.edges[i - hostEdges])
  const endLabel = (id: string) => label(merged.nodes.find((n) => n.id === id) ?? { id })
  merged.edges.forEach((e, i) => {
    const before = (edgeOf(i)?.data as { flow?: unknown } | undefined)?.flow
    const after = (e.data as { flow?: unknown } | undefined)?.flow
    if ((e.data?.kind ?? 'resource') === 'resource' && before !== after) out.push(`the connection from ${endLabel(e.source)} to ${endLabel(e.target)}`)
  })
  return out
}

// ── extract ───────────────────────────────────────────────────────────────────

export type DanglingRef = { from: string; targetId: string }

export type ExtractOk = {
  ok: true
  nodes: LoopNode[]
  edges: LoopEdge[]
  modelVersion: ModelSemanticsVersion
  /** loop-model/3 — the source's declared kinds the selection names (`[]` ⇒ no table) */
  kinds: ResourceKindDecl[]
  /** loop-model/4 — the source's step length, when the selection carries units */
  time?: DocTime
  /** loop-model/5 — the tables the selection's lines read, when any */
  timetables?: Timetable[]
}
export type ExtractResult = ExtractOk | { ok: false; reason: string; dangling?: DanglingRef[] }

export function extractModule(src: GraphDocLike, selectedIds: readonly string[]): ExtractResult {
  const g = normalizeGraph({ nodes: src.nodes, edges: src.edges })
  const sel = new Set(selectedIds)
  const selNodes = g.nodes.filter((n) => sel.has(n.id))
  if (selNodes.length === 0) return { ok: false, reason: 'Select at least one node first.' }

  // fully-internal edges only; boundary edges are dropped (§MS2.3).
  const selEdges = g.edges.filter((e) => sel.has(e.source) && sel.has(e.target))

  // a dangling `@ref` refuses the extract (§MS2.4 / B1) — no override.
  const dangling: DanglingRef[] = []
  for (const n of selNodes) {
    if (kindOf(n.data) !== 'register') continue
    const r = parse(String((n.data as { expr?: unknown }).expr ?? '0'))
    if (!r.ok) continue // a malformed expr is a separate problem, not this guard's
    for (const rid of refsOf(r.ast)) if (!sel.has(rid)) dangling.push({ from: n.id, targetId: rid })
  }
  for (const e of selEdges) {
    const flow = (e.data as { flow?: unknown } | undefined)?.flow
    if (kindOf(e.data) !== 'resource' || !isParamFlow(flow)) continue
    const r = parse(flow)
    if (!r.ok) continue
    for (const rid of refsOf(r.ast)) if (!sel.has(rid)) dangling.push({ from: e.id, targetId: rid })
  }
  if (dangling.length > 0) {
    const list = dangling.map((d) => `${d.from} → ${d.targetId}`).join(', ')
    return {
      ok: false,
      dangling,
      reason: `This selection references nodes outside it (${list}). Widen the selection to include them, or deselect the referencing node.`,
    }
  }

  // positions normalised to origin (§MS2.2). §DI-D15 — a module is portable
  // graph data meant for a possibly-different document, so any data-import
  // generating triple is stripped here too (mirrors `insertGraph` above).
  const o = topLeft(selNodes)
  const nodes = selNodes.map((n) =>
    stripDataImportProvenance({
      ...n,
      position: { x: n.position.x - o.x, y: n.position.y - o.y },
    }),
  )

  // schema v2 iff a surviving edge carries an `@param` flow (§MS2.2); every
  // referenced Parameter is guaranteed inside the selection (the dangling guard
  // above refused otherwise).
  const hasParamFlow = selEdges.some(
    (e) => kindOf(e.data) === 'resource' && isParamFlow((e.data as { flow?: unknown }).flow),
  )
  // loop-model/3 — the source's declared kinds that the selection names (a
  // Pool's `resourceType`, a connection's annotation) travel with it; a
  // module with a table is a `/graph/3` file (§M3-1).
  const named = new Set<string>()
  for (const n of nodes) {
    const rt = normalizeResourceType((n.data as { resourceType?: unknown }).resourceType).value
    if (rt !== null) named.add(rt)
  }
  for (const e of selEdges) {
    const rt = normalizeResourceType((e.data as { resourceType?: unknown } | undefined)?.resourceType).value
    if (rt !== null) named.add(rt)
  }
  const kinds = (src.kinds ?? []).filter((k) => named.has(k.name))
  // loop-model/4 — a selection whose kinds declare units or whose fields name
  // one, or whose document declares a step length, is a `/graph/4` file
  // (§M4-1); the step length is a model fact and travels with it, so an
  // insert can tell when the two step lengths differ (§M4-4)
  const units = kindsDeclareUnits(kinds) || anyFieldUnit(nodes, selEdges) || src.time !== undefined
  // loop-model/5 — the tables the selection's lines read travel with them
  const read = new Set(timetableLines(selEdges).map((l) => l.tableId))
  const timetables = (src.timetables ?? []).filter((t) => read.has(t.id))
  const modelVersion: ModelSemanticsVersion = timetables.length > 0 ? 5 : units ? 4 : kinds.length > 0 ? 3 : hasParamFlow ? 2 : 1
  const time = units ? src.time : undefined

  return { ok: true, nodes, edges: selEdges, modelVersion, kinds, ...(time !== undefined ? { time } : {}), ...(timetables.length > 0 ? { timetables } : {}) }
}
