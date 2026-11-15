import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// Whole-code review of 2026-11-15: the multi-supply plan (SEMANTICS.md §6,
// errata parts 3 and 4), three shapes no test built.
//
//   P1  part 3: the second Gate of a shared piece "is held to exactly that
//       throughput — its supplies, in their order, each up to its own bound,
//       cover it". Its last supply was found by a bisection over "covers
//       exactly", which is true at one point only: the search ended at 0 and
//       the group moved nothing. Part 4, "No slack": the same test with its
//       tolerance let an earlier supply settle 1e-9 past the throughput.
//   P3  part 2: "`pull all` members fix the number: below 1 − epsilon the group
//       moves nothing"; a `pull all` source Gate in a piece headed by a
//       multi-supply Gate was never asked, and was dropped at the commit while
//       the rest moved. The rule (Lumi, 2026-11-15): the WHOLE planned group
//       moves nothing, not only that Gate's piece.
//   P6  part 3: "a later supply gets what the earlier ones leave". The earlier
//       source Gate was charged what it COULD pull, not what it pulls.

const P0 = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({ id, type: 'pool', position: P0, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } })
const conv = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'converter', position: P0, data: { kind: 'converter', label: id, activation: 'automatic', mode } })
const gate = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'gate', position: P0, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'] })
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })

function run(nodes: LoopNode[], edges: LoopEdge[]) {
  const before = initSim(nodes)
  const r = step(nodes, edges, before, 1, 2)
  const moved: Record<string, number> = {}
  for (const e of edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  const gates: Record<string, string> = {}
  for (const g of r.report.gates) gates[g.nodeId] = `${g.state}${g.why ? '/' + g.why : ''}`
  return { moved, before: before.values, after: r.state.values, gates, report: r.report }
}
/** every connection and every Pool, to 1e-12 */
function expectExact(got: Record<string, number>, want: Record<string, number>, what: string) {
  expect(Object.keys(got).sort(), what).toEqual(Object.keys(want).sort())
  for (const k of Object.keys(want)) expect(Math.abs(got[k] - want[k]), `${what} ${k}: ${got[k]} against ${want[k]}`).toBeLessThan(1e-12)
}

describe('P1: a Gate held to a throughput covers it exactly', () => {
  // the J fixture of multiSupply.test.ts: g0 → g1 (+ its own Pool p), h0 → h1
  // (+ its own Pool r), g1 and h1 meet at C
  const J = (o: { b?: number; xCap?: number | null }) => ({
    nodes: [pool('a', 100), pool('b', o.b ?? 100), pool('p', 100), pool('r', 100), gate('g0'), gate('g1'), gate('h0'), gate('h1'), conv('C'), pool('x', 0, o.xCap ?? null)],
    edges: [res('e1', 'a', 'g0', '20'), res('g01', 'g0', 'g1', '20'), res('e2', 'p', 'g1', '20'), res('e3', 'b', 'h0', '20'), res('h01', 'h0', 'h1', '20'), res('e4', 'r', 'h1', '20'), res('k1', 'g1', 'C', '40'), res('k2', 'h1', 'C', '40'), res('o1', 'C', 'x', '80')],
  })
  it('the second Gate covers its 5 from its first supply (3) and its own Pool (2) (was: the whole group moved nothing)', () => {
    const g = J({ xCap: 10, b: 3 })
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { e1: 5, g01: 5, e2: 0, e3: 3, h01: 3, e4: 2, k1: 5, k2: 5, o1: 10 }, 'moved')
    expectExact(r.after, { a: 95, b: 0, p: 100, r: 98, x: 10 }, 'after')
  })
  it('with b at 100 the second Gate takes exactly 5, not 5.000000001 (no slack)', () => {
    const g = J({ xCap: 10 })
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { e1: 5, g01: 5, e2: 0, e3: 5, h01: 5, e4: 0, k1: 5, k2: 5, o1: 10 }, 'moved')
    expectExact(r.after, { a: 95, b: 95, p: 100, r: 100, x: 10 }, 'after')
  })
  it('an amount that is no power-of-two fraction of a bound (x capped at 14, b at 1)', () => {
    // f = 14 / 80, each Gate carries 7: g1 from g0; h1 1 from h0 and 6 from r
    const g = J({ xCap: 14, b: 1 })
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { e1: 7, g01: 7, e2: 0, e3: 1, h01: 1, e4: 6, k1: 7, k2: 7, o1: 14 }, 'moved')
  })
  it('the second Gate’s supplies cannot cover what the first could carry: the first is smaller (b at 3, r at 1)', () => {
    // h1 can bring 3 + 1 = 4 at most, so C runs at 4 / 40 and g1 carries 4 too
    const g = J({ b: 3 })
    const r = run([pool('a', 100), pool('b', 3), pool('p', 100), pool('r', 1), ...g.nodes.slice(4)], g.edges)
    expectExact(r.moved, { e1: 4, g01: 4, e2: 0, e3: 3, h01: 3, e4: 1, k1: 4, k2: 4, o1: 8 }, 'moved')
  })
})

describe('P3: a `pull all` source Gate under a multi-supply Gate that cannot have its demand zeroes the whole planned group', () => {
  // p ─20→ B ─20→ g ; a ─20→ g ; g ─40→ C ; xP ─40→ X (pull all) ─40→ C ; C ─80→ Q
  const small = (qCap: number) => ({
    nodes: [pool('p', 100), pool('a', 100), pool('xP', 100), conv('B'), gate('g'), gate('X', 'pullAll'), conv('C'), pool('Q', 0, qCap)],
    edges: [res('pB', 'p', 'B', '20'), res('Bg', 'B', 'g', '20'), res('ag', 'a', 'g', '20'), res('gC', 'g', 'C', '40'), res('xX', 'xP', 'X', '40'), res('XC', 'X', 'C', '40'), res('CQ', 'C', 'Q', '80')],
  })
  it('room for 40: X cannot have its 40, nothing moves (was: X was dropped and the rest moved 20)', () => {
    const g = small(40)
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { pB: 0, Bg: 0, ag: 0, gC: 0, xX: 0, XC: 0, CQ: 0 }, 'moved')
    expect(r.gates).toMatchObject({ X: 'held/pullAll', g: 'held/plan' })
  })
  it('control: with room for 80 the same group runs in full', () => {
    const g = small(80)
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { pB: 20, Bg: 20, ag: 20, gC: 40, xX: 40, XC: 40, CQ: 80 }, 'moved')
  })

  // The two readings part here. A second multi-supply Gate g2 hangs on the same
  // source Gate S, with a Pool of its own that owes X nothing:
  //   s ─20→ S ─1→ g , S ─1→ g2          a ─30→ g ; g ─40→ C ; xP ─40→ X (pull all) ─40→ C ; C ─80→ Q
  //                                      b ─10→ g2 ; g2 ─1→ R
  // With room for 40 in Q, X cannot have its 40.
  //   • "only X's piece stops": g, C and X move nothing, S moves nothing (it
  //     cannot send g2 its half without g's), but g2 still takes 10 from b.
  //   • "the whole planned group stops" (the rule): b ─→ g2 moves nothing too.
  const large = (qCap: number) => ({
    nodes: [pool('s', 100), pool('a', 100), pool('b', 100), pool('xP', 100), gate('S'), gate('g'), gate('g2'), gate('X', 'pullAll'), conv('C'), pool('Q', 0, qCap), pool('R', 0)],
    edges: [res('sS', 's', 'S', '20'), res('Sg', 'S', 'g', '1'), res('Sg2', 'S', 'g2', '1'), res('ag', 'a', 'g', '30'), res('gC', 'g', 'C', '40'), res('xX', 'xP', 'X', '40'), res('XC', 'X', 'C', '40'), res('CQ', 'C', 'Q', '80'), res('bg2', 'b', 'g2', '10'), res('g2R', 'g2', 'R', '1')],
  })
  it('a second multi-supply Gate with its own Pool, in the same group: it moves nothing either', () => {
    const g = large(40)
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { sS: 0, Sg: 0, Sg2: 0, ag: 0, gC: 0, xX: 0, XC: 0, CQ: 0, bg2: 0, g2R: 0 }, 'moved')
    expectExact(r.after, { s: 100, a: 100, b: 100, xP: 100, Q: 0, R: 0 }, 'after')
    expect(r.gates).toMatchObject({ X: 'held/pullAll', g: 'held/plan', g2: 'held/plan', S: 'held/plan' })
  })
  it('control: with room for 80 that larger group runs in full, g2 included', () => {
    const g = large(80)
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { sS: 20, Sg: 10, Sg2: 10, ag: 30, gC: 40, xX: 40, XC: 40, CQ: 80, bg2: 10, g2R: 20 }, 'moved')
  })
  it('control: X `pull any` in the larger group with room for 40: everything runs at half, g2 in full', () => {
    const g = large(40)
    const r = run(g.nodes.map((n) => (n.id === 'X' ? gate('X') : n)), g.edges)
    expect(r.moved.CQ).toBeCloseTo(40, 9)
    expect(r.moved.xX).toBeCloseTo(20, 9)
    expect(r.moved.bg2).toBeGreaterThan(0)
  })
})

describe('P6: a source Gate is charged what it pulls', () => {
  // P ─6→ A ─1→ J, A ─1→ X (room 1) ; P ─6→ B ─1→ J ; J ─1→ Q
  const twoIntoJoin = (A: string, B: string) => ({
    nodes: [pool('P', 10), gate(A), gate(B), gate('J'), pool('X', 0, 1), pool('Q', 0)],
    edges: [res('PA', 'P', A, '6'), res('AJ', A, 'J', '1'), res('AX', A, 'X', '1'), res('PB', 'P', B, '6'), res('BJ', B, 'J', '1'), res('JQ', 'J', 'Q', '1')],
  })
  it('the first source Gate is held to 2 by its side Pool, so the second has 8 to take its 6 from (was: 4)', () => {
    const g = twoIntoJoin('A', 'B')
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { PA: 2, AJ: 1, AX: 1, PB: 6, BJ: 6, JQ: 7 }, 'moved')
    expectExact(r.after, { P: 2, X: 1, Q: 7 }, 'after')
  })
  it('with the limited Gate second in the order: the same amounts', () => {
    const g = twoIntoJoin('B2', 'A2') // the limited Gate is now named B2, after A2
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { PA: 2, AJ: 1, AX: 1, PB: 6, BJ: 6, JQ: 7 }, 'moved')
  })
  it('control: a Pool of 7 is shared in the order: the limited Gate first takes 2, the other the 5 left', () => {
    const g = twoIntoJoin('A', 'B')
    const r = run([pool('P', 7), ...g.nodes.slice(1)], g.edges)
    expectExact(r.moved, { PA: 2, AJ: 1, AX: 1, PB: 5, BJ: 5, JQ: 6 }, 'moved')
  })
  it('the fixed priority, seen from the other side: the first supply is filled first even when less moves in all', () => {
    // P = 2 is wanted by A (2) and by B (4). A → J only half of what it takes
    // (the other half to a side Pool with room). The first supply, A, is
    // filled to the most it can carry; B gets what is left. Charged its whole
    // reach, A used to make the plan infeasible for any amount of its own and
    // was given nothing.
    const r = run(
      [pool('P', 2), gate('A'), gate('B'), gate('J'), pool('X', 0), pool('Q', 0)],
      [res('PA', 'P', 'A', '2'), res('AJ', 'A', 'J', '1'), res('AX', 'A', 'X', '1'), res('PB', 'P', 'B', '4'), res('BJ', 'B', 'J', '1'), res('JQ', 'J', 'Q', '1')],
    )
    expectExact(r.moved, { PA: 2, AJ: 1, AX: 1, PB: 0, BJ: 0, JQ: 1 }, 'moved')
  })
})
