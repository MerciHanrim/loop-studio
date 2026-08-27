import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { MC_DEFAULT_CONFIG, useMcStore } from './mcStore'

// tiny deterministic graph: Source [1-3] -> Pool
function seedGraph() {
  const g = useGraphStore.getState()
  g.newGraph()
  g.addNodeAt('source', { x: 0, y: 0 })
  g.addNodeAt('pool', { x: 200, y: 0 })
  const [s, p] = useGraphStore.getState().nodes
  useGraphStore.getState().onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' })
  const e = useGraphStore.getState().edges[0]
  useGraphStore.getState().setEdgeData(e.id, { kind: 'resource', flow: '1-3' })
  return { poolId: p.id }
}

beforeEach(() => {
  useMcStore.getState().clear()
  useMcStore.getState().setConfig(MC_DEFAULT_CONFIG)
})

describe('mcStore', () => {
  it('defaults: 200 runs, 30 steps, seed 1, all pools, idle, live view', () => {
    const s = useMcStore.getState()
    expect(s.config).toEqual({ baseSeed: 1, runs: 200, steps: 30, tracked: [] })
    expect(s.status).toBe('idle')
    expect(s.view).toBe('live')
    expect(s.result).toBeNull()
  })

  it('run() produces a result, switches to distribution, marks not stale', async () => {
    seedGraph()
    useMcStore.getState().setConfig({ runs: 40, steps: 6 })
    await useMcStore.getState().run()
    const s = useMcStore.getState()
    expect(s.status).toBe('done')
    expect(s.view).toBe('distribution')
    expect(s.stale).toBe(false)
    expect(s.result?.completedRuns).toBe(40)
    expect(s.result?.config.steps).toBe(6)
    expect(s.runGraph?.nodes.length).toBe(2)
  })

  it('a pure label rename does NOT mark the result stale', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 20, steps: 4 })
    await useMcStore.getState().run()
    expect(useMcStore.getState().stale).toBe(false)

    useGraphStore.getState().updateNodeData(poolId, { label: 'Renamed' })
    expect(useMcStore.getState().stale).toBe(false)
  })

  it('a simulation-relevant edit marks the result stale (still viewable)', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 20, steps: 4 })
    await useMcStore.getState().run()
    const before = useMcStore.getState().result

    useGraphStore.getState().updateNodeData(poolId, { capacity: 5 })
    const s = useMcStore.getState()
    expect(s.stale).toBe(true)
    expect(s.result).toBe(before) // not deleted — export just disables
  })

  it('clear() removes the result and returns to idle/live', async () => {
    seedGraph()
    useMcStore.getState().setConfig({ runs: 20, steps: 4 })
    await useMcStore.getState().run()
    useMcStore.getState().clear()
    const s = useMcStore.getState()
    expect(s.result).toBeNull()
    expect(s.status).toBe('idle')
    expect(s.view).toBe('live')
    expect(s.stale).toBe(false)
  })

  it('a re-run replaces a stale result and clears stale', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 20, steps: 4 })
    await useMcStore.getState().run()
    useGraphStore.getState().updateNodeData(poolId, { capacity: 5 })
    expect(useMcStore.getState().stale).toBe(true)

    await useMcStore.getState().run()
    expect(useMcStore.getState().stale).toBe(false)
    expect(useMcStore.getState().status).toBe('done')
  })

  it('a config edit (runs/steps/seed/tracked) does NOT stale the result; the header uses the run\'s own RunConfig', async () => {
    const { poolId } = seedGraph()
    useMcStore.getState().setConfig({ runs: 20, steps: 4, baseSeed: 1 })
    await useMcStore.getState().run()
    const savedConfig = useMcStore.getState().result!.config

    useMcStore.getState().setConfig({ runs: 999, steps: 50, baseSeed: 7, tracked: [poolId] })
    const s = useMcStore.getState()
    expect(s.stale).toBe(false)
    expect(s.result!.config).toEqual(savedConfig) // result keeps its own RunConfig
    expect(s.config).toMatchObject({ runs: 999, steps: 50, baseSeed: 7 }) // pending, next run only
  })
})

describe('mcStore — tracked-Pool reconciliation', () => {
  const poolIds = () =>
    useGraphStore
      .getState()
      .nodes.filter((n) => n.data.kind === 'pool')
      .map((n) => n.id)

  function twoPoolGraph() {
    const g = useGraphStore.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 100, y: 0 })
    g.addNodeAt('pool', { x: 200, y: 0 })
    g.addNodeAt('pool', { x: 300, y: 0 })
    const [, a, b, c] = useGraphStore.getState().nodes
    return { a: a.id, b: b.id, c: c.id }
  }

  it('"all" ([]) stays [] when a Pool is deleted', () => {
    const { a } = twoPoolGraph()
    useMcStore.getState().setConfig({ tracked: [] })
    useGraphStore.getState().removeNode(a)
    expect(useMcStore.getState().config.tracked).toEqual([])
  })

  it('an explicit subset keeps only the intersection with surviving Pools', () => {
    const { a, b, c } = twoPoolGraph()
    useMcStore.getState().setConfig({ tracked: [a, b] })
    useGraphStore.getState().removeNode(a)
    expect(useMcStore.getState().config.tracked).toEqual([b])
    expect(c).toBeTruthy() // c was never tracked; not added back
  })

  it('emptied subset with Pools remaining → first current Pool (never widens to all)', () => {
    const { a, b } = twoPoolGraph()
    useMcStore.getState().setConfig({ tracked: [a] })
    useGraphStore.getState().removeNode(a)
    const t = useMcStore.getState().config.tracked
    expect(t).toHaveLength(1)
    expect(t[0]).toBe(poolIds()[0])
    expect(t[0]).not.toEqual([]) // not "all"
    expect(b).toBeTruthy()
  })

  it('no Pools left → the (dead) list is kept; the dialog disables Run', () => {
    const { a, b, c } = twoPoolGraph()
    useMcStore.getState().setConfig({ tracked: [a, b] })
    useGraphStore.getState().removeNode(a)
    useGraphStore.getState().removeNode(b)
    useGraphStore.getState().removeNode(c)
    expect(poolIds()).toEqual([])
    // reconcile leaves it alone rather than widening to [] ("all")
    expect(useMcStore.getState().config.tracked.length).toBeGreaterThan(0)
  })
})
