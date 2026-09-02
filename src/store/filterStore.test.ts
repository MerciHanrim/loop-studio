import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { filtersActive, useFilterStore } from './filterStore'

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
    useGraphStore.getState().loadGraph({ nodes: [], edges: [] })
    expect(useGraphStore.getState().loadRev).toBe(loadRevBefore + 1)
    expect(filtersActive(useFilterStore.getState())).toBe(false)
  })
})
