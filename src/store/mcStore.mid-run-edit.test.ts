import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { MC_DEFAULT_CONFIG, useMcStore } from './mcStore'

// issue #407 — a graph edit while a Monte Carlo run is in flight. The run
// copies the graph and `simulationRev` when it starts; the cooperative runner
// (vitest has no Worker) yields to the event loop between batches, so an edit
// lands between two batches exactly as a user's edit lands between two Worker
// progress messages. The rule (Lumi, 2026-10-30): the run is NOT cancelled;
// the result is computed from, and stays bound to, the start graph; on
// completion the start rev is compared with the document's current rev and a
// difference marks the result `stale` on arrival — the same mark, with the
// same export consequence, a post-run edit leaves. A later run completed at
// the current rev clears it.

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

/** start a run and let the runner hand out its first yield; the run's promise
 *  is boxed so that awaiting this helper does not await the run itself */
async function startRun(): Promise<{ running: Promise<void> }> {
  const running = useMcStore.getState().run()
  expect(useMcStore.getState().status).toBe('running')
  await new Promise((r) => setTimeout(r, 0))
  expect(useMcStore.getState().status).toBe('running') // still in flight
  return { running }
}

beforeEach(() => {
  useMcStore.getState().clear()
  useMcStore.getState().setConfig(MC_DEFAULT_CONFIG)
})

describe('a graph edit while a Monte Carlo run is in flight (#407)', () => {
  it('the run is not cancelled; the result is the START graph\'s and lands marked stale, values and runRev preserved', async () => {
    const { poolId } = seedGraph()
    const revAtStart = useGraphStore.getState().simulationRev
    // enough batches for the runner to yield at least once (batchSize 64 ⇒ 4 yields)
    useMcStore.getState().setConfig({ runs: 300, steps: 5, tracked: [poolId] })
    const { running } = await startRun()

    useGraphStore.getState().updateNodeData(poolId, { initial: 5 })
    expect(useGraphStore.getState().simulationRev).toBe(revAtStart + 1)
    // a first run: no result yet, so the rev subscription has nothing to mark
    expect(useMcStore.getState()).toMatchObject({ status: 'running', stale: false, result: null })

    await running
    const s = useMcStore.getState()
    expect(s.status).toBe('done')
    expect(s.result?.completedRuns).toBe(300) // ran to the end
    expect(s.view).toBe('distribution')

    // bound to the start graph: step 0 of the Pool's band is 100, not the document's 5
    expect(s.result!.series[poolId].mean[0]).toBe(100)
    expect(s.result!.series[poolId].min[0]).toBe(100)
    expect(s.runGraph!.nodes.find((n) => n.id === poolId)!.data).toMatchObject({ initial: 100 })
    expect(s.runRev).toBe(revAtStart)
    expect(useGraphStore.getState().nodes.find((n) => n.id === poolId)!.data).toMatchObject({ initial: 5 })

    // and labelled as such on arrival
    expect(s.stale).toBe(true)
  })

  it('a second run in flight replaces an older result; the mid-run edit marks the new result stale too, and the old one is gone', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 300, steps: 5, tracked: [poolId] })
    await useMcStore.getState().run()
    const first = useMcStore.getState().result
    expect(useMcStore.getState().stale).toBe(false)

    const { running } = await startRun()
    useGraphStore.getState().updateNodeData(poolId, { initial: 5 })
    // during the run the subscription marks the OLD result, which stays on show
    expect(useMcStore.getState()).toMatchObject({ status: 'running', stale: true, result: first })

    await running
    const s = useMcStore.getState()
    expect(s.result).not.toBe(first)
    expect(s.result!.series[poolId].mean[0]).toBe(100)
    expect(s.stale).toBe(true)
  })

  it('a mid-run edit and a post-run edit leave the same state: done, viewable, stale', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 300, steps: 5, tracked: [poolId] })

    const { running } = await startRun()
    useGraphStore.getState().updateNodeData(poolId, { initial: 5 })
    await running
    const mid = useMcStore.getState()

    useMcStore.getState().clear()
    useGraphStore.getState().updateNodeData(poolId, { initial: 100 })
    await useMcStore.getState().run()
    useGraphStore.getState().updateNodeData(poolId, { initial: 5 })
    const post = useMcStore.getState()

    const shape = (s: typeof mid) => ({
      status: s.status,
      stale: s.stale,
      view: s.view,
      step0: s.result!.series[poolId].mean[0],
      runGraphInitial: (s.runGraph!.nodes.find((n) => n.id === poolId)!.data as { initial: number }).initial,
    })
    expect(shape(mid)).toEqual({ status: 'done', stale: true, view: 'distribution', step0: 100, runGraphInitial: 100 })
    expect(shape(post)).toEqual(shape(mid))
  })

  it('a later run completed at the current rev clears the mark; the control edits after completion still mark it', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 300, steps: 5, tracked: [poolId] })
    const { running } = await startRun()
    useGraphStore.getState().updateNodeData(poolId, { initial: 5 })
    await running
    expect(useMcStore.getState().stale).toBe(true)

    await useMcStore.getState().run() // no edit this time
    const s = useMcStore.getState()
    expect(s.stale).toBe(false)
    expect(s.runRev).toBe(useGraphStore.getState().simulationRev)
    expect(s.result!.series[poolId].mean[0]).toBe(5) // the current document's graph

    useGraphStore.getState().updateNodeData(poolId, { capacity: 50 })
    expect(useMcStore.getState().stale).toBe(true)
  })

  it('an edit that does not move simulationRev (a label) leaves a mid-run result current', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 300, steps: 5, tracked: [poolId] })
    const revAtStart = useGraphStore.getState().simulationRev
    const { running } = await startRun()
    useGraphStore.getState().updateNodeData(poolId, { label: 'Renamed' })
    expect(useGraphStore.getState().simulationRev).toBe(revAtStart)
    await running
    expect(useMcStore.getState()).toMatchObject({ status: 'done', stale: false, runRev: revAtStart })
  })
})
