import { beforeAll, describe, expect, it } from 'vitest'
import desalDoc from '../../examples/desalination.json'
import { useGraphStore } from '../store/graphStore'
import { __planFans, __syncFullGeneration, currentRouteGeneration } from '../store/routeMap'
import { useUiStore } from '../store/uiStore'
import { graphReadEdges, isReadEdge, READ_PORT_OFFSET, readEdges, withReadEdges } from './readEdges'
import { fullContentDigest } from './revision'
import type { LoopEdge, LoopNode } from './types'
import { semanticDigest } from './workspace'

// SEMANTICS-M6.md §M6-7. The router's half is here, on the real desalination document.
// That a read connection stays out of the document and the run is in
// e2e/read-connection.spec.ts.

type Pt = { x: number; y: number }
type Port = { readPort: { source: number; target: number }; ports: { source: string; target: string } }
const port = (e: LoopEdge): Port => e.data as unknown as Port

const RULE = { level: '1', band: '1', side: 'fill' }
const pool = (id: string, x: number, y: number): LoopNode => ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const stage = (id: string, x: number, y: number, tank?: string): LoopNode => ({ id, type: 'converter', position: { x, y }, data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny', ...(tank ? { run: { tank, ...RULE } } : {}) } }) as unknown as LoopNode
const line = (id: string, source: string, target: string, face: string): LoopEdge => ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1', route: 'orthogonal', ports: { source: face, target: 'left' } } }) as unknown as LoopEdge

const desal = desalDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] }
const ruled = (pairs: [string, string][]): LoopNode[] =>
  desal.nodes.map((n) => {
    const hit = pairs.find(([, s]) => s === n.id)
    return hit ? ({ ...n, data: { ...n.data, run: { tank: hit[0], ...RULE } } } as unknown as LoopNode) : n
  })
const PAIRS: [string, string][] = [['product', 'remin'], ['permeate', 'ro'], ['filtered', 'filter'], ['brine', 'adjust'], ['backwash', 'thick']]

const pointsOf = (m: ReadonlyMap<string, { points: Pt[] }>, ids: string[]) => Object.fromEntries(ids.map((id) => [id, m.get(id)?.points]))

/** the length two axis-aligned polylines run on top of each other */
function shared(a: Pt[], b: Pt[]): number {
  let n = 0
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const [p, q, r, s] = [a[i - 1]!, a[i]!, b[j - 1]!, b[j]!]
      if (p.x === q.x && r.x === s.x && p.x === r.x) n += Math.max(0, Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) - Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)))
      if (p.y === q.y && r.y === s.y && p.y === r.y) n += Math.max(0, Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) - Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)))
    }
  }
  return n
}

describe('read connections', () => {
  beforeAll(() => useUiStore.setState({ nodeStructure: 'outside' }))

  it('are worked out from the rule and leave a graph with none as it is', () => {
    const nodes = [pool('t', 0, 0), stage('s', 300, 0, 't')]
    const edges = [line('a', 't', 's', 'right')]
    const reads = graphReadEdges(nodes, edges)
    expect(reads.map((e) => [e.id, e.source, e.target])).toEqual([['read:s', 't', 's']])
    expect(reads.every(isReadEdge)).toBe(true)
    expect(withReadEdges(nodes, edges)).toHaveLength(2)
    const none = [pool('t', 0, 0), stage('s', 300, 0)]
    expect(withReadEdges(none, edges)).toBe(edges)
  })

  it('take a free face at its centre, and a Converter beside a flat side when it has none', () => {
    const nodes = [pool('t', 0, 0), stage('s', 300, 0, 't'), pool('u', 600, 0), pool('v', 300, 300), pool('w', 300, -300)]
    const edges = [line('a', 's', 'u', 'right'), line('b', 's', 'v', 'bottom'), line('c', 's', 'w', 'top'), line('d', 'u', 's', 'left')]
    const e = readEdges(nodes, edges).edges[0]!
    expect(port(e).readPort.source).toBe(0)
    expect(['top', 'bottom']).toContain(port(e).ports.target)
    expect(Math.abs(port(e).readPort.target)).toBe(READ_PORT_OFFSET)
  })

  it('take the other side of a face when the near one is taken', () => {
    // every face of the tank carries a line or its name, and both stages lie to its lower right
    const nodes = [pool('t', 0, 0), pool('n', 0, -300), pool('e', 300, -300), pool('w', -300, 0), stage('s1', 400, 100, 't'), stage('s2', 400, 200, 't')]
    const edges = [line('a', 't', 'n', 'top'), line('b', 't', 'e', 'right'), line('c', 't', 'w', 'left')]
    const [first, second] = readEdges(nodes, edges).edges
    expect(port(first!).ports.source).toBe('right')
    expect(port(first!).readPort.source).toBe(READ_PORT_OFFSET)
    expect(port(second!).ports.source).toBe('right')
    expect(port(second!).readPort.source).toBe(-READ_PORT_OFFSET)
  })

  it('are not drawn when a tank has no spot left, and say so', () => {
    const stages = Array.from({ length: 8 }, (_, i) => stage(`s${i}`, 400, i * 100, 't'))
    const nodes = [pool('t', 0, 0), pool('n', 0, -300), pool('e', 300, -300), pool('w', -300, 0), ...stages]
    const edges = [line('a', 't', 'n', 'top'), line('b', 't', 'e', 'right'), line('c', 't', 'w', 'left')]
    const r = readEdges(nodes, edges)
    expect(r.edges).toHaveLength(6)
    expect(r.blocked.map((b) => b.stage)).toEqual(['s6', 's7'])
    const spots = r.edges.map((e) => `${port(e).ports.source}|${port(e).readPort.source}`)
    expect(new Set(spots).size).toBe(6)
  })

  it('are routed after every document line, so a rule moves none of them', () => {
    // planned with the document's lines, this read connection pushes `x2` and its
    // neighbours aside: its stub would be reserved and its route seen by theirs
    const at = (id: string, x: number, y: number, tank?: string) => (id === 'p1' ? stage(id, x, y, tank) : pool(id, x, y))
    const place = (tank?: string) => [at('p0', 640, 120), at('p1', 320, 240, tank), at('p2', 480, 240), at('p3', 320, 480), at('p4', 0, 480), at('p5', 480, 0)]
    const tops = (id: string, s: string, t: string): LoopEdge => {
      const e = line(id, s, t, 'top')
      return { ...e, data: { ...e.data, ports: { source: 'top', target: 'top' } } } as LoopEdge
    }
    const edges = [tops('x0', 'p2', 'p0'), tops('x1', 'p2', 'p4'), tops('x2', 'p2', 'p5'), tops('x3', 'p0', 'p4'), tops('x4', 'p0', 'p3'), tops('x5', 'p2', 'p0')]
    const ids = edges.map((e) => e.id)
    const after = __syncFullGeneration(place('p0'), edges)
    expect(after.has('read:p1')).toBe(true)
    expect(pointsOf(after, ids)).toEqual(pointsOf(__syncFullGeneration(place(), edges), ids))
  })

  it('move no line of the desalination document, whatever the document ids sort as', () => {
    const edges = desal.edges.map((e) => ({ ...e, id: `x${e.id}` }))
    const ids = edges.map((e) => e.id)
    const before = pointsOf(__syncFullGeneration(desal.nodes, edges), ids)
    const after = __syncFullGeneration(ruled(PAIRS), edges)
    expect(pointsOf(after, ids)).toEqual(before)
    expect(PAIRS.every(([, s]) => after.has(`read:${s}`))).toBe(true)
  })

  it('take another id when a stored line already holds theirs', () => {
    const nodes = [pool('t', 0, 0), stage('s', 300, 0, 't'), pool('u', 600, 0)]
    const edges = [line('read:s', 's', 'u', 'right'), line('a', 't', 's', 'right')]
    const reads = graphReadEdges(nodes, edges)
    expect(reads).toHaveLength(1)
    const ids = withReadEdges(nodes, edges).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const map = __syncFullGeneration(nodes, edges)
    expect(map.get('read:s')!.points).not.toEqual(map.get(reads[0]!.id)!.points)
  })

  it('never take a stored line for one, whatever its id', () => {
    const nodes = [pool('t', 0, 0), stage('s', 300, 0)]
    const stored = line('read:x', 't', 's', 'right')
    expect(isReadEdge(stored)).toBe(false)
    // `__planFans` reports the document lines the plan holds
    expect(__planFans(nodes, [stored]).fans['read:x']).toBeDefined()
  })

  it('leave both digests of the document as they were', async () => {
    const doc = { schema: 'loop-studio/graph/6', version: 1, nodes: [pool('t', 0, 0), stage('s', 300, 0, 't')], edges: [line('a', 't', 's', 'right')] }
    useGraphStore.getState().loadJSON(JSON.stringify(doc))
    const g = () => useGraphStore.getState()
    const digests = async (edges: LoopEdge[]) => [await semanticDigest({ nodes: g().nodes, edges }, g().modelVersion), await fullContentDigest({ nodes: g().nodes, edges }, g().modelVersion)]
    const before = await digests(g().edges)
    // the router and the canvas work the line out, as a render does
    const drawn = currentRouteGeneration(g().nodes, g().edges).map
    expect(drawn.has('read:s')).toBe(true)
    expect(graphReadEdges(g().nodes, g().edges)).toHaveLength(1)
    expect(g().edges.map((e) => e.id)).toEqual(['a'])
    expect(await digests(g().edges)).toEqual(before)
    // both digests do read the edges: had the line reached the document, each would differ
    const leaked = await digests(withReadEdges(g().nodes, g().edges))
    expect(leaked[0]).not.toBe(before[0])
    expect(leaked[1]).not.toBe(before[1])
  })

  it('share no length of line with any other line on the desalination document', () => {
    const map = __syncFullGeneration(ruled(PAIRS), desal.edges)
    const others = desal.edges.map((e) => map.get(e.id)!.points)
    for (const [, s] of PAIRS) {
      const own = map.get(`read:${s}`)!.points
      expect(others.map((o) => shared(own, o)).reduce((a, b) => a + b, 0)).toBe(0)
    }
  })
})
