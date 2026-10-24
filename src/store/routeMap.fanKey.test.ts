import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { __planFans, currentRouteMap } from './routeMap'

// docs/edge-routing.md §ER14.3 (share note 54) — a fan is the connections that
// share one port's stub. A port's fan is per face: the same handle on another
// face is another fan — for a RESOURCE port, and since 2026-10-24 for a STATE
// port too, except on a node where one face has an arriving and a leaving
// state line (they meet at that face's one anchor — a separate unit), whose
// state ports keep one fan across faces. A resource `in` and `out` are never
// one fan, even on one anchor.

const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const res = (id: string, source: string, target: string, ports?: { source?: string; target?: string }): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal', ...(ports ? { ports } : {}) } }) as unknown as LoopEdge
const state = (id: string, source: string, target: string, ports?: { source?: string; target?: string }): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'label', label: '+1', route: 'orthogonal', ...(ports ? { ports } : {}) } }) as unknown as LoopEdge

const nodes = [node('a', 0, 0), node('b', 400, -200), node('c', 400, 200), node('d', 400, 400), node('m', 200, 0)]
const srcFans = (edges: LoopEdge[]) => {
  const f = __planFans(nodes, edges).fans
  return edges.map((e) => f[e.id].src)
}

function inwardCase(which: 'h1' | 'h2' | 'h3'): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const positions = which === 'h2'
    ? { s1: { x: -480, y: -32 }, s2: { x: -32, y: -480 } }
    : { s1: { x: -384, y: 0 }, s2: { x: 0, y: -384 } }
  const caseNodes = [
    node('z', 0, 0),
    { ...node('s1', 0, 0), position: positions.s1 },
    { ...node('s2', 0, 0), position: positions.s2 },
    ...(which === 'h3' ? [node('blk', -160, -160)] : []),
  ]
  const caseEdges = [
    res('e_t', 's1', 'z', { target: 'top' }),
    res('e_l', 's2', 'z'),
  ]
  return { nodes: caseNodes, edges: caseEdges }
}

function orthogonalCrossings(a: { x: number; y: number }[], b: { x: number; y: number }[]): number {
  let count = 0
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const a0 = a[i - 1], a1 = a[i], b0 = b[j - 1], b1 = b[j]
      const aVertical = a0.x === a1.x
      const bVertical = b0.x === b1.x
      if (aVertical === bVertical) continue
      const v0 = aVertical ? a0 : b0
      const v1 = aVertical ? a1 : b1
      const h0 = aVertical ? b0 : a0
      const h1 = aVertical ? b1 : a1
      const x = v0.x, y = h0.y
      if (Math.min(v0.y, v1.y) < y && y < Math.max(v0.y, v1.y) && Math.min(h0.x, h1.x) < x && x < Math.max(h0.x, h1.x)) count++
    }
  }
  return count
}

describe('fan membership: ports by face; a state in / out on one face keeps the node’s state fans across faces', () => {
  it('resource: connections on the same face are one fan', () => {
    expect(srcFans([res('e1', 'a', 'b'), res('e2', 'a', 'c')])).toEqual([true, true])
  })

  it('resource: the same handle on another face is another fan', () => {
    expect(srcFans([res('e1', 'a', 'b'), res('e2', 'a', 'c', { source: 'bottom' })])).toEqual([false, false])
  })

  it('resource: on a mixed node the two on one face fan, the one on the other face stays apart', () => {
    expect(srcFans([res('e1', 'a', 'b'), res('e2', 'a', 'c'), res('e3', 'a', 'd', { source: 'bottom' })])).toEqual([true, true, false])
  })

  it('state: the same handle on another face is another port (no fan)', () => {
    expect(srcFans([state('s1', 'a', 'b', { source: 'top' }), state('s2', 'a', 'c')])).toEqual([false, false])
  })

  it('state: connections on the same face are one fan', () => {
    expect(srcFans([state('s1', 'a', 'b'), state('s2', 'a', 'c')])).toEqual([true, true])
  })

  it('resource: an `in` and an `out` a face puts on one anchor are not one fan', () => {
    // m's `in` arrives on its left face (the default), its `out` leaves the left face too
    const f = __planFans(nodes, [res('i', 'a', 'm'), res('o', 'm', 'b', { source: 'left' })]).fans
    expect([f.i.tgt, f.o.src]).toEqual([false, false])
  })

  it('state: arrivals on three faces of one handle are three ports, none a fan (the pulls-count node of the gacha Templates)', () => {
    // m's state target is reached on its left, top and right faces, each by
    // one line; no face of m has a leaving state line
    const edges = [
      state('l', 'a', 'm', { target: 'left' }),
      state('t', 'b', 'm', { target: 'top' }),
      state('r', 'c', 'm', { target: 'right' }),
    ]
    const f = __planFans(nodes, edges).fans
    expect([f.l.tgt, f.t.tgt, f.r.tgt]).toEqual([false, false, false])
  })

  it('state: a line arriving level with a side face comes straight in, its full stub, no hook — whatever reaches the other faces', () => {
    // the hook of the gacha Templates' pulls count: the right-face arrival
    // was cut to a third of the stub and turned aside by the top and left ones
    const caseNodes = [node('m', 0, 0), node('sl', -320, 0), node('st', 0, -320), node('sr', 320, 0)]
    const caseEdges = [
      state('in_l', 'sl', 'm', { source: 'right', target: 'left' }),
      state('in_t', 'st', 'm', { source: 'bottom', target: 'top' }),
      state('in_r', 'sr', 'm', { source: 'left', target: 'right' }),
    ]
    const routes = currentRouteMap(caseNodes, caseEdges)
    for (const id of ['in_l', 'in_r']) {
      const pts = routes.get(id)!.points
      // one horizontal run, no bend on the way in
      expect(pts.every((p) => p.y === pts[0].y), `${id}: ${JSON.stringify(pts)}`).toBe(true)
    }
    const top = routes.get('in_t')!.points
    expect(top.every((p) => p.x === top[0].x), `in_t: ${JSON.stringify(top)}`).toBe(true)
  })

  it('state: a node where one face has an arriving AND a leaving state line keeps one fan across faces (share note 54: Pity top, Roll — forced, owed bottom)', () => {
    // m's state target: top (from b) and bottom (from c); m's state source:
    // top (to d) — the top face carries an arrival and a departure on one
    // anchor, the case grouping by face makes collide, so m keeps today's fans
    const edges = [
      state('in_top', 'b', 'm', { target: 'top' }),
      state('in_bottom', 'c', 'm', { target: 'bottom' }),
      state('out_top', 'm', 'd', { source: 'top' }),
      state('out_right', 'm', 'a', { source: 'right' }),
    ]
    const f = __planFans(nodes, edges).fans
    expect([f.in_top.tgt, f.in_bottom.tgt, f.out_top.src, f.out_right.src]).toEqual([true, true, true, true])
  })

  it('state: the fans do not depend on the order the connections are stored in', () => {
    const edges = [
      state('l', 'a', 'm', { target: 'left' }),
      state('t', 'b', 'm', { target: 'top' }),
      state('t2', 'c', 'm', { target: 'top' }),
      state('r', 'd', 'm', { target: 'right' }),
    ]
    const plain = __planFans(nodes, edges)
    const reversed = __planFans(nodes, [...edges].reverse())
    expect(reversed).toEqual(plain)
    // the two on the top face are one fan; the side ones are alone
    expect([plain.fans.l.tgt, plain.fans.t.tgt, plain.fans.t2.tgt, plain.fans.r.tgt]).toEqual([false, true, true, false])
    const a = currentRouteMap(nodes, edges)
    const b = currentRouteMap(nodes, [...edges].reverse())
    for (const e of edges) expect(b.get(e.id)!.d).toBe(a.get(e.id)!.d)
  })

  // the same hard cases with STATE lines (2026-10-24): two lines into one
  // state target on two faces are not siblings, so their crossings are
  // charged. Measured: 0 / 1 / 0 crossings; with the sibling relation kept
  // face-blind for state ports (the pickup gacha's `v_ssr_pull` back on its
  // old corridor) 1 / 3 / 1 — so it is not kept face-blind
  it.each([['h1', 0], ['h2', 1], ['h3', 0]] as const)('state sibling routing: %s — lines on two faces of one state target are routed as unrelated (%i crossing)', (which, want) => {
    const { nodes: caseNodes } = inwardCase(which)
    const edges = [state('e_t', 's1', 'z', { source: 'right', target: 'top' }), state('e_l', 's2', 'z', { source: 'bottom', target: 'left' })]
    const routes = currentRouteMap(caseNodes, edges)
    expect(orthogonalCrossings(routes.get('e_t')!.points, routes.get('e_l')!.points)).toBe(want)
  })

  it.each(['h1', 'h2', 'h3'] as const)('resource sibling routing: %s avoids the measured hook crossing', (which) => {
    const { nodes: caseNodes, edges } = inwardCase(which)
    const routes = currentRouteMap(caseNodes, edges)
    const crossings = orthogonalCrossings(routes.get('e_t')!.points, routes.get('e_l')!.points)
    // These measured stress cases are the cases where Z's broader sibling
    // relation exempted a non-shared face stub and allowed a hook/crossing.
    // U4 aligns sibling treatment with fan membership, leaving one crossing.
    expect(crossings).toBe(1)
  })
})
