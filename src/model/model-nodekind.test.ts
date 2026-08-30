import { describe, expect, it } from 'vitest'
import RISKY from '../../examples/risky-factory.json'
import { initSim, step } from '../engine'
import { createNode, defaultData } from './factory'
import { canonicalContent, digestOfCanonical, isModelLayerContent } from './revision'
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
  })
})
