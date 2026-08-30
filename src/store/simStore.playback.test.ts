import { beforeEach, describe, expect, it } from 'vitest'
import { serialize } from '../model/serialize'
import { TEMPLATES } from '../model/templates'
import { step } from '../engine'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'

// docs/simulation-playback.md Slice 1 — the compute/commit split.
//   prepareTransition()  — PURE: compute S(t+1); no store write, no id, no counter.
//   armPrepared(result)  — the one impure step: mint transitionId, mark active,
//                          deep-freeze in dev.
//   commitPrepared(p)    — the §PB7.7 ladder; one atomic commit + commitEpoch++.
// The store is S(t) until the commit (§PB2.2).

const sim = () => useSimStore.getState()
const graph = () => useGraphStore.getState()
/** prepare + arm — what the scheduler does before it can commit. */
const armed = () => sim().armPrepared(sim().prepareTransition())

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

describe('Slice 1 — prepare is pure, arm is the impure step (§PB2.7 / Round 2 §1)', () => {
  it('prepareTransition writes nothing, mints no id, and 100 calls are byte-identical', () => {
    flowGraph()
    sim().reset()
    const before = JSON.stringify({ i: sim().stepIndex, v: sim().values, l: sim().series.length, e: sim().commitEpoch, active: sim().activeTransitionId })
    const first = JSON.stringify(sim().prepareTransition())
    expect(JSON.parse(first)).not.toHaveProperty('transitionId')
    for (let k = 0; k < 99; k++) expect(JSON.stringify(sim().prepareTransition())).toBe(first)
    expect(JSON.stringify({ i: sim().stepIndex, v: sim().values, l: sim().series.length, e: sim().commitEpoch, active: sim().activeTransitionId })).toBe(before)
  })

  it('armPrepared mints a fresh id each call, marks it active, and (dev) deep-freezes the payload', () => {
    flowGraph()
    sim().reset()
    const a = sim().armPrepared(sim().prepareTransition())
    const b = sim().armPrepared(sim().prepareTransition())
    expect(a.transitionId).not.toBe(b.transitionId)
    expect(sim().activeTransitionId).toBe(b.transitionId)
    // frozen: the animation layer cannot mutate toState / derived (dev / test)
    expect(Object.isFrozen(a)).toBe(true)
    expect(() => {
      ;(a.toState.values as Record<string, number>).x = 999
    }).toThrow()
    expect(() => {
      ;(a.derived.firedNodeIds as string[]).push('x')
    }).toThrow()
  })

  it('the prepared inputs (graph nodes/edges) are not mutated — frozen-safe', () => {
    flowGraph()
    sim().reset()
    Object.freeze(graph().nodes)
    Object.freeze(graph().edges)
    for (const n of graph().nodes) Object.freeze(n)
    for (const e of graph().edges) Object.freeze(e)
    expect(() => sim().prepareTransition()).not.toThrow()
  })
})

describe('Slice 1 — commitPrepared ladder (§PB7.7)', () => {
  it('prepareTransition commits nothing; the store stays at S(t)', () => {
    flowGraph()
    sim().reset()
    const s0 = { i: sim().stepIndex, v: sim().values, l: sim().series.length, e: sim().commitEpoch }
    const p = sim().prepareTransition()
    expect(sim().stepIndex).toBe(s0.i)
    expect(sim().values).toBe(s0.v)
    expect(sim().series.length).toBe(s0.l)
    expect(sim().commitEpoch).toBe(s0.e)
    expect(p.fromStep).toBe(0)
    expect(p.toState.step).toBe(1)
    expect(p.expectedCommitEpoch).toBe(s0.e)
    expect(p.expectedSimulationRev).toBe(graph().simulationRev)
    expect(p.expectedSeed).toBe(sim().seed)
  })

  it('a full-guard commit applies one atomic step + bumps commitEpoch', () => {
    flowGraph()
    sim().reset()
    const e0 = sim().commitEpoch
    const p = armed()
    expect(sim().commitPrepared(p)).toBe('committed')
    expect(sim().stepIndex).toBe(1)
    expect(sim().series.length).toBe(2)
    expect(sim().commitEpoch).toBe(e0 + 1)
    expect(sim().activeTransitionId).toBeNull()
    expect(sim().lastSettledTransitionId).toBe(p.transitionId)
  })

  it('a second commit of the same prepared ⇒ already-settled, zero further mutation', () => {
    flowGraph()
    sim().reset()
    const p = armed()
    expect(sim().commitPrepared(p)).toBe('committed')
    const after = { step: sim().stepIndex, len: sim().series.length, epoch: sim().commitEpoch }
    expect(sim().commitPrepared(p)).toBe('already-settled')
    expect(sim().stepIndex).toBe(after.step)
    expect(sim().series.length).toBe(after.len)
    expect(sim().commitEpoch).toBe(after.epoch)
  })

  it('the order is fixed: already-settled beats stale-id beats CAS', () => {
    flowGraph()
    sim().reset()
    // never armed ⇒ id mismatch ⇒ stale (no CAS needed)
    expect(sim().commitPrepared({ ...sim().prepareTransition(), transitionId: 987654 })).toBe('stale')
    const real = armed()
    expect(sim().commitPrepared(real)).toBe('committed')
    // re-submit: id === lastSettledTransitionId wins even though CAS would also fail
    expect(sim().commitPrepared(real)).toBe('already-settled')
  })
})

describe('Slice 1 — CAS revalidation & audit of committed-state / engine-input paths (Round 2 §3)', () => {
  it('reset between prepare and commit ⇒ stale (commitEpoch), store untouched', () => {
    flowGraph()
    sim().reset()
    const p = armed()
    sim().reset() // bumps commitEpoch, discards the transition
    expect(sim().commitPrepared(p)).toBe('stale')
    expect(sim().stepIndex).toBe(0)
    expect(sim().series.length).toBe(1)
  })

  it('a seed change is in the CAS even without an epoch bump (expectedSeed)', () => {
    flowGraph()
    sim().reset()
    const p = armed()
    // bypass setSeed's reset() to isolate the seed check
    ;(useSimStore.setState as unknown as (s: object) => void)({ seed: 424242 })
    expect(sim().commitPrepared(p)).toBe('stale')
    expect(sim().stepIndex).toBe(0)
  })

  it('every committed-state / engine-input path bumps a guard AND discards the prepared transition', () => {
    const cases: { name: string; run: () => void }[] = [
      { name: 'graph edit', run: () => { const id = graph().nodes.find((n) => n.data.kind === 'pool')!.id; graph().updateNodeData(id, { capacity: 7 }) } },
      { name: 'undo', run: () => { const id = graph().nodes.find((n) => n.data.kind === 'pool')!.id; graph().updateNodeData(id, { capacity: 8 }); graph().undo() } },
      { name: 'redo', run: () => { const id = graph().nodes.find((n) => n.data.kind === 'pool')!.id; graph().updateNodeData(id, { capacity: 8 }); graph().undo(); graph().redo() } },
      { name: 'import (loadJSON)', run: () => graph().loadJSON(serialize(graph().nodes, graph().edges)) },
      { name: 'template swap (loadGraph)', run: () => graph().loadGraph(TEMPLATES[0].graph) },
      { name: 'restoreSnapshot', run: () => sim().restoreSnapshot({ seed: null, step: 0, ended: false, values: {}, fired: [], triggerQueue: [], stateEvents: [], series: [] }) },
      { name: 'setSeed', run: () => sim().setSeed(sim().seed + 1) },
    ]
    for (const c of cases) {
      flowGraph()
      sim().reset()
      const e0 = sim().commitEpoch
      const rev0 = graph().simulationRev
      const p = armed()
      c.run()
      const guardMoved = sim().commitEpoch !== e0 || graph().simulationRev !== rev0
      expect(guardMoved, `${c.name}: commitEpoch or simulationRev must change`).toBe(true)
      expect(sim().activeTransitionId, `${c.name}: prepared transition discarded`).toBeNull()
      expect(sim().commitPrepared(p), `${c.name}: a late commit is stale`).toBe('stale')
    }
  })
})

describe('Slice 1 — legacy immediate path (§PB2.8 / PB-INV-18)', () => {
  it('stepOnce from idle == a direct pure engine step', () => {
    flowGraph()
    sim().reset()
    const head = { step: 0, values: sim().values!, ended: false, fired: [], triggerQueue: [] }
    const direct = step(graph().nodes, graph().edges, head, sim().seed)
    sim().stepOnce()
    expect(sim().stepIndex).toBe(direct.state.step)
    expect(sim().values).toEqual(direct.state.values)
  })

  it('N steps are deterministic and speed-independent at the state layer', () => {
    flowGraph()
    const run = () => {
      sim().reset()
      for (let k = 0; k < 6; k++) sim().stepOnce()
      return JSON.stringify(sim().series)
    }
    const a = run()
    sim().setSpeed(50)
    const b = run()
    sim().setSpeed(2000)
    const c = run()
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('back-to-back advance() from idle leaves no active-id leak', () => {
    flowGraph()
    sim().reset()
    sim().stepOnce()
    sim().stepOnce()
    expect(sim().stepIndex).toBe(2)
    expect(sim().activeTransitionId).toBeNull()
  })
})

describe('Slice 1 — speed guards (§PB6.2)', () => {
  it('rejects 0 / NaN / negative / Infinity; keeps the last valid value', () => {
    sim().setSpeed(400)
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
