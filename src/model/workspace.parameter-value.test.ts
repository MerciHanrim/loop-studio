import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from './types'
import { canonicalGraphString, semanticDigest } from './workspace'

// issue #409 — reproduction on current main. Two documents that differ ONLY in
// a Parameter's `value`, which a loop-model/2 flow `@p` resolves at every
// step: do they get the same semantic digest (§W3.1), the one binding a saved
// Monte Carlo result to the graph it ran on?

const node = (id: string, data: LoopNode['data']): LoopNode => ({ id, type: data.kind, position: { x: 0, y: 0 }, data })
const graph = (value: number, poolInitial = 0) => {
  const nodes: LoopNode[] = [
    node('s', { kind: 'source', label: 'S', activation: 'automatic' } as LoopNode['data']),
    node('q', { kind: 'pool', label: 'Q', activation: 'passive', initial: poolInitial, capacity: null, mode: 'pullAny' } as LoopNode['data']),
    node('p', { kind: 'parameter', label: 'p', value } as LoopNode['data']),
  ]
  const edges: LoopEdge[] = [
    { id: 'e', source: 's', target: 'q', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '@p' } } as LoopEdge,
  ]
  return { nodes, edges }
}

describe('a Parameter value and the semantic digest (#409)', () => {
  it('two documents that differ only in p.value hash to the same canonical string and digest, under v1 and under v2', async () => {
    const one = graph(1)
    const two = graph(2)
    expect(one.nodes[2].data).not.toEqual(two.nodes[2].data) // the inputs differ
    for (const v of [1, 2] as const) {
      expect(canonicalGraphString(one, v)).toBe(canonicalGraphString(two, v))
      expect(await semanticDigest(one, v)).toBe(await semanticDigest(two, v))
    }
    // and the projection carries no `value` key at all
    expect(canonicalGraphString(one, 2)).not.toContain('"value"')
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
