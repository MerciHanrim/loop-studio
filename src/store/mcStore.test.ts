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

describe('mcStore.applyRecommended', () => {
  const base = () => useMcStore.getState().config

  // Source + 2 Pools, returns the Pool ids in graph order
  const twoPoolGraph = () => {
    const g = useGraphStore.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 100, y: 0 })
    g.addNodeAt('pool', { x: 200, y: 0 })
    const [, a, b] = useGraphStore.getState().nodes
    return { a: a.id, b: b.id }
  }

  it('applies valid runs / steps / baseSeed', () => {
    useMcStore.getState().applyRecommended({ baseSeed: 7, runs: 500, steps: 40 })
    expect(base()).toMatchObject({ baseSeed: 7, runs: 500, steps: 40 })
  })

  it('ignores a non-integer seed and non-positive runs/steps', () => {
    useMcStore.getState().setConfig({ baseSeed: 3, runs: 200, steps: 30 })
    useMcStore.getState().applyRecommended({ baseSeed: 1.5, runs: 0, steps: -4 })
    expect(base()).toMatchObject({ baseSeed: 3, runs: 200, steps: 30 })
    for (const bad of [NaN, Infinity, -Infinity, 2.0001]) {
      useMcStore.getState().applyRecommended({ baseSeed: bad })
      expect(base().baseSeed).toBe(3)
    }
  })

  it('normalises an integer seed to uint32 with >>> 0 (matches the seed input rule)', () => {
    useMcStore.getState().applyRecommended({ baseSeed: -1 })
    expect(base().baseSeed).toBe(4294967295)
    useMcStore.getState().applyRecommended({ baseSeed: 4294967296 })
    expect(base().baseSeed).toBe(0)
    useMcStore.getState().applyRecommended({ baseSeed: 4294967297 })
    expect(base().baseSeed).toBe(1)
  })

  it('applies only the valid fields of partially-broken metadata', () => {
    useMcStore.getState().setConfig({ baseSeed: 3, runs: 200, steps: 30 })
    useMcStore.getState().applyRecommended({ baseSeed: 9, runs: 2.5, steps: 40 })
    expect(base()).toMatchObject({ baseSeed: 9, runs: 200, steps: 40 })
  })

  it('undefined / empty / non-object input changes nothing', () => {
    const before = { ...base() }
    useMcStore.getState().applyRecommended(undefined)
    useMcStore.getState().applyRecommended({})
    useMcStore.getState().applyRecommended(42 as unknown as undefined)
    expect(base()).toEqual(before)
  })

  it('tracked: [] stays [] ("all pools")', () => {
    twoPoolGraph()
    useMcStore.getState().applyRecommended({ tracked: [] })
    expect(base().tracked).toEqual([])
  })

  it('tracked: intersects with the loaded graph, drops unknown ids, graph order', () => {
    const { a, b } = twoPoolGraph()
    useMcStore.getState().applyRecommended({ tracked: ['ghost', b, a, 'also-missing'] })
    expect(base().tracked).toEqual([a, b]) // graph order, unknowns gone
  })

  it('tracked: an all-unknown subset falls to the first Pool (never widens to all)', () => {
    const { a } = twoPoolGraph()
    useMcStore.getState().applyRecommended({ tracked: ['nope-1', 'nope-2'] })
    expect(base().tracked).toEqual([a])
  })

  it('tracked: unknown ids on a graph with no Pools stay a safe empty list', () => {
    const g = useGraphStore.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('drain', { x: 200, y: 0 })
    useMcStore.getState().setConfig({ tracked: [] })
    useMcStore.getState().applyRecommended({ tracked: ['ghost'] })
    const t = base().tracked
    expect(t).toEqual([]) // no undefined id, not widened
    expect(t.every((id) => typeof id === 'string')).toBe(true)
  })
})

describe('recommendedRunConfig.timelineSeries — the Timeline display default (separate from MC tracked)', () => {
  it('applyRecommended sets simStore.timelineSeries from the field (sorted)', async () => {
    const { useSimStore } = await import('./simStore')
    useMcStore.getState().applyRecommended({ timelineSeries: ['gold', 'level', 'gold'] })
    expect(useSimStore.getState().timelineSeries).toEqual(['gold', 'level'])
  })

  it('applyRecommended with no timelineSeries resets it to "all" (older files unchanged)', async () => {
    const { useSimStore } = await import('./simStore')
    useSimStore.getState().setTimelineSeries(['x'])
    useMcStore.getState().applyRecommended({ baseSeed: 5 })
    expect(useSimStore.getState().timelineSeries).toBe('all')
  })

  it('applyRecommended(undefined) also resets timelineSeries to "all"', async () => {
    const { useSimStore } = await import('./simStore')
    useSimStore.getState().setTimelineSeries(['x'])
    useMcStore.getState().applyRecommended(undefined)
    expect(useSimStore.getState().timelineSeries).toBe('all')
  })

  it('a non-array timelineSeries is ignored (⇒ "all")', async () => {
    const { useSimStore } = await import('./simStore')
    useSimStore.getState().setTimelineSeries(['x'])
    useMcStore.getState().applyRecommended({ timelineSeries: 'oops' as unknown as string[] })
    expect(useSimStore.getState().timelineSeries).toBe('all')
  })

  it('recommendedRunConfigForExport merges the MC config with a sorted timelineSeries', async () => {
    const { useSimStore } = await import('./simStore')
    const { recommendedRunConfigForExport } = await import('./mcStore')
    useMcStore.getState().setConfig({ baseSeed: 2, runs: 10, steps: 5, tracked: [] })
    useSimStore.getState().setTimelineSeries(['b', 'a'])
    expect(recommendedRunConfigForExport()).toEqual({
      baseSeed: 2,
      runs: 10,
      steps: 5,
      tracked: [],
      timelineSeries: ['a', 'b'],
    })
  })

  it('recommendedRunConfigForExport omits timelineSeries while it is "all"', async () => {
    const { useSimStore } = await import('./simStore')
    const { recommendedRunConfigForExport } = await import('./mcStore')
    useMcStore.getState().setConfig({ baseSeed: 1, runs: 3, steps: 3, tracked: [] })
    useSimStore.getState().setTimelineSeries(undefined)
    expect('timelineSeries' in recommendedRunConfigForExport()).toBe(false)
  })
})

describe('recommendedRunConfig.canvasLocked — the Canvas edit-lock (UI-only)', () => {
  it('applyRecommended sets uiStore.canvasLocked from the field; absent / non-true ⇒ false', async () => {
    const { useUiStore } = await import('./uiStore')
    useMcStore.getState().applyRecommended({ canvasLocked: true })
    expect(useUiStore.getState().canvasLocked).toBe(true)
    useMcStore.getState().applyRecommended({ baseSeed: 3 }) // no field ⇒ unlocked
    expect(useUiStore.getState().canvasLocked).toBe(false)
    useMcStore.getState().applyRecommended({ canvasLocked: true })
    useMcStore.getState().applyRecommended(undefined)
    expect(useUiStore.getState().canvasLocked).toBe(false)
    useMcStore.getState().applyRecommended({ canvasLocked: 'yes' as unknown as boolean })
    expect(useUiStore.getState().canvasLocked).toBe(false)
  })

  it('recommendedRunConfigForExport carries canvasLocked only while it is true', async () => {
    const { useUiStore } = await import('./uiStore')
    const { recommendedRunConfigForExport } = await import('./mcStore')
    useMcStore.getState().setConfig({ baseSeed: 1, runs: 3, steps: 3, tracked: [] })
    useUiStore.getState().setCanvasLocked(false)
    expect('canvasLocked' in recommendedRunConfigForExport()).toBe(false)
    useUiStore.getState().setCanvasLocked(true)
    expect(recommendedRunConfigForExport().canvasLocked).toBe(true)
    useUiStore.getState().setCanvasLocked(false)
  })
})
