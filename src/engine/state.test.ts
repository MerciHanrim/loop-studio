import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'

// SEMANTICS-S.md loop-state/1 — Slice 1: `trigger` + passive activation + delay.
// §S11 Case S-A / S-A2 are the acceptance vectors; I8-S is the reverse-array
// determinism check.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const drain = (id: string, activation: 'automatic' | 'passive' | 'interactive' = 'automatic'): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation, mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const trig = (id: string, s: string, t: string, delay?: number): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'trigger', expr: '', ...(delay === undefined ? {} : { delay }) },
})

type Frame = {
  step: number
  values: Record<string, number>
  fired: string[]
  stateEvents: unknown[]
  queue: { edgeId: string; target: string; deliveryStep: number }[]
}
function run(nodes: LoopNode[], edges: LoopEdge[], steps: number): { frames: Frame[]; diags: string[] } {
  let st: SimState = initSim(nodes)
  const frames: Frame[] = [{ step: 0, values: { ...st.values }, fired: [...st.fired], stateEvents: [], queue: [...st.triggerQueue] }]
  const diags: string[] = []
  for (let i = 0; i < steps; i++) {
    const r = step(nodes, edges, st, 1)
    st = r.state
    diags.push(...r.report.diagnostics)
    frames.push({
      step: st.step,
      values: { ...st.values },
      fired: r.report.fired,
      stateEvents: r.report.stateEvents,
      queue: st.triggerQueue.map((q) => ({ ...q })),
    })
  }
  return { frames, diags }
}

describe('initSim carries the state fields', () => {
  it('fired [] and triggerQueue [] at step 0', () => {
    const st = initSim([pool('P', 3)])
    expect(st.fired).toEqual([])
    expect(st.triggerQueue).toEqual([])
  })
})

describe('a graph with no state edges is untouched', () => {
  it('stateEvents [] and triggerQueue [] every step', () => {
    const { frames } = run([source('S'), pool('P'), drain('D')], [res('e1', 'S', 'P', '2'), res('e2', 'P', 'D', '1')], 4)
    for (const f of frames) {
      expect(f.stateEvents).toEqual([])
      expect(f.queue).toEqual([])
    }
  })
})

// ── Case S-A — trigger + passive, delay 0 ──────────────────────────────────
describe('S-A — Src ─2→ P ─1→ D(passive) ; Src ┄trigger d0┄> D', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'passive')]
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D', 0)]
  const { frames } = run(nodes, edges, 6)

  it('P = [0, 2, 3, 4, 5, 6, 7]', () => {
    expect(frames.map((f) => f.values.P)).toEqual([0, 2, 3, 4, 5, 6, 7])
  })
  it('D is idle at step 1 (not yet triggered), then fires from step 2', () => {
    expect(frames[1].fired).toEqual(['Src'])
    expect(frames[2].fired).toEqual(['D', 'Src'])
    expect(frames[3].fired).toEqual(['D', 'Src'])
  })
  it('the trigger schedules delivery at firedStep + 0 + 1', () => {
    expect(frames[1].queue).toEqual([{ edgeId: 't1', target: 'D', deliveryStep: 2 }])
    expect(frames[2].queue).toEqual([{ edgeId: 't1', target: 'D', deliveryStep: 3 }])
  })
  it('a delivered pulse to a passive target reports applied: true', () => {
    expect(frames[1].stateEvents).toEqual([])
    expect(frames[2].stateEvents).toEqual([
      { edgeId: 't1', from: 'Src', to: 'D', mode: 'trigger', effect: { kind: 'trigger', delivered: true, applied: true } },
    ])
  })
})

// ── Variant S-A2 — delay 2 ────────────────────────────────────────────────
describe('S-A2 — same graph, trigger delay 2', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'passive')]
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D', 2)]
  const { frames } = run(nodes, edges, 6)

  it('P = [0, 2, 4, 6, 7, 8, 9] — D first fires at step 4', () => {
    expect(frames.map((f) => f.values.P)).toEqual([0, 2, 4, 6, 7, 8, 9])
    expect(frames[3].fired).toEqual(['Src'])
    expect(frames[4].fired).toEqual(['D', 'Src'])
  })
  it('the queue holds the not-yet-due deliveries in (deliveryStep, edgeId) order', () => {
    expect(frames[3].queue).toEqual([
      { edgeId: 't1', target: 'D', deliveryStep: 4 },
      { edgeId: 't1', target: 'D', deliveryStep: 5 },
      { edgeId: 't1', target: 'D', deliveryStep: 6 },
    ])
  })
})

// ── trigger on an automatic target ────────────────────────────────────────
describe('a trigger on an automatic target has no execution effect', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'automatic')]
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D')]
  const { frames } = run(nodes, edges, 3)

  it('D fires on its own schedule; the delivery reports applied: false', () => {
    expect(frames[1].fired).toEqual(['Src']) // step 1: S[P]=0 so D pulls 0, not fired
    expect(frames[2].fired).toEqual(['D', 'Src'])
    expect(frames[2].stateEvents).toEqual([
      { edgeId: 't1', from: 'Src', to: 'D', mode: 'trigger', effect: { kind: 'trigger', delivered: true, applied: false } },
    ])
  })
})

// ── delivery-time guard ──────────────────────────────────────────────────
describe('a queued delivery for a removed edge / node is dropped', () => {
  it('no crash, a diagnostic, nothing triggered', () => {
    const nodes = [source('Src'), pool('P'), drain('D', 'passive')]
    const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1')] // t1 removed
    const prev: SimState = {
      step: 0, values: { P: 0 }, ended: false, fired: [],
      triggerQueue: [{ edgeId: 't1', target: 'D', deliveryStep: 1 }],
    }
    const r = step(nodes, edges, prev, 1)
    expect(r.report.fired).toEqual(['Src']) // D not fired
    expect(r.report.stateEvents).toEqual([])
    expect(r.state.triggerQueue).toEqual([]) // consumed
    expect(r.report.diagnostics.some((d) => /removed edge \/ node/.test(d))).toBe(true)
  })
})

// ── bad delay ────────────────────────────────────────────────────────────
describe('an invalid delay is treated as 0 with a diagnostic', () => {
  for (const bad of [1.5, -2, NaN, Infinity]) {
    it(`delay ${bad}`, () => {
      const nodes = [source('Src'), pool('P'), drain('D', 'passive')]
      const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D', bad)]
      const { frames, diags } = run(nodes, edges, 3)
      expect(frames.map((f) => f.values.P)).toEqual([0, 2, 3, 4]) // == delay 0
      expect(diags.some((d) => /delay .* not an integer/.test(d))).toBe(true)
    })
  }
})

// ── simultaneous pulses at one target ────────────────────────────────────
describe('two triggers to the same target: one execution, both edges reported', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'passive')]
  //           t2 delivers same step as t1 (both delay 0)
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D', 0), trig('t2', 'Src', 'D', 0)]
  const { frames } = run(nodes, edges, 3)

  it('D fires once at step 2', () => {
    expect(frames[2].fired).toEqual(['D', 'Src'])
    expect(frames[2].values.P).toBe(3) // +2 −1, not −2
  })
  it('stateEvents lists every arriving edge, ascending edgeId', () => {
    expect(frames[2].stateEvents).toEqual([
      { edgeId: 't1', from: 'Src', to: 'D', mode: 'trigger', effect: { kind: 'trigger', delivered: true, applied: true } },
      { edgeId: 't2', from: 'Src', to: 'D', mode: 'trigger', effect: { kind: 'trigger', delivered: true, applied: true } },
    ])
  })
  it('the queue keeps (deliveryStep, edgeId) order', () => {
    expect(frames[1].queue).toEqual([
      { edgeId: 't1', target: 'D', deliveryStep: 2 },
      { edgeId: 't2', target: 'D', deliveryStep: 2 },
    ])
  })
})

describe('mixed delays can deliver to one target on the same step', () => {
  // t1 d0 (from step t-1) and t2 d1 (from step t-2) both due at step 3
  const nodes = [source('Src'), pool('P'), drain('D', 'passive')]
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D', 0), trig('t2', 'Src', 'D', 1)]
  const { frames } = run(nodes, edges, 4)
  it('step 3: D fires once, both t1 and t2 report delivered', () => {
    expect(frames[3].fired).toEqual(['D', 'Src'])
    expect(frames[3].stateEvents.map((s) => (s as { edgeId: string }).edgeId)).toEqual(['t1', 't2'])
  })
})

// ── interactive target == passive ────────────────────────────────────────
describe('an interactive target behaves exactly like passive (headless)', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'interactive')]
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D', 0)]
  const { frames } = run(nodes, edges, 6)
  it('same P trace as S-A and applied: true', () => {
    expect(frames.map((f) => f.values.P)).toEqual([0, 2, 3, 4, 5, 6, 7])
    expect((frames[2].stateEvents[0] as { effect: { applied: boolean } }).effect.applied).toBe(true)
  })
})

// ── onStart target ──────────────────────────────────────────────────────
describe('a trigger on an onStart target has no execution effect', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'automatic')]
  // make D onStart via a raw override
  ;(nodes[2].data as { activation: string }).activation = 'onStart'
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D', 0)]
  const { frames } = run(nodes, edges, 4)
  it('D never fires (P has nothing at step 1); deliveries report applied: false', () => {
    for (let s = 1; s <= 4; s++) expect(frames[s].fired).toEqual(['Src'])
    expect((frames[2].stateEvents[0] as { effect: { applied: boolean } }).effect.applied).toBe(false)
  })
})

// ── a step where the source didn't move schedules nothing ────────────────
describe('a trigger source that did not fire schedules no pulse', () => {
  // Src → P is full from the start (init 2, cap 2) and P has no outlet ⇒ Src pushes 0
  const nodes = [source('Src'), pool('P', 2, 2)]
  const edges = [res('e1', 'Src', 'P', '5'), trig('t1', 'Src', 'P', 0)]
  const { frames } = run(nodes, edges, 3)
  it('the queue stays empty because Src never fired', () => {
    for (const f of frames) {
      expect(f.fired).toEqual([]) // Src pushed 0 each step
      expect(f.queue).toEqual([])
      expect(f.stateEvents).toEqual([])
    }
  })
})

// ── legacy `node` mode ──────────────────────────────────────────────────
describe('a legacy `node` mode state edge is inert with one diagnostic', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'passive')]
  const nodeEdge: LoopEdge = {
    id: 'x1', source: 'Src', target: 'D', type: 'loop',
    sourceHandle: 'state-source', targetHandle: 'state-target',
    data: { kind: 'state', mode: 'node', expr: '' },
  }
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), nodeEdge]
  const { frames, diags } = run(nodes, edges, 3)
  it('D never fires, no stateEvents, one "not supported" diagnostic per step', () => {
    for (let s = 1; s <= 3; s++) {
      expect(frames[s].fired).toEqual(['Src'])
      expect(frames[s].stateEvents).toEqual([])
    }
    expect(diags.filter((d) => /mode "node" is not supported/.test(d)).length).toBe(3)
  })
})

// ── I8-S — reverse-array determinism ─────────────────────────────────────
describe('I8-S — node / edge array order does not change the result', () => {
  // two trigger edges with distinct ids + a delay, so the (deliveryStep, edgeId)
  // sort tiebreak is exercised
  const nodes = [source('Src'), pool('P'), drain('D', 'passive'), drain('E', 'passive')]
  const edges = [
    res('e1', 'Src', 'P', '2'),
    res('e2', 'P', 'D', '1'),
    res('e3', 'P', 'E', '1'),
    trig('t2', 'Src', 'E', 1),
    trig('t1', 'Src', 'D', 1),
  ]
  const a = run(nodes, edges, 8)
  const b = run([...nodes].reverse(), [...edges].reverse(), 8)

  it('identical values / fired / stateEvents / triggerQueue frame by frame', () => {
    expect(b.frames).toEqual(a.frames)
    expect(b.diags).toEqual(a.diags)
  })
  it('the queue is sorted (deliveryStep, edgeId)', () => {
    // step 1 scheduled t1@3 and t2@3 ⇒ t1 before t2 by id
    expect(a.frames[1].queue).toEqual([
      { edgeId: 't1', target: 'D', deliveryStep: 3 },
      { edgeId: 't2', target: 'E', deliveryStep: 3 },
    ])
  })
})
