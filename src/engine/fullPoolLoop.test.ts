import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// Issue #572 (found on 2026-11-15 by a sweep of random graphs, seed 5865).
//
// A planned group that returns to a Pool exactly what it takes from it stood
// still when that Pool was exactly FULL. By the spec it runs (SEMANTICS.md §6,
// erratum part 2: "an earlier member's take is room a later member's delivery
// may fill"; the level stays at 0 and never passes the room).
//
// Cause: both planners check the room along the commit order with no slack
// (erratum part 4), `level > room` with a room of 0. The level is a sum of
// products of the members' coefficients, 0 on paper and about 1e-16 of the
// flow above 0 in floating point. The search for the plan's number halves its
// way down from the top, a halved number rounds the same way, so EVERY value
// it tried failed and it ended at 0, while a room of 1e-12 let all of it by.
//
// The repair is not a tolerance (tried and withdrawn: a search walks into it,
// and a delivery of exactly 1 into a full Pool became 1.0000000000000284). A
// level past its room is let through only when it is exactly proportional to
// the number under search, at half and at a quarter of it, and no larger than
// the rounding of the flow that moves with that number (erratum part 9). The
// second half of this file is what that must NOT do: pass a real bound.

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
  return { m, before: state.values, after: r.state.values, state: r.state }
}
const close = (got: Record<string, number>, want: Record<string, number>, within = 1e-12) => {
  for (const k of Object.keys(want)) expect(Math.abs(got[k] - want[k]), `${k}: ${got[k]} against ${want[k]}`).toBeLessThan(within)
}
/** How far the step's events put a capped Pool past its capacity, in units of
 *  the rounding of what went through it: `Number.EPSILON × (capacity +
 *  everything in and out)`. 0 when the Pool is not past its capacity. Summing
 *  the events is itself good to about one such unit; a tolerance in the plan
 *  shows as tens of them (the withdrawn one: 64). */
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

describe('a planned group that returns to an exactly full Pool what it takes from it runs (#572)', () => {
  // the tree plan, three nodes: P ─want→ g ; g ─a→ c , g ─b→ P ; c ─out→ P
  // (c takes `a` per run). With out = a the Gate and the Converter return
  // between them exactly what the Gate takes.
  const tree = (o: { want?: string; a?: string; b?: string; out?: string; held?: number; cap: number }): Graph => ({
    nodes: [pool('P', o.held ?? 10, o.cap), gate('g'), conv('c')],
    edges: [res('Pg', 'P', 'g', o.want ?? '3'), res('gc', 'g', 'c', o.a ?? '1'), res('gP', 'g', 'P', o.b ?? '6'), res('cP', 'c', 'P', o.out ?? o.a ?? '1')],
  })
  it('tree plan, P exactly full: 3 flows round, six sevenths by the Gate and one by the Converter (was: nothing moved)', () => {
    const g = tree({ cap: 10 })
    const r = one(g)
    close(r.m, { Pg: 3, gc: 3 / 7, gP: 18 / 7, cP: 3 / 7 })
    expect(r.after.P).toBe(10)
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })
  it('tree plan: the same flow with P exactly full, with a room of 1e-12 and with a room of 1 (it was 0, 3 and 3)', () => {
    for (const cap of [10, 10 + 1e-12, 11]) close(one(tree({ cap })).m, { Pg: 3, gc: 3 / 7, gP: 18 / 7, cP: 3 / 7 })
  })
  it('tree plan, another split and Pool (3 : 7, 2.2 of a Pool full at 19)', () => {
    const g = tree({ want: '2.2', a: '3', b: '7', held: 19, cap: 19 })
    const r = one(g)
    close(r.m, { Pg: 2.2, gc: 0.66, gP: 1.54, cP: 0.66 })
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })
  it('tree plan, it keeps running: ten steps on the full Pool move 3 each', () => {
    const g = tree({ cap: 10 })
    let st = initSim(g.nodes)
    for (let i = 0; i < 10; i++) {
      const r = one(g, st)
      close(r.m, { Pg: 3 }, 1e-9)
      expect(r.after.P).toBe(10)
      st = r.state
    }
  })

  // the multi-supply plan: the graph of sweep seed 5865, started in the state
  // it stood still in. p1 is full; g0 and g2 take from it (p0 is empty, so g2
  // pulls from p1 first) and c4 and g3 return to it. For g0's throughput T up
  // to 30/7 the takes are T and 7T/15, the returns T and 7T/15. Past 30/7, g2's
  // line off p1 brings its full 2 and the rest comes from p2: a real inflow.
  const seed5865 = (full: number, cap: number): Graph => ({
    nodes: [pool('p0', 0), pool('p1', full, cap), pool('p2', 40 / 7), pool('p3', 47 / 7), gate('g0'), gate('g1', 'pullAll'), gate('g2'), gate('g3'), conv('c4')],
    edges: [res('e0', 'p1', 'g0', '7'), res('e1', 'p2', 'g0', '4'), res('e2', 'g0', 'g1', '5'), res('e3', 'p0', 'g2', '7'), res('e4', 'p2', 'g2', '5'), res('e5', 'p1', 'g2', '2'), res('e6', 'g0', 'g3', '7'), res('e7', 'g2', 'g3', '5'), res('e8', 'g0', 'c4', '3'), res('e9', 'g2', 'c4', '2'), res('e10', 'g1', 'p3', '4'), res('e11', 'g1', 'p3', '2'), res('e12', 'g3', 'p1', '7'), res('e13', 'g3', 'p2', '5'), res('e14', 'c4', 'p1', '8'), res('e15', 'c4', 'p1', '7')],
  })
  const flow5865 = { e0: 30 / 7, e1: 0, e2: 10 / 7, e3: 0, e4: 0, e5: 2, e6: 2, e7: 10 / 7, e8: 6 / 7, e9: 4 / 7, e10: 20 / 21, e11: 10 / 21, e12: 2, e13: 10 / 7, e14: 16 / 7, e15: 2 }
  it.each([[19], [20], [16], [100]])('multi-supply plan, p1 full at %d: the group runs at g0 = 30/7 (was: nothing moved)', (full) => {
    const g = seed5865(full, full)
    const r = one(g)
    close(r.m, flow5865)
    expect(r.after.p1).toBe(full)
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })
  it('multi-supply plan: it stops at the end of the range, where g2’s line off p1 brings its full 2, and takes nothing from p2', () => {
    const r = one(seed5865(19, 19))
    expect(r.m.e5).toBe(2)
    expect(r.m.e4).toBe(0)
  })
  it('multi-supply plan: the same flow whether p1 is exactly full or has a room of 1e-12 (it was 0 against 4.29)', () => {
    const full = one(seed5865(19, 19))
    const hair = one(seed5865(19, 19 + 1e-12))
    close(full.m, hair.m, 1e-9)
  })
})

describe('…and no real bound is passed by it', () => {
  const tree = (o: { out: string; cap: number }): Graph => ({
    nodes: [pool('P', 10, o.cap), gate('g'), conv('c')],
    edges: [res('Pg', 'P', 'g', '3'), res('gc', 'g', 'c', '1'), res('gP', 'g', 'P', '6'), res('cP', 'c', 'P', o.out)],
  })
  it('the Converter returns MORE than its share (2 for 1): a real net inflow into a full Pool, nothing moves', () => {
    close(one(tree({ out: '2', cap: 10 })).m, { Pg: 0, gc: 0, gP: 0, cP: 0 })
  })
  it('a net inflow of one part in a million is still an inflow: nothing moves', () => {
    close(one(tree({ out: '1.000001', cap: 10 })).m, { Pg: 0, gc: 0, gP: 0, cP: 0 })
  })
  it('a net inflow of one part in 10^12 is still an inflow: nothing moves', () => {
    close(one(tree({ out: '1.000000000001', cap: 10 })).m, { Pg: 0, gc: 0, gP: 0, cP: 0 })
  })
  it('with a real room the bound is met exactly (room 0.25, a net inflow of a seventh: 1.75 flows)', () => {
    const g = tree({ out: '2', cap: 10.25 })
    const r = one(g)
    close(r.m, { Pg: 1.75, gc: 0.25, gP: 1.5, cP: 0.5 })
    expect(r.after.P).toBe(10.25)
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })
  it('a balanced loop whose Gate has a second Pool: it stops where the first line is used up, and the second brings nothing', () => {
    // P full ─3→ g, R ─5→ g: up to 3 the group returns what it takes from P;
    // anything g took from R would be a net inflow into P.
    const g: Graph = {
      nodes: [pool('P', 10, 10), pool('R', 100), gate('g'), conv('c')],
      edges: [res('Pg', 'P', 'g', '3'), res('Rg', 'R', 'g', '5'), res('gc', 'g', 'c', '1'), res('gP', 'g', 'P', '6'), res('cP', 'c', 'P', '1')],
    }
    const r = one(g)
    expect(r.m.Rg).toBe(0)
    close(r.m, { Pg: 3, gc: 3 / 7, gP: 18 / 7, cP: 3 / 7 })
    expect(r.after).toEqual({ P: 10, R: 100 })
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })

  // The generator of the sweep that found all this (a 32-bit linear
  // congruential generator; routers with one to three Pool lines, Pools
  // shared, Gates and Converters joined, a third of the Pools capped and one in
  // nine of those full).
  function build(seed0: number): Graph {
    let seed = seed0 >>> 0
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    const nodes: LoopNode[] = []
    const edges: LoopEdge[] = []
    const nPools = int(2, 5)
    for (let i = 0; i < nPools; i++) {
      const initial = int(0, 14)
      nodes.push(pool(`p${i}`, initial, rnd() < 0.35 ? initial + int(0, 8) : null))
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
    let n = 0
    const add = (s: string, t: string) => edges.push(res(`e${n++}`, s, t, String(int(1, 8))))
    routers.forEach((r, i) => {
      const fromRouters = routers.slice(0, i).filter(() => rnd() < 0.45)
      for (const u of fromRouters) add(u, r)
      const lines = fromRouters.length === 0 ? int(1, 3) : int(0, 2)
      for (let k = 0; k < lines; k++) add(`p${int(0, nPools - 1)}`, r)
    })
    for (const r of routers) {
      const outs = edges.some((e) => e.source === r) ? int(0, 1) : int(1, 2)
      for (let k = 0; k < outs; k++) add(r, `p${int(0, nPools - 1)}`)
    }
    return { nodes, edges }
  }

  it('sweep seed 1107: a Gate takes 1 from a full Pool and another delivers into it: exactly 1, not 1.0000000000000284', () => {
    // g2 pulls 1 from p3 (9 of 9), g4 delivers eight elevenths of its
    // throughput into p3: the level passes 0 at ONE point, a real bound. With a
    // tolerance in the comparison the search stopped one tolerance past it.
    const g = build(1107)
    const r = one(g)
    expect(r.m.e6, 'what g2 takes from p3').toBe(1)
    expect(r.m.e17, 'what g4 delivers into p3').toBe(1)
    expect(r.m.e10).toBe(1.25)
    expect(pastCapacity(g, r)).toBeLessThanOrEqual(1)
  })
  it('sweep seed 1839, three steps: a real inflow beside large fixed amounts is not let through as their rounding', () => {
    // at step 3 a supply's contribution to the full Pool p3 is proportional to
    // the number under search and real. Measured against the whole flow
    // through p3 it passed as rounding, 2.8e-14 past the Pool's capacity.
    const g = build(1839)
    let st = initSim(g.nodes)
    for (let i = 0; i < 3; i++) {
      const r = one(g, st)
      expect(pastCapacity(g, r), `step ${i + 1}`).toBeLessThanOrEqual(1)
      st = r.state
    }
  })
  it('sweep: over 2,000 random graphs and three steps each, no capped Pool is put past its capacity by more than the rounding of its own flow', () => {
    let worst = 0
    let ran = 0
    for (let seed = 1000; seed < 3000; seed++) {
      const g = build(seed)
      let st = initSim(g.nodes)
      for (let i = 0; i < 3; i++) {
        const r = one(g, st)
        st = r.state
        const past = pastCapacity(g, r)
        if (past > worst) worst = past
        expect(past, `seed ${seed}, step ${i + 1}`).toBeLessThanOrEqual(1)
      }
      ran++
    }
    expect(ran).toBe(2000)
    // measured on 2026-11-15: 0.48 with the repair, 0.48 before it, 64 with the withdrawn tolerance
    expect(worst).toBeLessThan(1)
  })
})
