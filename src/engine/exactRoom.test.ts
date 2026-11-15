import { describe, expect, it } from 'vitest'
import { deserialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// The exact test of a Pool's room (SEMANTICS.md §6 erratum, part 9; issue
// #572), from three sides the cases of `fullPoolLoop.test.ts` do not reach:
//   1. SCALE. Where the exact walk is asked depends on the amounts ("too close
//      to the room for floating point"), so the same cases are run from a
//      millionth to a million million times their size.
//   2. UNITS. A rate with a unit reaches the engine as the nearest double of
//      its exact value; the exact walk reads the exact value itself, the
//      authored decimal times the unit's ratio, not that double.
//   3. THE OTHER BOUNDS. A Pool's availability, a line's own amount, a
//      Converter's one fraction and a Gate's balance are still decided in
//      floating point; the exact room test must not make them contradict.

const P0 = { x: 0, y: 0 }
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({ id, type: 'pool', position: P0, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } })
const conv = (id: string, mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({ id, type: 'converter', position: P0, data: { kind: 'converter', label: id, activation: 'automatic', mode } })
const gate = (id: string, mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({ id, type: 'gate', position: P0, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'] })
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })
type Graph = { nodes: LoopNode[]; edges: LoopEdge[] }

function one(g: Graph, state = initSim(g.nodes)) {
  const r = step(g.nodes, g.edges, state, 7, 2)
  const m: Record<string, number> = {}
  for (const e of g.edges) m[e.id] = 0
  for (const ev of r.report.events) m[ev.edgeId] = (m[ev.edgeId] ?? 0) + ev.amount
  return { m, before: state.values, after: r.state.values, state: r.state, refused: r.report.diagnostics.some((d) => /^Can't run/.test(d)) }
}
/** `text` × 10^n, digit for digit (no arithmetic, so no rounding) */
function shift(text: string, n: number): string {
  const [int, frac = ''] = text.split('.')
  let digits = int + frac
  let point = int.length + n
  if (point <= 0) { digits = '0'.repeat(1 - point) + digits; point = 1 }
  if (point > digits.length) digits += '0'.repeat(point - digits.length)
  return digits.slice(0, point).replace(/^0+(?=\d)/, '') + (point < digits.length ? `.${digits.slice(point)}` : '')
}
const times = (x: number, n: number) => Number(shift(String(x), n))
/** how far the events put a capped Pool past its capacity, in units of the rounding of what went through it */
function pastCapacity(g: Graph, r: ReturnType<typeof one>): number {
  let worst = 0
  for (const n of g.nodes) {
    if (n.data.kind !== 'pool' || n.data.capacity == null) continue
    let net = 0
    let through = 0
    for (const e of g.edges) {
      if (e.target === n.id) { net += r.m[e.id]; through += r.m[e.id] }
      if (e.source === n.id) { net -= r.m[e.id]; through += r.m[e.id] }
    }
    const past = (r.before[n.id] ?? 0) + net - n.data.capacity
    if (past > 0) worst = Math.max(worst, past / (Number.EPSILON * (n.data.capacity + through)))
  }
  return worst
}

/** a Pool that was full is full again: at its capacity to the rounding of the sum that put it there, and never past it */
function atCapacity(value: number, capacity: number) {
  expect(value).toBeLessThanOrEqual(capacity)
  expect(capacity - value).toBeLessThanOrEqual(4 * Number.EPSILON * capacity)
}

const SCALES = [-6, -3, 0, 3, 6, 9, 12]

describe('1. the same cases at every scale, from 10⁻⁶ to 10¹² times', () => {
  // P ─3→ g ; g ─1→ c , g ─6→ P ; c ─out→ P, every amount times 10^n
  const tree = (n: number, out = '1', room = '0'): Graph => ({
    nodes: [pool('P', times(10, n), Number(shift(String(10 + Number(room)), n))), gate('g'), conv('c')],
    edges: [res('Pg', 'P', 'g', shift('3', n)), res('gc', 'g', 'c', shift('1', n)), res('gP', 'g', 'P', shift('6', n)), res('cP', 'c', 'P', shift(out, n))],
  })
  it.each(SCALES)('tree plan × 10^%i, Pool exactly full: three of the ten flow round', (n) => {
    const g = tree(n)
    const r = one(g)
    expect(r.m.Pg / times(3, n)).toBeCloseTo(1, 12)
    expect(r.m.gP / times(18, n) * 7).toBeCloseTo(1, 12)
    atCapacity(r.after.P, times(10, n))
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })
  it.each(SCALES)('tree plan × 10^%i: a real inflow is refused, at one part in 10^6, in 10^13 and at one unit in the last place', (n) => {
    for (const out of ['1.000001', '1.0000000000001', '1.0000000000000002']) {
      expect(one(tree(n, out)).m, `out ${out}`).toEqual({ Pg: 0, gc: 0, gP: 0, cP: 0 })
    }
  })
  it.each(SCALES)('tree plan × 10^%i: a net outflow of one unit in the last place runs', (n) => {
    const r = one(tree(n, '0.9999999999999999'))
    expect(r.m.Pg / times(3, n)).toBeCloseTo(1, 9)
  })
  it.each(SCALES)('tree plan × 10^%i: with a real room the bound is met to the last place (room 0.25, the Converter returns 2 for 1: 1.75)', (n) => {
    const g = tree(n, '2', '0.25')
    const r = one(g)
    expect(r.m.Pg / times(1.75, n)).toBeCloseTo(1, 12)
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })

  // the multi-supply case (sweep seed 5865), every amount times 10^n
  const multi = (n: number, room = 0): Graph => {
    const f = (x: string) => shift(x, n)
    return {
      nodes: [pool('p0', 0), pool('p1', times(19, n), times(19, n) + room), pool('p2', times(5.75, n)), pool('p3', times(6.75, n)), gate('g0'), gate('g1', 'pullAll'), gate('g2'), gate('g3'), conv('c4')],
      edges: [res('e0', 'p1', 'g0', f('7')), res('e1', 'p2', 'g0', f('4')), res('e2', 'g0', 'g1', f('5')), res('e3', 'p0', 'g2', f('7')), res('e4', 'p2', 'g2', f('5')), res('e5', 'p1', 'g2', f('2')), res('e6', 'g0', 'g3', f('7')), res('e7', 'g2', 'g3', f('5')), res('e8', 'g0', 'c4', f('3')), res('e9', 'g2', 'c4', f('2')), res('e10', 'g1', 'p3', f('4')), res('e11', 'g1', 'p3', f('2')), res('e12', 'g3', 'p1', f('7')), res('e13', 'g3', 'p2', f('5')), res('e14', 'c4', 'p1', f('8')), res('e15', 'c4', 'p1', f('7'))],
    }
  }
  it.each(SCALES)('multi-supply plan × 10^%i, Pool exactly full: the group runs at g0 = 30/7, and stops where g2’s line off the Pool is used up', (n) => {
    const g = multi(n)
    const r = one(g)
    expect(r.m.e0 / times(30, n) * 7).toBeCloseTo(1, 12)
    // g2's line off the Pool brings its 2 (to the last place, and never more), and nothing comes from p2
    expect(r.m.e5 / times(2, n)).toBeCloseTo(1, 12)
    expect(r.m.e5).toBeLessThanOrEqual(times(2, n))
    expect(r.m.e4).toBe(0)
    atCapacity(r.after.p1, times(19, n))
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })
})

// ── units ────────────────────────────────────────────────────────────────
// A day has 86,400 seconds, so at a step of 11 seconds one CMD (unit per day)
// is 11/86400 of a unit per step: no decimal, and no double. 100 and 900 CMD
// are 11/864 and 11/96 of a unit per step, and their nearest doubles do not
// add up to the nearest double of 1000 CMD's 55/432 to the last place.
//
// The kind is NOT conserved. A conserved kind refuses a Converter whose two
// sides differ before the run, exactly (`Can't run: ... A conserved kind must
// balance`), so the room test never sees one; a kind that is not conserved
// lets the Converter return more or less than it takes, and the room test is
// what decides.
const withUnits = (out2: string, stepValue = 11, stepUnit = 's') =>
  deserialize(
    JSON.stringify({
      schema: 'loop-studio/graph/4',
      version: 1,
      nodes: [
        { id: 'P', type: 'pool', position: P0, data: { kind: 'pool', label: 'P', initial: 10, capacity: 10, resourceType: 'water', activation: 'passive', mode: 'pullAny' } },
        { id: 'g', type: 'gate', position: P0, data: { kind: 'gate', label: 'g', activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } },
        { id: 'c', type: 'converter', position: P0, data: { kind: 'converter', label: 'c', activation: 'automatic', mode: 'pullAny' } },
      ],
      edges: [
        ['Pg', 'P', 'g', '3000'],
        ['gc', 'g', 'c', '1000'],
        ['gP', 'g', 'P', '6000'],
        ['c1', 'c', 'P', '100'],
        ['c2', 'c', 'P', out2],
      ].map(([id, source, target, flow]) => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow, unit: 'CMD' } })),
      kinds: [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMD', factor: '1', per: 'd' }] }],
      time: { step: { value: stepValue, unit: stepUnit } },
    }),
  )
function oneWithUnits(d: ReturnType<typeof withUnits>) {
  const o = { kinds: d.kinds, time: d.time }
  const r = step(d.nodes, d.edges, initSim(d.nodes, o), 1, d.modelVersion, o)
  const m: Record<string, number> = { Pg: 0, gc: 0, gP: 0, c1: 0, c2: 0 }
  for (const ev of r.report.events) m[ev.edgeId] += ev.amount
  return { m, after: r.state.values, diagnostics: r.report.diagnostics }
}

describe('2. rates with a unit: the exact value, not the double the unit conversion left', () => {
  const perStep = (cmd: number, seconds = 11) => (cmd * seconds) / 86400
  it('the premise: at a step of 11 seconds the doubles of 100 and 900 CMD do not add up to the double of 1000 CMD', () => {
    expect(perStep(100) + perStep(900)).not.toBe(perStep(1000))
  })
  it('the kind is not conserved, so nothing refuses the run before the room test', () => {
    for (const out2 of ['900', '900.000001', '899.999999999999']) expect(oneWithUnits(withUnits(out2)).diagnostics, out2).toEqual([])
  })
  it('a Converter that takes 1000 CMD and returns 100 and 900 CMD into a full Pool: balanced as written, the group runs', () => {
    const r = oneWithUnits(withUnits('900'))
    // the Gate takes its 3000 CMD, 3000 × 11 / 86400 of a unit this step, and
    // sends one part in seven to the Converter, which returns as much
    expect(r.m.Pg).toBeCloseTo(perStep(3000), 12)
    expect(r.m.gc).toBeCloseTo(perStep(3000) / 7, 12)
    expect(r.m.c1 + r.m.c2).toBeCloseTo(r.m.gc, 12)
    atCapacity(r.after.P, 10)
  })
  it.each([['900.000001'], ['900.0000000001'], ['900.000000000001']])('the same Converter returning 100 and %s CMD: a real inflow, nothing moves', (out2) => {
    const r = oneWithUnits(withUnits(out2))
    expect(r.m).toEqual({ Pg: 0, gc: 0, gP: 0, c1: 0, c2: 0 })
    expect(r.after.P).toBe(10)
  })
  it('returning 100 and 899.999999999999 CMD: a net outflow, the group runs', () => {
    const r = oneWithUnits(withUnits('899.999999999999'))
    expect(r.m.Pg).toBeCloseTo(perStep(3000), 9)
    expect(r.after.P).toBeLessThanOrEqual(10)
  })
  it.each([[1, 's', 1], [7, 's', 7], [11, 's', 11], [13, 's', 13], [7, 'min', 420], [1, 'h', 3600]] as const)('balanced as written at a step of %i %s as well, and a real inflow is refused there too', (value, unit, seconds) => {
    const r = oneWithUnits(withUnits('900', value, unit))
    // 3000 CMD of this step, or the 10 the Pool holds when the step is long
    expect(r.m.Pg).toBeCloseTo(Math.min(perStep(3000, seconds), 10), 12)
    expect(r.m.c1 + r.m.c2).toBeCloseTo(r.m.gc, 12)
    atCapacity(r.after.P, 10)
    expect(oneWithUnits(withUnits('900.000000000001', value, unit)).m).toEqual({ Pg: 0, gc: 0, gP: 0, c1: 0, c2: 0 })
  })
})

// ── the other bounds ─────────────────────────────────────────────────────
describe('3. the bounds still decided in floating point are not contradicted', () => {
  // the generator of the sweep that found issue #572, every amount times 10^n
  function build(seed0: number, n = 0): Graph {
    let seed = seed0 >>> 0
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    const nodes: LoopNode[] = []
    const edges: LoopEdge[] = []
    const nPools = int(2, 5)
    for (let i = 0; i < nPools; i++) {
      const initial = int(0, 14)
      const capacity = rnd() < 0.35 ? initial + int(0, 8) : null
      nodes.push(pool(`p${i}`, times(initial, n), capacity === null ? null : times(capacity, n)))
    }
    const nR = int(1, 5)
    const routers: string[] = []
    for (let i = 0; i < nR; i++) {
      const isGate = rnd() < 0.6
      const id = `${isGate ? 'g' : 'c'}${i}`
      const mode = rnd() < 0.2 ? 'pullAll' : 'pullAny'
      routers.push(id)
      nodes.push(isGate ? gate(id, mode) : conv(id, mode))
    }
    let k = 0
    const add = (s: string, t: string) => edges.push(res(`e${k++}`, s, t, shift(String(int(1, 8)), n)))
    routers.forEach((r, i) => {
      const fromRouters = routers.slice(0, i).filter(() => rnd() < 0.45)
      for (const u of fromRouters) add(u, r)
      const lines = fromRouters.length === 0 ? int(1, 3) : int(0, 2)
      for (let j = 0; j < lines; j++) add(`p${int(0, nPools - 1)}`, r)
    })
    for (const r of routers) {
      const outs = edges.some((e) => e.source === r) ? int(0, 1) : int(1, 2)
      for (let j = 0; j < outs; j++) add(r, `p${int(0, nPools - 1)}`)
    }
    return { nodes, edges }
  }
  const kindOf = (g: Graph) => new Map(g.nodes.map((x) => [x.id, x.data.kind]))

  it.each([[0], [6], [-3]])('2,000 random graphs × 10^%i, three steps each: Pools, lines and Gates keep their rules, and no capped Pool is put past its capacity', (n) => {
    const unit = times(1, n)
    const oneFraction: number[] = [] // seeds whose Converter is not at one fraction (issue #570, not this change)
    for (let seed = 1000; seed < 3000; seed++) {
      const g = build(seed, n)
      const kind = kindOf(g)
      let st = initSim(g.nodes)
      for (let i = 0; i < 3; i++) {
        const r = one(g, st)
        st = r.state
        if (r.refused) break
        const where = `seed ${seed}, step ${i + 1}`
        for (const node of g.nodes) {
          if (node.data.kind !== 'pool') continue
          let net = 0
          for (const e of g.edges) {
            if (e.target === node.id) net += r.m[e.id]
            if (e.source === node.id) net -= r.m[e.id]
          }
          // availability: no Pool below 0, and its change is what the events say
          expect(r.after[node.id], `${where}: ${node.id} below 0`).toBeGreaterThanOrEqual(0)
          expect(Math.abs(r.after[node.id] - r.before[node.id] - net), `${where}: ${node.id} against its events`).toBeLessThan(1e-9 * unit)
        }
        for (const e of g.edges) {
          // a line's own amount: a Pool line never carries more than it says
          if (kind.get(e.source) === 'pool') expect(r.m[e.id], `${where}: ${e.id} above its amount`).toBeLessThanOrEqual(Number((e.data as { flow: string }).flow) * (1 + 1e-12))
          // a Converter's fraction is at most 1 on every connection
          if (kind.get(e.source) === 'converter' || kind.get(e.target) === 'converter') expect(r.m[e.id], `${where}: ${e.id} past f = 1`).toBeLessThanOrEqual(Number((e.data as { flow: string }).flow) * (1 + 1e-9))
        }
        for (const node of g.nodes) {
          const ins = g.edges.filter((e) => e.target === node.id)
          const outs = g.edges.filter((e) => e.source === node.id)
          if (node.data.kind === 'gate') {
            const a = ins.reduce((t, e) => t + r.m[e.id], 0)
            const b = outs.reduce((t, e) => t + r.m[e.id], 0)
            expect(Math.abs(a - b), `${where}: Gate ${node.id} in against out`).toBeLessThan(1e-9 * unit)
          } else if (node.data.kind === 'converter') {
            const fs = [...ins, ...outs].map((e) => r.m[e.id] / Number((e.data as { flow: string }).flow))
            if (fs.length && Math.max(...fs) - Math.min(...fs) > 1e-9 && !oneFraction.includes(seed)) oneFraction.push(seed)
          }
        }
        expect(pastCapacity(g, r), `${where}: past a capacity`).toBeLessThanOrEqual(1)
      }
    }
    // The only graphs with a Converter off its one fraction are the ones of
    // issue #570 (a router outside the group takes a source Gate's planned
    // pull), the same before and after this change. When #570 is repaired this
    // list is empty.
    expect(oneFraction).toEqual([2841, 2931])
  })
})
