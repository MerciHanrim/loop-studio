import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { __planFans, currentRouteMap } from './routeMap'

// docs/edge-routing.md §ER14.3 (share note 54) — a fan is the connections that
// share one port's stub. A RESOURCE port's fan is per face: the same handle on
// another face is another fan. A STATE port keeps one fan across its faces, on
// purpose (grouping it by face uncovers an arriving and a leaving state line
// meeting at one anchor — a separate unit). A resource `in` and `out` are
// never one fan, even on one anchor.

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

describe('fan membership: resource ports by face, state ports across faces', () => {
  it('resource: connections on the same face are one fan', () => {
    expect(srcFans([res('e1', 'a', 'b'), res('e2', 'a', 'c')])).toEqual([true, true])
  })

  it('resource: the same handle on another face is another fan', () => {
    expect(srcFans([res('e1', 'a', 'b'), res('e2', 'a', 'c', { source: 'bottom' })])).toEqual([false, false])
  })

  it('resource: on a mixed node the two on one face fan, the one on the other face stays apart', () => {
    expect(srcFans([res('e1', 'a', 'b'), res('e2', 'a', 'c'), res('e3', 'a', 'd', { source: 'bottom' })])).toEqual([true, true, false])
  })

  it('state: connections on the top and the bottom face of one handle stay ONE fan (the rule kept in this scope)', () => {
    expect(srcFans([state('s1', 'a', 'b', { source: 'top' }), state('s2', 'a', 'c')])).toEqual([true, true])
  })

  it('state: connections on the same face are one fan', () => {
    expect(srcFans([state('s1', 'a', 'b'), state('s2', 'a', 'c')])).toEqual([true, true])
  })

  it('resource: an `in` and an `out` a face puts on one anchor are not one fan', () => {
    // m's `in` arrives on its left face (the default), its `out` leaves the left face too
    const f = __planFans(nodes, [res('i', 'a', 'm'), res('o', 'm', 'b', { source: 'left' })]).fans
    expect([f.i.tgt, f.o.src]).toEqual([false, false])
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
