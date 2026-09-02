import { beforeEach, describe, expect, it } from 'vitest'
import { serialize } from '../model/serialize'
import { useGraphStore } from './graphStore'

// loop-model/2 (SEMANTICS-M2.md §M2-1.1) — the document's model-semantics
// version: explicit, one-way, never promoted by a plain open/save.

const g = () => useGraphStore.getState()
const mv = () => g().modelVersion

function base() {
  g().newGraph()
  g().addNodeAt('source', { x: 0, y: 0 })
  g().addNodeAt('pool', { x: 200, y: 0 })
  const [s, p] = g().nodes
  g().onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' })
  return { edgeId: g().edges[0].id }
}

beforeEach(() => {
  g().newGraph()
})

describe('graphStore.modelVersion', () => {
  it('a fresh graph is v1', () => {
    expect(mv()).toBe(1)
  })

  it('newGraph resets to v1', () => {
    const { edgeId } = base()
    g().setEdgeData(edgeId, { kind: 'resource', flow: '@p' })
    expect(mv()).toBe(2)
    g().newGraph()
    expect(mv()).toBe(1)
  })

  it('committing a leading-@ flow — well-formed OR malformed — latches v2 (PI-D11)', () => {
    let e = base().edgeId
    g().setEdgeData(e, { kind: 'resource', flow: '@daily_roast' })
    expect(mv()).toBe(2)

    g().newGraph()
    e = base().edgeId
    g().setEdgeData(e, { kind: 'resource', flow: '@{visitor' }) // a typo
    expect(mv()).toBe(2) // still promoted — the edge will run 0 + a diagnostic, never 1
  })

  it('an ordinary literal flow edit does NOT promote', () => {
    const { edgeId } = base()
    g().setEdgeData(edgeId, { kind: 'resource', flow: '3' })
    expect(mv()).toBe(1)
    g().setEdgeData(edgeId, { kind: 'resource', flow: '2D6' })
    expect(mv()).toBe(1)
  })

  it('v2 is a one-way latch — removing the reference does not downgrade', () => {
    const { edgeId } = base()
    g().setEdgeData(edgeId, { kind: 'resource', flow: '@p' })
    expect(mv()).toBe(2)
    g().setEdgeData(edgeId, { kind: 'resource', flow: '1' })
    expect(mv()).toBe(2)
  })

  it('exportJSON writes the v1 schema until the graph is promoted, then v2', () => {
    const { edgeId } = base()
    expect(JSON.parse(g().exportJSON()).schema).toBe('loop-studio/graph')
    g().setEdgeData(edgeId, { kind: 'resource', flow: '@p' })
    expect(JSON.parse(g().exportJSON()).schema).toBe('loop-studio/graph/2')
  })

  it('loadJSON of a v2 document sets the store to v2; a v1 document sets it to v1', () => {
    const v2 = serialize(
      [
        { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'a' } } as never,
        { id: 'b', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'b' } } as never,
      ],
      [
        {
          id: 'e', source: 'a', target: 'b', type: 'loop',
          data: { kind: 'resource', flow: '@p' },
        } as never,
      ],
      undefined,
      undefined,
      undefined,
      2,
    )
    g().loadJSON(v2)
    expect(mv()).toBe(2)

    g().loadJSON(v2.replace('loop-studio/graph/2', 'loop-studio/graph'))
    expect(mv()).toBe(1)
  })

  it('a v1 document whose flow ALREADY contains "@foo" is not promoted by loading it', () => {
    const v1 = serialize(
      [
        { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'a' } } as never,
        { id: 'b', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'b' } } as never,
      ],
      [{ id: 'e', source: 'a', target: 'b', type: 'loop', data: { kind: 'resource', flow: '@foo' } } as never],
    )
    g().loadJSON(v1)
    expect(mv()).toBe(1)
    // and re-exporting keeps the v1 schema + the verbatim "@foo"
    const out = JSON.parse(g().exportJSON())
    expect(out.schema).toBe('loop-studio/graph')
    expect(out.edges[0].data.flow).toBe('@foo')
  })
})
