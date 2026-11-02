import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { converterGroups } from './converterGroups'
import { initSim, step } from './index'

// Issue #476 (#471 Deploy 3) — the multi-supply Gate: a Gate with two
// supplies (two upstream routers, or one and its own Pools) is planned with
// its group at a FIXED PRIORITY in the engine's existing order (SEMANTICS.md
// §6 erratum, part 3). Each case is one step of a minimal graph, asserting the
// amount on every connection the design names and every Pool after. The
// expected numbers come from the design document's solver (rev 3, confirmed
// 2026-11-02), not from the engine: the A / B / N / S / P / Q families are the
// design's cases, the `pull any` twins of the Q family are Q1a–Q5a. The four
// shapes the solver did not cover are hand-derived here and checked with the
// conservation checks as well. Every planned case ends with `notices: []`:
// the two loss notices are safety nets a planned group never reaches.

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
const gate = (id: string, mode: Mode = 'pullAny'): LoopNode => ({
  id, type: 'gate', position: P,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode },
})
const res = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in',
  data: { kind: 'resource', flow },
})
type Graph = { nodes: LoopNode[]; edges: LoopEdge[] }

/** one step; the amount moved on each connection (0 when nothing moved) and every Pool after */
function run({ nodes, edges }: Graph) {
  const before = initSim(nodes)
  const r = step(nodes, edges, before, 1, 2)
  const moved: Record<string, number> = {}
  for (const e of edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  const pools: Record<string, number> = {}
  for (const n of nodes) if (n.data.kind === 'pool') pools[n.id] = r.state.values[n.id]
  return { moved, pools, before: before.values, diagnostics: r.report.diagnostics, notices: r.report.notices }
}
const close = (got: Record<string, number>, want: Record<string, number>) => {
  for (const k of Object.keys(want)) expect(got[k], k).toBeCloseTo(want[k], 6)
}
/** the four checks of the #471 fix plan on one step: every Pool's change is its
 *  events; one f per Converter; a Gate passes on what it took; the total falls
 *  by exactly the recipe loss */
function checks({ nodes, edges }: Graph, r: ReturnType<typeof run>) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const rate = (e: LoopEdge) => { const f = (e.data as { flow: string }).flow; return f === 'all' ? 1 : Number(f) }
  let recipe = 0
  for (const n of nodes) {
    const ins = edges.filter((e) => e.target === n.id)
    const outs = edges.filter((e) => e.source === n.id)
    const sumIn = ins.reduce((t, e) => t + r.moved[e.id], 0)
    const sumOut = outs.reduce((t, e) => t + r.moved[e.id], 0)
    if (n.data.kind === 'pool') {
      expect(r.pools[n.id], `Pool ${n.id}`).toBeCloseTo(r.before[n.id] + sumIn - sumOut, 6)
    } else if (n.data.kind === 'gate') {
      expect(sumOut, `Gate ${n.id} in = out`).toBeCloseTo(sumIn, 6)
    } else if (n.data.kind === 'converter') {
      const fs = [...ins, ...outs].filter((e) => byId.get(e.source)?.data.kind !== 'gate' || e.target === n.id).map((e) => r.moved[e.id] / rate(e))
      const f = fs[0] ?? 0
      for (const x of fs) expect(x, `Converter ${n.id} one f`).toBeCloseTo(f, 6)
      recipe += sumIn - sumOut
    }
  }
  const total = (v: Record<string, number>) => nodes.filter((n) => n.data.kind === 'pool').reduce((t, n) => t + v[n.id], 0)
  expect(total(r.before) - total(r.pools), 'total − recipe loss').toBeCloseTo(recipe, 6)
  expect(r.notices).toEqual([])
  expect(r.diagnostics).toEqual([])
}
const pin = (g: Graph, want: { moved: Record<string, number>; pools: Record<string, number> }) => {
  const r = run(g)
  close(r.moved, want.moved)
  close(r.pools, want.pools)
  checks(g, r)
}

// ── the design's graphs ────────────────────────────────────────────────────
// Shape A (G7): a →(20) g;  p →(20) B →(20) g;  g →(40) C;  q →(40) C;  C →(80) x
const A = (o: { a?: number; p?: number; q?: number; xCap?: number | null; cMode?: Mode; gMode?: Mode; aFlow?: string } = {}): Graph => ({
  nodes: [pool('a', o.a ?? 100), pool('p', o.p ?? 100), conv('B'), gate('g', o.gMode), conv('C', o.cMode), pool('q', o.q ?? 100), pool('x', 0, o.xCap === undefined ? null : o.xCap)],
  edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', o.aFlow ?? '20'), res('k1', 'g', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')],
})
// Shape B: a →(20) g0 →(20) g1;  p →(20) B →(20) g1;  g1 →(40) C;  q →(40) C;  C →(80) x
const B = (o: { a?: number; p?: number; q?: number; xCap?: number | null; cMode?: Mode; aFlow?: string; gateId?: string } = {}): Graph => {
  const g0 = o.gateId ?? 'g0'
  return {
    nodes: [pool('a', o.a ?? 100), gate(g0), pool('p', o.p ?? 100), conv('B'), gate('g1'), conv('C', o.cMode), pool('q', o.q ?? 100), pool('x', 0, o.xCap === undefined ? null : o.xCap)],
    edges: [res('e1', 'a', g0, o.aFlow ?? '20'), res('g01', g0, 'g1', '20'), res('e0', 'p', 'B', '20'), res('b1', 'B', 'g1', '20'), res('k1', 'g1', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')],
  }
}
// Shape A with a shared Pool: g's own input and C read the same Pool a (q removed)
const shared = (a: number, xCap: number | null = null, gMode: Mode = 'pullAny', aFlow = '20'): Graph => ({
  nodes: [pool('a', a), pool('p', 100), conv('B'), gate('g', gMode), conv('C'), pool('x', 0, xCap)],
  edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', aFlow), res('k1', 'g', 'C', '40'), res('e2', 'a', 'C', '40'), res('o1', 'C', 'x', '80')],
})
// Shape N: a two-supply Gate with no Converter behind it (the gacha shape)
const N = (o: { a?: number; yCap?: number | null; twoGates?: boolean } = {}): Graph => ({
  nodes: [pool('a', o.a ?? 100), gate('g0'), pool('b', 100), ...(o.twoGates ? [gate('g2')] : []), gate('g1'), pool('y', 0, o.yCap === undefined ? null : o.yCap)],
  edges: [res('e1', 'a', 'g0', '20'), res('g01', 'g0', 'g1', '20'), ...(o.twoGates ? [res('e2', 'b', 'g2', '20'), res('g21', 'g2', 'g1', '20')] : [res('e2', 'b', 'g1', '20')]), res('o1', 'g1', 'y', '40')],
})
// Shape Q: the upstream Gate g0 splits 20:20 between the multi-supply Gate g1 and a second branch (a Pool y, or a Converter E)
const Q = (o: { a?: number; aFlow?: string; yCap?: number | null; g1Mode?: Mode; other?: 'pool' | 'conv' | 'convAll'; r?: number; cPool?: 'q' | 'a' } = {}): Graph => {
  const other = o.other ?? 'pool'
  const nodes: LoopNode[] = [pool('a', o.a ?? 100), gate('g0'), pool('p', 100), conv('B'), gate('g1', o.g1Mode ?? 'pullAll'), conv('C'), pool('x', 0)]
  const edges: LoopEdge[] = [res('e1', 'a', 'g0', o.aFlow ?? '40'), res('g01', 'g0', 'g1', '20'), res('e0', 'p', 'B', '20'), res('b1', 'B', 'g1', '20'), res('k1', 'g1', 'C', '40'), res('o1', 'C', 'x', '80')]
  if ((o.cPool ?? 'q') === 'q') { nodes.push(pool('q', 100)); edges.push(res('e2', 'q', 'C', '40')) } else edges.push(res('e2', 'a', 'C', '40'))
  if (other === 'pool') { nodes.push(pool('y', 0, o.yCap === undefined ? null : o.yCap)); edges.push(res('g0y', 'g0', 'y', '20')) }
  else { nodes.push(conv('E', other === 'convAll' ? 'pullAll' : 'pullAny'), pool('r', o.r ?? 100), pool('z', 0)); edges.push(res('g0E', 'g0', 'E', '20'), res('r1', 'r', 'E', '20'), res('z1', 'E', 'z', '40')) }
  return { nodes, edges }
}

// the design solver's plan for every case (multi-c3.json; multi-demand-c3.json, the reach reading)
const EXPECT: Record<string, { moved: Record<string, number>; pools: Record<string, number> }> = {
  A0: { moved: { b1: 20, e1: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 80, p: 80, q: 60, x: 80 } },
  A1: { moved: { b1: 20, e1: 5, k1: 25, e2: 25, o1: 50 }, pools: { a: 0, p: 80, q: 75, x: 50 } },
  A2: { moved: { b1: 5, e1: 20, k1: 25, e2: 25, o1: 50 }, pools: { a: 80, p: 0, q: 75, x: 50 } },
  A3: { moved: { b1: 10, e1: 0, k1: 10, e2: 10, o1: 20 }, pools: { a: 100, p: 90, q: 0, x: 20 } },
  A4: { moved: { b1: 5, e1: 0, k1: 5, e2: 5, o1: 10 }, pools: { a: 100, p: 95, q: 95, x: 10 } },
  A5: { moved: { b1: 20, e1: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 40, p: 80, x: 80 } },
  A5s: { moved: { b1: 20, e1: 5, k1: 25, e2: 25, o1: 50 }, pools: { a: 0, p: 80, x: 50 } },
  A6: { moved: { b1: 0, e1: 0, k1: 0, e2: 0, o1: 0 }, pools: { a: 100, p: 100, q: 10, x: 0 } },
  A7: { moved: { b1: 0, e1: 0, k1: 0, e2: 0, o1: 0 }, pools: { a: 5, p: 100, q: 100, x: 0 } },
  A8: { moved: { b1: 20, e1: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 80, p: 80, q: 60, x: 80 } },
  A9: { moved: { b1: 20, e1: 0, k1: 20, e2: 20, o1: 40 }, pools: { a: 100, p: 80, q: 120 } },
  B0: { moved: { b1: 20, g01: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 80, p: 80, q: 60, x: 80 } },
  B1: { moved: { b1: 20, g01: 5, k1: 25, e2: 25, o1: 50 }, pools: { a: 0, p: 80, q: 75, x: 50 } },
  B2: { moved: { b1: 5, g01: 20, k1: 25, e2: 25, o1: 50 }, pools: { a: 80, p: 0, q: 75, x: 50 } },
  B3: { moved: { b1: 10, g01: 0, k1: 10, e2: 10, o1: 20 }, pools: { a: 100, p: 90, q: 0, x: 20 } },
  B4: { moved: { b1: 5, g01: 0, k1: 5, e2: 5, o1: 10 }, pools: { a: 100, p: 95, q: 95, x: 10 } },
  B6: { moved: { b1: 0, g01: 0, k1: 0, e2: 0, o1: 0 }, pools: { a: 100, p: 100, q: 10, x: 0 } },
  N0: { moved: { g01: 20, e2: 20, o1: 40 }, pools: { a: 80, b: 80, y: 40 } },
  N1: { moved: { g01: 10, e2: 0, o1: 10 }, pools: { a: 90, b: 100, y: 10 } },
  N2: { moved: { g01: 5, e2: 20, o1: 25 }, pools: { a: 0, b: 80, y: 25 } },
  N3: { moved: { g01: 10, g21: 0, o1: 10 }, pools: { a: 90, b: 100, y: 10 } },
  N4: { moved: { g01: 20, g21: 20, o1: 40 }, pools: { a: 80, b: 80, y: 40 } },
  N5: { moved: { g01: 5, g21: 0, k1: 5, o1: 10 }, pools: { a: 95, b: 100, x: 10 } },
  S2: { moved: { b1: 15, e1: 0, k1: 15, e2: 15, o1: 30 }, pools: { a: 100, p: 0, x: 30 } },
  S3: { moved: { b1: 20, e1: 10, k1: 30, e2: 30, o1: 60 }, pools: { a: 0, q: 70, x: 60 } },
  S4: { moved: { b1: 10, e1: 0, k1: 10, e2: 10, o1: 20 }, pools: { a: 20, p: 90, x: 20 } },
  S6: { moved: { b1: 20, g01: 10, k1: 30, e2: 30, o1: 60 }, pools: { a: 0, q: 70, x: 60 } },
  P1: { moved: { b1: 0, e1: 0, k1: 0, e2: 0, o1: 0 }, pools: { a: 100, p: 100, q: 100, x: 0 } },
  P2: { moved: { b1: 20, e1: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 0, p: 80, q: 60, x: 80 } },
  P3: { moved: { b1: 0, e1: 0, k1: 0, e2: 0, o1: 0 }, pools: { a: 20, p: 100, q: 100, x: 0 } },
  P4: { moved: { b1: 0, e1: 0, k1: 0, e2: 0, o1: 0 }, pools: { a: 20, p: 100, x: 0 } },
  P5: { moved: { b1: 20, g01: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 80, p: 80, q: 60, x: 80 } },
  P6: { moved: { b1: 20, e1: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 80, p: 80, q: 60, x: 80 } },
  Q0: { moved: { b1: 20, g01: 20, g0y: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 60, p: 80, x: 80, q: 60, y: 20 } },
  Q1: { moved: { b1: 20, g01: 15, g0y: 15, k1: 35, e2: 35, o1: 70 }, pools: { a: 0, p: 80, x: 70, q: 65, y: 15 } },
  Q1a: { moved: { b1: 20, g01: 15, g0y: 15, k1: 35, e2: 35, o1: 70 }, pools: { a: 0, p: 80, x: 70, q: 65, y: 15 } },
  Q2: { moved: { b1: 20, g01: 10, g0y: 10, k1: 30, e2: 30, o1: 60 }, pools: { a: 80, p: 80, x: 60, q: 70, y: 10 } },
  Q2a: { moved: { b1: 20, g01: 10, g0y: 10, k1: 30, e2: 30, o1: 60 }, pools: { a: 80, p: 80, x: 60, q: 70, y: 10 } },
  Q3: { moved: { b1: 20, g01: 5, g0E: 5, r1: 5, z1: 10, k1: 25, e2: 25, o1: 50 }, pools: { a: 90, p: 80, x: 50, q: 75, r: 0, z: 10 } },
  Q3a: { moved: { b1: 20, g01: 5, g0E: 5, r1: 5, z1: 10, k1: 25, e2: 25, o1: 50 }, pools: { a: 90, p: 80, x: 50, q: 75, r: 0, z: 10 } },
  Q4: { moved: { b1: 20, g01: 0, g0E: 0, r1: 0, z1: 0, k1: 20, e2: 20, o1: 40 }, pools: { a: 100, p: 80, x: 40, q: 80, r: 5, z: 0 } },
  Q4a: { moved: { b1: 20, g01: 0, g0E: 0, r1: 0, z1: 0, k1: 20, e2: 20, o1: 40 }, pools: { a: 100, p: 80, x: 40, q: 80, r: 5, z: 0 } },
  Q5: { moved: { b1: 0, g01: 0, g0y: 0, k1: 0, e2: 0, o1: 0 }, pools: { a: 60, p: 100, x: 0, y: 0 } },
  Q5a: { moved: { b1: 20, g01: 13.333333, g0y: 13.333333, k1: 33.333333, e2: 33.333333, o1: 66.666667 }, pools: { a: 0, p: 80, x: 66.666667, y: 13.333333 } },
  Q5b: { moved: { b1: 20, g01: 20, g0y: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 20, p: 80, x: 80, y: 20 } },
  Q6: { moved: { b1: 20, g01: 20, g0y: 20, k1: 40, e2: 40, o1: 80 }, pools: { a: 0, p: 80, x: 80, q: 60, y: 20 } },
  Q7: { moved: { b1: 0, g01: 0, g0y: 0, k1: 0, e2: 0, o1: 0 }, pools: { a: 100, p: 100, x: 0, q: 100, y: 0 } },
}

describe('#476 — shape A: one upstream Converter and an own Pool into the Gate (the order: B, then a)', () => {
  const cases: [string, string, Graph][] = [
    ['A0', 'nominal: everything sufficient', A()],
    ['A1', "the Gate's own Pool is short (a = 5): B first in full, a gives its 5, C at f 5/8 — I2 kept (was: q taken in full)", A({ a: 5 })],
    ['A2', 'the upstream Converter is short (p = 5)', A({ p: 5 })],
    ['A3', "the Converter's own Pool is short (q = 10): the first supply B fills what C can take, a gives nothing", A({ q: 10 })],
    ['A4', 'output saturation (x cap 10): B at f 1/4, a nothing, nothing lost (was: 40 lost)', A({ xCap: 10 })],
    ['A5', "shared Pool: the Gate's own input and C read one Pool a (a = 100)", shared(100)],
    ['A5s', 'shared Pool, a = 30: B first, then a to what the shared Pool leaves (2u + 20 ≤ 30 → 5), C makes 50 — the order decides the throughput', shared(30)],
    ['A6', 'C is pull all and short (q = 10): the group moves nothing', A({ q: 10, cMode: 'pullAll' })],
    ['A7', 'g is pull all and its own Pool is short (a = 5): the point is not feasible, nothing moves (was: 20 held and lost)', A({ a: 5, gMode: 'pullAll' })],
    ['A8', '`all` on a → g reads all of a at plan time; the order fills B first, then a to what C can take (was: 40 lost)', A({ aFlow: 'all' })],
    ['A9', 'self-loop downstream (C makes into q, cap 120, which it also takes from): the net bound, a provisional premise (was: 20 held and lost)', { nodes: [pool('a', 100), pool('p', 100), conv('B'), gate('g'), conv('C'), pool('q', 100, 120)], edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('k1', 'g', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'q', '80')] }],
  ]
  it.each(cases)('%s: %s', (id, _note, g) => pin(g, EXPECT[id]))
})

describe('#476 — shape B: two upstream routers into the Gate (the order: router order)', () => {
  const cases: [string, string, Graph][] = [
    ['B0', 'nominal', B()],
    ['B1', 'g0 short (a = 5)', B({ a: 5 })],
    ['B2', 'B short (p = 5)', B({ p: 5 })],
    ['B3', 'q = 10: B (first in router order) takes the 10 C can run on, g0 nothing', B({ q: 10 })],
    ['B4', 'x cap 10', B({ xCap: 10 })],
    ['B6', 'C pull all, q = 10: nothing moves', B({ q: 10, cMode: 'pullAll' })],
  ]
  it.each(cases)('%s: %s', (id, _note, g) => pin(g, EXPECT[id]))

  it('the order between two routers IS the router order: named so that the Gate comes before B, the Gate fills first (B3 with g0 → A0)', () => {
    const g = B({ q: 10, gateId: 'A0' })
    const r = run(g)
    close(r.moved, { g01: 10, b1: 0, k1: 10, e2: 10, o1: 20 })
    close(r.pools, { a: 90, p: 100, q: 0, x: 20 })
    checks(g, r)
  })
})

describe('#476 — shape N: a two-supply Gate with no Converter behind it (the gacha merges) is planned too', () => {
  const cases: [string, string, Graph][] = [
    ['N0', 'nominal: 20 + 20 → 40', N()],
    ['N1', 'y capped at 10: the upstream Gate fills it, the own Pool gives nothing — identical to the per-Gate rule', N({ yCap: 10 })],
    ['N2', 'a = 5: 5 + 20 — identical to the per-Gate rule', N({ a: 5 })],
    ['N3', 'two upstream Gates into a capped y (10): the first in order fills it, the second moves nothing (was: both delivered 10, 10 lost)', N({ yCap: 10, twoGates: true })],
    ['N4', 'two upstream Gates, uncapped: 20 + 20', N({ twoGates: true })],
    ['N5', 'two upstream Gates into a Converter with x cap 10: g0 5, g2 nothing, C makes 10 (was: nothing made, 5 lost)', { nodes: [pool('a', 100), gate('g0'), pool('b', 100), gate('g2'), gate('g1'), conv('C'), pool('x', 0, 10)], edges: [res('e1', 'a', 'g0', '20'), res('g01', 'g0', 'g1', '20'), res('e2', 'b', 'g2', '20'), res('g21', 'g2', 'g1', '20'), res('k1', 'g1', 'C', '40'), res('o1', 'C', 'x', '80')] }],
  ]
  it.each(cases)('%s: %s', (id, _note, g) => pin(g, EXPECT[id]))
})

describe('#476 — shared Pools: the throughput is whatever the order leaves', () => {
  const cases: [string, string, Graph][] = [
    ['S2', "the upstream Converter's Pool p (30) is also C's Pool: B first takes 15 (u + (u + 0) ≤ 30), a nothing, C makes 30 — the other way round would make 50", { nodes: [pool('a', 100), pool('p', 30), conv('B'), gate('g'), conv('C'), pool('x', 0)], edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('k1', 'g', 'C', '40'), res('e2', 'p', 'C', '40'), res('o1', 'C', 'x', '80')] }],
    ['S3', 'both supplies read one Pool a (30), q separate: B 20, then a 10', { nodes: [pool('a', 30), conv('B'), gate('g'), conv('C'), pool('q', 100), pool('x', 0)], edges: [res('e0', 'a', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('k1', 'g', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')] }],
    ['S4', 'A5s with x capped at 20: D = 10 binds before the shared Pool does (was: 10 lost at C, 20 held at g)', shared(30, 20)],
    ['S6', 'two upstream routers sharing one Pool a (30): B 20 (first in router order), g0 10', { nodes: [pool('a', 30), gate('g0'), conv('B'), gate('g1'), conv('C'), pool('q', 100), pool('x', 0)], edges: [res('e1', 'a', 'g0', '20'), res('g01', 'g0', 'g1', '20'), res('e0', 'a', 'B', '20'), res('b1', 'B', 'g1', '20'), res('k1', 'g1', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')] }],
  ]
  it.each(cases)('%s: %s', (id, _note, g) => pin(g, EXPECT[id]))

  it('S5: an outside Gate reading the shared Pool between the group\'s first router and its Converter sees the Pool net of the plan\'s claim (the reservation effect, a = 90)', () => {
    // A5 with a = 90 plus an outside Gate l reading a at 50 into y; in the
    // order l comes after B and before g and C. The plan claims a at B's turn
    // (g 20 + C 40 = 60), so l takes 30 — not 50 as it did when it ran before
    // C's take and left C short.
    const g: Graph = { nodes: [pool('a', 90), pool('p', 100), conv('B'), gate('g'), conv('C'), pool('x', 0), gate('l'), pool('y', 0)], edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('k1', 'g', 'C', '40'), res('e2', 'a', 'C', '40'), res('o1', 'C', 'x', '80'), res('l1', 'a', 'l', '50'), res('l2', 'l', 'y', '50')] }
    const r = run(g)
    close(r.moved, { b1: 20, e1: 20, k1: 40, e2: 40, o1: 80, l1: 30, l2: 30 })
    close(r.pools, { a: 0, p: 80, x: 80, y: 30 })
    checks(g, r)
  })
})

describe('#476 — `all` and `pull all` at the multi-supply Gate (D-all, D-demand by reach, D-fixed)', () => {
  const cases: [string, string, Graph][] = [
    ['P1', 'g pull all with `all` from a (100) and B 20: a demand of 120 against a downstream of 40 — nothing moves (was: 20 held and lost)', A({ aFlow: 'all', gMode: 'pullAll' })],
    ['P2', 'P1 with a = 20: the demand 40 is the downstream — runs in full', A({ a: 20, aFlow: 'all', gMode: 'pullAll' })],
    ['P3', 'P2 with x capped at 40: the downstream 20 < the demand 40 — nothing moves (was: 20 held and lost)', A({ a: 20, aFlow: 'all', gMode: 'pullAll', xCap: 40 })],
    ['P4', 'g pull all, `all` from a, and a is also C\'s Pool (a = 20): the point is infeasible, the whole group moves nothing (D-fixed; was: C ran short, I2 broken)', shared(20, null, 'pullAll', 'all')],
    ['P5', '`all` on the upstream Gate\'s input (a = 100): g0 gives what C can take, 20 — not all 100 (was: a gave 80, 60 lost)', B({ aFlow: 'all' })],
    ['P6', 'g pull all with plain rates, everything sufficient', A({ gMode: 'pullAll' })],
  ]
  it.each(cases)('%s: %s', (id, _note, g) => pin(g, EXPECT[id]))
})

describe('#476 — shape Q: the upstream Gate splits, one branch into the pull-all Gate (D-demand by reach); the pull-any twins agree', () => {
  const cases: [string, string, Graph][] = [
    ['Q0', 'nominal', Q()],
    ['Q1', 'g0 short (a = 30): its branch can carry 15, the pull-all Gate takes 15 + 20 (the rate reading would have stopped the group)', Q({ a: 30 })],
    ['Q1a', 'Q1 with g1 pull any: the same', Q({ a: 30, g1Mode: 'pullAny' })],
    ['Q2', "the other branch's Pool y capped at 10 bounds g0 to 20 through its fixed split: the branch carries 10", Q({ yCap: 10 })],
    ['Q2a', 'Q2 with g1 pull any: the same', Q({ yCap: 10, g1Mode: 'pullAny' })],
    ['Q3', "the other branch feeds a Converter E whose Pool r = 5 (f_E ≤ 1/4): g0 is bounded to 10, the branch carries 5 (was: E ran on its inbox alone, I2 broken)", Q({ other: 'conv', r: 5 })],
    ['Q3a', 'Q3 with g1 pull any: the same', Q({ other: 'conv', r: 5, g1Mode: 'pullAny' })],
    ['Q4', 'the other branch feeds a pull-all Converter E that cannot reach f = 1: g0 and E idle, the Gate takes B\'s 20 alone', Q({ other: 'convAll', r: 5 })],
    ['Q4a', 'Q4 with g1 pull any: the same', Q({ other: 'convAll', r: 5, g1Mode: 'pullAny' })],
    ['Q5', "shared Pool: g0's Pool a (60) is also C's Pool — the reaches alone are feasible (20 each) but together claim 80: the whole group moves nothing (D-fixed)", Q({ a: 60, cPool: 'a' })],
    ['Q5a', 'Q5 with g1 pull any: B 20, then g0 to what the shared Pool leaves (2u + 20 + u ≤ 60 → 13⅓)', Q({ a: 60, cPool: 'a', g1Mode: 'pullAny' })],
    ['Q5b', 'shared Pool, a = 100: 80 wanted, 100 there', Q({ a: 100, cPool: 'a' })],
    ['Q6', '`all` on a → g0 with a = 40: half of 40 is the branch\'s 20', Q({ a: 40, aFlow: 'all' })],
    ['Q7', '`all` on a → g0 with a = 100: the branch could carry 40, with B\'s 20 that is 60 > 40 — nothing moves (was: g0 took 100, 30 lost)', Q({ a: 100, aFlow: 'all' })],
  ]
  it.each(cases)('%s: %s', (id, _note, g) => pin(g, EXPECT[id]))
})

describe('#476 — the shapes the design solver did not cover, on the real engine (hand-derived numbers + the four checks)', () => {
  it('three supplies: B, then a, then c fill what x (cap 60) leaves — 20, 10, 0', () => {
    const g: Graph = { nodes: [pool('a', 100), pool('c', 100), pool('p', 100), conv('B'), gate('g'), conv('C'), pool('q', 100), pool('x', 0, 60)], edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('e3', 'c', 'g', '20'), res('k1', 'g', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')] }
    const r = run(g)
    // C: f = 60/80 = 3/4 → T = 30: B 20 (first), a 10, c 0
    close(r.moved, { e0: 20, b1: 20, e1: 10, e3: 0, k1: 30, e2: 30, o1: 60 })
    close(r.pools, { a: 90, c: 100, p: 80, q: 70, x: 60 })
    checks(g, r)
  })
  it('two multi-supply Gates in a chain: the first is filled with the second\'s downstream in view, the second gets what is left', () => {
    // a →(20) g0 →(20) g1;  b →(20) g1;  g1 →(40) h1;  c →(20) h1;  h1 →(60) C →(60) x (cap 30)
    const g: Graph = { nodes: [pool('a', 100), gate('g0'), pool('b', 100), gate('g1'), pool('c', 100), gate('h1'), conv('C'), pool('x', 0, 30)], edges: [res('e1', 'a', 'g0', '20'), res('g01', 'g0', 'g1', '20'), res('e2', 'b', 'g1', '20'), res('g1h', 'g1', 'h1', '40'), res('e3', 'c', 'h1', '20'), res('h1c', 'h1', 'C', '60'), res('o1', 'C', 'x', '60')] }
    const r = run(g)
    // C can make 30 → T_h1 = 30; g1 first: g0 20 (≤ 30), b 10 (20 + u ≤ 30); then h1: its g1 supply is 30, c gets 0
    close(r.moved, { e1: 20, g01: 20, e2: 10, g1h: 30, e3: 0, h1c: 30, o1: 30 })
    close(r.pools, { a: 80, b: 90, c: 100, x: 30 })
    checks(g, r)
    expect(converterGroups(g.nodes, g.edges)[0]).toMatchObject({ cls: 'multi', multiGates: ['g1', 'h1'] })
  })
  it('the downstream of the multi-supply Gate is a Gate that splits further: its branches\' rooms bound the group', () => {
    // A without C: g →(40) h;  h →(10) y;  h →(30) z (cap 15) → T_h ≤ 15 / (3/4) = 20
    const g: Graph = { nodes: [pool('a', 100), pool('p', 100), conv('B'), gate('g'), gate('h'), pool('y', 0), pool('z', 0, 15)], edges: [res('e0', 'p', 'B', '20'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('k1', 'g', 'h', '40'), res('h1', 'h', 'y', '10'), res('h2', 'h', 'z', '30')] }
    const r = run(g)
    close(r.moved, { e0: 20, b1: 20, e1: 0, k1: 20, h1: 5, h2: 15 })
    close(r.pools, { a: 100, p: 80, y: 5, z: 15 })
    checks(g, r)
  })
  it('an upstream Converter with two Pool inputs, one short: its f bounds its supply, the own Pool fills after it', () => {
    // p →(20) B, p2 →(10) B (p2 = 5 → f_B ≤ 1/2), B →(20) g; a →(20) g; g →(40) C; q →(40) C; C →(80) x
    const g: Graph = { nodes: [pool('a', 100), pool('p', 100), pool('p2', 5), conv('B'), gate('g'), conv('C'), pool('q', 100), pool('x', 0)], edges: [res('e0', 'p', 'B', '20'), res('e0b', 'p2', 'B', '10'), res('b1', 'B', 'g', '20'), res('e1', 'a', 'g', '20'), res('k1', 'g', 'C', '40'), res('e2', 'q', 'C', '40'), res('o1', 'C', 'x', '80')] }
    const r = run(g)
    close(r.moved, { e0: 10, e0b: 5, b1: 10, e1: 20, k1: 30, e2: 30, o1: 60 })
    close(r.pools, { a: 80, p: 90, p2: 0, q: 70, x: 60 })
    checks(g, r)
  })
})

describe('#476 — two multi-supply Gates whose downstreams meet at one Converter (one piece, two heads): the first Gate is filled in order, the second is held to what the Converter\'s one fraction gives it', () => {
  // a →(20) g0 →(20) g1;  p →(20) g1;  b →(20) h0 →(20) h1;  r →(20) h1;  g1 →(40) C;  h1 →(40) C;  C →(80) x
  const J = (o: { xCap?: number | null; r?: number; h1Mode?: Mode } = {}): Graph => ({
    nodes: [pool('a', 100), pool('b', 100), pool('p', 100), pool('r', o.r ?? 100), gate('g0'), gate('g1'), gate('h0'), gate('h1', o.h1Mode), conv('C'), pool('x', 0, o.xCap === undefined ? null : o.xCap)],
    edges: [res('e1', 'a', 'g0', '20'), res('g01', 'g0', 'g1', '20'), res('e2', 'p', 'g1', '20'), res('e3', 'b', 'h0', '20'), res('h01', 'h0', 'h1', '20'), res('e4', 'r', 'h1', '20'), res('k1', 'g1', 'C', '40'), res('k2', 'h1', 'C', '40'), res('o1', 'C', 'x', '80')],
  })
  it('is one multi group with both Gates, not refused', () => {
    const g = J()
    expect(converterGroups(g.nodes, g.edges)[0]).toMatchObject({ cls: 'multi', multiGates: ['g1', 'h1'], hasConverter: true })
  })
  it('J1: x capped at 10 — C can run at 1/8, so g1 gets 5 (g0 first, p nothing) and h1 must bring exactly 5 (h0 first, r nothing); nothing is lost (was: 30 lost, reported)', () => {
    const g = J({ xCap: 10 })
    const r = run(g)
    close(r.moved, { e1: 5, g01: 5, e2: 0, e3: 5, h01: 5, e4: 0, k1: 5, k2: 5, o1: 10 })
    close(r.pools, { a: 95, b: 95, p: 100, r: 100, x: 10 })
    checks(g, r)
  })
  it('J2: everything sufficient — both Gates at 40, C at f = 1', () => {
    const g = J()
    const r = run(g)
    close(r.moved, { e1: 20, g01: 20, e2: 20, e3: 20, h01: 20, e4: 20, k1: 40, k2: 40, o1: 80 })
    close(r.pools, { a: 80, b: 80, p: 80, r: 80, x: 80 })
    checks(g, r)
  })
  it('J3: the second Gate\'s own Pool is short (r = 5): the first Gate\'s own Pool yields (p gives 5, not 20) so that the second can reach the throughput the Converter ties it to', () => {
    const g = J({ r: 5 })
    const r = run(g)
    close(r.moved, { e1: 20, g01: 20, e2: 5, e3: 20, h01: 20, e4: 5, k1: 25, k2: 25, o1: 50 })
    close(r.pools, { a: 80, b: 80, p: 95, r: 0, x: 50 })
    checks(g, r)
  })
  it('J4: the second Gate is pull all with x capped at 10: its fixed demand (20 + 20) is not the 5 the Converter gives it, so the whole group moves nothing (D-fixed)', () => {
    const g = J({ xCap: 10, h1Mode: 'pullAll' })
    const r = run(g)
    close(r.moved, { e1: 0, g01: 0, e2: 0, e3: 0, h01: 0, e4: 0, k1: 0, k2: 0, o1: 0 })
    close(r.pools, { a: 100, b: 100, p: 100, r: 100, x: 0 })
    checks(g, r)
  })
  it('J5: the second Gate is pull all and everything is sufficient: its demand 40 is exactly what the Converter gives it — runs in full', () => {
    const g = J({ h1Mode: 'pullAll' })
    const r = run(g)
    close(r.moved, { e1: 20, g01: 20, e2: 20, e3: 20, h01: 20, e4: 20, k1: 40, k2: 40, o1: 80 })
    close(r.pools, { a: 80, b: 80, p: 80, r: 80, x: 80 })
    checks(g, r)
  })
})
