import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// Whole-code review of 2026-11-15: the tree plan (SEMANTICS.md §6, erratum
// part 2) with SEVERAL source Gates, a shape no test built. A tree group can
// have more than one Gate fed from its own Pools: two Gates into one Converter.
// The plan walked the first of them only.
//
//   P2  two source Gates of one tree on one Pool. Part 2: "a source Gate's
//       reach from its own Pools, net of the plan's claims on the same Pools",
//       and "each member then moves exactly its planned amounts". Each Gate's
//       reach was read alone, so both were planned at 50 from a Pool of 60;
//       the first took 50, the second 10, and the Converter got 50 and 10.
//   P5  a loop through the SECOND source Gate. Part 2: "an earlier member's
//       take is room a later member's delivery may fill". Only the first
//       source Gate's take was walked, so the result turned on the Gates' ids.

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

describe('tree plan: several source Gates', () => {
  // shared ─50→ g1 ─50→ c ─1→ out ; shared ─50→ g2 ─50→ c
  const twoOnOnePool = (shared: number, mode2: Mode = 'pullAny') => ({
    nodes: [pool('shared', shared), gate('g1'), gate('g2', mode2), conv('c'), pool('out', 0)],
    edges: [res('s1', 'shared', 'g1', '50'), res('s2', 'shared', 'g2', '50'), res('b1', 'g1', 'c', '50'), res('b2', 'g2', 'c', '50'), res('o', 'c', 'out', '1')],
  })
  it('P2: two source Gates on one Pool of 60, both feeding one Converter: 30 + 30 at one fraction 0.6 (was: 50 + 10)', () => {
    const g = twoOnOnePool(60)
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { s1: 30, s2: 30, b1: 30, b2: 30, o: 0.6 }, 'moved')
    expectExact(r.after, { shared: 0, out: 0.6 }, 'after')
  })
  it('P2 control: the Pool holds enough for both (100): 50 + 50, the Converter runs once', () => {
    const g = twoOnOnePool(100)
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { s1: 50, s2: 50, b1: 50, b2: 50, o: 1 }, 'moved')
  })
  it('P2 with the second Gate `pull all`: its demand 50 cannot be had beside the first, so the group moves nothing', () => {
    const g = twoOnOnePool(60, 'pullAll')
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { s1: 0, s2: 0, b1: 0, b2: 0, o: 0 }, 'moved')
    expect(r.gates).toMatchObject({ g2: 'held/pullAll', g1: 'held/plan' })
  })
  it('P2 control: a third Pool line on the second Gate covers its share from both Pools, in their order (unchanged)', () => {
    // g2 also has zextra ─50→ g2 (pulled after `shared`, by the source's id):
    // at s, g1 takes s from shared, g2 takes what shared leaves (60 − s, up
    // to 50) and then zextra. f ≤ 1 bounds s at 50.
    const g = twoOnOnePool(60)
    const r = run([...g.nodes, pool('zextra', 100)], [...g.edges, res('s3', 'zextra', 'g2', '50')])
    expectExact(r.moved, { s1: 50, s2: 10, s3: 40, b1: 50, b2: 50, o: 1 }, 'moved')
  })
  it('P2 with three source Gates on one Pool of 60: 20 each', () => {
    const r = run(
      [pool('shared', 60), gate('g1'), gate('g2'), gate('g3'), conv('c'), pool('out', 0)],
      [res('s1', 'shared', 'g1', '50'), res('s2', 'shared', 'g2', '50'), res('s3', 'shared', 'g3', '50'), res('b1', 'g1', 'c', '50'), res('b2', 'g2', 'c', '50'), res('b3', 'g3', 'c', '50'), res('o', 'c', 'out', '1')],
    )
    expectExact(r.moved, { s1: 20, s2: 20, s3: 20, b1: 20, b2: 20, b3: 20, o: 0.4 }, 'moved')
  })
  it('P2 with the Converter also on that Pool: its claim comes off what the Gates share', () => {
    // c takes 20 per run from shared itself: at s, 20·s/50 + s + s ≤ 60, s = 25
    const g = twoOnOnePool(60)
    const r = run(g.nodes, [...g.edges, res('own', 'shared', 'c', '20')])
    expectExact(r.moved, { s1: 25, s2: 25, b1: 25, b2: 25, own: 10, o: 0.5 }, 'moved')
    expectExact(r.after, { shared: 0, out: 0.5 }, 'after')
  })

  // P full; R ─1→ first ─1→ c ; P ─1→ second ─1→ c ; c ─1→ P
  const loopThroughSecond = (first: string, second: string) => ({
    nodes: [pool('P', 10, 10), pool('R', 10), gate(first), gate(second), conv('c')],
    edges: [res('R1', 'R', first, '1'), res('1c', first, 'c', '1'), res('P2', 'P', second, '1'), res('2c', second, 'c', '1'), res('cP', 'c', 'P', '1')],
  })
  it.each([
    ['the Gate on the full Pool is second in the order (was: nothing moved)', 'a', 'b'],
    ['the Gate on the full Pool is first in the order', 'b', 'a'],
  ])('P5: a loop into a full Pool through a source Gate runs at f = 1 — %s', (_n, first, second) => {
    const g = loopThroughSecond(first, second)
    const r = run(g.nodes, g.edges)
    expectExact(r.moved, { R1: 1, '1c': 1, P2: 1, '2c': 1, cP: 1 }, 'moved')
    expectExact(r.after, { P: 10, R: 9 }, 'after')
  })
  it('P5 control: the Pool the Converter fills is full and NO member takes from it: nothing moves', () => {
    const r = run(
      [pool('P', 10, 10), pool('R', 10), pool('T', 10), gate('a'), gate('b'), conv('c')],
      [res('R1', 'R', 'a', '1'), res('1c', 'a', 'c', '1'), res('T2', 'T', 'b', '1'), res('2c', 'b', 'c', '1'), res('cP', 'c', 'P', '1')],
    )
    expectExact(r.moved, { R1: 0, '1c': 0, T2: 0, '2c': 0, cP: 0 }, 'moved')
  })
  it('P5 with room for half: the second Gate takes 1 from the Pool, the Converter returns 2, so f = 0.5', () => {
    // P 10 of 10.5; b takes f from P, c makes 2·f into P: the level ends at +f ≤ 0.5
    const g = loopThroughSecond('a', 'b')
    const r = run([pool('P', 10, 10.5), ...g.nodes.slice(1)], [...g.edges.slice(0, 4), res('cP', 'c', 'P', '2')])
    expectExact(r.moved, { R1: 0.5, '1c': 0.5, P2: 0.5, '2c': 0.5, cP: 1 }, 'moved')
    expectExact(r.after, { P: 10.5, R: 9.5 }, 'after')
  })
})

// A router OUTSIDE the group that is ordered between the group's first router
// and a source Gate took what the plan counted on that Gate to pull (issue
// #570, found by a sweep of random graphs on 2026-11-15). This file held it as
// a known defect; its repair and its cases are `sourceGateHold.test.ts`. One
// control stays here, the case that never depended on it.
describe('a router outside the group, ordered after it', () => {
  it('control: an outside Converter ordered AFTER the group (z1) gets what the group leaves', () => {
    // the group: a ─1→ c0 ─1→ c3 ; x ─1→ g ─1→ c3 ; c3 ─1→ out.  Outside it: x ─5→ z1 ─1→ y
    const r = run(
      [pool('a', 100), pool('x', 5), pool('y', 0), pool('out', 0), conv('c0'), conv('z1'), gate('g'), conv('c3')],
      [res('a0', 'a', 'c0', '1'), res('03', 'c0', 'c3', '1'), res('xg', 'x', 'g', '1'), res('g3', 'g', 'c3', '1'), res('3o', 'c3', 'out', '1'), res('x1', 'x', 'z1', '5'), res('1y', 'z1', 'y', '1')],
    )
    expectExact(r.moved, { a0: 1, '03': 1, xg: 1, g3: 1, '3o': 1, x1: 4, '1y': 0.8 }, 'moved')
  })
})
