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

// ── I8-S — reverse-array determinism ─────────────────────────────────────
describe('I8-S — node / edge array order does not change the result', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'passive')]
  const edges = [res('e1', 'Src', 'P', '2'), res('e2', 'P', 'D', '1'), trig('t1', 'Src', 'D', 1)]
  const a = run(nodes, edges, 8)
  const b = run([...nodes].reverse(), [...edges].reverse(), 8)

  it('identical values / fired / stateEvents / triggerQueue frame by frame', () => {
    expect(b.frames).toEqual(a.frames)
    expect(b.diags).toEqual(a.diags)
  })
})
