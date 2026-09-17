import { beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { __resetRouteCache, __routeGenCount, currentRouteMap } from './routeMap'

// docs/edge-routing.md §ER3.8 — the route map is keyed on the routing INPUT
// (quantised bounds + the orthogonal edge set), never on array identity alone:
// a `select` change or any other non-geometric replacement keeps the
// generation; a move, a resize, a route toggle or a waypoint edit rebuilds.

const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const edge = (id: string, source: string, target: string, extra: Record<string, unknown> = {}): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal', ...extra } }) as unknown as LoopEdge

const base = () => ({
  nodes: [node('a', 0, 0), node('b', 400, 0), node('o', 200, -300)],
  edges: [edge('e', 'a', 'b')],
})

beforeEach(() => __resetRouteCache())

describe('currentRouteMap — cache key', () => {
  it('a new array with the same layout reuses the generation (a select change)', () => {
    const { nodes, edges } = base()
    const m1 = currentRouteMap(nodes, edges)
    const g = __routeGenCount()
    const selected = nodes.map((n, i) => (i === 0 ? { ...n, selected: true } : n)) // what applyNodeChanges does
    const m2 = currentRouteMap(selected, edges)
    expect(m2).toBe(m1)
    expect(__routeGenCount()).toBe(g)
    // and the adopted identity is a fast-path hit afterwards
    expect(currentRouteMap(selected, edges)).toBe(m1)
    expect(__routeGenCount()).toBe(g)
  })

  it('a moved node, a resized node, a route toggle and a waypoint edit each rebuild', () => {
    const { nodes, edges } = base()
    currentRouteMap(nodes, edges)
    const g = __routeGenCount()
    currentRouteMap(nodes.map((n) => (n.id === 'o' ? { ...n, position: { x: 200, y: -10 } } : n)), edges)
    expect(__routeGenCount()).toBe(g + 1)
    currentRouteMap(nodes.map((n) => (n.id === 'o' ? { ...n, measured: { width: 300, height: 300 } } : n)), edges)
    expect(__routeGenCount()).toBe(g + 2)
    currentRouteMap(nodes, [edge('e', 'a', 'b', { route: undefined })])
    expect(__routeGenCount()).toBe(g + 3)
    currentRouteMap(nodes, [edge('e', 'a', 'b', { waypoints: [{ x: 200, y: 80 }] })])
    expect(__routeGenCount()).toBe(g + 4)
  })

  it('a rebuild from scratch equals the reused generation, route for route', () => {
    const { nodes, edges } = base()
    const m1 = currentRouteMap(nodes, edges)
    const again = currentRouteMap([...nodes], edges) // same layout, new identity
    expect(again).toBe(m1)
    __resetRouteCache()
    const cold = currentRouteMap(nodes, edges)
    expect([...cold.entries()].map(([id, r]) => [id, r.d])).toEqual([...m1.entries()].map(([id, r]) => [id, r.d]))
  })
})
