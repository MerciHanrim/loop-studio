import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { filtersActive, useFilterStore } from './filterStore'
import { computeHidden } from '../components/filterSet'

// docs/large-graph-readability.md §LGR3.2 / §LGR3.4 — the ephemeral filter
// selections: toggle in/out, an all-clear, and the "dropped on every whole-graph
// (re)load" rule (via graphStore.loadRev).

beforeEach(() => {
  useFilterStore.getState().clear()
})

describe('filterStore — toggles', () => {
  it('toggle adds then removes; sets are immutable snapshots', () => {
    const { toggleNodeKind } = useFilterStore.getState()
    const before = useFilterStore.getState().hiddenNodeKinds
    toggleNodeKind('pool')
    const after = useFilterStore.getState().hiddenNodeKinds
    expect(after).not.toBe(before) // new Set, not mutated
    expect(after.has('pool')).toBe(true)
    toggleNodeKind('pool')
    expect(useFilterStore.getState().hiddenNodeKinds.has('pool')).toBe(false)
  })

  it('the three axes are independent', () => {
    const s = useFilterStore.getState()
    s.toggleEdgeClass('state')
    s.toggleResourceType('currency')
    s.toggleNodeKind('end')
    const st = useFilterStore.getState()
    expect([...st.hiddenEdgeClasses]).toEqual(['state'])
    expect([...st.hiddenResourceTypes]).toEqual(['currency'])
    expect([...st.hiddenNodeKinds]).toEqual(['end'])
  })

  it('filtersActive / clear', () => {
    expect(filtersActive(useFilterStore.getState())).toBe(false)
    useFilterStore.getState().toggleEdgeClass('resource')
    expect(filtersActive(useFilterStore.getState())).toBe(true)
    useFilterStore.getState().clear()
    expect(filtersActive(useFilterStore.getState())).toBe(false)
    expect(useFilterStore.getState().hiddenEdgeClasses.size).toBe(0)
  })

  it('clear is a no-op reference when already empty', () => {
    const before = useFilterStore.getState()
    useFilterStore.getState().clear()
    expect(useFilterStore.getState().hiddenEdgeClasses).toBe(before.hiddenEdgeClasses)
  })
})

describe('filterStore — §LGR3.4 cleared on a whole-graph (re)load', () => {
  it('a graphStore load (loadRev bump) drops the selections; an edit does not', () => {
    useFilterStore.getState().toggleNodeKind('pool')
    useFilterStore.getState().toggleResourceType('currency')
    expect(filtersActive(useFilterStore.getState())).toBe(true)

    // an edit bumps simulationRev but NOT loadRev — filters survive
    const loadRevBefore = useGraphStore.getState().loadRev
    useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
    expect(useGraphStore.getState().loadRev).toBe(loadRevBefore)
    expect(filtersActive(useFilterStore.getState())).toBe(true)

    // a whole-graph load bumps loadRev → the subscription clears the filters
    useGraphStore.getState().loadGraph({ nodes: [], edges: [] }, { canvasLocked: false })
    expect(useGraphStore.getState().loadRev).toBe(loadRevBefore + 1)
    expect(filtersActive(useFilterStore.getState())).toBe(false)
  })
})

// issue #616 item 2 — a hidden node kind whose last node an edit removes leaves the
// hidden set: the panel offers no row for an absent kind, so it could never be
// unticked, and the next node of that kind was hidden the moment it was made.
// Another kind's hidden choice is kept.
describe('filterStore — #616 item 2: a hidden kind with no node left is dropped', () => {
  const ids = (kind: string) => useGraphStore.getState().nodes.filter((n) => n.data.kind === kind).map((n) => n.id)
  const hiddenKinds = () => [...useFilterStore.getState().hiddenNodeKinds].sort()
  const hiddenNow = () => {
    const g = useGraphStore.getState()
    const f = useFilterStore.getState()
    return computeHidden(g.nodes, g.edges, { hiddenEdgeClasses: f.hiddenEdgeClasses, hiddenResourceTypes: f.hiddenResourceTypes, hiddenNodeKinds: f.hiddenNodeKinds })
  }
  /** a document with one Drain and two Pools; Drain and Pool hidden */
  const setUp = () => {
    const g = useGraphStore.getState()
    g.loadGraph({ nodes: [], edges: [] }, { canvasLocked: false })
    g.addNodeAt('drain', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 200, y: 0 })
    g.addNodeAt('pool', { x: 400, y: 0 })
    useFilterStore.getState().toggleNodeKind('drain')
    useFilterStore.getState().toggleNodeKind('pool')
    expect(hiddenKinds()).toEqual(['drain', 'pool'])
  }

  it('the last Drain deleted: `drain` leaves the hidden set, and a new Drain is not hidden', () => {
    setUp()
    useGraphStore.getState().removeNode(ids('drain')[0])
    expect(hiddenKinds()).toEqual(['pool'])
    useGraphStore.getState().addNodeAt('drain', { x: 0, y: 200 })
    const [fresh] = ids('drain')
    expect(hiddenNow()?.nodes.has(fresh), 'the new Drain is drawn').toBe(false)
  })

  it('control: the other hidden kind is kept, and its nodes stay hidden', () => {
    setUp()
    useGraphStore.getState().removeNode(ids('drain')[0])
    expect(hiddenKinds()).toContain('pool')
    for (const id of ids('pool')) expect(hiddenNow()?.nodes.has(id), id).toBe(true)
  })

  it('control: a hidden kind that still has a node stays hidden', () => {
    setUp()
    useGraphStore.getState().removeNode(ids('pool')[0])
    expect(hiddenKinds()).toEqual(['drain', 'pool'])
    expect(hiddenNow()?.nodes.has(ids('pool')[0])).toBe(true)
  })
})
