import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './step'

// A Converter's run target: the fraction a step may run it at. `runTargets` is the
// engine's own seam. It is what a run rule will set, and no document reaches it yet.
// A step with no entry is what it was, and at a target of 1 too.
//
// The stage takes 100 feed and 300 power per run, and makes 45 product and 55 brine.

type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number): LoopNode =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const stage = (id: string, mode: Mode): LoopNode =>
  ({ id, type: 'converter', position: { x: 0, y: 0 }, data: { kind: 'converter', label: id, activation: 'automatic', mode } }) as unknown as LoopNode
const line = (id: string, source: string, target: string, flow: string): LoopEdge =>
  ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow } }) as unknown as LoopEdge

const LINES = [line('feed', 'tank', 'ro', '100'), line('power', 'panel', 'ro', '300'), line('product', 'ro', 'store', '45'), line('brine', 'ro', 'waste', '55')]
const plant = (mode: Mode, feed = 1e6, rate?: string) => ({
  nodes: [pool('tank', feed), pool('panel', 1e6), stage('ro', mode), pool('store', 0), pool('waste', 0)],
  edges: rate ? LINES.map((e) => ({ ...e, data: { ...e.data, flow: rate } }) as LoopEdge) : LINES,
})

function run(g: ReturnType<typeof plant>, target?: number) {
  const opts = target === undefined ? {} : { runTargets: { ro: target } }
  return step(g.nodes, g.edges, initSim(g.nodes), 1, 2, opts)
}
/** what share of its rate a line moved: the group's fraction, read from the feed line */
const moved = (r: ReturnType<typeof run>, rate = 100) => (r.report.events.find((e) => e.edgeId === 'feed')?.amount ?? 0) / rate

describe('a Converter runs at its target', () => {
  it('every line of the stage moves the same fraction, and what it makes follows', () => {
    const r = run(plant('pullAny'), 0.5)
    const amounts = Object.fromEntries(r.report.events.map((e) => [e.edgeId, e.amount]))
    expect(amounts).toEqual({ feed: 50, power: 150, product: 22.5, brine: 27.5 })
    expect(r.state.values.tank).toBe(1e6 - 50)
    expect(r.state.values.store).toBe(22.5)
  })

  it('no target and a target of 1 are the same step', () => {
    for (const mode of ['pullAny', 'pullAll'] as const) expect(run(plant(mode), 1)).toEqual(run(plant(mode)))
  })

  it('a target of 0 moves nothing', () => {
    for (const mode of ['pullAny', 'pullAll'] as const) expect(run(plant(mode), 0).report.events).toEqual([])
  })

  it('a target is a ceiling: the stage does not run above it with plenty to take', () => {
    expect(moved(run(plant('pullAny'), 0.25))).toBe(0.25)
    expect(moved(run(plant('pullAll'), 0.25))).toBe(0.25)
  })

  it('a target adds no memory: the state alone decides the next step', () => {
    const g = plant('pullAny')
    const o = { runTargets: { ro: 0.5 } }
    const first = step(g.nodes, g.edges, initSim(g.nodes), 1, 2, o)
    const second = step(g.nodes, g.edges, first.state, 1, 2, o)
    expect(second.state.values.tank).toBe(1e6 - 100)
  })
})

describe('the engine floors stay what they are', () => {
  it('a fraction at or below 1e-9 does not run, in either mode', () => {
    for (const mode of ['pullAny', 'pullAll'] as const) {
      expect(moved(run(plant(mode), 5e-10))).toBe(0)
      expect(moved(run(plant(mode), 1e-9))).toBe(0)
    }
  })

  it('a fraction just above it runs', () => {
    expect(moved(run(plant('pullAny'), 2e-9))).toBeCloseTo(2e-9, 15)
  })

  it('a line amount below the floor moves nothing, whatever the target', () => {
    expect(moved(run(plant('pullAny', 1e6, '0.1'), 2e-9), 0.1)).toBe(0)
  })
})

describe('`pull all` means reaching the target', () => {
  const ratio = (target: number, shortBy: number) => 100 * target * (1 - shortBy)

  it('short of a small target it stops: a tolerance of 1e-9 would let 1.5e-9 pass for 2e-9', () => {
    // feed for 1.5e-9 of a run, against a target of 2e-9
    expect(moved(run(plant('pullAny', 1.5e-7), 2e-9))).toBeCloseTo(1.5e-9, 15)
    expect(moved(run(plant('pullAll', 1.5e-7), 2e-9))).toBe(0)
  })

  it('within the ratio it runs, and past it it stops', () => {
    expect(moved(run(plant('pullAll', ratio(0.5, 5e-10)), 0.5))).toBeCloseTo(0.49999999975, 11)
    expect(moved(run(plant('pullAll', ratio(0.5, 2e-9)), 0.5))).toBe(0)
  })

  it('`pull any` takes what there is, with no ratio in the way', () => {
    expect(moved(run(plant('pullAny', ratio(0.5, 2e-9)), 0.5))).toBeCloseTo(0.499999999, 11)
  })

  it('at a target of 1 it keeps today’s tolerance', () => {
    expect(moved(run(plant('pullAll', ratio(1, 5e-10)), 1))).toBeCloseTo(0.9999999995, 11)
    expect(moved(run(plant('pullAll', ratio(1, 2e-9)), 1))).toBe(0)
    expect(moved(run(plant('pullAll', ratio(1, 5e-10))))).toBeCloseTo(0.9999999995, 11)
  })

  it('a third of a run, fed exactly its share, runs', () => {
    expect(moved(run(plant('pullAll', 100 / 3), 1 / 3))).toBeCloseTo(1 / 3, 12)
  })
})

describe('a group runs at its smallest target', () => {
  // two stages joined by a line form one group, and the plan fixes one number for it
  const chain = (mode: Mode, feed = 1e6) => ({
    nodes: [pool('tank', feed), stage('a', mode), stage('b', mode), pool('store', 0)],
    edges: [line('in', 'tank', 'a', '100'), line('mid', 'a', 'b', '100'), line('out', 'b', 'store', '100')],
  })
  const go = (g: ReturnType<typeof chain>, runTargets: Record<string, number>) => {
    const opts = { runTargets }
    const r = step(g.nodes, g.edges, initSim(g.nodes), 1, 2, opts)
    return Object.fromEntries(r.report.events.map((e) => [e.edgeId, e.amount]))
  }

  it('a target on one member holds the whole group', () => {
    expect(go(chain('pullAny'), { a: 0.5 })).toEqual({ in: 50, mid: 50, out: 50 })
    expect(go(chain('pullAny'), { b: 0.5 })).toEqual({ in: 50, mid: 50, out: 50 })
  })

  it('the smaller of two targets decides', () => {
    expect(go(chain('pullAny'), { a: 0.6, b: 0.4 })).toEqual({ in: 40, mid: 40, out: 40 })
  })

  it('a `pull all` group reaches the target, or does not run', () => {
    expect(go(chain('pullAll'), { a: 0.5 })).toEqual({ in: 50, mid: 50, out: 50 })
    expect(go(chain('pullAll', 30), { a: 0.5 })).toEqual({})
  })
})
