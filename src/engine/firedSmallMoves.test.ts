import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState, StepResult } from './index'
import { initSim, step } from './index'

// A node has fired where what it actually moved in the step is above 0 (issue 572). The
// threshold of 1e-9 decides which moves are shown as events and nothing else: a node whose
// every move is under it has fired, an End that takes such an amount ends the run, and a state
// connection that asks whether its source fired gets a yes. One test for each node kind that
// can fire, for the state connections that read a firing, and for a node that moves nothing.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string, activation: 'automatic' | 'passive' = 'automatic'): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation, mode: 'pushAny' },
})
const drain = (id: string): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' },
})
const end = (id: string): LoopNode => ({
  id, type: 'end', position: XY,
  data: { kind: 'end', label: id, activation: 'automatic', mode: 'pullAny' } as LoopNode['data'],
})
const gate = (id: string): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } as LoopNode['data'],
})
const converter = (id: string): LoopNode => ({
  id, type: 'converter', position: XY,
  data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const trigger = (id: string, s: string, t: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'trigger', expr: '', delay: 0 },
})
const labelWhenFired = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr, timing: 'afterPull', when: 'source-fired' },
})

/** half the display threshold, as a rate is written */
const SMALL = '0.0000000005'

function run(nodes: LoopNode[], edges: LoopEdge[], steps = 1): StepResult[] {
  let st: SimState = initSim(nodes)
  const out: StepResult[] = []
  for (let i = 0; i < steps; i++) {
    const r = step(nodes, edges, st, 1)
    out.push(r)
    st = r.state
  }
  return out
}

describe('a node whose every move is under the display threshold has fired', () => {
  it('a Source that pushes 5e-10: fired, no event, the Pool holds it', () => {
    const [r] = run([source('s'), pool('Q')], [res('in', 's', 'Q', SMALL)])
    expect(r.report.fired).toEqual(['s'])
    expect(r.state.fired).toEqual(['s'])
    expect(r.report.events).toEqual([])
    expect(r.state.values.Q).toBe(5e-10)
  })

  it('a Drain that takes 5e-10: fired, no event, the Pool falls by it', () => {
    const [r] = run([pool('P', 1), drain('d')], [res('out', 'P', 'd', SMALL)])
    expect(r.report.fired).toEqual(['d'])
    expect(r.report.events).toEqual([])
    expect(r.state.values.P).toBe(0.9999999995)
    expect(r.state.ended).toBe(false)
  })

  it('an End that takes 5e-10: fired, and the run ends on it', () => {
    const [r] = run([pool('P', 1), end('x')], [res('out', 'P', 'x', SMALL)])
    expect(r.report.fired).toEqual(['x'])
    expect(r.report.events).toEqual([])
    expect(r.state.values.P).toBe(0.9999999995)
    expect(r.state.ended).toBe(true)
  })

  it('a Gate that passes 5e-10 on: fired, no event, the amount arrives', () => {
    const [r] = run([pool('P', 1), gate('g'), pool('Q')], [res('in', 'P', 'g', SMALL), res('on', 'g', 'Q', '1')])
    expect(r.report.fired).toEqual(['g'])
    expect(r.report.events).toEqual([])
    expect(r.state.values).toEqual({ P: 0.9999999995, Q: 5e-10 })
  })

  it('a Converter that turns 5e-10 into 5e-10: fired, no event, the amount arrives', () => {
    const [r] = run([pool('P', 1), converter('c'), pool('Q')], [res('in', 'P', 'c', SMALL), res('made', 'c', 'Q', SMALL)])
    expect(r.report.fired).toEqual(['c'])
    expect(r.report.events).toEqual([])
    expect(r.state.values).toEqual({ P: 0.9999999995, Q: 5e-10 })
  })
})

describe('a node that moves nothing has not fired', () => {
  it('a Drain and an End on an empty Pool: not fired, and the run goes on', () => {
    const [r] = run([pool('P', 0), drain('d'), pool('R', 0), end('x')], [res('a', 'P', 'd', SMALL), res('b', 'R', 'x', SMALL)])
    expect(r.report.fired).toEqual([])
    expect(r.state.ended).toBe(false)
  })

  it('a Gate and a Converter on an empty Pool, and a Source into a full Pool: not fired', () => {
    const [r] = run(
      [pool('P', 0), gate('g'), pool('Q'), pool('R', 0), converter('c'), pool('T'), source('s'), pool('F', 3, 3)],
      [res('a', 'P', 'g', SMALL), res('b', 'g', 'Q', '1'), res('c1', 'R', 'c', SMALL), res('c2', 'c', 'T', SMALL), res('d', 's', 'F', SMALL)],
    )
    expect(r.report.fired).toEqual([])
    expect(r.state.values).toEqual({ P: 0, Q: 0, R: 0, T: 0, F: 3 })
  })
})

describe('a state connection that asks whether its source fired sees a firing with no event', () => {
  it("a `label` with when: 'source-fired' is applied in the step its Gate passes 5e-10", () => {
    const [r] = run(
      [pool('P', 1), gate('g'), pool('Q'), pool('K')],
      [res('in', 'P', 'g', SMALL), res('on', 'g', 'Q', '1'), labelWhenFired('count', 'g', 'K', '+1')],
    )
    expect(r.report.fired).toEqual(['g'])
    expect(r.report.events).toEqual([])
    expect(r.state.values.K).toBe(1)
  })

  it("the same `label` is not applied while the Gate's Pool is empty", () => {
    const [r] = run(
      [pool('P', 0), gate('g'), pool('Q'), pool('K')],
      [res('in', 'P', 'g', SMALL), res('on', 'g', 'Q', '1'), labelWhenFired('count', 'g', 'K', '+1')],
    )
    expect(r.report.fired).toEqual([])
    expect(r.state.values.K).toBe(0)
  })

  it('a trigger from a Drain that takes 5e-10 pulses its passive Source in the next step', () => {
    const out = run(
      [pool('P', 1), drain('d'), source('s2', 'passive'), pool('R')],
      [res('out', 'P', 'd', SMALL), trigger('t', 'd', 's2'), res('push', 's2', 'R', '2')],
      2,
    )
    expect(out[0].report.fired).toEqual(['d'])
    expect(out[0].state.values.R).toBe(0)
    expect(out[1].report.fired).toEqual(['d', 's2'])
    expect(out[1].state.values.R).toBe(2)
  })

  it('no trigger where the Drain has nothing to take', () => {
    const out = run(
      [pool('P', 0), drain('d'), source('s2', 'passive'), pool('R')],
      [res('out', 'P', 'd', SMALL), trigger('t', 'd', 's2'), res('push', 's2', 'R', '2')],
      2,
    )
    expect(out[1].report.fired).toEqual([])
    expect(out[1].state.values.R).toBe(0)
  })
})
