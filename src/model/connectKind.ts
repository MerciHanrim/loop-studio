// The workbench (2026-10, step 5; Lumi's direction B) — a connection's KIND is
// chosen explicitly, never inferred from which handle took a press. A face's
// port point decides only WHERE a connection attaches; the kind comes from the
// tool row's connection choice (uiStore.connectKind), in the product's words:
//   flow       a resource moves               (resource connection)
//   condition  the source's value turns the   (state, `activator`)
//              target on or off
//   change     the source adds to or sets a   (state, `label`)
//              value
//   trigger    the source's firing makes the  (state, `trigger`)
//              target fire
// `trigger` has no workbench word yet (the mock-up folded it into "change",
// which it is not); its word is PROVISIONAL, to be decided (2026-10-19).
// Without it a state connection between, say, a Gate and a Pool could no
// longer be drawn at all (a condition needs a Pool source, a change Pools at
// both ends) — it was what every drawn state connection used to be.
//
// ONE check (`connectVerdict`) decides whether a connection of the chosen kind
// can be made between two nodes, with the reason when not — the same port
// rules an end move uses (./endMove `portRefusal`, the drawing rule for "already
// connected"), and the state rules a reversal uses (./reverse `stateRefusal`).
// A refused drawing is refused, said, and never made as another kind.

import type { EdgePorts, LoopEdge, LoopEdgeData, LoopNode } from './types'
import { baseHandleId, canonicalPorts, edgePortKind, faceOf, faceOfHandle, type PortEnd, type PortKind } from './ports'
import { duplicateOf, portRefusal, type EndMoveReason } from './endMove'
import { stateRefusal } from './reverse'

export type ConnectKind = 'flow' | 'condition' | 'change' | 'trigger'
export const CONNECT_KINDS: readonly ConnectKind[] = ['flow', 'condition', 'change', 'trigger']

/** the port kind a connection kind rides */
export const portKindOf = (k: ConnectKind): PortKind => (k === 'flow' ? 'resource' : 'state')

/** the kind an existing connection is, in the same words, or null for a state
 *  connection whose mode is unknown (a legacy mode) */
export function connectKindOf(e: Pick<LoopEdge, 'data' | 'sourceHandle' | 'targetHandle'>): ConnectKind | null {
  if (edgePortKind(e) === 'resource') return 'flow'
  const mode = (e.data as { mode?: unknown } | undefined)?.mode
  return mode === 'activator' ? 'condition' : mode === 'label' ? 'change' : mode === 'trigger' ? 'trigger' : null
}

const MODE_OF: Record<Exclude<ConnectKind, 'flow'>, string> = { condition: 'activator', change: 'label', trigger: 'trigger' }

/** what a connection of a kind starts with (the fields its kind reads) */
export function kindData(k: ConnectKind): LoopEdgeData {
  if (k === 'flow') return { kind: 'resource', flow: '1' } as LoopEdgeData
  return { kind: 'state', mode: MODE_OF[k], expr: '' } as LoopEdgeData
}

/** why a connection of the chosen kind cannot be made: a port reason, a repeat,
 *  or the state rule of its kind */
export type ConnectReason =
  | EndMoveReason
  | 'conditionSource' // a condition needs a Pool as its source
  | 'changePool' // a value change applied always needs a Pool at both ends
  | 'changeRouterSource' // one applied when the source fires needs a Gate, Converter, Drain or End source
  | 'changeTarget' // … and a Pool target
  | 'stateMode' // a kept timing that never has an effect

export type ConnectVerdict = { ok: true } | { ok: false; reason: ConnectReason; end: PortEnd; node: string }

/** a drawing's two ends: the nodes and the DOM handles it went from and to */
export type ConnectEnds = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

/** the connection a drawing of kind `k` makes (not checked: see `connectVerdict`):
 *  the kind's own handles (the kind channel), the faces the drawing used —
 *  each handle's own face, so a face point is a position only — stored
 *  canonically, and a routed line (§ER14.1) */
export function drawnEdge(id: string, k: ConnectKind, c: ConnectEnds): LoopEdge {
  const pk = portKindOf(k)
  const faces: EdgePorts = { source: faceOfHandle(c.sourceHandle, 'source', pk), target: faceOfHandle(c.targetHandle, 'target', pk) }
  const ports = canonicalPorts(pk, faces)
  return {
    id,
    source: c.source,
    target: c.target,
    sourceHandle: baseHandleId(pk, 'source'),
    targetHandle: baseHandleId(pk, 'target'),
    type: 'loop',
    data: { ...kindData(k), route: 'orthogonal', ...(ports ? { ports } : {}) } as LoopEdgeData,
  }
}

/** whether a connection of kind `k` can be drawn between these ends, and if
 *  not, why (one reason, in this order: the source's port, the target's port,
 *  the kind's state rule, a repeat) */
export function connectVerdict(nodes: LoopNode[], edges: LoopEdge[], k: ConnectKind, c: ConnectEnds): ConnectVerdict {
  return verdictOf(nodes, edges, k, drawnEdge('', k, c))
}

/** the verdict on connection `e` as kind `k` — a new drawing, or an existing
 *  connection changed to `k` with what the change keeps (its expression and
 *  timing among them: a Value change applied when the source fires may start
 *  at a Gate, an always-applied one may not) */
function verdictOf(nodes: LoopNode[], edges: LoopEdge[], k: ConnectKind, e: LoopEdge, opts: { duplicates?: boolean } = {}): ConnectVerdict {
  const kindOf = (id: string) => nodes.find((n) => n.id === id)?.type
  const pk = portKindOf(k)
  const c = { source: e.source, target: e.target }
  const s = portRefusal(kindOf(c.source), pk, 'source')
  if (s) return { ok: false, reason: s, end: 'source', node: c.source }
  const t = portRefusal(kindOf(c.target), pk, 'target')
  if (t) return { ok: false, reason: t, end: 'target', node: c.target }
  if (pk === 'state') {
    const r = stateRefusal(e, kindOf)
    if (r) {
      const reason: ConnectReason =
        r.reason === 'activatorSource' ? 'conditionSource' : r.reason === 'labelRouterSource' ? 'changeRouterSource' : r.reason === 'labelTarget' ? 'changeTarget' : r.reason === 'labelPool' ? 'changePool' : 'stateMode'
      return { ok: false, reason, end: r.end, node: r.end === 'source' ? c.source : c.target }
    }
  }
  if (opts.duplicates !== false && duplicateOf(edges, e)) return { ok: false, reason: 'duplicate', end: 'target', node: c.target }
  return { ok: true }
}

/** an existing connection changed to kind `k` (not checked: see
 *  `kindChangeVerdict`): the kind's own handles, the fields of the kind, and
 *  everything about its line kept — route, bends, colour, and the faces it
 *  actually uses (re-stored canonically for the new kind) */
export function rekindedEdge(e: LoopEdge, k: ConnectKind): LoopEdge {
  const pk = portKindOf(k)
  const faces: EdgePorts = { source: faceOf(e, 'source'), target: faceOf(e, 'target') }
  const ports = canonicalPorts(pk, faces)
  const old = (e.data ?? {}) as Record<string, unknown>
  const keep: Record<string, unknown> = {}
  for (const key of ['route', 'waypoints', 'accent'] as const) if (old[key] !== undefined) keep[key] = old[key]
  // a state connection kept within state keeps its expression and timing
  if (pk === 'state' && old.kind === 'state') for (const key of ['expr', 'timing', 'when', 'delay'] as const) if (old[key] !== undefined) keep[key] = old[key]
  // a flow kept as flow keeps its amount and resource type
  if (pk === 'resource' && old.kind === 'resource') for (const key of ['flow', 'resourceType'] as const) if (old[key] !== undefined) keep[key] = old[key]
  return {
    ...e,
    sourceHandle: baseHandleId(pk, 'source'),
    targetHandle: baseHandleId(pk, 'target'),
    data: { ...kindData(k), ...keep, ...(ports ? { ports } : {}) } as LoopEdgeData,
  }
}

/** whether connection `edgeId` can become kind `k`, and if not, why (the same
 *  rules as drawing it, the connection itself not counting as a repeat) */
export function kindChangeVerdict(nodes: LoopNode[], edges: LoopEdge[], edgeId: string, k: ConnectKind): ConnectVerdict {
  const e = edges.find((x) => x.id === edgeId)
  if (!e) return { ok: false, reason: 'missing', end: 'source', node: edgeId }
  // judged as it would BE: the kind's handles with what the change keeps
  const next = rekindedEdge(e, k)
  // "already connected" is the drawing rule on the stored HANDLES (./endMove
  // `duplicateOf`), whatever the mode. A change between the state kinds keeps
  // the handles, so it makes no repeat that was not there before — as an end
  // move that changes only a side is never a duplicate (docs/edge-routing.md
  // §ER18): a document may hold two parallel state connections (2026-10-20:
  // each refused every change because of the other). Only a change that
  // rewrites the handles (flow ↔ state) is checked, against the others.
  const handlesChange = next.sourceHandle !== e.sourceHandle || next.targetHandle !== e.targetHandle
  return verdictOf(nodes, edges.filter((x) => x.id !== edgeId), k, next, { duplicates: handlesChange })
}
