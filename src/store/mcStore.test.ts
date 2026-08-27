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
})
