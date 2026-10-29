import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { MC_DEFAULT_CONFIG, useMcStore } from './mcStore'

// issue #407 — reproduction on current main. A Monte Carlo run copies the graph
// and `simulationRev` when it starts; the graph is edited while the run is in
// flight (the cooperative runner yields to the event loop between batches, so
// an edit lands between two batches exactly as a user's edit lands between two
// Worker progress messages); the result then arrives. Which graph is the result
// computed from, and how is it labelled?

function seedGraph() {
  const g = useGraphStore.getState()
  g.newGraph()
  g.addNodeAt('source', { x: 0, y: 0 })
  g.addNodeAt('pool', { x: 200, y: 0 })
  const [s, p] = useGraphStore.getState().nodes
  useGraphStore.getState().onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  const e = useGraphStore.getState().edges[0]
  useGraphStore.getState().setEdgeData(e.id, { kind: 'resource', flow: '1-3' })
  useGraphStore.getState().updateNodeData(p.id, { initial: 100 })
  return { poolId: p.id }
}

beforeEach(() => {
  useMcStore.getState().clear()
  useMcStore.getState().setConfig(MC_DEFAULT_CONFIG)
})

describe('a graph edit while a Monte Carlo run is in flight (#407)', () => {
  it('the result is computed from the graph at run START, and lands labelled as current (stale: false) although the graph has changed', async () => {
    const { poolId } = seedGraph()
    const revAtStart = useGraphStore.getState().simulationRev
    // enough batches for the runner to yield at least once (batchSize 64 ⇒ 4 yields)
    useMcStore.getState().setConfig({ runs: 300, steps: 5, tracked: [poolId] })

    const running = useMcStore.getState().run()
    expect(useMcStore.getState().status).toBe('running')

    // the edit arrives after the first batch has been handed its yield
    await new Promise((r) => setTimeout(r, 0))
    expect(useMcStore.getState().status).toBe('running') // still in flight
    useGraphStore.getState().updateNodeData(poolId, { initial: 5 })
    const revAfterEdit = useGraphStore.getState().simulationRev
    expect(revAfterEdit).toBe(revAtStart + 1)
    // no result yet ⇒ the rev subscription has nothing to mark; nothing cancels the run
    expect(useMcStore.getState().stale).toBe(false)
    expect(useMcStore.getState().status).toBe('running')

    await running
    const s = useMcStore.getState()
    expect(s.status).toBe('done')
    expect(s.result?.completedRuns).toBe(300)

    // WHICH graph: step 0 of the Pool's band is the initial of the graph at
    // run start (100), not the current document's (5)
    expect(s.result!.series[poolId].mean[0]).toBe(100)
    expect(s.result!.series[poolId].min[0]).toBe(100)
    expect(s.runGraph!.nodes.find((n) => n.id === poolId)!.data).toMatchObject({ initial: 100 })
    expect(useGraphStore.getState().nodes.find((n) => n.id === poolId)!.data).toMatchObject({ initial: 5 })

    // HOW it is labelled on current main — the defect: the completion handler
    // writes `stale: false` and `runRev` = the start rev, without comparing it
    // to the rev the document has moved to
    expect(s.runRev).toBe(revAtStart)
    expect(useGraphStore.getState().simulationRev).toBe(revAfterEdit)
    expect(s.runRev).not.toBe(useGraphStore.getState().simulationRev)
    expect(s.stale).toBe(false) // ← current behaviour; the rule will make this `true`
  })

  it('control: the same edit AFTER the run completes is marked stale by the rev subscription', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 20, steps: 3, tracked: [poolId] })
    await useMcStore.getState().run()
    expect(useMcStore.getState().stale).toBe(false)
    useGraphStore.getState().updateNodeData(poolId, { initial: 5 })
    expect(useMcStore.getState().stale).toBe(true)
  })
})
