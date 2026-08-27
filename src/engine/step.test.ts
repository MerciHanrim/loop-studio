import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// ── builders ────────────────────────────────────────────────────────────────
const P = { x: 0, y: 0 }
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id,
  type: 'pool',
  position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string, mode: 'pushAny' | 'pushAll' = 'pushAny'): LoopNode => ({
  id,
  type: 'source',
  position: P,
  data: { kind: 'source', label: id, activation: 'automatic', mode },
})
const drain = (id: string, mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({
  id,
  type: 'drain',
  position: P,
  data: { kind: 'drain', label: id, activation: 'automatic', mode },
})
const gate = (id: string, mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({
  id,
  type: 'gate',
  position: P,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode },
})
const converter = (id: string, mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({
  id,
  type: 'converter',
  position: P,
  data: { kind: 'converter', label: id, activation: 'automatic', mode },
})
const end = (id: string): LoopNode => ({
  id,
  type: 'end',
  position: P,
  data: { kind: 'end', label: id, activation: 'automatic' },
})
const edge = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id,
  source: s,
  target: t,
  type: 'loop',
  data: { kind: 'resource', flow },
})

type Frame = {
  step: number
  values: Record<string, number>
  byEdge: Record<string, number>
  fired: string[]
  ended: boolean
}

function run(nodes: LoopNode[], edges: LoopEdge[], steps: number): Frame[] {
  let st = initSim(nodes)
  const frames: Frame[] = [
    { step: 0, values: { ...st.values }, byEdge: {}, fired: [], ended: st.ended },
  ]
  for (let i = 0; i < steps; i++) {
    const r = step(nodes, edges, st)
    st = r.state
    const byEdge: Record<string, number> = {}
    for (const ev of r.report.events) byEdge[ev.edgeId] = (byEdge[ev.edgeId] ?? 0) + ev.amount
    frames.push({
      step: st.step,
      values: { ...st.values },
      byEdge,
      fired: r.report.fired,
      ended: st.ended,
    })
  }
  return frames
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6

// ── the acceptance sample (SEMANTICS.md §14) ────────────────────────────────
// n1 Source -3-> n2 Vault(cap10) -all-> n3 Gate --2--> n4 Converter -1-> n6 Prod(cap3)
//                                            \--1--> n5 Drain
// Variant A additionally: n6 Prod -1-> n7 Drain2

function sampleCommon() {
  const nodes = [
    source('n1'),
    pool('n2', 0, 10),
    gate('n3'),
    converter('n4'),
    drain('n5'),
    pool('n6', 0, 3),
  ]
  const edges = [
    edge('e1', 'n1', 'n2', '3'),
    edge('e2', 'n2', 'n3', 'all'),
    edge('e3', 'n3', 'n4', '2'),
    edge('e4', 'n3', 'n5', '1'),
    edge('e5', 'n4', 'n6', '1'),
  ]
  return { nodes, edges }
}

describe('Engine A — Variant A (flowing equilibrium)', () => {
  const { nodes, edges } = sampleCommon()
  nodes.push(drain('n7'))
  edges.push(edge('e6', 'n6', 'n7', '1'))
  const t = run(nodes, edges, 6)

  const expected: Array<[number, number, number, Record<string, number>, string[]]> = [
    // step, V, P, byEdge, fired
    [1, 3, 0, { e1: 3 }, ['n1']],
    [2, 3, 1, { e1: 3, e2: 3, e3: 2, e4: 1, e5: 1 }, ['n1', 'n3', 'n4', 'n5']],
    [3, 3, 1, { e1: 3, e2: 3, e3: 2, e4: 1, e5: 1, e6: 1 }, ['n1', 'n3', 'n4', 'n5', 'n7']],
    [4, 3, 1, { e1: 3, e2: 3, e3: 2, e4: 1, e5: 1, e6: 1 }, ['n1', 'n3', 'n4', 'n5', 'n7']],
  ]

  for (const [s, v, p, be, fired] of expected) {
    it(`step ${s}`, () => {
      const f = t[s]
      expect(near(f.values.n2, v)).toBe(true)
      expect(near(f.values.n6, p)).toBe(true)
      for (const k of ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] as const) {
        expect(near(f.byEdge[k] ?? 0, be[k] ?? 0)).toBe(true)
      }
      expect(f.fired).toEqual(fired)
    })
  }

  it('reaches steady state V=3 P=1', () => {
    for (let s = 3; s <= 6; s++) {
      expect(near(t[s].values.n2, 3)).toBe(true)
      expect(near(t[s].values.n6, 1)).toBe(true)
    }
  })
})

describe('Engine A — Variant B (bottleneck deadlock)', () => {
  const { nodes, edges } = sampleCommon()
  const t = run(nodes, edges, 10)

  const expected: Array<[number, number, number, Record<string, number>, string[]]> = [
    [1, 3, 0, { e1: 3 }, ['n1']],
    [2, 3, 1, { e1: 3, e2: 3, e3: 2, e4: 1, e5: 1 }, ['n1', 'n3', 'n4', 'n5']],
    [3, 3, 2, { e1: 3, e2: 3, e3: 2, e4: 1, e5: 1 }, ['n1', 'n3', 'n4', 'n5']],
    [4, 3, 3, { e1: 3, e2: 3, e3: 2, e4: 1, e5: 1 }, ['n1', 'n3', 'n4', 'n5']],
    [5, 6, 3, { e1: 3 }, ['n1']],
    [6, 9, 3, { e1: 3 }, ['n1']],
    [7, 10, 3, { e1: 1 }, ['n1']],
    [8, 10, 3, {}, []],
    [9, 10, 3, {}, []],
    [10, 10, 3, {}, []],
  ]

  for (const [s, v, p, be, fired] of expected) {
    it(`step ${s}`, () => {
      const f = t[s]
      expect(near(f.values.n2, v)).toBe(true)
      expect(near(f.values.n6, p)).toBe(true)
      for (const k of ['e1', 'e2', 'e3', 'e4', 'e5'] as const) {
        expect(near(f.byEdge[k] ?? 0, be[k] ?? 0)).toBe(true)
      }
      expect(f.fired).toEqual(fired)
    })
  }

  it('Source back-pressures at step 7 (pushes 1 of 3)', () => {
    expect(near(t[7].byEdge.e1 ?? 0, 1)).toBe(true)
  })
})

// ── invariants ─────────────────────────────────────────────────────────────
describe('Engine A — invariants', () => {
  it('I3 capacity — pools stay within [0, capacity] every step', () => {
    const { nodes, edges } = sampleCommon()
    for (const f of run(nodes, edges, 12)) {
      expect(f.values.n2).toBeGreaterThanOrEqual(-1e-9)
      expect(f.values.n2).toBeLessThanOrEqual(10 + 1e-9)
      expect(f.values.n6).toBeGreaterThanOrEqual(-1e-9)
      expect(f.values.n6).toBeLessThanOrEqual(3 + 1e-9)
    }
  })

  it('I6 determinism — two runs and a reset produce identical traces', () => {
    const { nodes, edges } = sampleCommon()
    const a = run(nodes, edges, 12)
    const b = run(nodes, edges, 12)
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a))
  })

  it('I1 conservation — pool delta = source pushes − drain pulls − converter loss, per step', () => {
    const { nodes, edges } = sampleCommon()
    nodes.push(drain('n7'))
    edges.push(edge('e6', 'n6', 'n7', '1'))
    const kind = new Map(nodes.map((n) => [n.id, n.data.kind]))
    let st = initSim(nodes)
    for (let i = 0; i < 12; i++) {
      const before = st.values.n2 + st.values.n6
      const r = step(nodes, edges, st)
      const after = r.state.values.n2 + r.state.values.n6
      let srcOut = 0
      let drainIn = 0
      let intoConv = 0
      let outConv = 0
      for (const ev of r.report.events) {
        if (kind.get(ev.from) === 'source') srcOut += ev.amount
        if (kind.get(ev.to) === 'drain' || kind.get(ev.to) === 'end') drainIn += ev.amount
        if (kind.get(ev.to) === 'converter') intoConv += ev.amount
        if (kind.get(ev.from) === 'converter') outConv += ev.amount
      }
      const convLoss = intoConv - outConv
      expect(near(after - before, srcOut - drainIn - convLoss)).toBe(true)
      st = r.state
    }
  })

  it('I7 iteration-order invariance — shuffled node/edge arrays give the same result', () => {
    const { nodes, edges } = sampleCommon()
    const shuffled = (arr: unknown[]) => [...arr].reverse()
    const a = run(nodes, edges, 10)
    const b = run(shuffled(nodes) as LoopNode[], shuffled(edges) as LoopEdge[], 10)
    for (let s = 0; s <= 10; s++) {
      expect(near(a[s].values.n2, b[s].values.n2)).toBe(true)
      expect(near(a[s].values.n6, b[s].values.n6)).toBe(true)
      expect(a[s].fired).toEqual(b[s].fired)
    }
  })
})

// ── mini-cases (SEMANTICS.md §14) ───────────────────────────────────────────
describe('Engine A — mini-cases', () => {
  it('pull all — atomic: takes nothing below demand, exactly the demand at/above it', () => {
    const nodes = [source('s'), pool('p', 4), drain('d', 'pullAll')]
    const edges = [edge('a', 's', 'p', '10'), edge('b', 'p', 'd', '5')]
    const t = run(nodes, edges, 2)
    // step 1: snapshot p = 4 < 5 → drain pulls 0; p = 4 + 10
    expect(near(t[1].byEdge.b ?? 0, 0)).toBe(true)
    expect(near(t[1].values.p, 14)).toBe(true)
    // step 2: snapshot p = 14 ≥ 5 → drain pulls exactly 5; p = 14 + 10 − 5
    expect(near(t[2].byEdge.b ?? 0, 5)).toBe(true)
    expect(near(t[2].values.p, 19)).toBe(true)
  })

  it('percent — 25% is a fraction of the snapshot', () => {
    const nodes = [pool('p', 10), gate('g'), drain('x'), drain('y')]
    const edges = [
      edge('in', 'p', 'g', '25%'),
      edge('ox', 'g', 'x', '1'),
      edge('oy', 'g', 'y', '1'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].values.p, 7.5)).toBe(true)
    expect(near(t[1].byEdge.ox ?? 0, 1.25)).toBe(true)
    expect(near(t[1].byEdge.oy ?? 0, 1.25)).toBe(true)
  })

  it('random flow contributes 0 and raises a diagnostic', () => {
    const nodes = [source('s'), pool('p', 0)]
    const edges = [edge('a', 's', 'p', '2D6')]
    const r = step(nodes, edges, initSim(nodes))
    expect(near(r.state.values.p, 0)).toBe(true)
    expect(r.report.diagnostics.some((d) => /random flow/i.test(d))).toBe(true)
  })

  it('End — a positive arrival ends the run and fires End', () => {
    const nodes = [source('s'), pool('p', 0), end('z')]
    const edges = [edge('a', 's', 'p', '1'), edge('b', 'p', 'z', '1')]
    const t = run(nodes, edges, 3)
    expect(t[1].ended).toBe(false)
    expect(t[2].ended).toBe(true)
    expect(t[2].fired).toContain('z')
  })
})
