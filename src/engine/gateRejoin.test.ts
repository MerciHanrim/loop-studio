import { describe, expect, it } from 'vitest'
import type { GateDistribution, LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// #471 — a group of Gates only that splits and rejoins (SEMANTICS.md §6
// erratum, part 4; ENGINE_REVISION 5). The design is the QA record
// gate-rejoin-design.md rev 2 (Lumi, 2026-11-04): the group is planned as one
// (G-R1–G-R4), several free numbers are filled at #476's priority, each to the
// largest value the WHOLE group can carry (G-R5), and a `pull all` Gate whose
// fixed demand is not met zeroes the whole group (G-R6). Each case is one step
// of a minimal graph. The expected numbers are the design's tables, not the
// engine's output; every case pins every connection, every Pool, every Gate's
// status and no notice.
//
// F7–F9 and R11 pin the #476 planner's own defect: the bisection accepted a
// level up to `room + EPSILON`, so it planned 4.000000001 into a room of 4 and
// the commit's clamp dropped 1e-9 with no record. A planned amount must be
// feasible against the actual room and availability with no slack, and every
// Pool's change must equal its recorded events — pinned here to 1e-12, never
// to the six decimals that hid it. T1 and T4 pin the tree planner's same
// slack: the shared-Pool reach (a Converter ran at two fractions, 1e-9 apart)
// and the room walk (1e-9 past the room, clipped).

const P = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const gate = (id: string, mode: Mode = 'pullAny', distribution: GateDistribution = 'deterministic'): LoopNode => ({
  id, type: 'gate', position: P,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution, mode },
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

const conv = (id: string): LoopNode => ({
  id, type: 'converter', position: P,
  data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny' },
})

type Case = { name: string; nodes: LoopNode[]; edges: LoopEdge[]; moved: string; pools: string; gates?: string }

// the diamond: P (100) → S (10) → a, b (1 : 1) → J → T
const D = {
  nodes: (T: LoopNode, J: LoopNode = gate('J'), S: LoopNode = gate('S'), extra: LoopNode[] = []) =>
    [pool('P', 100), S, gate('a'), gate('b'), J, T, ...extra],
  edges: (extra: LoopEdge[] = [], jt = true) => [
    res('p', 'P', 'S', '10'), res('sa', 'S', 'a', '1'), res('sb', 'S', 'b', '1'),
    res('aj', 'a', 'J', '1'), res('bj', 'b', 'J', '1'), ...(jt ? [res('jt', 'J', 'T', '1')] : []), ...extra,
  ],
}
// two entries: P1 → S (10) → a, b → J; P2 → g (6) → J; J → T
const twoEntries = (T: LoopNode, P1 = 100, g = 'g', extraNodes: LoopNode[] = [], extraEdges: LoopEdge[] = []) => ({
  nodes: [pool('P1', P1), pool('P2', 100), gate('S'), gate('a'), gate('b'), gate(g), gate('J'), T, ...extraNodes],
  edges: [res('p1', 'P1', 'S', '10'), res('sa', 'S', 'a', '1'), res('sb', 'S', 'b', '1'), res('aj', 'a', 'J', '1'), res('bj', 'b', 'J', '1'),
    res('p2', 'P2', g, '6'), res('gj', g, 'J', '1'), res('jt', 'J', 'T', '1'), ...extraEdges],
})
// R18: S (9) → a, b, h; a, b → J (pull all or not) → T room 4; P2 → g (6) → h → Y
const r18 = (J: LoopNode) => ({
  nodes: [pool('P1', 100), pool('P2', 100), gate('S'), gate('a'), gate('b'), gate('h'), gate('g'), J, pool('T', 0, 4), pool('Y', 0)],
  edges: [res('p1', 'P1', 'S', '9'), res('sa', 'S', 'a', '1'), res('sb', 'S', 'b', '1'), res('sh', 'S', 'h', '1'), res('aj', 'a', 'J', '1'), res('bj', 'b', 'J', '1'),
    res('jt', 'J', 'T', '1'), res('p2', 'P2', 'g', '6'), res('gh', 'g', 'h', '1'), res('hy', 'h', 'Y', '1')],
})
const held5 = 'a held/plan 5 5 0; b held/plan 5 5 0'

const cases: Case[] = [
  // ── one entry (rev 1) ──────────────────────────────────────────────────────
  { name: 'R0 nothing short', nodes: D.nodes(pool('T', 0)), edges: D.edges(),
    moved: 'p 10, sa 5, sb 5, aj 5, bj 5, jt 10', pools: 'P 90, T 10',
    gates: 'S full 10 10 10; a full 5 5 5; b full 5 5 5; J full 10 10 10' },
  { name: 'R1 T room 4', nodes: D.nodes(pool('T', 0, 4)), edges: D.edges(),
    moved: 'p 4, sa 2, sb 2, aj 2, bj 2, jt 4', pools: 'P 96, T 4',
    gates: 'S partial/room 10 10 4; a partial/room 5 5 2; b partial/room 5 5 2; J partial/room 10 10 4' },
  { name: 'R2 split 3 : 1', nodes: D.nodes(pool('T', 0, 4)),
    edges: D.edges().map((e) => (e.id === 'sa' ? res('sa', 'S', 'a', '3') : e)),
    moved: 'p 4, sa 3, sb 1, aj 3, bj 1, jt 4', pools: 'P 96, T 4',
    gates: 'S partial/room 10 10 4; a partial/room 7.5 7.5 3; b partial/room 2.5 2.5 1; J partial/room 10 10 4' },
  { name: 'R3 side exit a → X', nodes: D.nodes(pool('T', 0, 4), gate('J'), gate('S'), [pool('X', 0)]), edges: D.edges([res('ax', 'a', 'X', '1')]),
    moved: 'p 16/3, sa 8/3, sb 8/3, aj 4/3, ax 4/3, bj 8/3, jt 4', pools: 'P 284/3, T 4, X 4/3',
    gates: 'S partial/room 10 10 5.333333; a partial/room 5 5 2.666667; b partial/room 5 5 2.666667; J partial/room 7.5 7.5 4' },
  { name: 'R4 triangle S → J direct',
    nodes: [pool('P', 100), gate('S'), gate('a'), gate('J'), pool('T', 0, 4)],
    edges: [res('p', 'P', 'S', '10'), res('sa', 'S', 'a', '1'), res('sj', 'S', 'J', '1'), res('aj', 'a', 'J', '1'), res('jt', 'J', 'T', '1')],
    moved: 'p 4, sa 2, sj 2, aj 2, jt 4', pools: 'P 96, T 4',
    gates: 'S partial/room 10 10 4; a partial/room 5 5 2; J partial/room 10 10 4' },
  { name: 'R5 J own Pool Q, T room 4', nodes: D.nodes(pool('T', 0, 4), gate('J'), gate('S'), [pool('Q', 100)]), edges: D.edges([res('q', 'Q', 'J', '3')]),
    moved: 'p 4, sa 2, sb 2, aj 2, bj 2, q 0, jt 4', pools: 'P 96, Q 100, T 4',
    gates: 'S partial/room 10 10 4; a partial/room 5 5 2; b partial/room 5 5 2; J partial/room 13 13 4' },
  { name: 'R5b J own Pool Q, T room 12', nodes: D.nodes(pool('T', 0, 12), gate('J'), gate('S'), [pool('Q', 100)]), edges: D.edges([res('q', 'Q', 'J', '3')]),
    moved: 'p 10, sa 5, sb 5, aj 5, bj 5, q 2, jt 12', pools: 'P 90, Q 98, T 12',
    gates: 'S full 10 10 10; a full 5 5 5; b full 5 5 5; J partial/room 13 13 12' },
  { name: 'R6 J pull all', nodes: D.nodes(pool('T', 0, 4), gate('J', 'pullAll')), edges: D.edges(),
    moved: 'p 0, sa 0, sb 0, aj 0, bj 0, jt 0', pools: 'P 100, T 0',
    gates: `J held/pullAll 10 10 0; S held/plan 10 10 0; ${held5}` },
  { name: 'R7 S pull all', nodes: D.nodes(pool('T', 0, 4), gate('J'), gate('S', 'pullAll')), edges: D.edges(),
    moved: 'p 0, sa 0, sb 0, aj 0, bj 0, jt 0', pools: 'P 100, T 0',
    gates: `S held/pullAll 10 10 0; J held/plan 10 10 0; ${held5}` },
  { name: 'R8 source short',
    nodes: [pool('P', 3), gate('S'), gate('a'), gate('b'), gate('J'), pool('T', 0)], edges: D.edges(),
    moved: 'p 3, sa 1.5, sb 1.5, aj 1.5, bj 1.5, jt 3', pools: 'P 0, T 3',
    gates: 'S partial/supply 10 3 3; a partial/upstream 5 1.5 1.5; b partial/upstream 5 1.5 1.5; J partial/upstream 10 3 3' },
  { name: 'R9 the join sorts first',
    nodes: [pool('P', 100), gate('S'), gate('m'), gate('n'), gate('a0'), pool('T', 0, 4)],
    edges: [res('p', 'P', 'S', '10'), res('sa', 'S', 'm', '1'), res('sb', 'S', 'n', '1'), res('aj', 'm', 'a0', '1'), res('bj', 'n', 'a0', '1'), res('jt', 'a0', 'T', '1')],
    moved: 'p 4, sa 2, sb 2, aj 2, bj 2, jt 4', pools: 'P 96, T 4',
    gates: 'S partial/room 10 10 4; m partial/room 5 5 2; n partial/room 5 5 2; a0 partial/room 10 10 4' },
  { name: 'R10 J splits into T (4) and U (1)', nodes: D.nodes(pool('T', 0, 4), gate('J'), gate('S'), [pool('U', 0, 1)]), edges: D.edges([res('ju', 'J', 'U', '1')]),
    moved: 'p 2, sa 1, sb 1, aj 1, bj 1, jt 1, ju 1', pools: 'P 98, T 1, U 1',
    gates: 'S partial/room 10 10 2; a partial/room 5 5 1; b partial/room 5 5 1; J partial/room 10 10 2' },
  { name: 'R11 probabilistic split (one branch live)', nodes: D.nodes(pool('T', 0, 4), gate('J'), gate('S', 'pullAny', 'probabilistic')), edges: D.edges(),
    moved: 'p 4, sa 0, sb 4, aj 0, bj 4, jt 4', pools: 'P 96, T 4',
    gates: 'S partial/room 10 10 4; a idle 0 0 0; b partial/room 10 10 4; J partial/room 10 10 4' },
  { name: 'R12 two diamonds in a row',
    nodes: [pool('P', 100), gate('S'), gate('a'), gate('b'), gate('J1'), gate('c'), gate('d'), gate('J2'), pool('T', 0, 4)],
    edges: [res('p', 'P', 'S', '10'), res('sa', 'S', 'a', '1'), res('sb', 'S', 'b', '1'), res('aj', 'a', 'J1', '1'), res('bj', 'b', 'J1', '1'),
      res('jc', 'J1', 'c', '1'), res('jd', 'J1', 'd', '1'), res('cj', 'c', 'J2', '1'), res('dj', 'd', 'J2', '1'), res('jt', 'J2', 'T', '1')],
    moved: 'p 4, sa 2, sb 2, aj 2, bj 2, jc 2, jd 2, cj 2, dj 2, jt 4', pools: 'P 96, T 4',
    gates: 'S partial/room 10 10 4; a partial/room 5 5 2; b partial/room 5 5 2; J1 partial/room 10 10 4; c partial/room 5 5 2; d partial/room 5 5 2; J2 partial/room 10 10 4' },
  // ── two entries, G-R5 (rev 2) ──────────────────────────────────────────────
  { name: 'R13 S first, then g; T room 8', ...twoEntries(pool('T', 0, 8)),
    moved: 'p1 8, sa 4, sb 4, aj 4, bj 4, p2 0, gj 0, jt 8', pools: 'P1 92, P2 100, T 8',
    gates: 'S partial/room 10 10 8; a partial/room 5 5 4; b partial/room 5 5 4; g held/room 6 6 0; J partial/room 16 16 8' },
  { name: 'R13b the second entry first (G0)', ...twoEntries(pool('T', 0, 8), 100, 'G0'),
    moved: 'p1 2, sa 1, sb 1, aj 1, bj 1, p2 6, gj 6, jt 8', pools: 'P1 98, P2 94, T 8',
    gates: 'G0 full 6 6 6; S partial/room 10 10 2; a partial/room 5 5 1; b partial/room 5 5 1; J partial/room 16 16 8' },
  { name: 'R14 group-feasible, not the edge maximum', ...twoEntries(pool('T', 0, 4), 100, 'g', [pool('Y', 0)], [res('gy', 'g', 'Y', '1')]),
    moved: 'p1 4, sa 2, sb 2, aj 2, bj 2, p2 0, gj 0, gy 0, jt 4', pools: 'P1 96, P2 100, T 4, Y 0',
    gates: 'S partial/room 10 10 4; a partial/room 5 5 2; b partial/room 5 5 2; g held/room 6 6 0; J partial/room 13 13 4' },
  { name: 'R15 P1 short', ...twoEntries(pool('T', 0, 8), 3),
    moved: 'p1 3, sa 1.5, sb 1.5, aj 1.5, bj 1.5, p2 5, gj 5, jt 8', pools: 'P1 0, P2 95, T 8',
    gates: 'S partial/supply 10 3 3; a partial/upstream 5 1.5 1.5; b partial/upstream 5 1.5 1.5; g partial/room 6 6 5; J partial/room 16 9 8' },
  { name: 'R18b an entry that never reaches J, J pull any', ...r18(gate('J')),
    moved: 'p1 6, sa 2, sb 2, sh 2, aj 2, bj 2, jt 4, p2 6, gh 6, hy 8', pools: 'P1 94, P2 94, T 4, Y 8',
    gates: 'S partial/room 9 9 6; a partial/room 3 3 2; b partial/room 3 3 2; g full 6 6 6; h partial/room 9 9 8; J partial/room 6 6 4' },
  // ── `pull all` join with a side exit, G-R6 (rev 2) ─────────────────────────
  { name: 'R16 side exit before the join, J pull all', nodes: D.nodes(pool('T', 0, 4), gate('J', 'pullAll'), gate('S'), [pool('X', 0)]), edges: D.edges([res('ax', 'a', 'X', '1')]),
    moved: 'p 0, sa 0, sb 0, aj 0, ax 0, bj 0, jt 0', pools: 'P 100, T 0, X 0',
    gates: `J held/pullAll 7.5 7.5 0; S held/plan 10 10 0; ${held5}` },
  { name: 'R16b R16 with T room 8', nodes: D.nodes(pool('T', 0, 8), gate('J', 'pullAll'), gate('S'), [pool('X', 0)]), edges: D.edges([res('ax', 'a', 'X', '1')]),
    moved: 'p 10, sa 5, sb 5, aj 2.5, ax 2.5, bj 5, jt 7.5', pools: 'P 90, T 7.5, X 2.5',
    gates: 'S full 10 10 10; a full 5 5 5; b full 5 5 5; J full 7.5 7.5 7.5' },
  { name: 'R17 J pull all with its own side exit', nodes: D.nodes(pool('T', 0, 4), gate('J', 'pullAll'), gate('S'), [pool('X', 0)]), edges: D.edges([res('jx', 'J', 'X', '1')]),
    moved: 'p 0, sa 0, sb 0, aj 0, bj 0, jt 0, jx 0', pools: 'P 100, T 0, X 0',
    gates: `J held/pullAll 10 10 0; S held/plan 10 10 0; ${held5}` },
  { name: 'R18 J pull all zeroes an entry that never reaches it', ...r18(gate('J', 'pullAll')),
    moved: 'p1 0, sa 0, sb 0, sh 0, aj 0, bj 0, jt 0, p2 0, gh 0, hy 0', pools: 'P1 100, P2 100, T 0, Y 0',
    gates: 'J held/pullAll 6 6 0; S held/plan 9 9 0; a held/plan 3 3 0; b held/plan 3 3 0; g held/plan 6 6 0; h held/plan 9 9 0' },
  { name: 'R19 the join\'s Pool is already full, S has a side exit with room: nothing moves (a Gate below epsilon is still checked)',
    nodes: [pool('P', 100), gate('S'), gate('a'), gate('b'), gate('J'), pool('T', 4, 4), pool('X', 0)],
    edges: [res('p', 'P', 'S', '10'), res('sa', 'S', 'a', '1'), res('sb', 'S', 'b', '1'), res('sx', 'S', 'X', '2'), res('aj', 'a', 'J', '1'), res('bj', 'b', 'J', '1'), res('jt', 'J', 'T', '1')],
    moved: 'p 0, sa 0, sb 0, sx 0, aj 0, bj 0, jt 0', pools: 'P 100, T 4, X 0',
    gates: 'S held/room 10 10 0; a held/room 2.5 2.5 0; b held/room 2.5 2.5 0; J held/room 5 5 0' },
  // ── the #476 planner's 1e-9 (no rejoin) ────────────────────────────────────
  { name: 'F7 a supply with no input',
    nodes: [pool('P', 100), gate('a'), gate('b'), gate('J'), pool('T', 0, 4)],
    edges: [res('p', 'P', 'b', '10'), res('aj', 'a', 'J', '1'), res('bj', 'b', 'J', '1'), res('jt', 'J', 'T', '1')],
    moved: 'p 4, aj 0, bj 4, jt 4', pools: 'P 96, T 4',
    gates: 'a idle 0 0 0; b partial/room 10 10 4; J partial/room 10 10 4' },
  { name: 'F8 a supply from an empty Pool',
    nodes: [pool('P', 100), pool('Q', 0), gate('b'), gate('g'), gate('J'), pool('T', 0, 4)],
    edges: [res('p', 'P', 'b', '10'), res('q', 'Q', 'g', '10'), res('gj', 'g', 'J', '1'), res('bj', 'b', 'J', '1'), res('jt', 'J', 'T', '1')],
    moved: 'p 4, q 0, gj 0, bj 4, jt 4', pools: 'P 96, Q 0, T 4',
    gates: 'b partial/room 10 10 4; g idle 10 0 0; J partial/room 20 10 4' },
  { name: 'F9 two full supplies merging',
    nodes: [pool('P', 100), pool('Q', 100), gate('b'), gate('g'), gate('J'), pool('T', 0, 4)],
    edges: [res('p', 'P', 'b', '10'), res('q', 'Q', 'g', '10'), res('gj', 'g', 'J', '1'), res('bj', 'b', 'J', '1'), res('jt', 'J', 'T', '1')],
    moved: 'p 4, q 0, gj 0, bj 4, jt 4', pools: 'P 96, Q 100, T 4',
    gates: 'b partial/room 10 10 4; g held/room 10 10 0; J partial/room 20 20 4' },
  // ── the tree planner's same slack (a Converter group, not a rejoin) ────────
  { name: 'T1 the shared-Pool reach: G and C both take from p (f = 0.5 exactly)',
    nodes: [pool('p', 10), gate('G'), conv('C'), pool('x', 0)],
    edges: [res('e1', 'p', 'G', '10'), res('gc', 'G', 'C', '10'), res('pc', 'p', 'C', '10'), res('cx', 'C', 'x', '10')],
    moved: 'e1 5, gc 5, pc 5, cx 5', pools: 'p 0, x 5' },
  { name: 'T4 the room walk: C makes into the Pool G pulls from, room 0.5 (f = 0.5 exactly)',
    nodes: [pool('p', 9.5, 10), gate('G'), conv('C')],
    edges: [res('e1', 'p', 'G', '5'), res('gc', 'G', 'C', '1'), res('cp', 'C', 'p', '2')],
    moved: 'e1 0.5, gc 0.5, cp 1', pools: 'p 10' },
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

describe('Gate-only split and rejoin: one plan per group (#471, ENGINE_REVISION 5)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const r = run(c)
      // every connection and every Pool, to 1e-12
      for (const [k, v] of Object.entries(nums(c.moved))) expect(Math.abs(r.moved[k] - v), `connection ${k}: ${r.moved[k]} vs ${v}`).toBeLessThanOrEqual(TIGHT)
      const pools = nums(c.pools)
      for (const [k, v] of Object.entries(pools)) expect(Math.abs(r.after[k] - v), `Pool ${k}: ${r.after[k]} vs ${v}`).toBeLessThanOrEqual(TIGHT)
      // every connection is named, every Pool is named
      expect(Object.keys(nums(c.moved)).sort()).toEqual(c.edges.map((e) => e.id).sort())
      expect(Object.keys(pools).sort()).toEqual(c.nodes.filter((n) => n.data.kind === 'pool').map((n) => n.id).sort())
      // a planned group reaches neither loss notice, and nothing is diagnosed
      expect(r.report.notices).toEqual([])
      expect(r.report.diagnostics).toEqual([])
      // each Pool's change equals its recorded events; no event passes a room
      // or takes more than the Pool held — with no slack
      for (const n of c.nodes) {
        if (n.data.kind !== 'pool') continue
        const inflow = c.edges.filter((e) => e.target === n.id).reduce((t, e) => t + r.moved[e.id], 0)
        const outflow = c.edges.filter((e) => e.source === n.id).reduce((t, e) => t + r.moved[e.id], 0)
        expect(Math.abs(r.after[n.id] - r.before[n.id] - (inflow - outflow)), `Pool ${n.id} change vs its events`).toBeLessThanOrEqual(TIGHT)
        const cap = (n.data as { capacity?: number | null }).capacity
        if (cap != null) expect(r.before[n.id] + inflow - outflow, `Pool ${n.id} events vs its room`).toBeLessThanOrEqual(cap)
        expect(outflow, `Pool ${n.id} events vs what it held`).toBeLessThanOrEqual(r.before[n.id])
      }
      // every Gate passes on exactly what it took
      for (const n of c.nodes) {
        if (n.data.kind !== 'gate') continue
        const inflow = c.edges.filter((e) => e.target === n.id).reduce((t, e) => t + r.moved[e.id], 0)
        const outflow = c.edges.filter((e) => e.source === n.id).reduce((t, e) => t + r.moved[e.id], 0)
        expect(Math.abs(inflow - outflow), `Gate ${n.id} in ${inflow} vs out ${outflow}`).toBeLessThanOrEqual(TIGHT)
      }
      // a Converter runs at one fraction: every connection is f × its rate
      for (const n of c.nodes) {
        if (n.data.kind !== 'converter') continue
        const fs = c.edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => r.moved[e.id] / Number((e.data as { flow: string }).flow))
        for (const f of fs) expect(Math.abs(f - fs[0]), `Converter ${n.id} fractions ${fs.join(', ')}`).toBeLessThanOrEqual(TIGHT)
      }
      if (c.gates === undefined) return
      // the Gate statuses (#477; the report rounds to six decimals)
      const want = statuses(c.gates)
      const got = Object.fromEntries(r.report.gates.map((g) => [g.nodeId, g]))
      expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort())
      for (const [id, w] of Object.entries(want)) {
        const g = got[id]
        expect(`${g.state}/${g.why ?? ''}`, `Gate ${id}`).toBe(`${w.state}/${w.why ?? ''}`)
        expect([g.demand, g.available, g.moved], `Gate ${id} demand, available, moved`).toEqual([w.demand, w.available, w.moved])
      }
    })
  }
})
