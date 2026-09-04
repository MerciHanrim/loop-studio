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
import type { LoopEdge, LoopNode } from './types'

// ── shared shapes ─────────────────────────────────────────────────────────────

export type GraphDocLike = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  modelVersion: ModelSemanticsVersion
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
  /** the host was v1 and the module forced a v1 → v2 promotion (§MS3.4). */
  promotedToV2: boolean
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
    outNodes.push({
      ...n,
      id: idMap.get(n.id)!,
      position: { x: n.position.x + dx, y: n.position.y + dy },
      data,
    })
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

  // 3. model version (§MS3.4) — a v2 module lifts a v1 host.
  const modelVersion: ModelSemanticsVersion = mod.modelVersion === 2 ? 2 : host.modelVersion
  const promotedToV2 = host.modelVersion === 1 && modelVersion === 2

  // 4. build the full candidate, validate it whole, THEN return (§MS3.6 / B4).
  const nodes = [...host.nodes, ...outNodes]
  const edges = [...host.edges, ...outEdges]
  const v = validateResultGraph(nodes, edges)
  if (!v.ok) return { ok: false, reason: `The merged graph is not valid: ${v.reasons.join(' ')}` }
  try {
    canonicalContent({ nodes, edges }, { modelVersion })
  } catch {
    return { ok: false, reason: 'The merged graph holds a non-finite number.' }
  }

  return {
    ok: true,
    nodes,
    edges,
    modelVersion,
    promotedToV2,
    insertedNodeIds: outNodes.map((n) => n.id),
    insertedEdgeIds: outEdges.map((e) => e.id),
    idMap: Object.fromEntries(idMap),
  }
}

// ── extract ───────────────────────────────────────────────────────────────────

export type DanglingRef = { from: string; targetId: string }

export type ExtractOk = {
  ok: true
  nodes: LoopNode[]
  edges: LoopEdge[]
  modelVersion: ModelSemanticsVersion
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

  // positions normalised to origin (§MS2.2).
  const o = topLeft(selNodes)
  const nodes = selNodes.map((n) => ({
    ...n,
    position: { x: n.position.x - o.x, y: n.position.y - o.y },
  }))

  // schema v2 iff a surviving edge carries an `@param` flow (§MS2.2); every
  // referenced Parameter is guaranteed inside the selection (the dangling guard
  // above refused otherwise).
  const modelVersion: ModelSemanticsVersion = selEdges.some(
    (e) => kindOf(e.data) === 'resource' && isParamFlow((e.data as { flow?: unknown }).flow),
  )
    ? 2
    : 1

  return { ok: true, nodes, edges: selEdges, modelVersion }
}
