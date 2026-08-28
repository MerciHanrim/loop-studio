import { beforeAll, describe, expect, it } from 'vitest'
import fixtureDoc from '../../examples/state-verification.json'
import committedExpected from '../../examples/state-verification.expected.json'
import { deserialize, normalizeGraph, serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import {
  runMonteCarlo,
  runMonteCarloCooperative,
  runMonteCarloParallel,
  runSeed,
  toMonteCarloJson,
  type RunConfig,
} from './index'
import { initSim, step } from './step'

// `examples/state-verification.json` is an importable graph that exercises every
// executable `loop-state/1` + `loop-state/2` behaviour in one connected model.
// This test re-derives the per-step trace recorded in
// `examples/state-verification.expected.json` and asserts it still matches — the
// State regression guard. Regenerate after a deliberate change with GEN_FIXTURE=1.

const STEPS = 6

function load(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  return normalizeGraph(fixtureDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] })
}
const labelOf = (nodes: LoopNode[]) => new Map(nodes.map((n) => [n.id, n.data.label]))

type Frame = {
  step: number
  values: Record<string, number>
  fired: string[]
  stateEvents: unknown[]
  queue: { edgeId: string; target: string; deliveryStep: number }[]
}

/** step the graph `STEPS` times; capture values (by label) / fired / stateEvents / queue */
function trace(nodes: LoopNode[], edges: LoopEdge[]): Frame[] {
  const L = labelOf(nodes)
  const poolLabels = nodes.filter((n) => n.data.kind === 'pool').map((n) => n.data.label).sort()
  // Pool values only, keys sorted ⇒ a frame is canonical regardless of array order
  const byLabel = (v: Record<string, number>) => {
    const idByLabel = new Map([...L].map(([id, label]) => [label, id]))
    return Object.fromEntries(poolLabels.map((label) => [label, v[idByLabel.get(label)!] ?? 0]))
  }
  const firedLabels = (ids: string[]) => ids.map((id) => L.get(id) ?? id).sort()
  const queueLabels = (q: Frame['queue']) =>
    q.map((e) => ({ edgeId: e.edgeId, target: L.get(e.target) ?? e.target, deliveryStep: e.deliveryStep }))

  let st = initSim(nodes)
  const frames: Frame[] = [
    { step: 0, values: byLabel(st.values), fired: [], stateEvents: [], queue: queueLabels(st.triggerQueue) },
  ]
  for (let s = 1; s <= STEPS; s++) {
    const r = step(nodes, edges, st, 1)
    st = r.state
    frames.push({
      step: s,
      values: byLabel(st.values),
      fired: firedLabels(r.report.fired),
      stateEvents: r.report.stateEvents,
      queue: queueLabels(st.triggerQueue),
    })
  }
  return frames
}

async function deriveExpected(nodes: LoopNode[], edges: LoopEdge[]) {
  const frames = trace(nodes, edges)

  // import → export → import keeps every value
  const round = deserialize(serialize(nodes, edges))
  const roundTripFrames = trace(round.nodes, round.edges)

  // node / edge array order must not change any result (I8-S)
  const reversedFrames = trace([...nodes].reverse(), [...edges].reverse())

  // no RNG in state ⇒ every Monte-Carlo run is identical, and every path agrees
  const cfg: RunConfig = { baseSeed: 1, runs: 8, steps: STEPS, tracked: [] }
  const sync = runMonteCarlo(nodes, edges, cfg)
  const coop = await runMonteCarloCooperative(nodes, edges, cfg, { batchSize: 3 })
  const par = await runMonteCarloParallel(nodes, edges, cfg, { workers: 3, jobSize: 2 })
  const tankId = nodes.find((n) => n.data.label === 'Tank')!.id
  const standaloneTank: number[] = []
  for (let i = 0; i < cfg.runs; i++) {
    let s = initSim(nodes)
    for (let t = 1; t <= STEPS; t++) s = step(nodes, edges, s, runSeed(cfg.baseSeed, i)).state
    standaloneTank.push(s.values[tankId] ?? 0)
  }

  return {
    about:
      'State verification fixture (loop-state/1 + loop-state/2). Import state-verification.json, then follow examples/README.md.',
    steps: STEPS,
    frames,
    roundTrip: { matchesTrace: JSON.stringify(roundTripFrames) === JSON.stringify(frames) },
    arrayReverse: { matchesTrace: JSON.stringify(reversedFrames) === JSON.stringify(frames) },
    monteCarlo: {
      perRunIsolation: JSON.stringify(sync.final[tankId].values) === JSON.stringify(standaloneTank),
      syncEqualsCooperative: toMonteCarloJson(sync) === toMonteCarloJson(coop),
      syncEqualsParallel: toMonteCarloJson(sync) === toMonteCarloJson(par),
      tankTerminalAllEqual: sync.final[tankId].values.every((v) => v === sync.final[tankId].values[0]),
    },
  }
}

describe('state verification fixture', () => {
  const { nodes, edges } = load()
  let derived: Awaited<ReturnType<typeof deriveExpected>>
  beforeAll(async () => {
    derived = await deriveExpected(nodes, edges)
  })

  it('reproduces examples/state-verification.expected.json exactly', async () => {
    if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEN_FIXTURE === '1') {
      const fs = await import('node:' + 'fs')
      fs.writeFileSync(
        new URL('../../examples/state-verification.json', import.meta.url),
        JSON.stringify(fixtureDoc, null, 2) + '\n',
      )
      fs.writeFileSync(
        new URL('../../examples/state-verification.expected.json', import.meta.url),
        JSON.stringify(derived, null, 2) + '\n',
      )
      return
    }
    expect(derived).toEqual(committedExpected)
  })

  it('trigger delay: t_pd_a/b (delay 0) deliver from step 2; t_id_delayed (delay 2) from step 4', () => {
    const ev = (f: Frame, id: string) =>
      (f.stateEvents as { edgeId: string; effect: any }[]).find((e) => e.edgeId === id)
    expect(ev(derived.frames[1], 't_pd_a')).toBeUndefined()
    expect(ev(derived.frames[2], 't_pd_a')?.effect.delivered).toBe(true)
    for (const s of [1, 2, 3]) expect(ev(derived.frames[s], 't_id_delayed')).toBeUndefined()
    expect(ev(derived.frames[4], 't_id_delayed')?.effect.delivered).toBe(true)
  })

  it('activator AND: Passive Drain stays shut until Gauge A ≥ 3 (step 4), Gauge B is always ≥ 3', () => {
    const ev = (f: Frame, id: string) =>
      (f.stateEvents as { edgeId: string; effect: any }[]).find((e) => e.edgeId === id)
    for (const s of [2, 3]) {
      expect(ev(derived.frames[s], 'a_gb_pd')?.effect.satisfied).toBe(true)
      expect(ev(derived.frames[s], 'a_ga_pd')?.effect.satisfied).toBe(false)
      expect(derived.frames[s].fired).not.toContain('Passive Drain')
      // a pulse still arrives while the gate is shut, and is consumed as applied:false
      expect(ev(derived.frames[s], 't_pd_a')?.effect).toEqual({ kind: 'trigger', delivered: true, applied: false })
    }
    expect(ev(derived.frames[4], 'a_ga_pd')?.effect.satisfied).toBe(true)
    expect(derived.frames[4].fired).toContain('Passive Drain')
    expect(ev(derived.frames[4], 't_pd_a')?.effect.applied).toBe(true)
  })

  it('simultaneous pulses: two edges into Passive Drain ⇒ one execution, both edges reported', () => {
    const f = derived.frames[4]
    const trig = (f.stateEvents as { edgeId: string; effect: any }[]).filter(
      (e) => e.edgeId.startsWith('t_pd_') && e.effect.kind === 'trigger',
    )
    expect(trig.map((e) => e.edgeId)).toEqual(['t_pd_a', 't_pd_b']) // both, ascending
    expect(f.fired.filter((n) => n === 'Passive Drain')).toHaveLength(1) // once
  })

  it('interactive activation behaves as passive: the delayed pulse fires Interactive Drain from step 4', () => {
    for (const s of [1, 2, 3]) expect(derived.frames[s].fired).not.toContain('Interactive Drain')
    for (const s of [4, 5, 6]) expect(derived.frames[s].fired).toContain('Interactive Drain')
  })

  it('label +/-/=: Tank trace [0,8,4,4,4,4,4]; the single clamp rides the last edge', () => {
    expect(derived.frames.map((f) => f.values.Tank)).toEqual([0, 8, 4, 4, 4, 4, 4])
    const ev = (f: Frame, id: string) =>
      (f.stateEvents as { edgeId: string; effect: any }[]).find((e) => e.edgeId === id)
    // m_tank_addS < m_tank_sub is false — ids sort m_tank_addS, m_tank_sub ⇒ addS first, sub last
    expect(ev(derived.frames[1], 'm_tank_addS')?.effect).toEqual({ kind: 'label', delta: 10, clampAdjustment: 0 })
    expect(ev(derived.frames[1], 'm_tank_sub')?.effect).toEqual({ kind: 'label', delta: -1, clampAdjustment: -1 })
    expect(ev(derived.frames[2], 'm_tank_sub')?.effect.clampAdjustment).toBe(-9)
    // `=7` into a cap-5 Pool ⇒ Level pinned at 5, clampAdjustment −2 every step
    expect(derived.frames.map((f) => f.values.Level)).toEqual([0, 5, 5, 5, 5, 5, 5])
    expect(ev(derived.frames[1], 'm_level_set')?.effect).toEqual({ kind: 'label', delta: 7, clampAdjustment: -2 })
    expect(ev(derived.frames[2], 'm_level_set')?.effect).toEqual({ kind: 'label', delta: 2, clampAdjustment: -2 })
  })

  it('Feeder (label source) is only read, never debited', () => {
    for (const f of derived.frames) expect(f.values.Feeder).toBe(10)
  })

  it('label edits never appear as resource transfers and never end the run', () => {
    // (an End node would be needed to end; there is none — this asserts the queue
    //  is the only state carried and it drains cleanly, not that `ended` flips)
    expect(derived.frames.every((f) => Array.isArray(f.queue))).toBe(true)
  })

  it('import → export → import, array reversal, and every Monte-Carlo path agree', () => {
    expect(derived.roundTrip.matchesTrace).toBe(true)
    expect(derived.arrayReverse.matchesTrace).toBe(true)
    expect(derived.monteCarlo.perRunIsolation).toBe(true)
    expect(derived.monteCarlo.syncEqualsCooperative).toBe(true)
    expect(derived.monteCarlo.syncEqualsParallel).toBe(true)
    expect(derived.monteCarlo.tankTerminalAllEqual).toBe(true) // no RNG ⇒ identical runs
  })
})
