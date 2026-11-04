import { describe, expect, it } from 'vitest'
import type { GateDistribution, LoopEdge, LoopNode } from '../model/types'
import { converterGroups } from './converterGroups'
import { initSim, step } from './index'

// #492 — a plain tree of routers (no group: no router-fed Converter, no Gate
// with two supplies, no rejoin) whose branches reach one capped Pool by two or
// more paths (SEMANTICS.md §6 erratum, part 5; ENGINE_REVISION 6). Each branch
// read the Pool's whole room, so the first router sent more than the Pool could
// take; its reservations passed the room, the Gates below were handed amounts
// they could not deliver, and those amounts were gone at the end of the step
// with only the held notice to say so. The router that sizes the tree now
// bounds what it moves by each shared Pool's room over the path-summed share.
//
// The numbers are hand-derived: `s` is the smallest of the room over the Pool's
// share of a unit at the root, and every connection is `s` times its share.
// Each case is one step and pins every connection, every Pool, every Gate's
// status and no notice, to 1e-12.

const P = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const pushing = (id: string, initial: number): LoopNode => ({
  id, type: 'pool', position: P,
  data: { kind: 'pool', label: id, activation: 'automatic', initial, capacity: null, mode: 'pushAny' },
})
const gate = (id: string, mode: Mode = 'pullAny', distribution: GateDistribution = 'deterministic'): LoopNode => ({
  id, type: 'gate', position: P,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution, mode },
})
const conv = (id: string): LoopNode => ({
  id, type: 'converter', position: P,
  data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny' },
})
const drain = (id: string): LoopNode => ({
  id, type: 'drain', position: P,
  data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' },
})
const res = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in',
  data: { kind: 'resource', flow },
})

/** "p 4, sa 16/3" → { p: 4, sa: 5.333… } */
const nums = (s: string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [k, v] = part.split(/\s+/)
    const [a, b] = v.split('/')
    out[k] = b === undefined ? Number(a) : Number(a) / Number(b)
  }
  return out
}
/** "S partial/room 10 10 4; a held/plan 5 5 0" → per Gate: state, why, demand, available, moved */
const statuses = (s: string) =>
  Object.fromEntries(
    s.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
      const [id, sw, d, a, m] = x.split(/\s+/)
      const [state, why] = sw.split('/')
      return [id, { state, why, demand: Number(d), available: Number(a), moved: Number(m) }]
    }),
  )

type Case = { name: string; nodes: LoopNode[]; edges: LoopEdge[]; moved: string; pools: string; gates: string }

// the issue's tree: G0 → G1, G2 (3 : 3), both → T
const split = [res('g1', 'G0', 'G1', '3'), res('g2', 'G0', 'G2', '3'), res('t1', 'G1', 'T', '5'), res('t2', 'G2', 'T', '3')]
const tree = (T: LoopNode, G0 = gate('G0'), G1 = gate('G1')) => ({
  nodes: [pool('P', 100), T, G0, G1, gate('G2')],
  edges: [res('p', 'P', 'G0', '6'), ...split],
})
const half = '3 3 1'

const cases: Case[] = [
  { name: 'A1 the issue: G0 → G1, G2 → T room 2 (main: 4 lost, T 0)', ...tree(pool('T', 0, 2)),
    moved: 'p 2, g1 1, g2 1, t1 1, t2 1', pools: 'P 98, T 2',
    gates: `G0 partial/room 6 6 2; G1 partial/room ${half}; G2 partial/room ${half}` },
  { name: 'A2 nothing short: the tree moves in full, as on main', ...tree(pool('T', 0, 8)),
    moved: 'p 6, g1 3, g2 3, t1 3, t2 3', pools: 'P 94, T 6',
    gates: 'G0 full 6 6 6; G1 full 3 3 3; G2 full 3 3 3' },
  { name: 'A3 split 2 : 1, T room 3 (main: 3 lost, T 1.5)',
    nodes: [pool('P', 100), pool('T', 0, 3), gate('G0'), gate('G1'), gate('G2')],
    edges: [res('p', 'P', 'G0', '6'), res('g1', 'G0', 'G1', '2'), res('g2', 'G0', 'G2', '1'), res('t1', 'G1', 'T', '1'), res('t2', 'G2', 'T', '1')],
    moved: 'p 3, g1 2, g2 1, t1 2, t2 1', pools: 'P 97, T 3',
    gates: 'G0 partial/room 6 6 3; G1 partial/room 4 4 2; G2 partial/room 2 2 1' },
  { name: 'A4 G2 also feeds X 1 : 1, T room 3: T\'s share is ¾ (main: 4.5 lost)',
    nodes: [pool('P', 100), pool('T', 0, 3), pool('X', 0), gate('G0'), gate('G1'), gate('G2')],
    edges: [res('p', 'P', 'G0', '8'), res('g1', 'G0', 'G1', '1'), res('g2', 'G0', 'G2', '1'), res('t1', 'G1', 'T', '1'), res('t2', 'G2', 'T', '1'), res('x', 'G2', 'X', '1')],
    moved: 'p 4, g1 2, g2 2, t1 2, t2 1, x 1', pools: 'P 96, T 3, X 1',
    gates: 'G0 partial/room 8 8 4; G1 partial/room 4 4 2; G2 partial/room 4 4 2' },
  { name: 'A5 three paths at two depths: G0 → G1 → G3, G4 → T and G0 → G2 → T, T room 3 (main: 6 lost)',
    nodes: [pool('P', 100), pool('T', 0, 3), gate('G0'), gate('G1'), gate('G2'), gate('G3'), gate('G4')],
    edges: [res('p', 'P', 'G0', '8'), res('g1', 'G0', 'G1', '1'), res('g2', 'G0', 'G2', '1'), res('g3', 'G1', 'G3', '1'), res('g4', 'G1', 'G4', '1'), res('t3', 'G3', 'T', '1'), res('t4', 'G4', 'T', '1'), res('t2', 'G2', 'T', '1')],
    moved: 'p 3, g1 1.5, g2 1.5, g3 0.75, g4 0.75, t3 0.75, t4 0.75, t2 1.5', pools: 'P 97, T 3',
    gates: 'G0 partial/room 8 8 3; G1 partial/room 4 4 1.5; G2 partial/room 4 4 1.5; G3 partial/room 2 2 0.75; G4 partial/room 2 2 0.75' },
  { name: 'A6 mixed depth: G0 → T and G0 → G1 → T, T room 2 (main: 2 lost)',
    nodes: [pool('P', 100), pool('T', 0, 2), gate('G0'), gate('G1')],
    edges: [res('p', 'P', 'G0', '6'), res('t0', 'G0', 'T', '1'), res('g1', 'G0', 'G1', '1'), res('t1', 'G1', 'T', '1')],
    moved: 'p 2, t0 1, g1 1, t1 1', pools: 'P 98, T 2',
    gates: `G0 partial/room 6 6 2; G1 partial/room ${half}` },
  { name: 'A7 a Drain beside the tree: T\'s share is ⅔ (main: 4 lost)',
    nodes: [pool('P', 100), pool('T', 0, 2), gate('G0'), gate('G1'), gate('G2'), drain('D')],
    edges: [res('p', 'P', 'G0', '9'), ...split, res('d', 'G0', 'D', '3')],
    moved: 'p 3, g1 1, g2 1, t1 1, t2 1, d 1', pools: 'P 97, T 2',
    gates: `G0 partial/room 9 9 3; G1 partial/room ${half}; G2 partial/room ${half}` },
  { name: 'A8 the room is the capacity less what T holds: T 1 of 3 (main: 4 lost)', ...tree(pool('T', 1, 3)),
    moved: 'p 2, g1 1, g2 1, t1 1, t2 1', pools: 'P 98, T 3',
    gates: `G0 partial/room 6 6 2; G1 partial/room ${half}; G2 partial/room ${half}` },
  { name: 'A9 T already full: nothing moves, as on main', ...tree(pool('T', 2, 2)),
    moved: 'p 0, g1 0, g2 0, t1 0, t2 0', pools: 'P 100, T 2',
    gates: 'G0 held/room 6 6 0; G1 held/room 3 3 0; G2 held/room 3 3 0' },
  { name: 'A10 two shared Pools: the smaller bound holds, U room 1 (main: 4 lost)',
    nodes: [pool('P', 100), pool('T', 0, 2), pool('U', 0, 1), gate('G0'), gate('G1'), gate('G2')],
    edges: [res('p', 'P', 'G0', '8'), res('g1', 'G0', 'G1', '1'), res('g2', 'G0', 'G2', '1'), res('a', 'G1', 'T', '1'), res('b', 'G1', 'U', '1'), res('c', 'G2', 'T', '1'), res('d', 'G2', 'U', '1')],
    moved: 'p 2, g1 1, g2 1, a 0.5, b 0.5, c 0.5, d 0.5', pools: 'P 98, T 1, U 1',
    gates: 'G0 partial/room 8 8 2; G1 partial/room 4 4 1; G2 partial/room 4 4 1' },
  { name: 'A11 control, no shared Pool: each branch bounds the tree, as on main',
    nodes: [pool('P', 100), pool('T', 0, 2), pool('U', 0, 9), gate('G0'), gate('G1'), gate('G2')],
    edges: [res('p', 'P', 'G0', '6'), res('g1', 'G0', 'G1', '3'), res('g2', 'G0', 'G2', '3'), res('t1', 'G1', 'T', '1'), res('u', 'G2', 'U', '1')],
    moved: 'p 4, g1 2, g2 2, t1 2, u 2', pools: 'P 96, T 2, U 2',
    gates: 'G0 partial/room 6 6 4; G1 partial/room 3 3 2; G2 partial/room 3 3 2' },
  { name: 'B1 a `pull all` root that cannot reach its demand moves nothing, as on main', ...tree(pool('T', 0, 2), gate('G0', 'pullAll')),
    moved: 'p 0, g1 0, g2 0, t1 0, t2 0', pools: 'P 100, T 0',
    gates: 'G0 held/room 6 6 0; G1 held/room 3 3 0; G2 held/room 3 3 0' },
  { name: 'B2 a `pull all` Gate below the root takes what it is handed (main: 4 lost)', ...tree(pool('T', 0, 2), gate('G0'), gate('G1', 'pullAll')),
    moved: 'p 2, g1 1, g2 1, t1 1, t2 1', pools: 'P 98, T 2',
    gates: `G0 partial/room 6 6 2; G1 partial/room ${half}; G2 partial/room ${half}` },
  { name: 'B3 a `pull all` root with room moves in full, as on main', ...tree(pool('T', 0, 8), gate('G0', 'pullAll')),
    moved: 'p 6, g1 3, g2 3, t1 3, t2 3', pools: 'P 94, T 6',
    gates: 'G0 full 6 6 6; G1 full 3 3 3; G2 full 3 3 3' },
  { name: 'C1 a probabilistic root: one branch live, no shared path, as on main', ...tree(pool('T', 0, 2), gate('G0', 'pullAny', 'probabilistic')),
    moved: 'p 2, g1 2, g2 0, t1 2, t2 0', pools: 'P 98, T 2',
    gates: 'G0 partial/room 6 6 2; G1 partial/room 6 6 2; G2 idle 0 0 0' },
  { name: 'C2 a probabilistic Gate in the tree: its picked branch is the path (main: 4 lost)',
    nodes: [pool('P', 100), pool('T', 0, 2), pool('X', 0), gate('G0'), gate('G1'), gate('G2', 'pullAny', 'probabilistic')],
    edges: [res('p', 'P', 'G0', '6'), res('g1', 'G0', 'G1', '1'), res('g2', 'G0', 'G2', '1'), res('t1', 'G1', 'T', '1'), res('t2', 'G2', 'T', '1'), res('x', 'G2', 'X', '1')],
    moved: 'p 2, g1 1, g2 1, t1 1, t2 1, x 0', pools: 'P 98, T 2, X 0',
    gates: `G0 partial/room 6 6 2; G1 partial/room ${half}; G2 partial/room ${half}` },
  { name: 'D1 a Converter root: C → G1, G2 → T room 2 (main: 4 lost)',
    nodes: [pool('P', 100), pool('T', 0, 2), conv('C'), gate('G1'), gate('G2')],
    edges: [res('p', 'P', 'C', '6'), res('g1', 'C', 'G1', '3'), res('g2', 'C', 'G2', '3'), res('t1', 'G1', 'T', '1'), res('t2', 'G2', 'T', '1')],
    moved: 'p 2, g1 1, g2 1, t1 1, t2 1', pools: 'P 98, T 2',
    gates: `G1 partial/room ${half}; G2 partial/room ${half}` },
  { name: 'D2 a Converter into T directly and through a Gate, T room 2 (main: 2 lost)',
    nodes: [pool('P', 100), pool('T', 0, 2), conv('C'), gate('G1')],
    edges: [res('p', 'P', 'C', '6'), res('t0', 'C', 'T', '3'), res('g1', 'C', 'G1', '3'), res('t1', 'G1', 'T', '1')],
    moved: 'p 2, t0 1, g1 1, t1 1', pools: 'P 98, T 2',
    gates: `G1 partial/room ${half}` },
  { name: 'E2 a pushing Pool at the root (main: 4 lost)',
    nodes: [pushing('P', 100), pool('T', 0, 2), gate('G0'), gate('G1'), gate('G2')],
    edges: [res('p', 'P', 'G0', '6'), ...split],
    moved: 'p 2, g1 1, g2 1, t1 1, t2 1', pools: 'P 98, T 2',
    gates: `G0 partial/room 6 6 2; G1 partial/room ${half}; G2 partial/room ${half}` },
  { name: 'E3 an outside router between a chain\'s Gates sees each amount reserved once (main: reserved twice, T stopped at 4 with room left)',
    nodes: [pool('P', 100), pool('Q', 100), pool('T', 0, 6), gate('a0'), gate('a1'), gate('m'), gate('z')],
    edges: [res('p', 'P', 'a0', '2'), res('e1', 'a0', 'a1', '1'), res('e2', 'a1', 'z', '1'), res('t', 'z', 'T', '1'), res('q', 'Q', 'm', '5'), res('mt', 'm', 'T', '1')],
    moved: 'p 2, e1 2, e2 2, t 2, q 4, mt 4', pools: 'P 98, Q 96, T 6',
    gates: 'a0 full 2 2 2; a1 full 2 2 2; z full 2 2 2; m partial/room 5 5 4' },
  { name: 'F1 the #491 seed-38 live graph: a `pull all` root whose demand no longer fits moves nothing (main: 3 lost)',
    nodes: [pool('P0', 16), pool('T1', 0), pool('T2', 0, 2), gate('G0', 'pullAll'), gate('G1'), gate('G2'), gate('G3', 'pullAll'), gate('G4')],
    edges: [res('e0', 'P0', 'G0', '5'), res('e1', 'G0', 'G1', '3'), res('e2', 'G0', 'G2', '3'), res('e7', 'G0', 'T1', '3'), res('e3', 'G1', 'G3', '5'), res('e5', 'G1', 'G3', '1'), res('e8', 'G1', 'T2', '5'), res('e9', 'G2', 'T2', '3'), res('e6', 'G3', 'G4', '3'), res('e10', 'G4', 'T2', '1')],
    moved: 'e0 0, e1 0, e2 0, e7 0, e3 0, e5 0, e8 0, e9 0, e6 0, e10 0', pools: 'P0 16, T1 0, T2 0',
    gates: 'G0 held/room 5 5 0; G1 held/room 1.666667 1.666667 0; G2 held/room 1.666667 1.666667 0; G3 held/room 0.909091 0.909091 0; G4 held/room 0.909091 0.909091 0' },
]

const TIGHT = 1e-12

function run(c: Case) {
  const before = initSim(c.nodes)
  const r = step(c.nodes, c.edges, before, 1, 2)
  const moved: Record<string, number> = {}
  for (const e of c.edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  return { before: before.values, after: r.state.values, moved, report: r.report }
}

describe('a plain tree of routers shares a capped Pool it reaches by two paths (#492, ENGINE_REVISION 6)', () => {
  for (const c of cases) {
    it(c.name, () => {
      // the shape is outside every group: the per-router path runs it
      expect(converterGroups(c.nodes, c.edges)).toEqual([])
      const r = run(c)
      for (const [k, v] of Object.entries(nums(c.moved))) expect(Math.abs(r.moved[k] - v), `connection ${k}: ${r.moved[k]} vs ${v}`).toBeLessThanOrEqual(TIGHT)
      const pools = nums(c.pools)
      for (const [k, v] of Object.entries(pools)) expect(Math.abs(r.after[k] - v), `Pool ${k}: ${r.after[k]} vs ${v}`).toBeLessThanOrEqual(TIGHT)
      expect(Object.keys(nums(c.moved)).sort()).toEqual(c.edges.map((e) => e.id).sort())
      expect(Object.keys(pools).sort()).toEqual(c.nodes.filter((n) => n.data.kind === 'pool').map((n) => n.id).sort())
      expect(r.report.notices).toEqual([])
      expect(r.report.diagnostics).toEqual([])
      for (const n of c.nodes) {
        const inflow = c.edges.filter((e) => e.target === n.id).reduce((t, e) => t + r.moved[e.id], 0)
        const outflow = c.edges.filter((e) => e.source === n.id).reduce((t, e) => t + r.moved[e.id], 0)
        if (n.data.kind === 'pool') {
          // each Pool's change is its events, and no event passes the room
          expect(Math.abs(r.after[n.id] - r.before[n.id] - (inflow - outflow)), `Pool ${n.id} change vs its events`).toBeLessThanOrEqual(TIGHT)
          const cap = (n.data as { capacity?: number | null }).capacity
          if (cap != null) expect(r.before[n.id] + inflow - outflow, `Pool ${n.id} events vs its room`).toBeLessThanOrEqual(cap + TIGHT)
        }
        // a Gate passes on what it took; these Converters' recipes lose nothing
        if (n.data.kind === 'gate' || n.data.kind === 'converter') expect(Math.abs(inflow - outflow), `${n.id} in ${inflow} vs out ${outflow}`).toBeLessThanOrEqual(TIGHT)
      }
      const want = statuses(c.gates)
      const got = Object.fromEntries(r.report.gates.map((g) => [g.nodeId, g]))
      expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort())
      for (const [id, w] of Object.entries(want)) {
        const g = got[id]
        expect(`${g.state}/${g.why ?? ''}`, `Gate ${id}`).toBe(`${w.state}/${w.why ?? ''}`)
        expect([g.demand, g.available, g.moved], `Gate ${id} demand, available, moved`).toEqual([w.demand, w.available, w.moved])
        expect(g.held, `Gate ${id} holds nothing`).toBeUndefined()
      }
    })
  }

  it('over several steps the Pool fills to its capacity and the total is kept to the last step', () => {
    const { nodes, edges } = tree(pool('T', 0, 5))
    let st = initSim(nodes)
    const seen: number[] = []
    for (let t = 0; t < 4; t++) {
      const r = step(nodes, edges, st, 1, 2)
      st = r.state
      expect(r.report.notices).toEqual([])
      expect(Math.abs(st.values.P + st.values.T - 100)).toBeLessThanOrEqual(TIGHT)
      seen.push(st.values.T)
    }
    expect(seen).toEqual([5, 5, 5, 5])
  })
})
