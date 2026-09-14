// docs/data-import.md §DI-D9 -- Phase 2: the reference scanner a
// delete-with-reference-check needs, which does NOT exist anywhere in this
// codebase today. Verified directly against `graphStore.ts`'s `removeNode`:
// it strips only literal incident edges; nothing scans a Register `expr`, a
// v2 resource-edge `flow`, or a state-edge activator `expr` for an `@id`
// reference before a node is removed. Pure, no store access -- exactly like
// `moduleGraph.ts`'s own dangling-`@ref` check for Extract, which this
// mirrors in spirit but not in code (that check refuses an EXTRACT batch
// atomically; this one reports every reference so the caller can decide).

import { parse, refsOf } from './expr'
import { parseFlow } from '../engine/flow'
import { parseActivatorExpr } from '../engine/stateExpr'
import { readRegisterData } from './model'
import type { LoopEdge, LoopNode } from './types'

/** `register` is the one NODE-carried reference (the Register itself holds
 *  the referencing `expr`). The other three are all EDGE data --
 *  `incident-edge` a plain graph edge, `resource-flow` a v2 resource edge's
 *  `flow`, `activator` a state edge's activator `expr` -- so each of those
 *  three is identified by `edgeId`, never a node id. */
export type NodeReference =
  | { via: 'register'; nodeId: string }
  | { via: 'incident-edge' | 'resource-flow' | 'activator'; edgeId: string }

/** Every reference to `targetId` this app can create, across all four
 *  kinds -- a plain incident edge (the same check `removeNode` already
 *  does when it strips edges, surfaced here instead of silently applied),
 *  a Register `expr` (`parse` + `refsOf`, same as `exprRefs.ts` /
 *  `moduleGraph.ts`'s own dangling-`@ref` check), a v2 resource-edge `flow`
 *  (`parseFlow(flow, 2)` -- a v1 document never treats a leading `@` as a
 *  reference at all, so `modelVersion` must be threaded through), and a
 *  state-edge activator `expr` (`parseActivatorExpr`, whose `param-term`
 *  RHS carries the id directly, no AST to walk). */
export function findReferences(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  modelVersion: 1 | 2,
  targetId: string,
): NodeReference[] {
  const out: NodeReference[] = []

  for (const e of edges) {
    if (e.source === targetId || e.target === targetId) {
      out.push({ via: 'incident-edge', edgeId: e.id })
    }
  }

  for (const n of nodes) {
    if ((n.data as { kind?: string } | undefined)?.kind !== 'register') continue
    const r = readRegisterData(n.data)
    if (!r.ok) continue
    const p = parse(r.data.expr)
    if (!p.ok) continue
    if (refsOf(p.ast).includes(targetId)) out.push({ via: 'register', nodeId: n.id })
  }

  for (const e of edges) {
    if (e.data?.kind === 'resource') {
      const f = parseFlow(e.data.flow, modelVersion)
      if (f.kind === 'param' && f.id === targetId) out.push({ via: 'resource-flow', edgeId: e.id })
    } else if (e.data?.kind === 'state' && e.data.mode === 'activator') {
      const a = parseActivatorExpr(e.data.expr, modelVersion)
      if (a.ok && a.rhs.kind === 'param' && a.rhs.id === targetId) out.push({ via: 'activator', edgeId: e.id })
    }
  }

  return out
}
