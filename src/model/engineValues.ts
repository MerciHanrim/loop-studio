// loop-model/4 (SEMANTICS-M4.md §M4-2.1) — the graph the engine reads. A
// number field of a declared kind holds its AUTHORED decimal and unit; the
// engine reads the DERIVED value, the nearest double of the exact rational in
// the base unit per step. This pass produces that graph: a Pool's `initial`
// and `capacity` and a resource connection's constant `flow` are replaced by
// their engine values; nothing else changes, and a graph in which no field
// names a unit comes back as the SAME arrays (M4-INV-1: every earlier
// document steps on its own numbers, byte for byte).
import { resolveKinds, type ResourceKindDecl } from './kinds'
import { parseDecimal, plainDecimal } from './rational'
import type { LoopEdge, LoopNode, PoolData, ResourceEdgeData } from './types'
import { engineValue, poolKindName, resolveFieldUnit, type DocTime } from './units'

const hasUnitKey = (data: unknown) => typeof (data as { unit?: unknown } | undefined)?.unit === 'string' && (data as { unit: string }).unit !== ''

/** `true` when any Pool or resource connection names a unit */
export function anyFieldUnit(nodes: readonly LoopNode[], edges: readonly LoopEdge[]): boolean {
  return nodes.some((n) => n.data?.kind === 'pool' && hasUnitKey(n.data)) || edges.some((e) => (e.data?.kind ?? 'resource') === 'resource' && hasUnitKey(e.data))
}

/** §M4-1 — a graph as a document before loop-model/4 means it: every field
 *  `unit` key dropped (the number is the base unit per step). The same arrays
 *  when none carries one. */
export function stripFieldUnits(nodes: LoopNode[], edges: LoopEdge[]): { nodes: LoopNode[]; edges: LoopEdge[] } {
  if (!anyFieldUnit(nodes, edges)) return { nodes, edges }
  const drop = <T extends { data?: unknown }>(x: T): T => {
    if (!hasUnitKey(x.data)) return x
    const { unit: _u, ...rest } = x.data as Record<string, unknown>
    return { ...x, data: rest } as T
  }
  return { nodes: nodes.map((n) => (n.data?.kind === 'pool' ? drop(n) : n)), edges: edges.map((e) => ((e.data?.kind ?? 'resource') === 'resource' ? drop(e) : e)) }
}

/**
 * The engine's view of the graph. With no field unit anywhere, or no kinds
 * table, the input arrays themselves; otherwise copies in which every unit-
 * bearing field carries its engine value. A field whose unit does not resolve
 * (an unknown name, a rate unit on a stock, a per-time unit with no step
 * length) keeps its number: the fail-safe of §M4-2.2.
 */
export function applyUnits(
  nodes: LoopNode[],
  edges: LoopEdge[],
  kinds: readonly ResourceKindDecl[] | undefined,
  time: DocTime | undefined,
): { nodes: LoopNode[]; edges: LoopEdge[] } {
  if (!kinds || kinds.length === 0 || !anyFieldUnit(nodes, edges)) return { nodes, edges }
  const declOf = new Map(kinds.map((k) => [k.name, k]))
  const outNodes = nodes.map((n) => {
    if (n.data?.kind !== 'pool' || !hasUnitKey(n.data)) return n
    const d = n.data as PoolData & { unit?: string }
    const fu = resolveFieldUnit(d.unit, declOf.get(poolKindName(d) ?? ''), time, 'stock')
    if (fu.kind === 'base') return n
    const data: PoolData = { ...d, initial: engineValue(d.initial, fu, time), capacity: d.capacity == null ? d.capacity : engineValue(d.capacity, fu, time) }
    return { ...n, data } as LoopNode
  })
  const res = resolveKinds(nodes, edges)
  const outEdges = edges.map((e) => {
    if ((e.data?.kind ?? 'resource') !== 'resource' || !hasUnitKey(e.data)) return e
    const d = e.data as ResourceEdgeData & { unit?: string }
    const kind = res.edgeKind.get(e.id) ?? null
    if (kind === null) return e
    const fu = resolveFieldUnit(d.unit, declOf.get(kind), time, 'rate')
    if (fu.kind === 'base') return e
    const raw = String(d.flow ?? '1').trim()
    if (parseDecimal(raw) === null) return e // a percent, `all`, a random form, a reference: never converted (D3)
    // plain digits, because `parseFlow` reads no other number and runs what it
    // cannot read as 1: `String` writes an exponent below 1e-6 and from 1e21. A
    // value that is not finite is left as text: the `outOfRange` finding refuses it.
    const value = engineValue(raw, fu, time)
    return { ...e, data: { ...d, flow: Number.isFinite(value) ? plainDecimal(value) : String(value) } } as LoopEdge
  })
  return { nodes: outNodes, edges: outEdges }
}
