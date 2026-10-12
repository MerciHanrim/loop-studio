import { describe, expect, it } from 'vitest'
import { canonicalContent, canonicalJson, fieldTag } from './revision'
import { normalizeGraph, serialize } from './serialize'
import { canonicalGraphString } from './workspace'
import type { LoopEdge, LoopNode } from './types'

const nodes: LoopNode[] = [
  { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  { id: 'b', type: 'drain', position: { x: 200, y: 0 }, data: { kind: 'drain', label: 'B', activation: 'automatic', mode: 'pullAny' } },
] as LoopNode[]
const plain: LoopEdge = { id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1', route: 'orthogonal' } } as LoopEdge
const faced: LoopEdge = { ...plain, data: { ...plain.data, ports: { source: 'bottom', target: 'top' } } } as LoopEdge

describe('port faces in the document (17-implementation-rules.md §4.2)', () => {
  it('never reach the engine digest: the canonical graph string is identical with and without faces', () => {
    expect(canonicalGraphString({ nodes, edges: [faced] })).toBe(canonicalGraphString({ nodes, edges: [plain] }))
  })

  it('are revision content, tagged cosmetic: projected trailing, diffed, absent when none is stored', () => {
    expect(fieldTag('edge', 'data.ports')).toBe('cosmetic')
    const withFaces = canonicalJson(canonicalContent({ nodes, edges: [faced] }))
    const without = canonicalJson(canonicalContent({ nodes, edges: [plain] }))
    expect(withFaces).not.toBe(without)
    expect(withFaces).toContain('"ports":{"source":"bottom","target":"top"}')
    expect(without).not.toContain('ports')
    // the projected key order: `ports` after `accent`'s slot, i.e. last
    const idx = withFaces.indexOf('"ports"')
    expect(idx).toBeGreaterThan(withFaces.indexOf('"route"'))
  })

  it('a document without faces serializes to the same bytes as before, and one with faces round-trips them', () => {
    const t0 = serialize(nodes, [plain])
    expect(t0).not.toContain('ports')
    const t1 = serialize(nodes, [faced])
    const back = normalizeGraph(JSON.parse(t1))
    expect(back.edges[0].data).toMatchObject({ ports: { source: 'bottom', target: 'top' } })
    expect(back.edges[0].sourceHandle).toBe('out')
    expect(back.edges[0].targetHandle).toBe('in')
    expect(serialize(back.nodes, back.edges)).toBe(t1)
  })

  it('the normaliser keeps only valid faces and drops an empty payload', () => {
    const bad = { ...plain, data: { ...plain.data, ports: { source: 'sideways', target: 'top' } } } as unknown as LoopEdge
    expect(normalizeGraph({ nodes, edges: [bad] }).edges[0].data).toMatchObject({ ports: { target: 'top' } })
    const empty = { ...plain, data: { ...plain.data, ports: { source: 'sideways' } } } as unknown as LoopEdge
    expect((normalizeGraph({ nodes, edges: [empty] }).edges[0].data as { ports?: unknown }).ports).toBeUndefined()
  })
})
