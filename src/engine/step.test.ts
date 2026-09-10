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
const pgate = (id: string, mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({
  id,
  type: 'gate',
  position: P,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'probabilistic', mode },
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

  it('pull all — a Converter below demand is atomic too: consumes 0, produces 0', () => {
    // SEMANTICS.md §9 — "for a Converter, f = 0 when f < 1 … it moves 0 from
    // every edge (atomic)"; §11 / I5 — a blocked Converter accumulates nothing
    // and destroys nothing. Regression: the converter used to `takeFrom` the
    // input Pool for the partial amount *before* the `f < 1` bail, draining the
    // source while emitting no output.
    const nodes = [pool('wallet', 200), converter('buy', 'pullAll'), pool('rolls', 0), drain('sink')]
    const edges = [
      edge('in', 'wallet', 'buy', '300'), // needs a full 300, only 200 is there
      edge('out', 'buy', 'rolls', '1'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.in ?? 0, 0)).toBe(true) // nothing pulled from wallet
    expect(near(t[1].byEdge.out ?? 0, 0)).toBe(true) // nothing produced
    expect(near(t[1].values.wallet, 200)).toBe(true) // wallet intact
    expect(near(t[1].values.rolls ?? 0, 0)).toBe(true)
    expect(t[1].fired).not.toContain('buy')
  })

  it('pull all — a Converter at/above demand converts in full', () => {
    const nodes = [pool('wallet', 300), converter('buy', 'pullAll'), pool('rolls', 0), drain('sink')]
    const edges = [edge('in', 'wallet', 'buy', '300'), edge('out', 'buy', 'rolls', '1')]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.in ?? 0, 300)).toBe(true)
    expect(near(t[1].byEdge.out ?? 0, 1)).toBe(true)
    expect(near(t[1].values.wallet, 0)).toBe(true)
    expect(near(t[1].values.rolls ?? 0, 1)).toBe(true)
    expect(t[1].fired).toContain('buy')
  })

  it('pull all — a router feeding a short pullAll Converter routes nothing', () => {
    // Pool(50) → Gate → pullAll Converter(needs 100) → Pool. The Gate runs
    // first; without an input-side feasibility check it would push 50 into the
    // Converter inbox, the Converter would bail at f = 0.5, and the 50 pulled
    // out of `src` would be destroyed. `accept(converter_pullAll)` must be 0
    // here so the Gate never pulls.
    const nodes = [pool('src', 50), gate('g'), converter('c', 'pullAll'), pool('out', 0), drain('d')]
    const edges = [
      edge('a', 'src', 'g', '100'),
      edge('b', 'g', 'c', '100'),
      edge('e', 'c', 'out', '1'),
      edge('f', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.a ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.b ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.e ?? 0, 0)).toBe(true)
    expect(near(t[1].values.src, 50)).toBe(true)
    expect(near(t[1].values.out ?? 0, 0)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull all — mixed inbox + direct Pool inputs, total short: nothing moves', () => {
    // Converter `c` (pullAll) needs 40 via a direct Pool edge + 60 via a Gate
    // edge = 100/activation. `poolIn` has only 30, `gateSrc` has only 50 → the
    // Gate can supply at most 50 < 60. Total possible 30 + 50 = 80 < 100.
    const nodes = [
      pool('poolIn', 30),
      pool('gateSrc', 50),
      gate('g'),
      converter('c', 'pullAll'),
      pool('out', 0),
      drain('d'),
    ]
    const edges = [
      edge('p', 'poolIn', 'c', '40'),
      edge('gs', 'gateSrc', 'g', '60'),
      edge('gc', 'g', 'c', '60'),
      edge('co', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.p ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.gs ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.gc ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.co ?? 0, 0)).toBe(true)
    expect(near(t[1].values.poolIn, 30)).toBe(true)
    expect(near(t[1].values.gateSrc, 50)).toBe(true)
    expect(near(t[1].values.out ?? 0, 0)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull all — mixed inbox + direct Pool inputs, both sufficient: converts in full', () => {
    const nodes = [
      pool('poolIn', 40),
      pool('gateSrc', 60),
      gate('g'),
      converter('c', 'pullAll'),
      pool('out', 0),
      drain('d'),
    ]
    const edges = [
      edge('p', 'poolIn', 'c', '40'),
      edge('gs', 'gateSrc', 'g', '60'),
      edge('gc', 'g', 'c', '60'),
      edge('co', 'c', 'out', '2'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.p ?? 0, 40)).toBe(true)
    expect(near(t[1].byEdge.gc ?? 0, 60)).toBe(true)
    expect(near(t[1].byEdge.co ?? 0, 2)).toBe(true)
    expect(near(t[1].values.poolIn, 0)).toBe(true)
    expect(near(t[1].values.gateSrc, 0)).toBe(true)
    expect(near(t[1].values.out ?? 0, 2)).toBe(true)
    expect(t[1].fired).toContain('c')
  })

  it('pull all — two input edges off ONE Pool, jointly short: atomic', () => {
    // `c` (pullAll) pulls 30 + 30 = 60/activation, both from `p`, which has 50.
    // `dryAvail` must show the second edge only 20 left → f < 1 → nothing moves.
    const nodes = [pool('p', 50), converter('c', 'pullAll'), pool('out', 0), drain('d')]
    const edges = [
      edge('i1', 'p', 'c', '30'),
      edge('i2', 'p', 'c', '30'),
      edge('o', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.i1 ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.i2 ?? 0, 0)).toBe(true)
    expect(near(t[1].values.p, 50)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull all — two input Pools, one short: atomic (no partial from the full one)', () => {
    const nodes = [pool('a', 100), pool('b', 10), converter('c', 'pullAll'), pool('out', 0), drain('d')]
    const edges = [
      edge('ia', 'a', 'c', '50'),
      edge('ib', 'b', 'c', '50'),
      edge('o', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.ia ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.ib ?? 0, 0)).toBe(true)
    expect(near(t[1].values.a, 100)).toBe(true)
    expect(near(t[1].values.b, 10)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull all — output space short: every input edge and event is 0', () => {
    // `c` (pullAll) can pull its full 100 from `p`, but `out` (cap 1) has no
    // room for the 100-unit result → f bounded below 1 by headroom → atomic.
    const nodes = [pool('p', 100), converter('c', 'pullAll'), pool('out', 0, 1), drain('d')]
    const edges = [
      edge('i', 'p', 'c', '100'),
      edge('o', 'c', 'out', '100'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.i ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.o ?? 0, 0)).toBe(true)
    expect(near(t[1].values.p, 100)).toBe(true)
    expect(near(t[1].values.out ?? 0, 0)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull ANY converter is unchanged — a short feed still converts proportionally', () => {
    const nodes = [pool('p', 40), converter('c', 'pullAny'), pool('out', 0), drain('d')]
    const edges = [
      edge('i', 'p', 'c', '100'), // wants 100, only 40 available
      edge('o', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    // f = 40/100 = 0.4 → pulls 40, produces 0.4
    expect(near(t[1].byEdge.i ?? 0, 40)).toBe(true)
    expect(near(t[1].byEdge.o ?? 0, 0.4)).toBe(true)
    expect(near(t[1].values.p, 0)).toBe(true)
    expect(near(t[1].values.out ?? 0, 0.4)).toBe(true)
    expect(t[1].fired).toContain('c')
  })

  it('pull ANY converter behind a router is unchanged too', () => {
    const nodes = [pool('src', 50), gate('g'), converter('c', 'pullAny'), pool('out', 0), drain('d')]
    const edges = [
      edge('a', 'src', 'g', '100'),
      edge('b', 'g', 'c', '100'),
      edge('e', 'c', 'out', '1'),
      edge('f', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    // Gate pulls 50 from src, Converter (pullAny) converts f = 0.5 → 0.5 out
    expect(near(t[1].byEdge.a ?? 0, 50)).toBe(true)
    expect(near(t[1].byEdge.e ?? 0, 0.5)).toBe(true)
    expect(near(t[1].values.src, 0)).toBe(true)
    expect(near(t[1].values.out ?? 0, 0.5)).toBe(true)
  })

  // ── shared source, two upstream routers, one pullAll Converter (diamond) ──
  // ONE Pool (60) fans out to two Gates that both re-join at one pullAll
  // Converter needing 50 + 50 = 100. The Pool cannot feed both, so the
  // Converter is infeasible and NOTHING may move — the supply accounting must
  // charge the shared Pool once, not once per path.
  const diamondNodes = () => [
    pool('shared', 60),
    gate('g1'),
    gate('g2'),
    converter('c', 'pullAll'),
    pool('out', 0),
    drain('d'),
  ]
  const diamondEdges = () => [
    edge('a1', 'shared', 'g1', '50'),
    edge('a2', 'shared', 'g2', '50'),
    edge('b1', 'g1', 'c', '50'),
    edge('b2', 'g2', 'c', '50'),
    edge('co', 'c', 'out', '1'),
    edge('od', 'out', 'd', '0'),
  ]

  it('pull all — shared Pool → two routers → one Converter: infeasible, nothing moves', () => {
    const t = run(diamondNodes(), diamondEdges(), 1)
    for (const k of ['a1', 'a2', 'b1', 'b2', 'co']) {
      expect(near(t[1].byEdge[k] ?? 0, 0)).toBe(true)
    }
    expect(near(t[1].values.shared, 60)).toBe(true)
    expect(near(t[1].values.out ?? 0, 0)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull all — the diamond verdict is invariant to node / edge array order', () => {
    const fwd = run(diamondNodes(), diamondEdges(), 1)
    const rev = run(diamondNodes().reverse(), diamondEdges().reverse(), 1)
    expect(near(rev[1].values.shared, 60)).toBe(true)
    expect(near(rev[1].values.out ?? 0, 0)).toBe(true)
    expect(rev[1].fired).not.toContain('c')
    expect(near(fwd[1].values.shared, rev[1].values.shared)).toBe(true)
  })

  it('pull all — a Converter chain: short at the first stage stops the second cleanly', () => {
    // p(30) → c1(pullAll, needs 50) → c2(pullAll) → out. c1 can't fill, so it
    // moves 0; c2 then has an empty inbox and also moves 0. Nothing anywhere.
    const nodes = [
      pool('p', 30),
      converter('c1', 'pullAll'),
      converter('c2', 'pullAll'),
      pool('out', 0),
      drain('d'),
    ]
    const edges = [
      edge('a', 'p', 'c1', '50'),
      edge('b', 'c1', 'c2', '10'),
      edge('e', 'c2', 'out', '1'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.a ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.b ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.e ?? 0, 0)).toBe(true)
    expect(near(t[1].values.p, 30)).toBe(true)
    expect(t[1].fired).not.toContain('c1')
    expect(t[1].fired).not.toContain('c2')
  })

  it('pull all — shared Pool feeds the diamond fully when it has enough', () => {
    // same shape, `shared` = 100 → both 50-edges fillable → converts in full
    const nodes = diamondNodes()
    ;(nodes.find((n) => n.id === 'shared')!.data as { initial: number }).initial = 100
    const t = run(nodes, diamondEdges(), 1)
    expect(near(t[1].byEdge.b1 ?? 0, 50)).toBe(true)
    expect(near(t[1].byEdge.b2 ?? 0, 50)).toBe(true)
    expect(near(t[1].byEdge.co ?? 0, 1)).toBe(true)
    expect(near(t[1].values.shared, 0)).toBe(true)
    expect(near(t[1].values.out ?? 0, 1)).toBe(true)
    expect(t[1].fired).toContain('c')
  })

  // ── HR round-3: pullAllFeasible must model real upstream execution ──────────
  it('pull all — a probabilistic gate: when it picks the Converter branch, the pullAll Converter runs', () => {
    // `pg` sends its whole input down the ONE branch its draw picks. Branch
    // weights `co`:`ce` = 1:1; `c` (pullAll) needs its input edge full (rate 5)
    // and `p` holds exactly 5. `pullAllFeasible` must NOT block this with a
    // `want·ΣW/w` proportional-split back-calc — a probabilistic branch carries
    // the whole selected input, not a weighted fraction.
    const nodes = [pool('p', 5), pgate('pg'), converter('c', 'pullAll'), pool('out', 0), pool('elsewhere', 0, 99), drain('d'), drain('d2')]
    const edges = [
      edge('in', 'p', 'pg', '5'),
      edge('co', 'pg', 'c', '5'),
      edge('ce', 'pg', 'elsewhere', '5'),
      edge('o', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
      edge('ed', 'elsewhere', 'd2', '0'),
    ]
    // pick a seed whose draw lands on `co` (the Converter branch)
    let seed = 1
    for (; seed < 300; seed++) {
      const g = step(nodes, edges, initSim(nodes), seed)
      if ((g.report.events.find((e) => e.edgeId === 'co')?.amount ?? 0) > 0) break
    }
    const r = step(nodes, edges, initSim(nodes), seed)
    expect(near(r.report.events.find((e) => e.edgeId === 'co')?.amount ?? 0, 5)).toBe(true)
    expect(near(r.state.values.out ?? 0, 1)).toBe(true) // Converter ran (f = 1)
    expect(near(r.state.values.p, 0)).toBe(true)
    expect(r.report.fired).toContain('c')
  })

  it('pull all — a probabilistic gate that picks a DIFFERENT branch leaves the Converter idle, nothing lost', () => {
    const nodes = [pool('p', 5), pgate('pg'), converter('c', 'pullAll'), pool('out', 0), pool('elsewhere', 0, 99), drain('d'), drain('d2')]
    const edges = [
      edge('in', 'p', 'pg', '5'),
      edge('co', 'pg', 'c', '5'),
      edge('ce', 'pg', 'elsewhere', '5'),
      edge('o', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
      edge('ed', 'elsewhere', 'd2', '0'),
    ]
    let seed = 1
    for (; seed < 300; seed++) {
      const g = step(nodes, edges, initSim(nodes), seed)
      if ((g.report.events.find((e) => e.edgeId === 'ce')?.amount ?? 0) > 0) break
    }
    const r = step(nodes, edges, initSim(nodes), seed)
    expect(near(r.report.events.find((e) => e.edgeId === 'co')?.amount ?? 0, 0)).toBe(true)
    expect(near(r.state.values.out ?? 0, 0)).toBe(true)
    expect(r.report.fired).not.toContain('c')
    // the 5 went to `elsewhere` — nothing destroyed
    expect(near(r.state.values.p, 0)).toBe(true)
    expect(near(r.state.values.elsewhere ?? 0, 5)).toBe(true)
  })

  it('pull all — one feeder blocked by a full sibling, the OTHER feeder must not strand resource', () => {
    // `c` (pullAll, needs 50 + 50). `g1` splits 1:1 to `c` and to `full`
    // (cap 5, already full) → `g1` can deliver 0 to `c`. `g2` is healthy and
    // would push 50 into `c`'s inbox. `c` then has 50 < 100 and bails — and
    // that 50 from `g2` is destroyed. `pullAllFeasible(c)` must see `g1` cannot
    // contribute and return infeasible so `g2` never pulls.
    const nodes = [
      pool('s1', 100),
      pool('s2', 100),
      pool('full', 5, 5),
      gate('g1'),
      gate('g2'),
      converter('c', 'pullAll'),
      pool('out', 0),
      drain('d'),
    ]
    const edges = [
      edge('a1', 's1', 'g1', '100'),
      edge('g1f', 'g1', 'full', '50'),
      edge('g1c', 'g1', 'c', '50'),
      edge('a2', 's2', 'g2', '50'),
      edge('g2c', 'g2', 'c', '50'),
      edge('co', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.a2 ?? 0, 0)).toBe(true) // g2 must not pull from s2
    expect(near(t[1].byEdge.g2c ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.g1c ?? 0, 0)).toBe(true)
    expect(near(t[1].values.s2, 100)).toBe(true) // no destruction
    expect(near(t[1].values.s1, 100)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull all — an upstream gate whose OTHER branch is a throttled Converter: no strand', () => {
    // The case the backward walk could not see: `g` (det, 1:1) feeds `c`
    // (pullAll, needs 50) and a SIBLING Converter `sib` (pullAll) that is itself
    // starved (`sibIn` has 2, needs 40). `sib` accepts nothing, so to push 50
    // into `c` the gate would have to dump 50 down a dead branch — impossible.
    // The probe pass runs real Phase 2 semantics, so it sees `g` deliver 0 and
    // marks `c` infeasible; nothing moves.
    const nodes = [
      pool('p', 1000),
      pool('sibIn', 2),
      gate('g'),
      converter('c', 'pullAll'),
      converter('sib', 'pullAll'),
      pool('out', 0),
      pool('sibOut', 0),
      drain('d'),
      drain('d2'),
    ]
    const edges = [
      edge('pg', 'p', 'g', '100'),
      edge('gc', 'g', 'c', '50'),
      edge('gsib', 'g', 'sib', '50'),
      edge('si', 'sibIn', 'sib', '40'),
      edge('so', 'sib', 'sibOut', '1'),
      edge('co', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
      edge('sd', 'sibOut', 'd2', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.pg ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.gc ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.gsib ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.si ?? 0, 0)).toBe(true)
    expect(near(t[1].values.p, 1000)).toBe(true) // no destruction
    expect(near(t[1].values.sibIn, 2)).toBe(true)
    expect(t[1].fired).not.toContain('c')
    expect(t[1].fired).not.toContain('sib')
  })

  it('pull all — two Converters contend for one Pool: the canonical-order winner runs, the loser is idle', () => {
    // `p` has exactly 50. `cA` and `cB` are both pullAll needing 50. In router
    // `order` (ascending id) `cA` comes first, fills, fires; `cB` is short and
    // must move nothing — no partial pull from `p`.
    const nodes = [
      pool('p', 50),
      converter('cA', 'pullAll'),
      converter('cB', 'pullAll'),
      pool('outA', 0),
      pool('outB', 0),
      drain('dA'),
      drain('dB'),
    ]
    const edges = [
      edge('ia', 'p', 'cA', '50'),
      edge('ib', 'p', 'cB', '50'),
      edge('oa', 'cA', 'outA', '1'),
      edge('ob', 'cB', 'outB', '1'),
      edge('oad', 'outA', 'dA', '0'),
      edge('obd', 'outB', 'dB', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.ia ?? 0, 50)).toBe(true)
    expect(near(t[1].byEdge.ib ?? 0, 0)).toBe(true)
    expect(near(t[1].values.p, 0)).toBe(true)
    expect(near(t[1].values.outA ?? 0, 1)).toBe(true)
    expect(near(t[1].values.outB ?? 0, 0)).toBe(true)
    expect(t[1].fired).toContain('cA')
    expect(t[1].fired).not.toContain('cB')
  })

  it('pull all — a chain of contending Converters settles without a "did not settle" diagnostic', () => {
    // p feeds three pullAll Converters, each needs 50, p has 120 → the first two
    // (canonical id order) run, the third is idle. The fixpoint must converge
    // well within `#pullAll + 1 = 4` probe passes and emit no warning.
    const nodes = [
      pool('p', 120),
      converter('c1', 'pullAll'),
      converter('c2', 'pullAll'),
      converter('c3', 'pullAll'),
      pool('o1', 0),
      pool('o2', 0),
      pool('o3', 0),
      drain('d1'),
      drain('d2'),
      drain('d3'),
    ]
    const edges = [
      edge('i1', 'p', 'c1', '50'),
      edge('i2', 'p', 'c2', '50'),
      edge('i3', 'p', 'c3', '50'),
      edge('e1', 'c1', 'o1', '1'),
      edge('e2', 'c2', 'o2', '1'),
      edge('e3', 'c3', 'o3', '1'),
      edge('x1', 'o1', 'd1', '0'),
      edge('x2', 'o2', 'd2', '0'),
      edge('x3', 'o3', 'd3', '0'),
    ]
    const r = step(nodes, edges, initSim(nodes), 1)
    expect(near(r.state.values.o1 ?? 0, 1)).toBe(true)
    expect(near(r.state.values.o2 ?? 0, 1)).toBe(true)
    expect(near(r.state.values.o3 ?? 0, 0)).toBe(true)
    expect(near(r.state.values.p, 20)).toBe(true) // 120 − 50 − 50
    expect(r.report.diagnostics.some((d) => /did not settle/i.test(d))).toBe(false)
  })

  it('pull all — the reversed array gives the SAME canonical winner (id order, not array order)', () => {
    const nodes = [
      pool('p', 50),
      converter('cA', 'pullAll'),
      converter('cB', 'pullAll'),
      pool('outA', 0),
      pool('outB', 0),
      drain('dA'),
      drain('dB'),
    ]
    const edges = [
      edge('ia', 'p', 'cA', '50'),
      edge('ib', 'p', 'cB', '50'),
      edge('oa', 'cA', 'outA', '1'),
      edge('ob', 'cB', 'outB', '1'),
      edge('oad', 'outA', 'dA', '0'),
      edge('obd', 'outB', 'dB', '0'),
    ]
    const t = run([...nodes].reverse(), [...edges].reverse(), 1)
    expect(near(t[1].values.outA ?? 0, 1)).toBe(true) // cA still wins
    expect(near(t[1].values.outB ?? 0, 0)).toBe(true)
    expect(t[1].fired).toContain('cA')
    expect(t[1].fired).not.toContain('cB')
  })

  it('pull all — a sibling branch with only PARTIAL headroom throttles the gate: nothing reaches the Converter', () => {
    // `g` (det, splits `gc`:`gpar` = 1:1) feeds `c` (pullAll, needs 50) and a
    // Pool `partial` (cap 10, at 8 → headroom 2). To put 50 into `c` the gate
    // must pull 100 and shove 50 into `partial` — impossible. `accept()` caps
    // the gate at ~4, so it would deliver ~2 into `c`'s inbox and `c` would bail,
    // destroying that 2. `pullAllFeasible` must weigh the sibling's headroom.
    const nodes = [
      pool('p', 100),
      gate('g'),
      converter('c', 'pullAll'),
      pool('partial', 8, 10),
      pool('out', 0),
      drain('d'),
      drain('d2'),
    ]
    const edges = [
      edge('pg', 'p', 'g', '100'),
      edge('gc', 'g', 'c', '50'),
      edge('gpar', 'g', 'partial', '50'),
      edge('o', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
      edge('pd', 'partial', 'd2', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.pg ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.gc ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.gpar ?? 0, 0)).toBe(true)
    expect(near(t[1].values.p, 100)).toBe(true) // no destruction
    expect(near(t[1].values.partial, 8)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull all — a sibling output being full shrinks the gate: NO partial reaches the pullAll Converter', () => {
    // `g` (deterministic) splits `co`:`cf` = 1:1. `full` (cap 5, already at 5)
    // can take nothing, so `g` can only pull 2·min(headroom) ≈ 0 total → it must
    // deliver 0 to `c`, and `c` (pullAll, needs 50) moves nothing. The DANGER:
    // if feasibility ignores the sibling's headroom it says "feasible", `g`
    // routes a partial into `c`'s inbox, `c` bails, and that resource is gone.
    const nodes = [
      pool('src', 500),
      pool('full', 5, 5),
      gate('g'),
      converter('c', 'pullAll'),
      pool('out', 0),
      drain('d'),
    ]
    const edges = [
      edge('a', 'src', 'g', '100'),
      edge('cf', 'g', 'full', '50'),
      edge('co', 'g', 'c', '50'),
      edge('o', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.a ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.cf ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.co ?? 0, 0)).toBe(true)
    expect(near(t[1].values.src, 500)).toBe(true) // nothing pulled — no destruction
    expect(near(t[1].values.full, 5)).toBe(true)
    expect(t[1].fired).not.toContain('c')
  })

  it('pull all — an upstream pullAll gate short on a SIBLING input: the whole path moves 0', () => {
    // `pg` (pullAll Gate) needs 50 + 50 = 100 across two inputs; `pinA` has 50
    // but `pinB` only 10 → `pg` is all-or-nothing and delivers 0. The back-calc
    // only charges the toward-`c` share, so it can wrongly call `c` feasible;
    // then `c` (pullAll) is short and its healthy `direct` edge must move 0 too.
    const nodes = [
      pool('pinA', 50),
      pool('pinB', 10),
      pool('direct', 100),
      gate('pg', 'pullAll'),
      converter('c', 'pullAll'),
      pool('out', 0),
      drain('d'),
    ]
    const edges = [
      edge('gia', 'pinA', 'pg', '50'),
      edge('gib', 'pinB', 'pg', '50'), // sibling input short → pullAll gate does nothing
      edge('gc', 'pg', 'c', '50'),
      edge('dc', 'direct', 'c', '50'),
      edge('o', 'c', 'out', '1'),
      edge('od', 'out', 'd', '0'),
    ]
    const t = run(nodes, edges, 1)
    expect(near(t[1].byEdge.gia ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.gib ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.gc ?? 0, 0)).toBe(true)
    expect(near(t[1].byEdge.dc ?? 0, 0)).toBe(true) // the healthy edge must not move either
    expect(near(t[1].values.pinA, 50)).toBe(true)
    expect(near(t[1].values.direct, 100)).toBe(true)
    expect(t[1].fired).not.toContain('c')
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

  it('random flow (2D6) is evaluated by the seeded RNG — Engine B Part 1', () => {
    const nodes = [source('s'), pool('p', 0)]
    const edges = [edge('a', 's', 'p', '2D6')]
    const r = step(nodes, edges, initSim(nodes), 1) // seed 1
    // 1|1|a|flow-die|0 → 6, 1|1|a|flow-die|1 → 2  (see rng.test.ts vectors)
    expect(near(r.state.values.p, 8)).toBe(true)
    expect(r.report.diagnostics).toEqual([]) // no "inactive" diagnostic anymore
    // deterministic for a given seed
    const again = step(nodes, edges, initSim(nodes), 1)
    expect(near(again.state.values.p, 8)).toBe(true)
    // a different seed → a different (still valid) draw
    const other = step(nodes, edges, initSim(nodes), 999)
    expect(other.state.values.p).toBeGreaterThanOrEqual(2)
    expect(other.state.values.p).toBeLessThanOrEqual(12)
  })

  it('malformed random flow (2D0) contributes 0 and raises a diagnostic', () => {
    const nodes = [source('s'), pool('p', 0)]
    const edges = [edge('a', 's', 'p', '2D0')]
    const r = step(nodes, edges, initSim(nodes), 1)
    expect(near(r.state.values.p, 0)).toBe(true)
    expect(r.report.diagnostics.some((d) => /D0|sides ≥ 1|contributes 0/i.test(d))).toBe(true)
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

// ── probe pass must not lose (or duplicate) diagnostics ─────────────────────
describe('Engine A — probe pass diagnostics', () => {
  const badCount = (ds: string[], re: RegExp) => ds.filter((d) => re.test(d)).length

  it('a Phase-2 `2D0` on a live path is diagnosed exactly once, even with a pullAll probe', () => {
    // `pbad -2D0-> g -1-> sink` executes in the real pass. `p2 -50-> cP` (pullAll)
    // is short (only 20 in p2) → the fixpoint runs probe passes that evaluate the
    // `2D0` edge first. The reason must survive to the committed pass — once.
    const nodes = [
      pool('pbad', 100),
      gate('g'),
      pool('sink', 0),
      drain('sd'),
      pool('p2', 20),
      converter('cP', 'pullAll'),
      pool('out', 0),
      drain('od'),
    ]
    const edges = [
      edge('a', 'pbad', 'g', '2D0'),
      edge('gs', 'g', 'sink', '1'),
      edge('sx', 'sink', 'sd', '0'),
      edge('i2', 'p2', 'cP', '50'),
      edge('e2', 'cP', 'out', '1'),
      edge('ox', 'out', 'od', '0'),
    ]
    const r = step(nodes, edges, initSim(nodes), 1)
    expect(badCount(r.report.diagnostics, /"a".*contributes 0|D0|sides ≥ 1/i)).toBe(1)
  })

  it('a probabilistic gate with zero-sum weights is diagnosed exactly once through probe + commit', () => {
    const nodes = [
      pool('p', 100),
      pgate('pg'),
      pool('x', 0),
      pool('y', 0),
      drain('dx'),
      drain('dy'),
      pool('p2', 20),
      converter('cP', 'pullAll'),
      pool('out', 0),
      drain('od'),
    ]
    const edges = [
      edge('in', 'p', 'pg', '100'),
      edge('ox', 'pg', 'x', '0'), // both branch weights 0 → gate inert
      edge('oy', 'pg', 'y', '0'),
      edge('xd', 'x', 'dx', '0'),
      edge('yd', 'y', 'dy', '0'),
      edge('i2', 'p2', 'cP', '50'),
      edge('e2', 'cP', 'out', '1'),
      edge('ox2', 'out', 'od', '0'),
    ]
    const r = step(nodes, edges, initSim(nodes), 1)
    expect(badCount(r.report.diagnostics, /gate .*inert|no positive branch weight/i)).toBe(1)
  })

  it('a `2D0` consumed ONLY by a disabled pullAll Converter raises NO diagnostic', () => {
    // `p -2D0-> cLoser` (pullAll) is the sole consumer of the bad edge; sumIn is
    // 0 so `cLoser` can never fire and the fixpoint disables it. On the committed
    // pass it is skipped before any edge is read → the reason is never surfaced.
    const nodes = [pool('p', 100), converter('cLoser', 'pullAll'), pool('out', 0), drain('od')]
    const edges = [
      edge('a', 'p', 'cLoser', '2D0'),
      edge('e', 'cLoser', 'out', '1'),
      edge('ox', 'out', 'od', '0'),
    ]
    const r = step(nodes, edges, initSim(nodes), 1)
    expect(badCount(r.report.diagnostics, /"a".*contributes 0|D0|sides ≥ 1/i)).toBe(0)
    expect(r.report.fired).not.toContain('cLoser')
  })

  it('valid random flow + probabilistic gate: full 3-step report identical with and without a probe', () => {
    // `rp -2D6-> gRand` is a real Phase-2 gate INPUT edge (Pool→Gate), so the
    // draw actually moves resource. `pp -10-> pgProb` routes probabilistically.
    // `cp -50-> c` is fed exactly its demand, so `pullAll` (probe runs, settles
    // with `c` enabled) and `pullAny` (no probe) must produce the identical run.
    const mk = (mode: 'pullAny' | 'pullAll') => {
      const nodes = [
        pool('rp', 100, 999),
        gate('gRand'),
        pool('hit', 0, 999),
        pool('pp', 100, 999),
        pgate('pgProb'),
        pool('x', 0, 999),
        pool('y', 0, 999),
        pool('cp', 200, 999),
        converter('c', mode),
        pool('cout', 0, 999),
      ]
      const edges = [
        edge('rr', 'rp', 'gRand', '2D6'), // random Phase-2 gate input
        edge('rh', 'gRand', 'hit', '1'),
        edge('pi', 'pp', 'pgProb', '10'),
        edge('px', 'pgProb', 'x', '3'),
        edge('py', 'pgProb', 'y', '1'),
        edge('ci', 'cp', 'c', '50'),
        edge('co', 'c', 'cout', '1'),
      ]
      return { nodes, edges }
    }

    const capture = (mode: 'pullAny' | 'pullAll') => {
      const { nodes, edges } = mk(mode)
      let st = initSim(nodes)
      const frames = []
      for (let i = 0; i < 3; i++) {
        const r = step(nodes, edges, st, 7)
        st = r.state
        frames.push({
          values: { ...st.values },
          ended: st.ended,
          events: r.report.events,
          fired: [...r.report.fired].sort(),
          activated: [...r.report.activated].sort(),
          diagnostics: [...r.report.diagnostics].sort(),
        })
      }
      return frames
    }

    const withProbe = capture('pullAll')
    const noProbe = capture('pullAny')

    // the random edge and the probabilistic gate actually did something
    expect((withProbe[0].events.find((e) => e.edgeId === 'rr')?.amount ?? 0) > 0).toBe(true)
    expect(
      withProbe[0].events.some((e) => (e.edgeId === 'px' || e.edgeId === 'py') && e.amount > 0),
    ).toBe(true)
    // and the converter really ran (so `pullAll` exercised the probe fixpoint)
    expect(withProbe[0].fired).toContain('c')

    // full projected report — every Pool value, every event, fired, activated,
    // diagnostics — identical across all 3 steps
    expect(withProbe).toEqual(noProbe)
  })
})
