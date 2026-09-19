import { beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { __resetRouteCache, __routeGenCount, currentRouteMap, layoutSignature } from './routeMap'

// docs/edge-routing.md §ER3.8 — the route map is keyed on the routing INPUT
// (the layout signature), never on array identity alone: a `select` change or
// any other non-geometric replacement keeps the generation; anything the router
// reads — a move, a resize, a visibility change, a route toggle, an endpoint /
// handle / waypoint edit, an added or removed node or edge — rebuilds. A reused
// generation is the same routes a cold rebuild would produce.

const node = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): LoopNode =>
  ({
    id,
    type: 'pool',
    position: { x, y },
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
    ...extra,
  }) as unknown as LoopNode
const edge = (id: string, source: string, target: string, extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}): LoopEdge =>
  ({
    id,
    type: 'loop',
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    data: { kind: 'resource', flow: '1', route: 'orthogonal', ...extra },
    ...top,
  }) as unknown as LoopEdge

/** s → t with an obstacle `o` above the corridor, plus a plain (non-orthogonal) edge */
const base = () => ({
  nodes: [node('s', 0, 0), node('t', 400, 0), node('o', 200, -300)],
  edges: [edge('e', 's', 't'), edge('plain', 't', 's', { route: undefined })],
})
const routes = (m: ReadonlyMap<string, { d: string; hitD: string; routeClass: string }>) =>
  [...m.entries()].map(([id, r]) => [id, r.d, r.hitD, r.routeClass])

beforeEach(() => __resetRouteCache())

describe('currentRouteMap — same layout reuses the generation', () => {
  it('a select change (a new nodes array, same geometry) keeps the map and the generation count', () => {
    const { nodes, edges } = base()
    const m1 = currentRouteMap(nodes, edges)
    const g = __routeGenCount()
    const selected = nodes.map((n, i) => (i === 0 ? { ...n, selected: true } : n)) // what applyNodeChanges returns
    expect(currentRouteMap(selected, edges)).toBe(m1)
    expect(__routeGenCount()).toBe(g)
    // the adopted identity is a fast-path hit afterwards
    expect(currentRouteMap(selected, edges)).toBe(m1)
    expect(__routeGenCount()).toBe(g)
  })

  it('other non-layout fields do not rebuild either: dragging flag, label / value edits, className, a plain-edge edit, re-created arrays', () => {
    const { nodes, edges } = base()
    const m1 = currentRouteMap(nodes, edges)
    const g = __routeGenCount()
    const variants: [LoopNode[], LoopEdge[]][] = [
      [nodes.map((n) => ({ ...n, dragging: true })), edges],
      [nodes.map((n) => ({ ...n, data: { ...n.data, label: `${n.id} renamed`, initial: 42 } })), edges],
      [nodes.map((n) => ({ ...n, className: 'lgr-deemph' })) as LoopNode[], edges],
      [nodes, edges.map((e) => (e.id === 'plain' ? ({ ...e, data: { ...e.data, flow: '7' } } as LoopEdge) : e))],
      [[...nodes], [...edges]],
    ]
    for (const [ns, es] of variants) {
      expect(currentRouteMap(ns, es)).toBe(m1)
      expect(__routeGenCount()).toBe(g)
    }
  })
})

describe('currentRouteMap — every layout change rebuilds', () => {
  const cases: [string, (n: LoopNode[], e: LoopEdge[]) => [LoopNode[], LoopEdge[]]][] = [
    ['a node moves', (n, e) => [n.map((x) => (x.id === 'o' ? { ...x, position: { x: 200, y: -10 } } : x)), e]],
    ['a node is measured at a new size', (n, e) => [n.map((x) => (x.id === 'o' ? { ...x, measured: { width: 300, height: 300 } } : x)), e]],
    ['a node gets an explicit width / height', (n, e) => [n.map((x) => (x.id === 'o' ? { ...x, width: 10, height: 10 } : x)), e]],
    ['a node is hidden', (n, e) => [n.map((x) => (x.id === 'o' ? { ...x, hidden: true } : x)), e]],
    ['a node is added', (n, e) => [[...n, node('p', 200, 100)], e]],
    ['a node is removed', (n, e) => [n.filter((x) => x.id !== 'o'), e]],
    ['an orthogonal edge becomes plain', (n, e) => [n, e.map((x) => (x.id === 'e' ? edge('e', 's', 't', { route: undefined }) : x))]],
    ['a plain edge becomes orthogonal', (n, e) => [n, e.map((x) => (x.id === 'plain' ? edge('plain', 't', 's') : x))]],
    ['an edge changes its target', (n, e) => [n, e.map((x) => (x.id === 'e' ? edge('e', 's', 'o') : x))]],
    ['an edge changes a handle', (n, e) => [n, e.map((x) => (x.id === 'e' ? edge('e', 's', 't', {}, { sourceHandle: 'state-source' }) : x))]],
    ['a waypoint is added', (n, e) => [n, e.map((x) => (x.id === 'e' ? edge('e', 's', 't', { waypoints: [{ x: 200, y: 80 }] }) : x))]],
    ['a waypoint moves', (n, e) => [n, e.map((x) => (x.id === 'e' ? edge('e', 's', 't', { waypoints: [{ x: 200, y: 120 }] }) : x))]],
    ['an orthogonal edge is added', (n, e) => [n, [...e, edge('e2', 's', 'o')]]],
    ['an orthogonal edge is removed', (n, e) => [n, e.filter((x) => x.id !== 'e')]],
  ]
  for (const [name, mutate] of cases) {
    it(name, () => {
      const { nodes, edges } = base()
      const m1 = currentRouteMap(nodes, edges)
      const g = __routeGenCount()
      const [ns, es] = mutate(nodes, edges)
      expect(layoutSignature(ns, es)).not.toBe(layoutSignature(nodes, edges))
      const m2 = currentRouteMap(ns, es)
      expect(__routeGenCount()).toBe(g + 1)
      expect(m2).not.toBe(m1)
    })
  }
  // the waypoint case above starts from no waypoints; a waypoint REMOVED is the
  // reverse direction and must rebuild too
  it('a waypoint is removed', () => {
    const { nodes } = base()
    const withWp = [edge('e', 's', 't', { waypoints: [{ x: 200, y: 80 }] })]
    currentRouteMap(nodes, withWp)
    const g = __routeGenCount()
    currentRouteMap(nodes, [edge('e', 's', 't')])
    expect(__routeGenCount()).toBe(g + 1)
  })
})

describe('currentRouteMap — the key cannot collide', () => {
  const box = (id: string, x: number, y: number, w: number, h: number): LoopNode => node(id, x, y, { measured: { width: w, height: h } })
  const ends = [node('s', 0, 0), node('t', 600, 0)]
  const edgeSet = [edge('e', 's', 't')]

  it('an id spelled like a delimiter-joined record is not the record: two obstacles vs one oddly-named obstacle rebuild separately', () => {
    // layout A: obstacles a(100,10,80,60) and b(300,10,80,60), both across the s → t corridor
    const layoutA = [...ends, box('a', 100, 10, 80, 60), box('b', 300, 10, 80, 60)]
    // layout B: ONE obstacle whose id is the joined text of a's record, sitting where b was —
    // a `${id}:${x}:${y}:${w}:${h};` key would give both layouts the identical string
    const layoutB = [...ends, box('a:100:10:80:60;b', 300, 10, 80, 60)]
    expect(layoutSignature(layoutA, edgeSet)).not.toBe(layoutSignature(layoutB, edgeSet))
    const mA = currentRouteMap(layoutA, edgeSet)
    const g = __routeGenCount()
    const mB = currentRouteMap(layoutB, edgeSet)
    expect(__routeGenCount()).toBe(g + 1)
    expect(mB).not.toBe(mA)
    expect(mB.get('e')!.d).not.toBe(mA.get('e')!.d) // layout A has a second obstacle at x=100 to clear
  })

  it('ids containing JSON punctuation, brackets or quotes stay distinct from the structure around them', () => {
    const weird = ['a","b', 'x],[', '["y"]', '1,2,3', '{}']
    const sigs = weird.map((id) => layoutSignature([...ends, box(id, 300, 10, 80, 60)], edgeSet))
    expect(new Set(sigs).size).toBe(weird.length)
    // and each still round-trips as one node id, not several
    for (const [i, id] of weird.entries()) {
      const parsed = JSON.parse(sigs[i]) as [unknown[][], unknown[][]]
      expect(parsed[0]).toHaveLength(3)
      expect(parsed[0][2][0]).toBe(id)
    }
  })

  it('an edge id spelled like an endpoint pair is not that pair', () => {
    const a = [edge('e', 's', 't')]
    const b = [edge('e,s,out,t,in', 's', 't')]
    expect(layoutSignature(ends, a)).not.toBe(layoutSignature(ends, b))
  })
})

describe('currentRouteMap — a reused generation equals a cold rebuild', () => {
  it('route for route (d, hitD, routeClass), including after several reuses', () => {
    const { nodes, edges } = base()
    const m1 = currentRouteMap(nodes, edges)
    let ns = nodes
    for (let i = 0; i < 5; i++) {
      ns = ns.map((n) => ({ ...n, selected: i % 2 === 0 }))
      expect(currentRouteMap(ns, edges)).toBe(m1)
    }
    __resetRouteCache()
    const cold = currentRouteMap(nodes, edges)
    expect(routes(cold)).toEqual(routes(m1))
    expect(__routeGenCount()).toBe(1)
  })

  it('a rebuild after a real change equals a cold rebuild of that layout', () => {
    const { nodes, edges } = base()
    currentRouteMap(nodes, edges)
    const moved = nodes.map((n) => (n.id === 'o' ? { ...n, position: { x: 200, y: -10 } } : n))
    const warm = currentRouteMap(moved, edges)
    __resetRouteCache()
    expect(routes(currentRouteMap(moved, edges))).toEqual(routes(warm))
  })
})
