import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'
import { EDGE_CLASSES, NODE_KINDS, UNTYPED, type EdgeClass } from '../store/filterStore'
import { computeHidden, graphResourceTypes } from './filterSet'

// docs/large-graph-readability.md §LGR3.2 — the transient-filter view layer.
// Pure: turn the filter selections into the ids React Flow renders `hidden`.

const node = (id: string, kind: NodeKind, extra: Record<string, unknown> = {}): LoopNode =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id, ...extra } }) as LoopNode

const resEdge = (id: string, source: string, target: string, resourceType?: string): LoopEdge =>
  ({
    id,
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    type: 'loop',
    data: { kind: 'resource', flow: '1', ...(resourceType ? { resourceType } : {}) },
  }) as LoopEdge

const stateEdge = (id: string, source: string, target: string): LoopEdge =>
  ({
    id,
    source,
    target,
    sourceHandle: 'state-source',
    targetHandle: 'state-target',
    type: 'loop',
    data: { kind: 'state', mode: 'activator', expr: '>= 1' },
  }) as LoopEdge

const sel = (o: {
  edgeClasses?: EdgeClass[]
  resourceTypes?: string[]
  nodeKinds?: NodeKind[]
}) => ({
  hiddenEdgeClasses: new Set(o.edgeClasses ?? []),
  hiddenResourceTypes: new Set(o.resourceTypes ?? []),
  hiddenNodeKinds: new Set(o.nodeKinds ?? []),
})

describe('graphResourceTypes — built from the graph, not a fixed palette (§LGR3.2)', () => {
  it('collects normalised resourceType from pools + resource edges, deduped + sorted', () => {
    const nodes = [
      node('p1', 'pool', { resourceType: 'supply' }),
      node('p2', 'pool', { resourceType: 'currency' }),
      node('p3', 'pool', { resourceType: '  currency  ' }), // normalises to the same
      node('p4', 'pool'), // untyped — not in the typed list
      node('s1', 'source', { resourceType: 'ignored' }), // only pools carry it
    ]
    const edges = [
      resEdge('e1', 'p1', 'p2', 'power'),
      resEdge('e2', 'p2', 'p3'), // untyped edge
      stateEdge('e3', 'p1', 'p4'), // state edges never contribute
    ]
    expect(graphResourceTypes(nodes, edges)).toEqual(['currency', 'power', 'supply'])
  })

  it('an empty graph has no typed entries', () => {
    expect(graphResourceTypes([], [])).toEqual([])
  })
})

describe('computeHidden', () => {
  const nodes = [
    node('src', 'source'),
    node('gold', 'pool', { resourceType: 'currency' }),
    node('mana', 'pool', { resourceType: 'power' }),
    node('plain', 'pool'),
    node('end', 'end'),
  ]
  const edges = [
    resEdge('r_src_gold', 'src', 'gold', 'currency'),
    resEdge('r_gold_mana', 'gold', 'mana'),
    resEdge('r_mana_end', 'mana', 'end', 'power'),
    stateEdge('s_gold_src', 'gold', 'src'),
  ]

  it('returns null when no filter is active', () => {
    expect(computeHidden(nodes, edges, sel({}))).toBeNull()
  })

  it('hide a node kind → its nodes and every incident edge go (§LGR3.2)', () => {
    const h = computeHidden(nodes, edges, sel({ nodeKinds: ['end'] }))!
    expect([...h.nodes]).toEqual(['end'])
    // r_mana_end is incident to `end`; the others are not
    expect([...h.edges].sort()).toEqual(['r_mana_end'])
  })

  it('hide an edge class → only that class of edge, endpoints untouched', () => {
    const h = computeHidden(nodes, edges, sel({ edgeClasses: ['state'] }))!
    expect(h.nodes.size).toBe(0)
    expect([...h.edges]).toEqual(['s_gold_src'])
  })

  it('hide a resource type → typed pools + typed resource edges + incident edges', () => {
    const h = computeHidden(nodes, edges, sel({ resourceTypes: ['currency'] }))!
    expect([...h.nodes]).toEqual(['gold']) // the currency pool
    // r_src_gold is currency-typed; r_gold_mana + s_gold_src are incident to `gold`
    expect([...h.edges].sort()).toEqual(['r_gold_mana', 'r_src_gold', 's_gold_src'])
  })

  it('hide the untyped bucket → only pools / resource edges with no resourceType', () => {
    const h = computeHidden(nodes, edges, sel({ resourceTypes: [UNTYPED] }))!
    expect([...h.nodes]).toEqual(['plain'])
    // r_gold_mana has no resourceType; state edges are never resource-typed
    expect([...h.edges]).toEqual(['r_gold_mana'])
  })

  it('composes: a node hidden by one axis drags its edges out regardless of their own class/type', () => {
    const h = computeHidden(nodes, edges, sel({ nodeKinds: ['pool'] }))!
    expect([...h.nodes].sort()).toEqual(['gold', 'mana', 'plain'])
    // every edge here touches a pool
    expect([...h.edges].sort()).toEqual(['r_gold_mana', 'r_mana_end', 'r_src_gold', 's_gold_src'])
  })
})

describe('constants', () => {
  it('EDGE_CLASSES / NODE_KINDS are the documented sets (§LGR3.2)', () => {
    expect([...EDGE_CLASSES]).toEqual(['resource', 'state'])
    expect([...NODE_KINDS]).toEqual([
      'source',
      'pool',
      'gate',
      'converter',
      'drain',
      'end',
      'parameter',
      'register',
    ])
  })
})
