import { describe, expect, it } from 'vitest'
import RISKY from '../../examples/risky-factory.json'
import { initSim, step } from '../engine'
import { createNode, defaultData } from './factory'
import {
  canonicalContent,
  computeRevisionDiff,
  digestOfCanonical,
  graphStructureIssues,
  isModelLayerContent,
  validateResultGraph,
} from './revision'
import { normalizeResourceType, resourceTypeMismatches } from './model'
import { deserialize, normalizeGraph, serialize } from './serialize'
import type { LoopEdge, LoopNode } from './types'

// Editor-wiring slice — `parameter` / `register` become first-class NodeKinds.
// The overriding constraint: an existing v1 GraphDoc must serialize, digest, and
// run byte-/behaviour-identical to before.

const node = (id: string, data: Record<string, unknown>): LoopNode =>
  ({ id, type: data.kind as string, position: { x: 0, y: 0 }, data }) as unknown as LoopNode

const risky = () =>
  JSON.parse(JSON.stringify(RISKY)) as { nodes: LoopNode[]; edges: LoopEdge[]; recommendedRunConfig?: never }

describe('NodeKind widening — factory', () => {
  it('defaultData covers the two model kinds with the frozen defaults', () => {
    expect(defaultData('parameter')).toEqual({ kind: 'parameter', label: 'Parameter', value: 0 })
    expect(defaultData('register')).toEqual({ kind: 'register', label: 'Register', expr: '0' })
    expect(createNode('parameter', { x: 1, y: 2 })).toMatchObject({
      type: 'parameter',
      position: { x: 1, y: 2 },
      data: { kind: 'parameter', value: 0 },
    })
  })
})

describe('normalizeNode — model nodes fold the defensive read into a new object', () => {
  it('fills value → 0 and drops an incoherent min/max pair', () => {
    const g = normalizeGraph({
      nodes: [node('pm', { kind: 'parameter', label: 'Price', min: 10, max: 1 })],
      edges: [],
    })
    expect(g.nodes[0].data).toEqual({ kind: 'parameter', label: 'Price', value: 0 })
  })

  it('stores expr in §X8 canonical form; drops a bad format', () => {
    const g = normalizeGraph({
      nodes: [node('rg', { kind: 'register', label: 'P', expr: '@a+@b', format: 'money' })],
      edges: [],
    })
    expect(g.nodes[0].data).toEqual({ kind: 'register', label: 'P', expr: '@a + @b' })
  })

  it('an unseatable model node is left EXACTLY as authored (no silent repair)', () => {
    const raw = node('pm', { kind: 'parameter', label: 'x', value: { bad: true } })
    const g = normalizeGraph({ nodes: [raw], edges: [] })
    expect(g.nodes[0]).toBe(raw) // same reference — untouched
  })
})

describe('v1 GraphDoc invariance (the editor-wiring must not disturb it)', () => {
  it('serialize → deserialize → serialize is byte-stable', () => {
    const a = risky()
    const s1 = serialize(
      deserialize(serialize(a.nodes, a.edges)).nodes,
      deserialize(serialize(a.nodes, a.edges)).edges,
    )
    const rd = deserialize(s1)
    expect(serialize(rd.nodes, rd.edges)).toBe(s1)
  })

  it('is loop-revision/1 content and its v1 / v2 digests agree (R2-INV-2)', () => {
    const a = risky()
    expect(isModelLayerContent(a as never)).toBe(false)
    const v1 = canonicalContent(a, { modelLayer: false })
    const v2 = canonicalContent(a, { modelLayer: true })
    expect(digestOfCanonical(v1)).toBe(digestOfCanonical(v2))
  })

  it('still runs identically step-for-step', () => {
    const a = risky()
    const b = risky()
    let sa = initSim(a.nodes)
    let sb = initSim(b.nodes)
    for (let i = 0; i < 30; i++) {
      const ra = step(a.nodes, a.edges, sa, 7)
      const rb = step(b.nodes, b.edges, sb, 7)
      expect(ra.state).toEqual(rb.state)
      sa = ra.state
      sb = rb.state
    }
  })
})

const rEdge = (id: string, source: string, target: string, data: Record<string, unknown> = { kind: 'resource', flow: '1' }): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data }) as unknown as LoopEdge

describe('no-port structure is enforced by validation, not just hidden in the UI', () => {
  const nodes = [
    node('p1', { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' }),
    node('pm', { kind: 'parameter', label: 'x', value: 1 }),
    node('rg', { kind: 'register', label: 'r', expr: '0' }),
  ]

  it('graphStructureIssues flags any edge incident to a parameter / register (deterministic, id-sorted)', () => {
    const edges = [
      rEdge('e2', 'p1', 'rg'),
      rEdge('e1', 'pm', 'p1'),
      { id: 'e3', type: 'loop', source: 'p1', target: 'rg', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '' } } as unknown as LoopEdge,
    ]
    const issues = graphStructureIssues(nodes, edges)
    expect(issues).toHaveLength(3)
    expect(issues[0]).toContain('e1')
    expect(issues[1]).toContain('e2')
    expect(issues[2]).toContain('e3')
    expect(graphStructureIssues(nodes, [rEdge('ok', 'p1', 'p1')])).toEqual([])
  })

  it('validateResultGraph (whole + selective Apply share it) rejects such an edge', () => {
    const r = validateResultGraph(nodes, [rEdge('e1', 'pm', 'p1')])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.some((x) => x.includes('has no ports'))).toBe(true)
  })
})

describe('engine tolerates model nodes (SEMANTICS-M.md §M6.1 — never read, never fire)', () => {
  it('a graph with a parameter + register runs and neither node ever fires', () => {
    const a = risky()
    const g = normalizeGraph({
      nodes: [
        ...a.nodes,
        node('pm', { kind: 'parameter', label: 'Price', value: 3 }),
        node('rg', { kind: 'register', label: 'P', expr: '@pm * 2' }),
      ],
      edges: a.edges,
    })
    let st = initSim(g.nodes)
    const firedEver = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const r = step(g.nodes, g.edges, st, 1)
      for (const id of r.state.fired) firedEver.add(id)
      st = r.state
    }
    expect(firedEver.has('pm')).toBe(false)
    expect(firedEver.has('rg')).toBe(false)
    // §M3.6 / M-INV-2 — Register values are NEVER in SimState
    const st1 = step(g.nodes, g.edges, initSim(g.nodes), 1).state
    expect(Object.keys(st1.values)).not.toContain('rg')
    expect(Object.keys(st1.values).every((k) => (g.nodes.find((n) => n.id === k)?.data as { kind: string }).kind === 'pool')).toBe(true)
  })

  it('an edge incident to a model node contributes no flow and never blocks the run', () => {
    const a = risky()
    const pmId = 'pm_extra'
    const g = normalizeGraph({
      nodes: [...a.nodes, node(pmId, { kind: 'parameter', label: 'x', value: 3 })],
      edges: [...a.edges, rEdge('e_bad', pmId, a.nodes.find((n) => (n.data as { kind: string }).kind === 'pool')!.id)],
    })
    // baseline without the bogus node/edge
    const base = risky()
    let sg = initSim(g.nodes)
    let sb = initSim(base.nodes)
    for (let i = 0; i < 15; i++) {
      const rg = step(g.nodes, g.edges, sg, 3)
      const rb = step(base.nodes, base.edges, sb, 3)
      expect(rg.state.values).toEqual(rb.state.values) // identical — the bad edge is inert
      sg = rg.state
      sb = rb.state
    }
  })
})

describe('resource-type editing (loop-model/1 §M4) is advisory revision content', () => {
  const g = (poolRT?: string, edgeRT?: string) => ({
    nodes: [
      node('a', { kind: 'pool', label: 'A', activation: 'passive', initial: 10, capacity: null, mode: 'pullAny', ...(poolRT !== undefined ? { resourceType: poolRT } : {}) }),
      node('b', { kind: 'drain', label: 'B', activation: 'automatic', mode: 'pullAny' }),
    ] as LoopNode[],
    edges: [rEdge('e', 'a', 'b', { kind: 'resource', flow: '1', ...(edgeRT !== undefined ? { resourceType: edgeRT } : {}) })] as LoopEdge[],
  })

  it('setting a pool resourceType flips dirty and is an advisory diff — not engineAffecting', () => {
    const before = canonicalContent(g())
    const after = canonicalContent(g('Gold'))
    expect(digestOfCanonical(before)).not.toBe(digestOfCanonical(after))
    const d = computeRevisionDiff(before, after)
    expect(d.summary.engineAffecting).toBe(false)
    expect(d.summary.advisoryAffecting).toBe(true)
    expect(d.nodes.changed[0].fields[0].tag).toBe('advisory')
  })

  it('trim / NFC applied; an over-cap value is dropped (not truncated) with the field absent', () => {
    expect(normalizeResourceType('  Gold  ').value).toBe('Gold')
    const proj = canonicalContent(g('A'.repeat(65)))
    expect('resourceType' in proj.nodes[0].data).toBe(false)
  })

  it('a mismatch finding is emitted but changes no number and no connection', () => {
    const graph = g('Energy', 'Gold') // pool A is Energy, edge is Gold
    const findings = resourceTypeMismatches({
      resourceEdges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, resourceType: (e.data as { resourceType?: unknown }).resourceType })),
      nodeKind: (id) => (graph.nodes.find((n) => n.id === id)?.data as { kind: string }).kind,
      nodeResourceType: (id) => (graph.nodes.find((n) => n.id === id)?.data as { resourceType?: unknown }).resourceType,
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ edgeId: 'e', endpoint: 'source', edgeType: 'Gold', nodeType: 'Energy' })

    // the run is byte-identical to the same graph with NO resource types —
    // §M4.2, mismatch is computation-neutral
    const plain = g()
    let s1 = initSim(graph.nodes)
    let s2 = initSim(plain.nodes)
    for (let i = 0; i < 8; i++) {
      const r1 = step(graph.nodes, graph.edges, s1, 1)
      const r2 = step(plain.nodes, plain.edges, s2, 1)
      expect(r1.state).toEqual(r2.state)
      s1 = r1.state
      s2 = r2.state
    }
    expect(step(graph.nodes, graph.edges, initSim(graph.nodes), 1).report.events.some((ev) => ev.edgeId === 'e')).toBe(true)
  })
})
