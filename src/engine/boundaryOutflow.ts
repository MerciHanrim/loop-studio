// loop-model/3 (SEMANTICS-M3.md §M3-5, L1) — boundary outflow by kind: a
// step's deliveries into Drains and Ends, grouped per kind and per exit node.
// The report names none of it a loss; the Drain's label says what an outflow
// is (permeate to "demand", brine to "outfall", water to "evaporation").
import type { LoopEdge, LoopNode } from '../model/types'
import type { FlowEvent } from './types'

export type BoundaryOutflow = {
  /** the connection's kind (K1), or `null` for a line with none */
  kind: string | null
  /** the Drain or End the amount went into */
  nodeId: string
  /** the sum of this step's deliveries on that kind into that node, rounded to 9 decimals */
  amount: number
}

const EXIT_KINDS = new Set(['drain', 'end'])

/** Deterministic: ascending kind (`null` last), then ascending node id. Only
 *  events whose target is a Drain or an End count; an event into a Pool or a
 *  router is not a boundary. */
export function boundaryOutflowByKind(
  events: readonly FlowEvent[],
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  edgeKind: ReadonlyMap<string, string | null>,
): BoundaryOutflow[] {
  const nodeKind = new Map(nodes.map((n) => [n.id, n.data.kind]))
  const edgeById = new Map(edges.map((e) => [e.id, e]))
  const sums = new Map<string, BoundaryOutflow>()
  for (const ev of events) {
    if (!EXIT_KINDS.has(nodeKind.get(ev.to) ?? '')) continue
    const kind = edgeById.has(ev.edgeId) ? (edgeKind.get(ev.edgeId) ?? null) : null
    const key = `${kind ?? '\u0000'}\u0001${ev.to}`
    const row = sums.get(key) ?? { kind, nodeId: ev.to, amount: 0 }
    row.amount += ev.amount
    sums.set(key, row)
  }
  return [...sums.values()]
    .map((r) => ({ ...r, amount: Math.round(r.amount * 1e9) / 1e9 }))
    .sort((a, b) => {
      if (a.kind === b.kind) return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0
      if (a.kind === null) return 1
      if (b.kind === null) return -1
      return a.kind < b.kind ? -1 : 1
    })
}
