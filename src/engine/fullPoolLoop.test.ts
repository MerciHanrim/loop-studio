import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// KNOWN DEFECT (issue #572), not fixed by the change that added this file
// (found on 2026-11-15 by a sweep of random graphs, seed 5865; it is on main
// as well).
//
// A planned group that returns to a Pool exactly what it takes from it stands
// still when that Pool is exactly FULL. By the spec it runs (SEMANTICS.md §6,
// erratum part 2: "an earlier member's take is room a later member's delivery
// may fill", and the level never passes the room: it stays at 0).
//
// Cause, followed through the plan's own arithmetic: both planners check the
// room along the commit order with no slack (erratum part 4), `level > room`
// with a room of 0. The level is a sum of products of the members'
// coefficients, 0 on paper and about 1e-16 above 0 in floating point. The
// search for the plan's number halves its way down from the top, a halved
// number rounds the same way, so EVERY value it tries fails and it ends at 0.
// With a room of 1e-12 the whole flow passes.
//
// What is asked here holds under any repair: the flow is the one a hair of
// room gives. `it.fails` passes while the defect is there and turns red when
// it is gone: change it to `it` then. A rounding allowance in the comparison
// is NOT the repair (tried and withdrawn: it removes the stall and moves 51
// other random graphs by up to 8e-13, a delivery of exactly 1 into a full
// Pool becoming 1.0000000000000284).

const P0 = { x: 0, y: 0 }
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({ id, type: 'pool', position: P0, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } })
const conv = (id: string): LoopNode => ({ id, type: 'converter', position: P0, data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny' } })
const gate = (id: string, mode: 'pullAny' | 'pullAll' = 'pullAny'): LoopNode => ({ id, type: 'gate', position: P0, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'] })
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })

function moved(nodes: LoopNode[], edges: LoopEdge[]) {
  const r = step(nodes, edges, initSim(nodes), 1, 2)
  const m: Record<string, number> = {}
  for (const e of edges) m[e.id] = 0
  for (const ev of r.report.events) m[ev.edgeId] = (m[ev.edgeId] ?? 0) + ev.amount
  return { m, after: r.state.values }
}
const close = (got: Record<string, number>, want: Record<string, number>) => {
  for (const k of Object.keys(want)) expect(Math.abs(got[k] - want[k]), `${k}: ${got[k]} against ${want[k]}`).toBeLessThan(1e-9)
}

describe('KNOWN DEFECT (#572): a group that returns to an exactly full Pool what it takes from it stands still', () => {
  // the tree plan, three nodes: P ─3→ g ; g ─1→ c , g ─6→ P ; c ─1→ P.
  // g returns six sevenths of what it takes at once, c the last seventh.
  const tree = (cap: number) => ({
    nodes: [pool('P', 10, cap), gate('g'), conv('c')],
    edges: [res('Pg', 'P', 'g', '3'), res('gc', 'g', 'c', '1'), res('gP', 'g', 'P', '6'), res('cP', 'c', 'P', '1')],
  })
  const treeFlow = { Pg: 3, gc: 3 / 7, gP: 18 / 7, cP: 3 / 7 }
  it('tree plan, with a room of 1e-12 in P: 3 flows round', () => {
    const g = tree(10 + 1e-12)
    close(moved(g.nodes, g.edges).m, treeFlow)
  })
  it.fails('tree plan, P exactly full: the same 3 flows round (today: nothing moves)', () => {
    const g = tree(10)
    close(moved(g.nodes, g.edges).m, treeFlow)
  })
  it('tree plan, P exactly full, what it does today, so that a change is seen: nothing moves', () => {
    const g = tree(10)
    expect(moved(g.nodes, g.edges).m).toEqual({ Pg: 0, gc: 0, gP: 0, cP: 0 })
  })
  it('control: the Converter returns MORE than its share (2 for 1), a real net inflow: nothing moves, full or not by a hair', () => {
    for (const cap of [10, 10 + 1e-12]) {
      const g = tree(cap)
      const edges = g.edges.map((e) => (e.id === 'cP' ? res('cP', 'c', 'P', '2') : e))
      close(moved(g.nodes, edges).m, { Pg: 0, gc: 0, gP: 0, cP: 0 })
    }
  })

  // the multi-supply plan: the graph of sweep seed 5865, started in the state
  // it stood still in. p1 is full; g0 and g2 take from it (p0 is empty, so g2
  // pulls from p1 first) and c4 and g3 return to it. For g0's throughput T up
  // to 30/7 the takes are T and 7T/15, the returns T and 7T/15.
  const seed5865 = (cap: number) => ({
    nodes: [pool('p0', 0), pool('p1', 19, cap), pool('p2', 40 / 7), pool('p3', 47 / 7), gate('g0'), gate('g1', 'pullAll'), gate('g2'), gate('g3'), conv('c4')],
    edges: [res('e0', 'p1', 'g0', '7'), res('e1', 'p2', 'g0', '4'), res('e2', 'g0', 'g1', '5'), res('e3', 'p0', 'g2', '7'), res('e4', 'p2', 'g2', '5'), res('e5', 'p1', 'g2', '2'), res('e6', 'g0', 'g3', '7'), res('e7', 'g2', 'g3', '5'), res('e8', 'g0', 'c4', '3'), res('e9', 'g2', 'c4', '2'), res('e10', 'g1', 'p3', '4'), res('e11', 'g1', 'p3', '2'), res('e12', 'g3', 'p1', '7'), res('e13', 'g3', 'p2', '5'), res('e14', 'c4', 'p1', '8'), res('e15', 'c4', 'p1', '7')],
  })
  const flow5865 = { e0: 30 / 7, e1: 0, e2: 10 / 7, e3: 0, e4: 0, e5: 2, e6: 2, e7: 10 / 7, e8: 6 / 7, e9: 4 / 7, e10: 20 / 21, e11: 10 / 21, e12: 2, e13: 10 / 7, e14: 16 / 7, e15: 2 }
  it('multi-supply plan, with a room of 1e-12 in p1: the group runs at g0 = 30/7', () => {
    const g = seed5865(19 + 1e-12)
    close(moved(g.nodes, g.edges).m, flow5865)
  })
  it.fails('multi-supply plan, p1 exactly full: the same flow (today: nothing moves)', () => {
    const g = seed5865(19)
    close(moved(g.nodes, g.edges).m, flow5865)
  })
  it('multi-supply plan, p1 exactly full, what it does today: nothing moves', () => {
    const g = seed5865(19)
    const r = moved(g.nodes, g.edges)
    expect(Object.values(r.m).every((v) => v === 0)).toBe(true)
    expect(r.after.p1).toBe(19)
  })
})
