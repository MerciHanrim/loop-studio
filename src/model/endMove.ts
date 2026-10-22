// docs/edge-routing.md §ER18 — moving an existing connection's end: to another
// side of the same node, or to another node. ONE check (`endMoveVerdict`) and
// ONE change (`moveEdgeEnds`), shared by every surface that offers it (the
// Inspector's Ends group, the canvas end grips), so the two can never disagree.
//
// A move keeps the connection: its id, kind, direction, handles (the kind
// channel) and every `data` field — amount or condition, resource type,
// colour, line shape and the user's bends. Only the end node and the end's
// side (`data.ports`, canonical: a default side is not stored) change.

import type { EdgePorts, LoopEdge, LoopNode, PortFace } from './types'
import { canonicalPorts, edgePortKind, faceOf, type PortEnd, type PortKind } from './ports'

/** an end: the node it is on and the side of that node */
export type EdgeEnd = { node: string; face: PortFace }
/** the ends a move asks for; an end left out stays where it is */
export type EndMove = { source?: EdgeEnd; target?: EdgeEnd }

/** why a move cannot be made (the reason is shown, never swallowed) */
export type EndMoveReason = 'missing' | 'noInput' | 'noOutput' | 'noPorts' | 'duplicate'

export type EndMoveVerdict =
  | { ok: true; same: boolean; nodeChanged: boolean }
  | { ok: false; reason: EndMoveReason; end: PortEnd; node: string }

const RESOURCE_IN = new Set(['pool', 'gate', 'converter', 'drain', 'end'])
const RESOURCE_OUT = new Set(['source', 'pool', 'gate', 'converter'])
/** loop-model/1 (SEMANTICS-M.md §M1.3) — a Parameter or Register has no ports */
const MODEL = new Set(['parameter', 'register'])

/** whether a node of `kind` has the port a connection of `portKind` needs at
 *  `end`, or why not: the resource ports are the ones each node draws (a Source
 *  has no input, a Drain or End no output); the state ports are on every node
 *  of the flow, none on a Parameter or Register */
export function portRefusal(kind: string | undefined, portKind: PortKind, end: PortEnd): EndMoveReason | null {
  if (kind == null) return 'missing'
  if (MODEL.has(kind)) return 'noPorts'
  if (portKind === 'state') return null
  if (end === 'target') return RESOURCE_IN.has(kind) ? null : 'noInput'
  return RESOURCE_OUT.has(kind) ? null : 'noOutput'
}

/** the drawing rule for "already connected": the same two ends AND the same
 *  stored handles (what xyflow's `addEdge` refuses); sides are not part of it,
 *  so parallel connections that differ in kind are allowed. `except` is the
 *  connection being moved, which never counts against itself. */
export function duplicateOf(edges: LoopEdge[], e: Pick<LoopEdge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>, except?: string): LoopEdge | undefined {
  const same = (a: string | null | undefined, b: string | null | undefined) => a === b || (!a && !b)
  return edges.find((x) => x.id !== except && x.source === e.source && x.target === e.target && same(x.sourceHandle, e.sourceHandle) && same(x.targetHandle, e.targetHandle))
}

/** docs/edge-routing.md §ER15.2 — the repeated Value change groups: two or more
 *  Value changes with the same ends and stored handles (the rule above).
 *  Drawing refuses such a group, but a document may hold one, and in a run its
 *  chips grow side by side. Each group's ids in id order, the groups in the
 *  order of their first id. */
export function repeatedChangeGroups(edges: readonly LoopEdge[]): string[][] {
  const byKey = new Map<string, string[]>()
  for (const e of edges) {
    const d = e.data as { kind?: unknown; mode?: unknown } | undefined
    if (d?.kind !== 'state' || d.mode !== 'label') continue
    const k = JSON.stringify([e.source, e.target, e.sourceHandle || null, e.targetHandle || null])
    ;(byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e.id)
  }
  const ord = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return [...byKey.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort(ord))
    .sort((a, b) => ord(a[0], b[0]))
}

/** the connection after the move (not checked: see `endMoveVerdict`) */
export function movedEdge(e: LoopEdge, move: EndMove): LoopEdge {
  const kind = edgePortKind(e)
  const faces: EdgePorts = {
    source: move.source?.face ?? faceOf(e, 'source'),
    target: move.target?.face ?? faceOf(e, 'target'),
  }
  const ports = canonicalPorts(kind, faces)
  const { ports: _old, ...rest } = (e.data ?? {}) as Record<string, unknown>
  void _old
  return {
    ...e,
    source: move.source?.node ?? e.source,
    target: move.target?.node ?? e.target,
    data: { ...rest, ...(ports ? { ports } : {}) } as LoopEdge['data'],
  }
}

/**
 * Whether `move` can be applied to connection `edgeId`, and if not, why.
 * - Each moved end must land on a node that has the port this connection's
 *   kind needs at that end (no input / no output / no ports otherwise).
 * - When an end changes NODE, the result must not repeat another connection
 *   by the drawing rule (`duplicateOf`), the moved connection excluded. A side
 *   change alone is never a duplicate: the examples hold parallel connections.
 * - The same ends as now: ok and `same` (nothing to record).
 * A self-loop is allowed, as when drawing.
 */
export function endMoveVerdict(nodes: LoopNode[], edges: LoopEdge[], edgeId: string, move: EndMove): EndMoveVerdict {
  const e = edges.find((x) => x.id === edgeId)
  if (!e) return { ok: false, reason: 'missing', end: 'source', node: '' }
  const kindOf = new Map(nodes.map((n) => [n.id, (n.data as { kind?: string } | undefined)?.kind]))
  const portKind = edgePortKind(e)
  for (const end of ['source', 'target'] as const) {
    const to = move[end]
    if (!to) continue
    if (!kindOf.has(to.node)) return { ok: false, reason: 'missing', end, node: to.node }
    if (to.node === e[end]) continue // the node it is on already has this port
    const refusal = portRefusal(kindOf.get(to.node), portKind, end)
    if (refusal) return { ok: false, reason: refusal, end, node: to.node }
  }
  const next = movedEdge(e, move)
  const nodeChanged = next.source !== e.source || next.target !== e.target
  const same = !nodeChanged && faceOf(next, 'source') === faceOf(e, 'source') && faceOf(next, 'target') === faceOf(e, 'target')
  if (nodeChanged && duplicateOf(edges, next, e.id)) {
    return { ok: false, reason: 'duplicate', end: next.source !== e.source ? 'source' : 'target', node: next.source !== e.source ? next.source : next.target }
  }
  return { ok: true, same, nodeChanged }
}
