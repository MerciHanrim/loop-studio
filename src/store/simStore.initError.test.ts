import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useProjectStore } from './projectStore'
import { useSimStore } from './simStore'

// Audit ①-2 — a Pool whose `initial` / `capacity` the engine refuses
// (negative / non-finite) used to make `initSim` THROW inside the sim store's
// graph subscriber: the throw escaped `updateNodeData`, and — because zustand
// runs listeners in one loop — every subscriber registered after the sim
// store (Monte-Carlo staleness, the project `dirty` flag) silently missed
// that change. Now the failure is a value (`initError`), Play / Step are
// no-ops while it is set, and it clears the moment the graph is valid again.

const poolId = () => useGraphStore.getState().nodes.find((n) => n.data.kind === 'pool')!.id

beforeEach(() => {
  useMcStore.getState().clear()
  useGraphStore.getState().newGraph()
  useSimStore.getState().reset()
  useProjectStore.setState({ open: null, dirty: false, activePlanId: null })
  useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
  useGraphStore.getState().addNodeAt('source', { x: 0, y: 100 })
})

describe('simStore.initError — the engine refusing to initialise is a value, not a throw', () => {
  it('a negative `initial` reaching the store never throws; initError names it; later subscribers still run', () => {
    // give the MC store a result so its stale-marking subscriber is observable
    useMcStore.setState({ result: { completedRuns: 1 } as never, stale: false, runRev: useGraphStore.getState().simulationRev })
    expect(() => useGraphStore.getState().updateNodeData(poolId(), { initial: -5 })).not.toThrow()
    const s = useSimStore.getState()
    expect(s.initError).toMatch(/initial must be a finite number/)
    expect(s.status).toBe('idle')
    expect(s.values).toEqual({}) // an empty head, never stale values
    expect(useMcStore.getState().stale).toBe(true) // the subscriber after simStore DID run
  })

  it('Play and Step are no-ops while initError is set; Reset keeps reporting it', () => {
    useGraphStore.getState().updateNodeData(poolId(), { initial: -5 })
    useSimStore.getState().play()
    expect(useSimStore.getState().status).toBe('idle')
    useSimStore.getState().stepOnce()
    expect(useSimStore.getState().stepIndex).toBe(0)
    expect(() => useSimStore.getState().reset()).not.toThrow()
    expect(useSimStore.getState().initError).not.toBeNull()
  })

  it('fixing the value clears initError and the run works again', () => {
    useGraphStore.getState().updateNodeData(poolId(), { initial: -5 })
    expect(useSimStore.getState().initError).not.toBeNull()
    useGraphStore.getState().updateNodeData(poolId(), { initial: 3 })
    expect(useSimStore.getState().initError).toBeNull()
    expect(useSimStore.getState().values).toEqual({ [poolId()]: 3 })
    useSimStore.getState().advance()
    expect(useSimStore.getState().stepIndex).toBe(1)
  })

  it('a non-finite `capacity` (a hand-edited file) is reported the same way', () => {
    useGraphStore.getState().updateNodeData(poolId(), { capacity: Number.POSITIVE_INFINITY })
    expect(useSimStore.getState().initError).toMatch(/capacity/)
    useGraphStore.getState().updateNodeData(poolId(), { capacity: null })
    expect(useSimStore.getState().initError).toBeNull()
  })

  it('a restored Workspace snapshot is a valid head: initError is cleared', () => {
    useGraphStore.getState().updateNodeData(poolId(), { initial: -5 })
    useSimStore.getState().restoreSnapshot({
      seed: null, step: 2, ended: false, values: { [poolId()]: 7 }, fired: [], triggerQueue: [], stateEvents: [],
      series: [{ step: 0, values: { [poolId()]: 5 } }],
    })
    expect(useSimStore.getState().initError).toBeNull()
    expect(useSimStore.getState().status).toBe('paused')
  })
})

describe('mcStore.message is a code, rendered by the UI', () => {
  it('starts empty and only ever holds a known code', () => {
    const m = useMcStore.getState()
    expect(m.message).toBe('')
    expect(m.errorDetail).toBe('')
    useMcStore.setState({ message: 'failed', errorDetail: 'boom' })
    useMcStore.getState().clear()
    expect(useMcStore.getState().message).toBe('')
    expect(useMcStore.getState().errorDetail).toBe('')
  })
})
