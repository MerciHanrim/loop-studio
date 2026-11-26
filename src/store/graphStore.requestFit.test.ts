import { describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'

// issue #616 item 3 — a share link asks the Canvas for the app's fit (`requestFit`): one
// `fitRev` step marked as asked for, so it replaces React Flow's own first fit. A Template's
// swap (`loadGraph`) keeps the Canvas's guard against a camera the user moved.

describe('graphStore.requestFit', () => {
  it('moves fitRev by one and marks the fit as asked for; nothing in the document changes', () => {
    const g = useGraphStore.getState()
    g.loadGraph({ nodes: [], edges: [] }, { canvasLocked: false })
    const before = useGraphStore.getState()
    useGraphStore.getState().requestFit()
    const after = useGraphStore.getState()
    expect(after.fitRev).toBe(before.fitRev + 1)
    expect(after.fitRequested).toBe(true)
    expect(after.loadRev).toBe(before.loadRev)
    expect(after.simulationRev).toBe(before.simulationRev)
    expect(after.nodes).toBe(before.nodes)
  })

  it('control: a Template swap is not an asked-for fit', () => {
    useGraphStore.getState().requestFit()
    useGraphStore.getState().loadGraph({ nodes: [], edges: [] }, { canvasLocked: false })
    expect(useGraphStore.getState().fitRequested).toBe(false)
  })
})
