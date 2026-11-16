import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// Issue #572, the loss (found on 2026-11-16 by checking a step's rules at
// several scales; sweep seed 1241 at 10^9).
//
// A planned Gate with no Pool line of its own is fed by another member of its
// group. The plan gives it a number, its coefficient times the group's number,
// `((1 / W) · w) · T`; the member before it hands it `(T · w) / W`. One amount,
// worked out in two orders, and the two can differ in the last place. The Gate moved
// the least of the two, so one last place stayed in its inbox and was gone at
// the end of the step, at every scale and with no notice. Its `pull all` was
// then asked again between the two workings: once the amounts were large
// enough for a last place to be more than epsilon (1e-9), it moved NOTHING,
// and the whole of what it had been handed was gone.
//
// The repair (SEMANTICS.md §6 erratum, part 12): such a Gate passes on what it
// was handed. The plan decides what a group moves, its `pull all` members
// included; the first half of this file is that nothing is dropped, the second
// that a real shortage is still refused, by the plan.

const P0 = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({ id, type: 'pool', position: P0, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } })
const conv = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'converter', position: P0, data: { kind: 'converter', label: id, activation: 'automatic', mode } })
const gate = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'gate', position: P0, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'] })
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })
type Graph = { nodes: LoopNode[]; edges: LoopEdge[] }

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
function one(g: Graph, state = initSim(g.nodes)) {
  const r = step(g.nodes, g.edges, state, 7, 2)
  const moved: Record<string, number> = {}
  for (const e of g.edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  return { moved, after: r.state.values, state: r.state, notices: r.report.notices ?? [], gates: Object.fromEntries(r.report.gates.map((x) => [x.nodeId, `${x.state}${x.why ? '/' + x.why : ''}`])) }
}

// P ─take→ g1 ;  g1 ─a→ c ─1→ o1 ;  g1 ─b→ g4 ─1→ o2        (every amount times 10^n)
// g1 splits what it takes a : b. The Converter c makes the three a planned group; g4 has no Pool
// line and one output with no capacity, so everything it is handed can be passed on.
// `plainWeight` leaves g4's one output at the weight 1 whatever the scale. A Gate delivers
// `(T · w) / W` on a branch, and with one branch of weight 10^9 that product and quotient can drop
// a last place of T by themselves; that rounding is every Gate's and is not what is asked here.
const chain = (n: number, mode: Mode, opts: { take?: string; a?: string; b?: string; held?: number; g1?: Mode; o2?: number | null; plainWeight?: boolean } = {}): Graph => {
  const f = (x: string) => shift(x, n)
  return {
    nodes: [pool('P', times(opts.held ?? 100, n)), pool('o1', 0), pool('o2', 0, opts.o2 == null ? null : times(opts.o2, n)), gate('g1', opts.g1 ?? 'pullAny'), conv('c'), gate('g4', mode)],
    edges: [res('Pg', 'P', 'g1', f(opts.take ?? '6')), res('gc', 'g1', 'c', f(opts.a ?? '5')), res('g4', 'g1', 'g4', f(opts.b ?? '7')), res('co', 'c', 'o1', f('1')), res('4o', 'g4', 'o2', opts.plainWeight ? '1' : f('1'))],
  }
}
const MODES: Mode[] = ['pullAny', 'pullAll']
const SCALES = [0, 3, 9, 12]

describe('a planned Gate with no Pool line of its own passes on what it was handed', () => {
  it('the premise: the plan’s number and the hand-over are one amount in two orders, and differ in the last place', () => {
    expect((1 / 12) * 7 * 6).toBe(3.4999999999999996) // the coefficient walk: one over the sum of the weights, times the weight, times the number
    expect((6 * 7) / 12).toBe(3.5) // the delivery: the throughput times the weight, over the sum
  })
  it.each(MODES.flatMap((m) => SCALES.map((n) => [m, n] as const)))('%s, × 10^%i: handed 3.5 and passes on 3.5, the same double; nothing is held (was: 3.4999999999999996 at scale 1, and at 10^9 a `pull all` Gate passed on nothing)', (mode, n) => {
    const r = one(chain(n, mode))
    expect(r.moved.Pg).toBe(times(6, n))
    expect(r.moved.g4).toBe(times(3.5, n))
    expect(r.moved['4o'], 'what it passes on is what it was handed').toBe(r.moved.g4)
    expect(r.after.o2).toBe(times(3.5, n))
    expect(r.notices).toEqual([])
  })
  it.each(MODES)('%s: three steps move three times as much; nothing is lost on the way', (mode) => {
    for (const n of [0, 9]) {
      const g = chain(n, mode)
      let st = initSim(g.nodes)
      for (let i = 0; i < 3; i++) {
        const r = one(g, st)
        st = r.state
        expect(r.moved['4o'], `x 10^${n}, step ${i + 1}`).toBe(r.moved.g4)
        expect(r.notices, `x 10^${n}, step ${i + 1}`).toEqual([])
      }
      expect(st.values.o2, `x 10^${n}`).toBe(times(10.5, n))
      expect(st.values.P, `x 10^${n}`).toBe(times(82, n))
    }
  })
  it.each(MODES)('%s: over 240 other splits, at scale 1 and at 10^9, the Gate’s intake is its output to the last place', (mode) => {
    // a throughput of 1 to 10 and weights of 1 to 12 against 7; on main the two differed on some of them
    const found: string[] = []
    let asked = 0
    for (const n of [0, 9]) {
      for (let take = 1; take <= 10; take++) {
        for (let a = 1; a <= 12; a++) {
          const r = one(chain(n, mode, { take: String(take), a: String(a), plainWeight: true }))
          asked++
          if (r.moved.g4 !== r.moved['4o'] || r.notices.length) found.push(`x 10^${n}, takes ${take}, split ${a} : 7: handed ${r.moved.g4}, passed on ${r.moved['4o']}`)
        }
      }
    }
    expect(found.slice(0, 20), `${found.length} of ${asked}`).toEqual([])
    expect(asked).toBe(240)
  })
  it('a Gate further down the same group: every Gate of the chain passes on what it was handed', () => {
    // P ─6→ g1 ; g1 ─5→ c ─1→ o1 ; g1 ─7→ g4 ─3→ g5 (pull all) ─1→ o2 , g4 ─4→ o3
    for (const n of [0, 9]) {
      const f = (x: string) => shift(x, n)
      const g: Graph = {
        nodes: [pool('P', times(100, n)), pool('o1', 0), pool('o2', 0), pool('o3', 0), gate('g1'), conv('c'), gate('g4'), gate('g5', 'pullAll')],
        edges: [res('Pg', 'P', 'g1', f('6')), res('gc', 'g1', 'c', f('5')), res('g4', 'g1', 'g4', f('7')), res('co', 'c', 'o1', f('1')), res('45', 'g4', 'g5', f('3')), res('4o', 'g4', 'o3', f('4')), res('5o', 'g5', 'o2', f('1'))],
      }
      const r = one(g)
      expect(r.moved['45'] + r.moved['4o'], `x 10^${n}: g4`).toBe(r.moved.g4)
      expect(r.moved['5o'], `x 10^${n}: g5`).toBe(r.moved['45'])
      expect(r.moved['5o'], `x 10^${n}: g5 runs`).toBeGreaterThan(0)
      expect(r.notices, `x 10^${n}`).toEqual([])
    }
  })
})

describe('a real shortage is still refused, and by the plan: no `pull all` passes a part', () => {
  // each case at scale 1 and at 10^9
  it.each([0, 9])('× 10^%i: the upstream Gate is `pull all` and its Pool holds 4 of the 6 it asks: the plan moves nothing, so nothing is handed over and nothing passed on', (n) => {
    const r = one(chain(n, 'pullAll', { g1: 'pullAll', held: 4 }))
    expect(r.moved).toEqual({ Pg: 0, gc: 0, g4: 0, co: 0, '4o': 0 })
    expect(r.after.P).toBe(times(4, n))
    expect(r.gates.g1).toBe('held/pullAll')
    expect(r.notices).toEqual([])
  })
  it.each([0, 9])('× 10^%i, control: the same with 6 in the Pool runs in full', (n) => {
    const r = one(chain(n, 'pullAll', { g1: 'pullAll', held: 6 }))
    expect(r.moved.Pg).toBe(times(6, n))
    expect(r.moved['4o']).toBe(r.moved.g4)
    expect(r.moved['4o']).toBe(times(3.5, n))
  })
  it.each([0, 9])('× 10^%i: the upstream Gate is `pull any` and its Pool holds 3: the group runs at half, and the `pull all` Gate passes on the whole of the 1.75 it is handed (what it is handed is all it asks for)', (n) => {
    const r = one(chain(n, 'pullAll', { held: 3 }))
    expect(r.moved.Pg).toBe(times(3, n))
    expect(r.moved.g4).toBe(times(1.75, n))
    expect(r.moved['4o']).toBe(r.moved.g4)
    expect(r.notices).toEqual([])
  })
  it.each([0, 9])('× 10^%i: the Pool the `pull all` Gate fills has room for 2: the plan holds the whole group to it, the Gate is handed what fits and passes it all on', (n) => {
    const g = chain(n, 'pullAll', { o2: 2 })
    const r = one(g)
    expect(r.moved['4o'], 'what it passes on is what it was handed').toBe(r.moved.g4)
    expect(r.moved['4o'] / times(1, n)).toBeCloseTo(2, 9)
    expect(r.after.o2).toBeLessThanOrEqual(times(2, n))
    // the upstream Gate took less for it: 2 is seven twelfths of 24/7
    expect(r.moved.Pg / times(1, n)).toBeCloseTo(24 / 7, 9)
    expect(r.notices).toEqual([])
  })
  it.each([0, 9])('× 10^%i: a planned `pull all` Gate ON ITS OWN POOL keeps its test: short of its line by a real half, the group moves nothing; with the whole amount it runs', (n) => {
    // A ─1→ c0 ─1→ c3 ; X ─3.5→ g (pull all) ─1→ c3 ; c3 ─1→ out
    const f = (x: string) => shift(x, n)
    const shape = (x: number): Graph => ({
      nodes: [pool('A', times(100, n)), pool('X', times(x, n)), pool('out', 0), conv('c0'), gate('g', 'pullAll'), conv('c3')],
      edges: [res('A0', 'A', 'c0', f('1')), res('03', 'c0', 'c3', f('1')), res('Xg', 'X', 'g', f('3.5')), res('g3', 'g', 'c3', f('3.5')), res('3o', 'c3', 'out', f('1'))],
    })
    expect(one(shape(3)).moved).toEqual({ A0: 0, '03': 0, Xg: 0, g3: 0, '3o': 0 })
    const full = one(shape(3.5))
    expect(full.moved.Xg).toBe(times(3.5, n))
    expect(full.moved['3o']).toBe(times(1, n))
  })
})
