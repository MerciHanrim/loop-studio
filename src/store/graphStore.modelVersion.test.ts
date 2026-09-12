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

  it('an explicit v1 → v2 promotion bumps simulationRev (⇒ any MC result goes stale) (M2-INV-12)', () => {
    const { edgeId } = base()
    const before = g().simulationRev
    g().setEdgeData(edgeId, { kind: 'resource', flow: '@p' })
    expect(mv()).toBe(2)
    expect(g().simulationRev).toBeGreaterThan(before)
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

  // docs/module-system.md §MS3.5 — `HistoryEntry` carries `modelVersion`, so
  // undo / redo restore it alongside the graph. Every history entry must capture
  // the `modelVersion` that was live when it was pushed.
  describe('modelVersion rides the undo history', () => {
    it('a purely-v1 session stays v1 across every undo and redo', () => {
      g().newGraph()
      g().addNodeAt('pool', { x: 0, y: 0 })
      g().addNodeAt('pool', { x: 100, y: 0 })
      g().addNodeAt('pool', { x: 200, y: 0 })
      expect(mv()).toBe(1)
      for (let i = 0; i < 3; i++) {
        g().undo()
        expect(mv()).toBe(1)
      }
      for (let i = 0; i < 3; i++) {
        g().redo()
        expect(mv()).toBe(1)
      }
    })

    it('undo of the promoting edit reverts to v1; redo brings v2 back; deeper history stays v1', () => {
      const { edgeId } = base() // source + pool + edge, all committed as v1 entries
      expect(mv()).toBe(1)
      g().setEdgeData(edgeId, { kind: 'resource', flow: '@p' }) // the promotion
      expect(mv()).toBe(2)
      g().addNodeAt('pool', { x: 400, y: 0 }) // one more edit, its entry captures v2
      expect(mv()).toBe(2)

      g().undo() // drop the extra pool — still v2
      expect(mv()).toBe(2)
      g().undo() // undo the promoting flow edit — back to v1
      expect(mv()).toBe(1)
      g().undo() // deeper into the v1-era history
      expect(mv()).toBe(1)

      g().redo() // re-add the edge
      expect(mv()).toBe(1)
      g().redo() // re-apply the promoting flow edit — v2 again
      expect(mv()).toBe(2)
      g().redo() // re-add the extra pool
      expect(mv()).toBe(2)
    })

    it('undo of a v2-document load restores the pre-load v1', () => {
      const v2 = serialize(
        [
          { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'a' } } as never,
          { id: 'b', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'b' } } as never,
        ],
        [{ id: 'e', source: 'a', target: 'b', type: 'loop', data: { kind: 'resource', flow: '@p' } } as never],
        undefined,
        undefined,
        undefined,
        2,
      )
      g().newGraph()
      g().addNodeAt('pool', { x: 0, y: 0 })
      expect(mv()).toBe(1)
      g().loadJSON(v2)
      expect(mv()).toBe(2)
      g().undo() // the load's history entry captured the pre-load v1
      expect(mv()).toBe(1)
      g().redo()
      expect(mv()).toBe(2)
    })
  })

  // docs/parameter-activator.md §PA11-D4 — the same one-way latch, triggered
  // by a state-edge `activator` `expr` instead of a resource-edge `flow`.
  describe('the SAME latch extends to a param-term activator (PA11-D4)', () => {
    it('committing an activator whose RHS is a param-term latches v2', () => {
      const { edgeId } = base()
      g().setEdgeData(edgeId, { kind: 'state', mode: 'activator', expr: '>= @hard_pity - 1' })
      expect(mv()).toBe(2)
    })

    it('a bare @id reference (no offset) also latches', () => {
      const { edgeId } = base()
      g().setEdgeData(edgeId, { kind: 'state', mode: 'activator', expr: '>= @hard_pity' })
      expect(mv()).toBe(2)
    })

    it('an ordinary literal activator does NOT promote', () => {
      const { edgeId } = base()
      g().setEdgeData(edgeId, { kind: 'state', mode: 'activator', expr: '>= 5' })
      expect(mv()).toBe(1)
    })

    it('a grammar-invalid string that merely contains an "@" does NOT promote (it is not a param-term)', () => {
      const { edgeId } = base()
      g().setEdgeData(edgeId, { kind: 'state', mode: 'activator', expr: '>= @a - @b' })
      expect(mv()).toBe(1)
    })

    it('bumps simulationRev, same as the flow-reference promotion (M2-INV-12)', () => {
      const { edgeId } = base()
      const before = g().simulationRev
      g().setEdgeData(edgeId, { kind: 'state', mode: 'activator', expr: '>= @hard_pity - 1' })
      expect(mv()).toBe(2)
      expect(g().simulationRev).toBeGreaterThan(before)
    })

    it('is a one-way latch — removing the reference does not downgrade', () => {
      const { edgeId } = base()
      g().setEdgeData(edgeId, { kind: 'state', mode: 'activator', expr: '>= @hard_pity - 1' })
      expect(mv()).toBe(2)
      g().setEdgeData(edgeId, { kind: 'state', mode: 'activator', expr: '>= 5' })
      expect(mv()).toBe(2)
    })

    it('opening a v1 file that already contains a param-term-shaped expr does NOT promote it on load', () => {
      const v1 = serialize(
        [
          { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'a' } } as never,
          { id: 'b', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'b' } } as never,
        ],
        [
          {
            id: 'e', source: 'a', target: 'b', type: 'loop',
            sourceHandle: 'state-source', targetHandle: 'state-target',
            data: { kind: 'state', mode: 'activator', expr: '>= @hard_pity - 1' },
          } as never,
        ],
      )
      g().loadJSON(v1)
      expect(mv()).toBe(1)
      const out = JSON.parse(g().exportJSON())
      expect(out.schema).toBe('loop-studio/graph')
      expect(out.edges[0].data.expr).toBe('>= @hard_pity - 1')
    })
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
