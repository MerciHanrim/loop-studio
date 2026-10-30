import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from './types'
import { canonicalGraphString, semanticDigest } from './workspace'

// issue #409 — the semantic digest (§W3.1 / §W11) projects a Parameter's
// `value` under the loop-model/2 projection ONLY (erratum, Lumi, 2026-10-30):
// a `flow: "@p"` resolves it at every step, so two v2 documents that differ in
// it compute different runs and must not share a digest. Under v1 the value
// is not an engine input and the bytes stay exactly as before (M2-INV-9). The
// other Parameter fields and a Register's `expr` stay out.

const node = (id: string, data: LoopNode['data']): LoopNode => ({ id, type: data.kind, position: { x: 0, y: 0 }, data })
const graph = (value: number, poolInitial = 0, extra: Record<string, unknown> = {}) => {
  const nodes: LoopNode[] = [
    node('s', { kind: 'source', label: 'S', activation: 'automatic' } as LoopNode['data']),
    node('q', { kind: 'pool', label: 'Q', activation: 'passive', initial: poolInitial, capacity: null, mode: 'pullAny' } as LoopNode['data']),
    node('p', { kind: 'parameter', label: 'p', value, ...extra } as LoopNode['data']),
  ]
  const edges: LoopEdge[] = [
    { id: 'e', source: 's', target: 'q', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '@p' } } as LoopEdge,
  ]
  return { nodes, edges }
}

describe('a Parameter value and the semantic digest (#409)', () => {
  it('v2: two documents that differ only in p.value hash differently, and the canonical string carries the value', async () => {
    const one = graph(1)
    const two = graph(2)
    expect(canonicalGraphString(one, 2)).not.toBe(canonicalGraphString(two, 2))
    expect(await semanticDigest(one, 2)).not.toBe(await semanticDigest(two, 2))
    expect(canonicalGraphString(one, 2)).toContain('"value":1')
  })

  it('v1: the bytes are unchanged — the same two documents hash alike and carry no value key (M2-INV-9)', async () => {
    const one = graph(1)
    const two = graph(2)
    expect(canonicalGraphString(one, 1)).toBe(canonicalGraphString(two, 1))
    expect(canonicalGraphString(one, undefined)).toBe(canonicalGraphString(two, undefined))
    expect(await semanticDigest(one, 1)).toBe(await semanticDigest(two, 1))
    expect(canonicalGraphString(one, 1)).not.toContain('"value"')
  })

  it('v2: the value is the only Parameter field projected — min, max, step, unit and the data-import provenance keys do not move the digest', async () => {
    const base = await semanticDigest(graph(1), 2)
    expect(await semanticDigest(graph(1, 0, { min: 0, max: 9, step: 0.5, unit: 'kg' }), 2)).toBe(base)
    expect(await semanticDigest(graph(1, 0, { sourceTableId: 't', sourceKey: 'k', sourceColumnId: 'c' }), 2)).toBe(base)
    expect(await semanticDigest(graph(1, 0, { label: 'renamed' }), 2)).toBe(base)
  })

  it('control: a Pool initial, a flow string and the model-semantics version each move the digest', async () => {
    const base = await semanticDigest(graph(1), 2)
    expect(await semanticDigest(graph(1, 5), 2)).not.toBe(base)
    const g = graph(1)
    ;(g.edges[0].data as { flow: string }).flow = '@p+1'
    expect(await semanticDigest(g, 2)).not.toBe(base)
    expect(await semanticDigest(graph(1), 1)).not.toBe(base)
  })
})
