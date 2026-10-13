// docs/edge-routing.md §ER19 — reversing an existing connection's direction:
// the source becomes the target and the target the source. ONE check
// (`reverseVerdict`) and ONE change (`reversedEdge`, through the store's
// `reverseEdge`), as for moving an end (§ER18).
//
// A reversal keeps the connection: its id, kind, handles (the kind channel)
// and every `data` field — amount or condition, mode, timing, delay, resource
// type, colour, line shape. The two ends swap, each end keeps the side of the
// node it is on (so the sides swap with the ends), and the user's bends keep
// their points in reverse order. The same text is then read in the new
// direction.

import type { LoopEdge, LoopNode } from './types'
import { canonicalPorts, edgePortKind, faceOf, type PortEnd } from './ports'
import { duplicateOf, portRefusal, type EndMoveReason } from './endMove'
import { classifyLabelTiming, ROUTER_KINDS } from '../engine/stateExpr'

/** why a reversal cannot be made: an end-move reason (ports, a repeat), or the
 *  state rule the engine would break in the new direction (SEMANTICS-S.md §S4,
 *  §S5, SEMANTICS-S3.md §S3-5), which this action refuses rather than leave a
 *  connection with no effect. The engine rules themselves are unchanged. */
export type ReverseReason =
  | EndMoveReason
  | 'activatorSource' // an activator needs a Pool source
  | 'labelPool' // an "Always" label needs a Pool at both ends
  | 'labelRouterSource' // a "When the source fires" label needs a Gate, Converter, Drain or End source
  | 'labelTarget' // a "When the source fires" label needs a Pool target
  | 'stateMode' // a mode or timing that never has an effect

export type ReverseVerdict =
  | { ok: true; same: boolean; nodeChanged: boolean }
  | { ok: false; reason: ReverseReason; end: PortEnd; node: string }

const KNOWN_STATE_MODES = new Set(['trigger', 'activator', 'label'])

/** the connection reversed (not checked: see `reverseVerdict`) */
export function reversedEdge(e: LoopEdge): LoopEdge {
  const kind = edgePortKind(e)
  const ports = canonicalPorts(kind, { source: faceOf(e, 'target'), target: faceOf(e, 'source') })
  const { ports: _old, ...rest } = (e.data ?? {}) as Record<string, unknown>
  void _old
  const data: Record<string, unknown> = { ...rest, ...(ports ? { ports } : {}) }
  if (Array.isArray(data.waypoints)) data.waypoints = [...(data.waypoints as unknown[])].reverse()
  return { ...e, source: e.target, target: e.source, data: data as LoopEdge['data'] }
}

/** the state rule a state connection with these ends breaks, in the engine's
 *  own order, or null */
function stateRefusal(e: LoopEdge, kindOf: (id: string) => string | undefined): { reason: ReverseReason; end: PortEnd } | null {
  const d = (e.data ?? {}) as { mode?: unknown; timing?: unknown; when?: unknown }
  if (typeof d.mode !== 'string' || !KNOWN_STATE_MODES.has(d.mode)) return { reason: 'stateMode', end: 'source' }
  if (d.mode === 'activator') return kindOf(e.source) === 'pool' ? null : { reason: 'activatorSource', end: 'source' }
  if (d.mode === 'label') {
    const timing = classifyLabelTiming(d.timing, d.when)
    if (timing === 'unsupported') return { reason: 'stateMode', end: 'source' }
    if (timing === 'afterPull') {
      const s = kindOf(e.source)
      if (!s || !ROUTER_KINDS.has(s)) return { reason: 'labelRouterSource', end: 'source' }
      return kindOf(e.target) === 'pool' ? null : { reason: 'labelTarget', end: 'target' }
    }
    if (kindOf(e.source) !== 'pool') return { reason: 'labelPool', end: 'source' }
    return kindOf(e.target) === 'pool' ? null : { reason: 'labelPool', end: 'target' }
  }
  return null // a trigger pulses any node
}

/**
 * Whether connection `edgeId` can be reversed, and if not, why — judged on the
 * RESULT, so a connection without effect today that would work reversed is
 * accepted. In this order (one reason shown):
 * - the new source needs an output and the new target an input (as drawing);
 * - the result must not repeat another connection by the drawing rule;
 * - a state connection must not break its mode's or timing's rule.
 * Resource rules that are not about ports (a loop of Gates and Converters with
 * no Pool, a probabilistic Gate's branch weights) are left to the engine's
 * existing warnings (Lumi, 2026-10-14).
 * A self-loop keeps its node: only its sides swap (no run reset); with one
 * side and at most one bend nothing changes (`same`).
 */
export function reverseVerdict(nodes: LoopNode[], edges: LoopEdge[], edgeId: string): ReverseVerdict {
  const e = edges.find((x) => x.id === edgeId)
  if (!e) return { ok: false, reason: 'missing', end: 'source', node: '' }
  const kinds = new Map(nodes.map((n) => [n.id, (n.data as { kind?: string } | undefined)?.kind]))
  const kindOf = (id: string) => kinds.get(id)
  for (const id of [e.source, e.target]) if (!kinds.has(id)) return { ok: false, reason: 'missing', end: id === e.source ? 'source' : 'target', node: id }
  const portKind = edgePortKind(e)
  const next = reversedEdge(e)
  for (const end of ['source', 'target'] as const) {
    const refusal = portRefusal(kindOf(next[end]), portKind, end)
    if (refusal) return { ok: false, reason: refusal, end, node: next[end] }
  }
  const nodeChanged = e.source !== e.target
  if (nodeChanged && duplicateOf(edges, next, e.id)) return { ok: false, reason: 'duplicate', end: 'source', node: next.source }
  if (portKind === 'state') {
    const s = stateRefusal(next, kindOf)
    if (s) return { ok: false, reason: s.reason, end: s.end, node: next[s.end] }
  }
  const bends = (e.data as { waypoints?: unknown[] } | undefined)?.waypoints?.length ?? 0
  const same = !nodeChanged && faceOf(e, 'source') === faceOf(e, 'target') && bends <= 1
  return { ok: true, same, nodeChanged }
}
