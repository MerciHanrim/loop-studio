import { describe, expect, it } from 'vitest'
import { canonicalContent } from './revision'
import { extractModule, insertGraph, type GraphDocLike } from './moduleGraph'
import type { LoopEdge, LoopNode } from './types'

// docs/module-system.md §MS8 — the model layer for module insert / extract.
// Every id is re-issued on insert (MS7-1); expression `@ref` / v2 `@param` flow
// are rewritten; the whole candidate is validated before it is returned
// (§MS3.6 / B4); a dangling `@ref` refuses Extract (§MS2.4 / B1).

const pool = (id: string, over: Partial<LoopNode['data']> = {}, pos = { x: 0, y: 0 }): LoopNode =>
  ({
    id,
    type: 'pool',
    position: pos,
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...over },
  }) as LoopNode

const param = (id: string, value = 1, pos = { x: 0, y: 0 }): LoopNode =>
  ({ id, type: 'parameter', position: pos, data: { kind: 'parameter', label: id, value } }) as LoopNode

const register = (id: string, expr: string, pos = { x: 0, y: 0 }): LoopNode =>
  ({ id, type: 'register', position: pos, data: { kind: 'register', label: id, expr } }) as LoopNode

const rEdge = (id: string, s: string, t: string, flow = '1'): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as LoopEdge

const doc = (nodes: LoopNode[], edges: LoopEdge[] = [], modelVersion: 1 | 2 = 1): GraphDocLike => ({
  nodes,
  edges,
  modelVersion,
})

const host = () => doc([pool('h1', { initial: 3 }, { x: 500, y: 500 })], [], 1)

describe('insertGraph — id re-issue (MS7-1)', () => {
  it('re-issues every node and edge id, rewrites endpoints, leaves the host untouched', () => {
    const mod = doc(
      [pool('m_src', {}, { x: 0, y: 0 }), pool('m_dst', {}, { x: 200, y: 0 })],
      [rEdge('m_e1', 'm_src', 'm_dst', '2')],
      1,
    )
    const r = insertGraph(host(), mod, { at: { x: 100, y: 100 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // host node still present, verbatim
    expect(r.nodes[0]).toEqual(host().nodes[0])
    // every module id is fresh — none of the originals survive
    const ids = new Set(r.nodes.map((n) => n.id).concat(r.edges.map((e) => e.id)))
    for (const old of ['m_src', 'm_dst', 'm_e1']) expect(ids.has(old)).toBe(false)
    expect(r.insertedNodeIds).toHaveLength(2)
    expect(r.insertedEdgeIds).toHaveLength(1)
    // the inserted edge points at the re-issued node ids
    const e = r.edges.at(-1)!
    expect(e.source).toBe(r.idMap['m_src'])
    expect(e.target).toBe(r.idMap['m_dst'])
    expect((e.data as { flow: string }).flow).toBe('2')
    // the merged graph is valid + finite
    expect(() => canonicalContent({ nodes: r.nodes, edges: r.edges })).not.toThrow()
  })

  it('places the module bounding-box top-left at opts.at', () => {
    const mod = doc(
      [pool('a', {}, { x: 40, y: 80 }), pool('b', {}, { x: 240, y: 380 })],
      [],
      1,
    )
    const r = insertGraph(host(), mod, { at: { x: 1000, y: 1000 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const placed = r.nodes.filter((n) => r.insertedNodeIds.includes(n.id)).map((n) => n.position)
    // top-left (40,80) -> (1000,1000); the other node keeps its relative offset
    expect(placed).toEqual([
      { x: 1000, y: 1000 },
      { x: 1200, y: 1300 },
    ])
  })

  it('the same module inserted twice yields two disjoint copies (no shared id)', () => {
    const mod = doc([pool('x'), pool('y')], [rEdge('e', 'x', 'y')], 1)
    const first = insertGraph(host(), mod, { at: { x: 0, y: 0 } })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = insertGraph({ ...host(), nodes: first.nodes, edges: first.edges }, mod, { at: { x: 50, y: 50 } })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const a = new Set(first.insertedNodeIds.concat(first.insertedEdgeIds))
    const b = new Set(second.insertedNodeIds.concat(second.insertedEdgeIds))
    for (const id of b) expect(a.has(id)).toBe(false)
    // second insert kept the first copy verbatim
    for (const id of first.insertedNodeIds) expect(second.nodes.some((n) => n.id === id)).toBe(true)
  })
})

describe('insertGraph — expression rewrite', () => {
  it('rewrites a register `@ref` to the re-issued node id', () => {
    const mod = doc([param('m_lever', 5), register('m_out', '@m_lever * 2')], [], 1)
    const r = insertGraph(host(), mod, { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reg = r.nodes.find((n) => n.id === r.idMap['m_out'])!
    expect((reg.data as { expr: string }).expr).toBe(`@${r.idMap['m_lever']} * 2`)
  })

  it('rewrites a v2 `@param` flow and promotes a v1 host (§MS3.4)', () => {
    const mod = doc(
      [param('m_rate', 3), pool('m_a'), pool('m_b')],
      [{ ...rEdge('m_flow', 'm_a', 'm_b', '@m_rate') }],
      2,
    )
    const r = insertGraph(host(), mod, { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.promotedToV2).toBe(true)
    expect(r.modelVersion).toBe(2)
    const flowEdge = r.edges.find((e) => e.id === r.insertedEdgeIds[0])!
    expect((flowEdge.data as { flow: string }).flow).toBe(`@${r.idMap['m_rate']}`)
  })

  it('a v2 host + v1 module stays v2 and does not report a promotion', () => {
    const v2host: GraphDocLike = { ...host(), modelVersion: 2 }
    const r = insertGraph(v2host, doc([pool('a'), pool('b')], [rEdge('e', 'a', 'b')], 1), { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.modelVersion).toBe(2)
    expect(r.promotedToV2).toBe(false)
  })

  it('refuses a module whose register references a node outside the module', () => {
    const mod = doc([register('m_out', '@not_in_module + 1')], [], 1)
    const r = insertGraph(host(), mod, { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/not_in_module/)
  })
})

describe('insertGraph — build, validate, then apply once (§MS3.6 / B4)', () => {
  it('refuses a module with an edge incident to a parameter node — host unchanged', () => {
    const mod = doc([pool('p'), param('lever')], [rEdge('bad', 'p', 'lever')], 1)
    const r = insertGraph(host(), mod, { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(false)
  })

  it('refuses a module carrying a non-finite number', () => {
    const mod = doc([pool('p', { initial: Number.POSITIVE_INFINITY })], [], 1)
    const r = insertGraph(host(), mod, { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(false)
  })

  it('refuses an empty module', () => {
    expect(insertGraph(host(), doc([]), { at: { x: 0, y: 0 } }).ok).toBe(false)
  })
})

describe('extractModule — §MS2', () => {
  const graph = () =>
    doc(
      [
        pool('keep1', {}, { x: 300, y: 200 }),
        pool('keep2', {}, { x: 500, y: 260 }),
        pool('outside', {}, { x: 900, y: 900 }),
      ],
      [
        rEdge('internal', 'keep1', 'keep2', '4'),
        rEdge('boundary', 'keep2', 'outside', '1'),
      ],
      1,
    )

  it('keeps the selected nodes + fully-internal edges, drops boundary edges, normalises to origin', () => {
    const r = extractModule(graph(), ['keep1', 'keep2'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['keep1', 'keep2'])
    expect(r.edges.map((e) => e.id)).toEqual(['internal'])
    // bbox top-left (300,200) -> (0,0)
    expect(r.nodes.find((n) => n.id === 'keep1')!.position).toEqual({ x: 0, y: 0 })
    expect(r.nodes.find((n) => n.id === 'keep2')!.position).toEqual({ x: 200, y: 60 })
    // no run config / frames field on the result shape at all
    expect(Object.keys(r).sort()).toEqual(['edges', 'modelVersion', 'nodes', 'ok'])
  })

  it('does not mutate the source graph', () => {
    const g = graph()
    const before = JSON.stringify(g)
    extractModule(g, ['keep1', 'keep2'])
    expect(JSON.stringify(g)).toBe(before)
  })

  it('refuses when a selected register references a node outside the selection (§MS2.4 / B1)', () => {
    const g = doc(
      [param('lever', 2, { x: 0, y: 0 }), register('out', '@lever + @far', { x: 100, y: 0 }), pool('far', {}, { x: 900, y: 0 })],
      [],
      1,
    )
    const r = extractModule(g, ['lever', 'out'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.dangling).toEqual([{ from: 'out', targetId: 'far' }])
    expect(r.reason).toMatch(/outside/)
  })

  it('marks the module v2 only when a surviving edge carries an `@param` flow', () => {
    const v1 = extractModule(graph(), ['keep1', 'keep2'])
    expect(v1.ok && v1.modelVersion).toBe(1)

    const g2 = doc(
      [param('rate', 3, { x: 0, y: 0 }), pool('a', {}, { x: 100, y: 0 }), pool('b', {}, { x: 200, y: 0 })],
      [{ ...rEdge('f', 'a', 'b', '@rate') }],
      2,
    )
    const r = extractModule(g2, ['rate', 'a', 'b'])
    expect(r.ok && r.modelVersion).toBe(2)
  })

  it('refuses an empty selection', () => {
    expect(extractModule(graph(), []).ok).toBe(false)
    expect(extractModule(graph(), ['nope']).ok).toBe(false)
  })
})

describe('round-trip — extract then insert back', () => {
  it('produces a second disjoint copy that validates', () => {
    const g = doc(
      [pool('a', { initial: 2 }, { x: 100, y: 100 }), pool('b', {}, { x: 260, y: 140 })],
      [rEdge('e', 'a', 'b', '3')],
      1,
    )
    const ex = extractModule(g, ['a', 'b'])
    expect(ex.ok).toBe(true)
    if (!ex.ok) return
    const back = insertGraph(g, { nodes: ex.nodes, edges: ex.edges, modelVersion: ex.modelVersion }, { at: { x: 700, y: 700 } })
    expect(back.ok).toBe(true)
    if (!back.ok) return
    // original 2 nodes + 2 fresh = 4, all ids distinct
    expect(back.nodes).toHaveLength(4)
    expect(new Set(back.nodes.map((n) => n.id)).size).toBe(4)
    expect(() => canonicalContent({ nodes: back.nodes, edges: back.edges })).not.toThrow()
  })
})
