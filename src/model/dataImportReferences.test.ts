import { describe, expect, it } from 'vitest'
import { findReferences } from './dataImportReferences'
import type { LoopEdge, LoopNode } from './types'

// docs/data-import.md §DI-D9 -- Phase 2. `findReferences` is the new
// delete-with-reference-check scanner: verify each of the four `via` kinds
// independently, plus a clean "no reference at all" case that must allow a
// delete to proceed.

const target = (): LoopNode =>
  ({ id: 'target', type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: 'T', value: 1 } }) as LoopNode

const pool = (id: string): LoopNode =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as LoopNode

const register = (id: string, expr: string): LoopNode =>
  ({ id, type: 'register', position: { x: 0, y: 0 }, data: { kind: 'register', label: id, expr } }) as LoopNode

describe('findReferences', () => {
  it('finds an incident edge (either direction) by edgeId', () => {
    const nodes = [target(), pool('a')]
    const edges: LoopEdge[] = [
      { id: 'e1', source: 'target', target: 'a', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    ]
    const refs = findReferences(nodes, edges, 1, 'target')
    expect(refs).toEqual([{ via: 'incident-edge', edgeId: 'e1' }])
  })

  it('finds a Register expr reference by nodeId, never an edgeId', () => {
    const nodes = [target(), register('r1', '@target + 1')]
    const refs = findReferences(nodes, [], 1, 'target')
    expect(refs).toEqual([{ via: 'register', nodeId: 'r1' }])
  })

  it('a Register with an unparseable expr is skipped, never throws', () => {
    const nodes = [target(), register('r1', '@target +')]
    expect(() => findReferences(nodes, [], 1, 'target')).not.toThrow()
    expect(findReferences(nodes, [], 1, 'target')).toEqual([])
  })

  it('finds a v2 resource-edge flow reference by edgeId, never in a v1 document', () => {
    const nodes = [target(), pool('a'), pool('b')]
    const edges: LoopEdge[] = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '@target' } },
    ]
    expect(findReferences(nodes, edges, 2, 'target')).toEqual([{ via: 'resource-flow', edgeId: 'e1' }])
    // v1: a leading `@` is just an unparseable literal, never a reference (loop-model/2's own rule)
    expect(findReferences(nodes, edges, 1, 'target')).toEqual([])
  })

  // issue #393 C — the Properties panel's "Connections that use this value"
  // rows come from this scanner now; it must match by parsed id, so a
  // Parameter whose id is the start of another's is not confused with it, and
  // the `@{id}` spelling the grammar accepts counts too
  it('matches a reference by id, not by text: `a` is not `ab`, and `@{a}` is `a`', () => {
    const param = (id: string): LoopNode =>
      ({ id, type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: id, value: 1 } }) as LoopNode
    const nodes = [param('a'), param('ab'), pool('p'), pool('q')]
    const edge = (id: string, data: LoopEdge['data']): LoopEdge =>
      ({ id, source: 'p', target: 'q', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data }) as LoopEdge
    const edges = [
      edge('flowAb', { kind: 'resource', flow: '@ab' }),
      edge('flowBraced', { kind: 'resource', flow: '@{a}' }),
      edge('actAb', { kind: 'state', mode: 'activator', expr: '>=@ab' } as LoopEdge['data']),
      edge('actA', { kind: 'state', mode: 'activator', expr: '>=@a' } as LoopEdge['data']),
    ]
    const edgeIds = (id: string) => findReferences(nodes, edges, 2, id).flatMap((r) => ('edgeId' in r ? [r.edgeId] : []))
    expect(edgeIds('a')).toEqual(['flowBraced', 'actA'])
    expect(edgeIds('ab')).toEqual(['flowAb', 'actAb'])
  })

  it('finds a state-edge activator param-term reference by edgeId', () => {
    const nodes = [target(), pool('a'), pool('b')]
    const edges: LoopEdge[] = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'state', mode: 'activator', expr: '>=@target' } },
    ]
    expect(findReferences(nodes, edges, 2, 'target')).toEqual([{ via: 'activator', edgeId: 'e1' }])
  })

  it('a node with no reference at all is reported clean -- delete may proceed', () => {
    const nodes = [target(), pool('a'), register('r1', '@a + 1')]
    const edges: LoopEdge[] = [
      { id: 'e1', source: 'a', target: 'a', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    ]
    expect(findReferences(nodes, edges, 2, 'target')).toEqual([])
  })

  it('collects every reference kind at once when several exist', () => {
    const nodes = [target(), register('r1', '@target')]
    const edges: LoopEdge[] = [
      { id: 'e1', source: 'target', target: 'target', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      { id: 'e2', source: 'r1', target: 'r1', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'state', mode: 'activator', expr: '>=@target' } },
    ]
    const refs = findReferences(nodes, edges, 2, 'target')
    expect(refs).toEqual(
      expect.arrayContaining([
        { via: 'incident-edge', edgeId: 'e1' },
        { via: 'register', nodeId: 'r1' },
        { via: 'activator', edgeId: 'e2' },
      ]),
    )
    expect(refs).toHaveLength(3)
  })
})
