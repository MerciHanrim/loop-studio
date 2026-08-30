import { beforeEach, describe, expect, it } from 'vitest'
import { step } from '../engine'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'

// docs/simulation-playback.md Slice 1 — the compute/commit split.
// `prepareTransition` computes S(t+1) and commits NOTHING; `commitPrepared`
// runs the §PB7.7 decision ladder and, on success, does one atomic commit +
// bumps `commitEpoch`. The store is S(t) until the commit (§PB2.2).

const sim = () => useSimStore.getState()
const graph = () => useGraphStore.getState()
/** the scheduler marks a transition active before committing it; mirror that in
 *  unit tests that call `commitPrepared` directly. */
const arm = (id: number) =>
  (useSimStore.setState as unknown as (s: object) => void)({ activeTransitionId: id })

/** Source ─2→ Pool ─1→ Drain (a plain deterministic flow). */
function flowGraph() {
  const g = graph()
  g.newGraph()
  g.addNodeAt('source', { x: 0, y: 0 })
  g.addNodeAt('pool', { x: 200, y: 0 })
  g.addNodeAt('drain', { x: 400, y: 0 })
  const [s, p, d] = graph().nodes
  graph().onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' })
  graph().onConnect({ source: p.id, target: d.id, sourceHandle: 'out', targetHandle: 'in' })
  const e = graph().edges.find((x) => x.source === s.id && x.target === p.id)!
  graph().setEdgeData(e.id, { kind: 'resource', flow: '2' })
  return { poolId: p.id }
}

beforeEach(() => {
  useSimStore.getState().reset()
  useGraphStore.getState().newGraph()
})

describe('Slice 1 — prepare / commit split', () => {
  it('prepareTransition commits nothing; the store stays at S(t) (§PB12-2)', () => {
    flowGraph()
    sim().reset()
    const step0 = { stepIndex: sim().stepIndex, values: sim().values, len: sim().series.length, epoch: sim().commitEpoch }
    const p = sim().prepareTransition()
    // nothing moved
    expect(sim().stepIndex).toBe(step0.stepIndex)
    expect(sim().values).toBe(step0.values)
    expect(sim().series.length).toBe(step0.len)
    expect(sim().commitEpoch).toBe(step0.epoch)
    // but the prepared step is fully computed
    expect(p.fromStep).toBe(0)
    expect(p.toState.step).toBe(1)
    expect(p.expectedCommitEpoch).toBe(step0.epoch)
    expect(p.expectedSimulationRev).toBe(graph().simulationRev)
  })

  it('commitPrepared applies one atomic step and bumps commitEpoch (§PB12-2)', () => {
    flowGraph()
    sim().reset()
    const e0 = sim().commitEpoch
    const p = sim().prepareTransition()
    arm(p.transitionId)
    expect(sim().commitPrepared(p)).toBe('committed')
    expect(sim().stepIndex).toBe(1)
    expect(sim().series.length).toBe(2)
    expect(sim().commitEpoch).toBe(e0 + 1)
    expect(sim().activeTransitionId).toBeNull()
    expect(sim().lastSettledTransitionId).toBe(p.transitionId)
  })

  it('a second commit of the same prepared ⇒ already-settled, zero further mutation (§PB12-8 / §PB12-18)', () => {
    flowGraph()
    sim().reset()
    const p = sim().prepareTransition()
    arm(p.transitionId)
    expect(sim().commitPrepared(p)).toBe('committed')
    const after = { step: sim().stepIndex, len: sim().series.length, epoch: sim().commitEpoch }
    expect(sim().commitPrepared(p)).toBe('already-settled')
    expect(sim().stepIndex).toBe(after.step)
    expect(sim().series.length).toBe(after.len)
    expect(sim().commitEpoch).toBe(after.epoch)
  })

  it('the ladder is ordered: already-settled beats stale-id beats CAS (§PB7.7)', () => {
    flowGraph()
    sim().reset()
    // a prepared whose id was never made active ⇒ stale (id mismatch), no CAS needed
    const never = sim().prepareTransition()
    expect(sim().commitPrepared(never)).toBe('stale')
    // commit a real one, then re-submit ⇒ already-settled even though CAS would also fail
    const real = sim().prepareTransition()
    arm(real.transitionId)
    expect(sim().commitPrepared(real)).toBe('committed')
    expect(sim().commitPrepared(real)).toBe('already-settled')
  })
})

describe('Slice 1 — CAS revalidation (§PB12-16)', () => {
  it('a reset between prepare and commit ⇒ stale, store untouched', () => {
    flowGraph()
    sim().reset()
    const p = sim().prepareTransition()
    sim().reset() // bumps commitEpoch
    arm(p.transitionId)
    expect(sim().commitPrepared(p)).toBe('stale')
    expect(sim().stepIndex).toBe(0)
    expect(sim().series.length).toBe(1)
  })

  it('a GraphDoc edit between prepare and commit ⇒ stale (simulationRev)', () => {
    const { poolId } = flowGraph()
    sim().reset()
    const p = sim().prepareTransition()
    graph().updateNodeData(poolId, { capacity: 9 }) // bumps simulationRev → subscription resets sim
    arm(p.transitionId)
    expect(sim().commitPrepared(p)).toBe('stale')
    expect(sim().stepIndex).toBe(0)
  })

  it('a step advanced another way between prepare and commit ⇒ stale (fromStep)', () => {
    flowGraph()
    sim().reset()
    const p = sim().prepareTransition() // fromStep 0
    sim().stepOnce() // now at step 1
    arm(p.transitionId)
    expect(sim().commitPrepared(p)).toBe('stale')
    expect(sim().stepIndex).toBe(1)
  })

  it('restoreSnapshot bumps commitEpoch and staleness applies', () => {
    flowGraph()
    sim().reset()
    const e0 = sim().commitEpoch
    const p = sim().prepareTransition()
    sim().restoreSnapshot({ seed: null, step: 3, ended: false, values: { x: 1 }, fired: [], triggerQueue: [], stateEvents: [], series: [] })
    expect(sim().commitEpoch).toBe(e0 + 1)
    arm(p.transitionId)
    expect(sim().commitPrepared(p)).toBe('stale')
  })
})

describe('Slice 1 — prepare determinism (§PB12-17)', () => {
  it('100 prepares are pure: identical toState, store byte-identical after', () => {
    flowGraph()
    sim().reset()
    const before = JSON.stringify({ i: sim().stepIndex, v: sim().values, l: sim().series.length, e: sim().commitEpoch })
    const first = JSON.stringify(sim().prepareTransition().toState)
    for (let k = 0; k < 99; k++) {
      expect(JSON.stringify(sim().prepareTransition().toState)).toBe(first)
    }
    expect(JSON.stringify({ i: sim().stepIndex, v: sim().values, l: sim().series.length, e: sim().commitEpoch })).toBe(before)
  })

  it('prepare does not mutate the graph inputs (frozen-safe)', () => {
    flowGraph()
    sim().reset()
    Object.freeze(graph().nodes)
    Object.freeze(graph().edges)
    for (const n of graph().nodes) Object.freeze(n)
    for (const e of graph().edges) Object.freeze(e)
    expect(() => sim().prepareTransition()).not.toThrow()
  })
})

describe('Slice 1 — legacy immediate path equivalence (§PB12-19 / PB-INV-18)', () => {
  it('stepOnce from idle == a direct pure engine step', () => {
    flowGraph()
    sim().reset()
    const head = { step: 0, values: sim().values!, ended: false, fired: [], triggerQueue: [] }
    const direct = step(graph().nodes, graph().edges, head, sim().seed)
    sim().stepOnce()
    expect(sim().stepIndex).toBe(direct.state.step)
    expect(sim().values).toEqual(direct.state.values)
  })

  it('N steps are deterministic and speed-independent at the state layer (§PB12-1)', () => {
    flowGraph()
    const run = () => {
      sim().reset()
      for (let k = 0; k < 6; k++) sim().stepOnce()
      return JSON.stringify(sim().series)
    }
    const a = run()
    sim().setSpeed(50) // rejected? 50 is valid; just changes pacing, not state
    const b = run()
    sim().setSpeed(2000)
    const c = run()
    expect(b).toBe(a)
    expect(c).toBe(a)
  })
})

describe('Slice 1 — speed guards (§PB12-10 / §PB6.2)', () => {
  it('rejects 0 / NaN / negative / Infinity; keeps the last valid value', () => {
    sim().setSpeed(400)
    expect(sim().speedMs).toBe(400)
    for (const bad of [0, Number.NaN, -100, Number.POSITIVE_INFINITY]) {
      sim().setSpeed(bad)
      expect(sim().speedMs).toBe(400)
    }
    sim().setSpeed(250)
    expect(sim().speedMs).toBe(250)
  })
})

describe('Slice 1 — commitEpoch discipline (PB-INV-19)', () => {
  it('bumps on settle / reset / restoreSnapshot, never on prepare', () => {
    flowGraph()
    sim().reset()
    const e0 = sim().commitEpoch
    sim().prepareTransition()
    sim().prepareTransition()
    expect(sim().commitEpoch).toBe(e0) // prepare never bumps
    sim().stepOnce()
    expect(sim().commitEpoch).toBe(e0 + 1) // settle bumps
    sim().reset()
    expect(sim().commitEpoch).toBe(e0 + 2) // reset bumps
    sim().restoreSnapshot({ seed: null, step: 0, ended: false, values: {}, fired: [], triggerQueue: [], stateEvents: [], series: [] })
    expect(sim().commitEpoch).toBe(e0 + 3)
  })
})
