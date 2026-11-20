import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'
import type { GateStatus } from './types'
import { graphWithSourceLines, plainGraph } from './generatedGraphs.fixture'

// Issue #477 — a Gate's execution evidence (`StepReport.gates`). The design is
// the QA record gate-state-design.md rev 2 (Lumi, 2026-11-02): the state is
// decided by the engine at the point that decided what the Gate moved, and
// `demand` / `available` are plan-free, so a Gate the group plan cut never
// reads as `full`. The T / A / B rows are the design's §4a table (one step
// each, the numbers computed on the engine before this field existed and
// confirmed by Lumi); the rest pin the faults, a Gate-only rejoin that holds
// nothing once it is planned (#471, ENGINE_REVISION 5), the absence of
// an entry for a Gate that does not fire, and the empty field.

const P = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const conv = (id: string, mode: Mode = 'pullAny'): LoopNode => ({
  id, type: 'converter', position: P,
  data: { kind: 'converter', label: id, activation: 'automatic', mode },
})
const gate = (id: string, mode: Mode = 'pullAny', extra: Partial<LoopNode['data']> = {}): LoopNode => ({
  id, type: 'gate', position: P,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode, ...extra } as LoopNode['data'],
})
const res = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in',
  data: { kind: 'resource', flow },
})
type Graph = { nodes: LoopNode[]; edges: LoopEdge[] }

function run({ nodes, edges }: Graph) {
  const r = step(nodes, edges, initSim(nodes), 1, 2)
  const moved: Record<string, number> = {}
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  return { gates: r.report.gates, moved, report: r.report }
}
const only = (g: GateStatus[], id: string): GateStatus => {
  const e = g.find((x) => x.nodeId === id)
  expect(e, `entry for ${id}`).toBeDefined()
  return e!
}
type Want = Pick<GateStatus, 'state' | 'demand' | 'available' | 'moved'> & { why?: GateStatus['why'] }
const expectGate = (g: GateStatus[], id: string, want: Want) => {
  const e = only(g, id)
  expect(e.state, `${id} state`).toBe(want.state)
  expect(e.why, `${id} why`).toBe(want.why)
  expect(e.demand, `${id} demand`).toBeCloseTo(want.demand, 6)
  expect(e.available, `${id} available`).toBeCloseTo(want.available, 6)
  expect(e.moved, `${id} moved`).toBeCloseTo(want.moved, 6)
}

// ── the design's §4a shapes ───────────────────────────────────────────────
const T2 = (q: number, xCap: number | null, gMode: Mode = 'pullAny'): Graph => ({
  nodes: [pool('p', 100), conv('C1'), pool('q', q), conv('C2'), gate('G', gMode), pool('x', 0, xCap)],
  edges: [res('e0', 'p', 'C1', '10'), res('c1', 'C1', 'G', '10'), res('e1', 'q', 'C2', '10'), res('c2', 'C2', 'G', '10'), res('o1', 'G', 'x', '20')],
})
const single = (a: number, xCap: number | null, mode: Mode): Graph => ({
  nodes: [pool('a', a), gate('G', mode), pool('x', 0, xCap)],
  edges: [res('e1', 'a', 'G', '5'), res('o1', 'G', 'x', '5')],
})
const A = (xCap: number | null): Graph => ({
  nodes: [pool('a', 100), pool('p', 100), conv('B'), gate('g'), conv('C'), pool('q', 100), pool('x', 0, xCap)],
  edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('k1', 'g', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')],
})

describe('#477 — the Gate state is decided by the engine, against a plan-free demand', () => {
  it('T1 — a tree: the plan cuts the Converter, the Gate wanted 10 and the room gave 4', () => {
    const g: Graph = {
      nodes: [pool('p', 100), conv('C'), gate('G'), pool('x', 0, 4)],
      edges: [res('e0', 'p', 'C', '10'), res('c1', 'C', 'G', '10'), res('o1', 'G', 'x', '10')],
    }
    expectGate(run(g).gates, 'G', { state: 'partial', why: 'room', demand: 10, available: 10, moved: 4 })
  })
  it('T2 — two routers, the room cuts the second supply', () => {
    expectGate(run(T2(100, 12)).gates, 'G', { state: 'partial', why: 'room', demand: 20, available: 20, moved: 12 })
  })
  it('T3 — the second supply is short: it took all it was offered', () => {
    expectGate(run(T2(3, null)).gates, 'G', { state: 'partial', why: 'upstream', demand: 20, available: 13, moved: 13 })
  })
  it('T4 — the same under pull all: the rule binds own Pools only, so this is a part, not a hold', () => {
    expectGate(run(T2(3, null, 'pullAll')).gates, 'G', { state: 'partial', why: 'upstream', demand: 20, available: 13, moved: 13 })
  })
  it('T5 — pull all with a short own Pool beside a router supply: the fixed demand fails (D-fixed)', () => {
    const g: Graph = {
      nodes: [pool('p', 100), conv('C'), pool('a', 3), gate('G', 'pullAll'), pool('x', 0)],
      edges: [res('e0', 'p', 'C', '10'), res('c1', 'C', 'G', '10'), res('e1', 'a', 'G', '5'), res('o1', 'G', 'x', '15')],
    }
    const r = run(g)
    expectGate(r.gates, 'G', { state: 'held', why: 'pullAll', demand: 15, available: 13, moved: 0 })
    expect(r.moved['o1'] ?? 0).toBe(0)
  })
  it('T6 — a normal zero: an empty own Pool is idle, under pull all too (D1)', () => {
    expectGate(run(single(0, null, 'pullAll')).gates, 'G', { state: 'idle', demand: 5, available: 0, moved: 0 })
    expectGate(run(single(0, null, 'pullAny')).gates, 'G', { state: 'idle', demand: 5, available: 0, moved: 0 })
  })
  it('T7 — a short own Pool under pull any is a part by supply', () => {
    expectGate(run(single(3, null, 'pullAny')).gates, 'G', { state: 'partial', why: 'supply', demand: 5, available: 3, moved: 3 })
  })
  it('T7b — a short own Pool under pull all is held by the rule', () => {
    expectGate(run(single(3, null, 'pullAll')).gates, 'G', { state: 'held', why: 'pullAll', demand: 5, available: 3, moved: 0 })
  })
  it('T8 — a full target: held by room (D2)', () => {
    expectGate(run(single(100, 0, 'pullAny')).gates, 'G', { state: 'held', why: 'room', demand: 5, available: 5, moved: 0 })
  })
  it('a Gate with nothing connected on its input side is idle', () => {
    const g: Graph = { nodes: [gate('G'), pool('x', 0)], edges: [res('o1', 'G', 'x', '5')] }
    expectGate(run(g).gates, 'G', { state: 'idle', demand: 0, available: 0, moved: 0 })
  })
  it('A0 — design shape A, roomy: full', () => {
    expectGate(run(A(null)).gates, 'g', { state: 'full', demand: 40, available: 40, moved: 40 })
  })
  it('A-room — the plan fills the router supply first and the own Pool gets nothing: a part by room', () => {
    expectGate(run(A(40)).gates, 'g', { state: 'partial', why: 'room', demand: 40, available: 40, moved: 20 })
  })
  it('B-tree — the first supply takes the room; the second Gate is held by room, the merging Gate is a part', () => {
    const g: Graph = {
      nodes: [pool('a', 100), gate('g0'), pool('p', 100), conv('B'), gate('g1'), conv('C'), pool('q', 100), pool('x', 0, 40)],
      edges: [res('e1', 'a', 'g0', '20'), res('g01', 'g0', 'g1', '20'), res('e0', 'p', 'B', '20'), res('b1', 'B', 'g1', '20'), res('k1', 'g1', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')],
    }
    const r = run(g)
    expectGate(r.gates, 'g0', { state: 'held', why: 'room', demand: 20, available: 20, moved: 0 })
    expectGate(r.gates, 'g1', { state: 'partial', why: 'room', demand: 40, available: 40, moved: 20 })
    expect(r.gates.map((x) => x.nodeId)).toEqual(['g0', 'g1'])
  })

  // ── the plan's own zero ──────────────────────────────────────────────────
  it('a group zeroed by a pull all Converter short of f = 1: its Gate is held by the plan', () => {
    // a(100) →20 g →40 C(pull all) ←40 q(10); C →80 x — C cannot reach f = 1, the group moves nothing
    const g: Graph = {
      nodes: [pool('a', 100), pool('p', 100), conv('B'), gate('g'), conv('C', 'pullAll'), pool('q', 10), pool('x', 0)],
      edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('k1', 'g', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')],
    }
    const r = run(g)
    expectGate(r.gates, 'g', { state: 'held', why: 'plan', demand: 40, available: 40, moved: 0 })
  })

  // ── faults ───────────────────────────────────────────────────────────────
  it('a probabilistic Gate with no positive weight is a fault (inert), its numbers still reported', () => {
    const g: Graph = {
      nodes: [pool('a', 100), gate('G', 'pullAny', { distribution: 'probabilistic' }), pool('x', 0)],
      edges: [res('e1', 'a', 'G', '5'), res('o1', 'G', 'x', '0')],
    }
    const r = run(g)
    expectGate(r.gates, 'G', { state: 'fault', why: 'inert', demand: 5, available: 5, moved: 0 })
    expect(r.report.diagnostics.some((d) => d.includes('inert'))).toBe(true)
  })
  it('a Gate on a zero-storage cycle is a fault (cycle)', () => {
    const g: Graph = {
      nodes: [pool('a', 100), gate('g1'), gate('g2'), pool('x', 0)],
      edges: [res('e1', 'a', 'g1', '5'), res('c12', 'g1', 'g2', '5'), res('c21', 'g2', 'g1', '5'), res('o1', 'g2', 'x', '5')],
    }
    const r = run(g)
    expectGate(r.gates, 'g1', { state: 'fault', why: 'cycle', demand: 0, available: 0, moved: 0 })
    expectGate(r.gates, 'g2', { state: 'fault', why: 'cycle', demand: 0, available: 0, moved: 0 })
  })

  // ── the held amount ──────────────────────────────────────────────────────
  it('a Gate-only split that rejoins at a full target is planned as one group: nothing is held, so no Gate carries a held amount (#471, erratum part 4)', () => {
    // a(100) →40 g0; g0 →20 g1, →20 g2; g1 →20 g3; g2 →20 g3; g3 →40 y[cap 10]
    // — under the per-Gate rule g3 was handed 40 and held 30 (the held amount
    // this test pinned until ENGINE_REVISION 5); planned, the group runs at
    // y's room. The held field stays a safety net, as the notice does.
    const g: Graph = {
      nodes: [pool('a', 100), gate('g0'), gate('g1'), gate('g2'), gate('g3'), pool('y', 0, 10)],
      edges: [res('e1', 'a', 'g0', '40'), res('g01', 'g0', 'g1', '20'), res('g02', 'g0', 'g2', '20'), res('g13', 'g1', 'g3', '20'), res('g23', 'g2', 'g3', '20'), res('o1', 'g3', 'y', '40')],
    }
    const r = run(g)
    expect(r.report.notices).toEqual([])
    expect(r.moved).toEqual({ e1: 10, g01: 5, g02: 5, g13: 5, g23: 5, o1: 10 })
    expectGate(r.gates, 'g3', { state: 'partial', why: 'room', demand: 40, available: 40, moved: 10 })
    expectGate(r.gates, 'g0', { state: 'partial', why: 'room', demand: 40, available: 40, moved: 10 })
    for (const x of r.gates) expect(x.held, x.nodeId).toBeUndefined()
  })

  // ── absence ──────────────────────────────────────────────────────────────
  it('a Gate that does not fire this step has no entry (off); a graph without Gates has an empty field', () => {
    const passive: Graph = {
      nodes: [pool('a', 100), gate('G', 'pullAny', { activation: 'passive' }), pool('x', 0)],
      edges: [res('e1', 'a', 'G', '5'), res('o1', 'G', 'x', '5')],
    }
    expect(run(passive).gates).toEqual([])
    const noGate: Graph = { nodes: [pool('a', 100), conv('C'), pool('x', 0)], edges: [res('e1', 'a', 'C', '5'), res('o1', 'C', 'x', '5')] }
    expect(run(noGate).gates).toEqual([])
  })
  it('the ended fixed point and a refused graph report an empty field', () => {
    const g = single(100, null, 'pullAny')
    const ended = step(g.nodes, g.edges, { ...initSim(g.nodes), ended: true }, 1, 2)
    expect(ended.report.gates).toEqual([])
  })
})

// Issue #593 — a `pull all` Gate that its own Pools leave short by more than the allowance of
// SEMANTICS-E.md §E11 (1e-9) stops, and says `pullAll`, whatever the size of the shortfall. The
// reason is given where the stop is decided: at the Gate's turn, and where a plan sets its piece
// to 0. It read `room` where the shortfall was under the reported precision (1e-6), or where the
// sum of doubles rounded it away, in a graph with no capacity at all. Where it is a room that cut
// the Gate, `room` stands; a reason the plan already gave (`plan`) stands.
const F64 = new Float64Array(1)
const U64 = new BigUint64Array(F64.buffer)
/** the double one last place under x */
const lastPlaceUnder = (x: number) => {
  F64[0] = x
  U64[0] -= 1n
  return F64[0]
}
/** the Gate entries of step `at` of a generated graph (the seed and model version of exactMoves*.test.ts) */
const gatesAt = ({ nodes, edges }: Graph, at: number): GateStatus[] => {
  let st = initSim(nodes)
  let r = step(nodes, edges, st, 7, 2)
  for (let i = 2; i <= at; i++) {
    st = r.state
    r = step(nodes, edges, st, 7, 2)
  }
  return r.report.gates
}
const held = (g: GateStatus[], id: string, why: GateStatus['why']) => {
  const e = only(g, id)
  expect(`${e.state}/${e.why}`, id).toBe(`held/${why}`)
  expect(e.moved, `${id} moved`).toBe(0)
}

describe('#593 — a `pull all` Gate stopped by its own supply says `pullAll`, at any size of the shortfall', () => {
  it('alone, one line of 5, its Pool holds 4.9999999 (1e-7 short): held by its `pull all` rule', () => {
    const g: Graph = { nodes: [pool('a', 4.9999999), gate('G', 'pullAll'), pool('x', 0)], edges: [res('e1', 'a', 'G', '5'), res('o1', 'G', 'x', '5')] }
    held(run(g).gates, 'G', 'pullAll')
  })
  it('alone, two lines of 5e8, one Pool a last place under (6e-8 short, which a sum of doubles rounds away): held by its `pull all` rule', () => {
    const g: Graph = {
      nodes: [pool('a', lastPlaceUnder(5e8)), pool('b', 5e8), gate('G', 'pullAll'), pool('x', 0)],
      edges: [res('e1', 'a', 'G', '500000000'), res('e2', 'b', 'G', '500000000'), res('o1', 'G', 'x', '1')],
    }
    held(run(g).gates, 'G', 'pullAll')
  })
  it('an earlier member took of its Pool first (generated graph, seed 34, at 10^-6, steps 1 and 2: a Converter takes 3e-6 of 5e-6, and the Gate asks 3e-6)', () => {
    for (const at of [1, 2]) held(gatesAt(plainGraph(34, -6), at), 'g1', 'pullAll')
  })
  it('an earlier Gate emptied its Pool, which was 1e-6 short already (generated graph, seed 5, at 10^-6, step 1)', () => {
    held(gatesAt(plainGraph(5, -6), 1), 'g0', 'pullAll')
  })
  it('seed 2950 at 10^8 and 10^9, step 4: the plan sets g0`s piece to 0, its Pool a last place short of 5 times the scale', () => {
    for (const n of [8, 9]) held(gatesAt(plainGraph(2950, n), 4), 'g0', 'pullAll')
  })
  it('a room AND a supply 1e-7 short: its own Pools fail it first, as for a larger shortfall', () => {
    const g: Graph = { nodes: [pool('a', 4.9999999), gate('G', 'pullAll'), pool('x', 9, 10)], edges: [res('e1', 'a', 'G', '5'), res('o1', 'G', 'x', '5')] }
    held(run(g).gates, 'G', 'pullAll')
  })
  // controls: unchanged
  it('control: the supply is whole and the room is 1 of 5: held by room', () => {
    const g: Graph = { nodes: [pool('a', 5), gate('G', 'pullAll'), pool('x', 9, 10)], edges: [res('e1', 'a', 'G', '5'), res('o1', 'G', 'x', '5')] }
    held(run(g).gates, 'G', 'room')
  })
  it('control: within the allowance (1e-10 short) the Gate runs and takes what its Pool holds', () => {
    const g: Graph = { nodes: [pool('a', 4.9999999999), gate('G', 'pullAll'), pool('x', 0)], edges: [res('e1', 'a', 'G', '5'), res('o1', 'G', 'x', '5')] }
    expect(only(run(g).gates, 'G').state).toBe('full')
  })
  it('control: E-open 3 (generated graph with Source lines, seed 3763, at 10^-8): a room a last place short holds the piece of the `pull all` Gate g1, whose Pools are whole: held by room', () => {
    held(gatesAt(graphWithSourceLines(3763, -8), 1), 'g1', 'room')
  })
  it('control: a reason the plan gave stands (seed 727 at 10^-12, step 3; seed 1056 at 10^-12, step 1: a `pull all` Converter zeroes the group)', () => {
    held(gatesAt(plainGraph(727, -12), 3), 'g2', 'plan')
    held(gatesAt(plainGraph(1056, -12), 1), 'g0', 'plan')
  })
})
