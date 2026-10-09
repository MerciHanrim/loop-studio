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

// issue #344 step 2 — docs/edge-routing.md §ER14
describe('currentRouteMap — the guarded generation (§ER14)', () => {
  /** a row of three sources feeding two targets, with crossing traffic */
  const busy = () => ({
    nodes: [node('a', 0, 0), node('b', 0, 160), node('c', 0, 320), node('x', 500, 80), node('y', 500, 240), node('mid', 250, 140)],
    edges: [edge('e1', 'a', 'y'), edge('e2', 'c', 'x'), edge('e3', 'b', 'x'), edge('e4', 'b', 'y'), edge('e5', 'y', 'a')],
  })

  it('is independent of node and edge input order (edges are routed in id order)', () => {
    const { nodes, edges } = busy()
    const m1 = routes(currentRouteMap(nodes, edges))
    __resetRouteCache()
    const m2 = routes(currentRouteMap([...nodes].reverse(), [...edges].reverse()))
    expect(new Map(m2.map((r) => [r[0], r]))).toEqual(new Map(m1.map((r) => [r[0], r])))
  })

  it('a label sits in a free slot clear of every node box', async () => {
    const { setRouteLabelSize } = await import('./routeMap')
    const { nodes, edges } = busy()
    for (const e of edges) setRouteLabelSize(e.id, 24, 18)
    const m = currentRouteMap(nodes, edges)
    for (const [id, r] of m) {
      expect(r.label, id).not.toBeNull()
      const L = { x: r.label!.x - 12, y: r.label!.y - 9, w: 24, h: 18 }
      for (const n of nodes) {
        const b = { x: n.position.x - 2, y: n.position.y - 2, w: 134, h: 60 }
        const overlap = L.x < b.x + b.w && b.x < L.x + L.w && L.y < b.y + b.h && b.y < L.y + L.h
        // the midpoint is the fallback when no slot is free; here every route has one
        expect(overlap, `${id} label on ${n.id}`).toBe(false)
      }
    }
  })

  /** a scheduler the test drives by hand: `run()` runs every queued slice */
  const manual = () => {
    const q: (() => void)[] = []
    return {
      schedule: (fn: () => void) => void q.push(fn),
      step: () => q.shift()?.(),
      run: () => {
        let n = 0
        while (q.length && n++ < 10000) q.shift()!()
        return n
      },
      size: () => q.length,
    }
  }

  it('a live gesture re-routes only what the moved node touches; the drop commits the cold-load generation', async () => {
    const { beginLiveLayout, endLiveLayout, __setRouteScheduler } = await import('./routeMap')
    const s = manual()
    __setRouteScheduler(s.schedule)
    try {
      const { nodes, edges } = busy()
      currentRouteMap(nodes, edges) // cold: sliced too
      s.run()
      const before = currentRouteMap(nodes, edges)
      beginLiveLayout()
      // drag `a` (incident: e1, e5) a little
      const moved = nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 0, y: 16 } } : n))
      const during = currentRouteMap(moved, edges)
      for (const id of ['e2', 'e3', 'e4']) expect(during.get(id), `${id} untouched while live`).toBe(before.get(id))
      expect(during.get('e1')!.d).not.toBe(before.get('e1')!.d)
      expect(s.size(), 'no full generation while the gesture lasts').toBe(0)
      const g = __routeGenCount()
      endLiveLayout()
      s.run()
      expect(__routeGenCount()).toBe(g + 1)
      const dropped = currentRouteMap(moved, edges)
      __setRouteScheduler(null)
      __resetRouteCache()
      const cold = currentRouteMap(moved, edges)
      expect(routes(dropped)).toEqual(routes(cold))
    } finally {
      __setRouteScheduler(null)
    }
  })

  it('a sliced full generation shows the provisional map until it is complete, then the synchronous result in one swap', async () => {
    const { __setRouteScheduler } = await import('./routeMap')
    const s = manual()
    __setRouteScheduler(s.schedule)
    try {
      const { nodes, edges } = busy()
      currentRouteMap(nodes, edges) // cold: sliced too
      s.run()
      const moved = nodes.map((n) => (n.id === 'mid' ? { ...n, position: { x: 250, y: 60 } } : n))
      const shown = currentRouteMap(moved, edges)
      // until the job commits, every render gets the SAME provisional map
      expect(currentRouteMap(moved, edges)).toBe(shown)
      s.run()
      const final = currentRouteMap(moved, edges)
      __setRouteScheduler(null)
      __resetRouteCache()
      expect(routes(final)).toEqual(routes(currentRouteMap(moved, edges)))
    } finally {
      __setRouteScheduler(null)
    }
  })

  it('a cold start draws no routed edge until its sliced generation commits; busy meanwhile; a layout seen again is shown at once', async () => {
    const { __setRouteScheduler, useRouteInputs } = await import('./routeMap')
    const s = manual()
    __setRouteScheduler(s.schedule)
    try {
      const { nodes, edges } = busy()
      expect(currentRouteMap(nodes, edges).size, 'nothing routed is drawn yet').toBe(0)
      await Promise.resolve() // `busy` is published right after the render
      expect(useRouteInputs.getState().busy).toBe(true)
      s.run()
      const full = currentRouteMap(nodes, edges)
      expect(full.size).toBe(edges.length)
      await Promise.resolve()
      expect(useRouteInputs.getState().busy).toBe(false)
      // another layout, then back: the kept generation, with no job
      const moved = nodes.map((n) => (n.id === 'mid' ? { ...n, position: { x: 250, y: 60 } } : n))
      currentRouteMap(moved, edges)
      s.run()
      const g = __routeGenCount()
      expect(currentRouteMap(nodes, edges)).toBe(full)
      expect(s.size()).toBe(0)
      expect(__routeGenCount()).toBe(g)
      // and it equals the synchronous generation
      __setRouteScheduler(null)
      __resetRouteCache()
      expect(routes(full)).toEqual(routes(currentRouteMap(nodes, edges)))
    } finally {
      __setRouteScheduler(null)
    }
  })

  it('a newer layout cancels a running job: the cancelled generation never commits', async () => {
    const { __setRouteScheduler, routeDiagnostics } = await import('./routeMap')
    const s = manual()
    __setRouteScheduler(s.schedule)
    try {
      const { nodes, edges } = busy()
      currentRouteMap(nodes, edges)
      s.run()
      const g = __routeGenCount()
      const m1 = nodes.map((n) => (n.id === 'mid' ? { ...n, position: { x: 250, y: 60 } } : n))
      currentRouteMap(m1, edges) // the first job is queued, not finished
      const m2 = nodes.map((n) => (n.id === 'mid' ? { ...n, position: { x: 250, y: 200 } } : n))
      currentRouteMap(m2, edges) // cancels it
      s.run()
      expect(__routeGenCount()).toBe(g + 1) // only the second commits
      expect(routeDiagnostics().job.cancelled).toBeGreaterThan(0)
      const final = currentRouteMap(m2, edges)
      __setRouteScheduler(null)
      __resetRouteCache()
      expect(routes(final)).toEqual(routes(currentRouteMap(m2, edges)))
    } finally {
      __setRouteScheduler(null)
    }
  })

  it('a port fan shares only its stub: no two connections of one port run together past it, and no label sits on it', async () => {
    const { routeDiagnostics, setRouteLabelSize } = await import('./routeMap')
    // one source port feeding four targets in the same direction
    const nodes = [node('s', 0, 160), node('t1', 400, 0), node('t2', 400, 120), node('t3', 400, 240), node('t4', 400, 360)]
    const edges = [edge('f1', 's', 't1'), edge('f2', 's', 't2'), edge('f3', 's', 't3'), edge('f4', 's', 't4')]
    for (const e of edges) setRouteLabelSize(e.id, 24, 18)
    const m = currentRouteMap(nodes, edges)
    expect(routeDiagnostics().fanOverlaps).toEqual([])
    for (const [id, r] of m) {
      const [p0, p1] = r.stubs
      const L = { x: r.label!.x - 12, y: r.label!.y - 9, w: 24, h: 18 }
      const onStub = Math.max(p0.x, p1.x) > L.x && Math.min(p0.x, p1.x) < L.x + L.w && Math.max(p0.y, p1.y) > L.y && Math.min(p0.y, p1.y) < L.y + L.h
      expect(onStub, `${id} label on the shared stub`).toBe(false)
    }
  })

  it('reports how many routes each rung produced, and names every outer / blocked one', async () => {
    const { routeDiagnostics } = await import('./routeMap')
    const { nodes, edges } = busy()
    currentRouteMap(nodes, edges)
    const d = routeDiagnostics()
    expect(Object.values(d.counts).reduce((a, b) => a + b, 0)).toBe(edges.length)
    expect(d.flagged.every((f) => f.routeClass === 'outer' || f.routeClass === 'blocked')).toBe(true)
  })
})

describe('currentRouteGeneration — Curved and Straight label slots (§ER15)', () => {
  const LS = { w: 24, h: 18 }
  /** s → t straight with a node `o` on the middle of the line; a → b curved
   *  with `o2` on its middle; plus one routed edge r → u */
  const scene = () => ({
    nodes: [node('s', 0, 0), node('t', 400, 0), node('o', 230, 0), node('a', 0, 240), node('b', 400, 240), node('o2', 230, 240), node('r', 0, 480), node('u', 400, 480)],
    edges: [edge('st', 's', 't', { route: 'straight' }), edge('cv', 'a', 'b', { route: undefined }), edge('or', 'r', 'u')],
  })
  const boxes = (nodes: LoopNode[]) => nodes.map((n) => ({ id: n.id, x: n.position.x - 2, y: n.position.y - 2, w: 134, h: 60 }))
  const hits = (c: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) =>
    c.x - LS.w / 2 < b.x + b.w && b.x < c.x + LS.w / 2 && c.y - LS.h / 2 < b.y + b.h && b.y < c.y + LS.h / 2

  it('a label takes the first slot on its own line that is clear of every node, not the middle', async () => {
    const { currentRouteGeneration, setRouteLabelSize } = await import('./routeMap')
    const { nodes, edges } = scene()
    for (const e of edges) setRouteLabelSize(e.id, LS.w, LS.h)
    const g = currentRouteGeneration(nodes, edges)
    expect([...g.free.keys()].sort()).toEqual(['cv', 'st'])
    for (const id of ['st', 'cv']) {
      const s = g.free.get(id)!
      expect(s.f, id).not.toBe(0.5)
      for (const b of boxes(nodes)) expect(hits(s.at, b), `${id} label on ${b.id}`).toBe(false)
    }
    // both lines are horizontal here (ports on one row), so the slot is on the row
    expect(g.free.get('st')!.at.y).toBe(28)
    expect(g.free.get('cv')!.at.y).toBeCloseTo(268, 6)
  })

  it('a label whose size is not known yet has no slot', async () => {
    const { currentRouteGeneration, setRouteLabelSize } = await import('./routeMap')
    const { nodes, edges } = scene()
    setRouteLabelSize('st', LS.w, LS.h)
    expect([...currentRouteGeneration(nodes, edges).free.keys()]).toEqual(['st'])
  })

  it('Curved and Straight connections never change a route', async () => {
    const { currentRouteGeneration } = await import('./routeMap')
    const { nodes, edges } = scene()
    const withFree = routes(currentRouteGeneration(nodes, edges).map)
    __resetRouteCache()
    expect(routes(currentRouteGeneration(nodes, edges.filter((e) => e.id === 'or')).map)).toEqual(withFree)
  })

  it('the sliced generation gives the synchronous slots; a moved node re-places only the labels of its own edges until the drop', async () => {
    const { currentRouteGeneration, setRouteLabelSize, __setRouteScheduler, beginLiveLayout, endLiveLayout } = await import('./routeMap')
    const q: (() => void)[] = []
    __setRouteScheduler((fn) => void q.push(fn))
    try {
      const { nodes, edges } = scene()
      for (const e of edges) setRouteLabelSize(e.id, LS.w, LS.h)
      expect(currentRouteGeneration(nodes, edges).free.size, 'no slot before the first generation commits').toBe(0)
      while (q.length) q.shift()!()
      const sliced = currentRouteGeneration(nodes, edges)
      beginLiveLayout()
      const moved = nodes.map((n) => (n.id === 's' ? { ...n, position: { x: 0, y: 16 } } : n))
      const during = currentRouteGeneration(moved, edges)
      expect(during.free.get('cv'), 'an edge the move does not touch keeps its slot').toBe(sliced.free.get('cv'))
      expect(during.free.get('st')).not.toBe(sliced.free.get('st'))
      endLiveLayout()
      while (q.length) q.shift()!()
      const dropped = currentRouteGeneration(moved, edges)
      __setRouteScheduler(null)
      __resetRouteCache()
      for (const e of edges) setRouteLabelSize(e.id, LS.w, LS.h)
      expect([...dropped.free]).toEqual([...currentRouteGeneration(moved, edges).free])
      __resetRouteCache()
      for (const e of edges) setRouteLabelSize(e.id, LS.w, LS.h)
      expect([...sliced.free]).toEqual([...currentRouteGeneration(nodes, edges).free])
    } finally {
      __setRouteScheduler(null)
    }
  })
})

describe('bend points from the keyboard and on the line (§ER16.2)', () => {
  const two = () => ({ nodes: [node('a', 0, 0), node('b', 480, 192)], edges: [edge('e', 'a', 'b')] })

  it('Enter takes the middle of the longest editable segment, snapped along it and kept on its line', async () => {
    const { keyboardBend } = await import('./routeMap')
    const { nodes, edges } = two()
    const r = currentRouteMap(nodes, edges).get('e')!
    const p = keyboardBend(nodes, edges, 'e', r)!
    expect(p).not.toBeNull()
    // on the route: one coordinate is a segment's own line, the other on the grid
    const onLine = r.points.some((a, i) => {
      const b = r.points[i + 1]
      return !!b && ((a.x === b.x && p.x === a.x && p.y % 16 === 0) || (a.y === b.y && p.y === a.y && p.x % 16 === 0))
    })
    expect(onLine).toBe(true)
    // deterministic
    expect(keyboardBend(nodes, edges, 'e', r)).toEqual(p)
  })

  it('equal segments go to the one nearer the start; a refused point gives way to the next segment', async () => {
    const { keyboardBend } = await import('./routeMap')
    // a symmetric Z: two equal horizontal legs; the first one wins
    const { nodes, edges } = { nodes: [node('a', 0, 0), node('b', 448, 320)], edges: [edge('e', 'a', 'b')] }
    const r = currentRouteMap(nodes, edges).get('e')!
    const p = keyboardBend(nodes, edges, 'e', r)!
    expect(p).not.toBeNull()
    // a node over that point refuses it: another segment is used
    const blocked = [...nodes, node('x', p.x - 20, p.y - 20, { width: 40, height: 40, measured: { width: 40, height: 40 } })]
    __resetRouteCache()
    const r2 = currentRouteMap(blocked, edges).get('e')!
    const q = keyboardBend(blocked, edges, 'e', r2)
    if (q) expect(q).not.toEqual(p)
  })

  it('a click puts the bend on the nearest segment, snapped along it (Alt: exactly at the click)', async () => {
    const { bendAtClick } = await import('./routeMap')
    const pts = [{ x: 0, y: 28 }, { x: 200, y: 28 }, { x: 200, y: 300 }]
    expect(bendAtClick(pts, { x: 75, y: 33 }, false)).toEqual({ x: 80, y: 28 })
    expect(bendAtClick(pts, { x: 75, y: 33 }, true)).toEqual({ x: 75, y: 28 })
    expect(bendAtClick(pts, { x: 205, y: 151 }, false)).toEqual({ x: 200, y: 144 })
    // a segment with no grid line inside it takes no snapped bend
    expect(bendAtClick([{ x: 1, y: 28 }, { x: 15, y: 28 }], { x: 8, y: 28 }, false)).toBeNull()
  })
})

describe('the record label rule (§ER15.1)', () => {
  it('a record places no Curved / Straight label, and its routed labels are the ones without them', async () => {
    const { currentRouteGeneration, setRecordLabels, setRouteLabelSize } = await import('./routeMap')
    const nodes = [node('s', 0, 0), node('t', 400, 0), node('mid', 200, 0), node('r', 0, 240), node('u', 400, 240)]
    const edges = [edge('cv', 's', 't', { route: undefined }), edge('or', 'r', 'u')]
    for (const e of edges) setRouteLabelSize(e.id, 24, 18)
    setRecordLabels(true)
    const rec = currentRouteGeneration(nodes, edges)
    expect(rec.free.size).toBe(0)
    const recRoutes = [...rec.map].map(([id, x]) => [id, x.d, x.label])
    __resetRouteCache()
    for (const e of edges) setRouteLabelSize(e.id, 24, 18)
    setRecordLabels(true)
    expect([...currentRouteGeneration(nodes, edges.filter((e) => e.id === 'or')).map].map(([id, x]) => [id, x.d, x.label])).toEqual(recRoutes)
    setRecordLabels(false)
    expect(currentRouteGeneration(nodes, edges).free.has('cv'), 'the current rule places it').toBe(true)
  })
})
