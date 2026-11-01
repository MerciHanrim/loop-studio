import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// Issue #471 — a Converter plans its run before it takes anything, and every
// connection then moves exactly `f · rate` (SEMANTICS.md §6 / I2 / I4). Each
// case below is one step of a minimal graph, asserting the amount on every
// connection AND the Pool values after, in both modes where the mode matters.
// The first block failed on the code before the fix, for the reason in its
// name; the "pins" block passed before and must still pass; the last block is
// the Phase B target (router-fed inputs, the joint plan across routers — a
// separate design), kept as `it.fails` so the suite is green now and flips the
// moment Phase B lands.

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

/** one step; the amount moved on each connection (0 when nothing moved) and every Pool after */
function run(nodes: LoopNode[], edges: LoopEdge[]) {
  const r = step(nodes, edges, initSim(nodes), 1, 2)
  const moved: Record<string, number> = {}
  for (const e of edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  const pools: Record<string, number> = {}
  for (const n of nodes) if (n.data.kind === 'pool') pools[n.id] = r.state.values[n.id]
  return { moved, pools, fired: r.state.fired, diagnostics: r.report.diagnostics }
}
const close = (got: Record<string, number>, want: Record<string, number>) => {
  for (const k of Object.keys(want)) expect(got[k], k).toBeCloseTo(want[k], 6)
}
/** the same graph with every router in `mode` */
const inMode = (nodes: LoopNode[], mode: Mode) =>
  nodes.map((n) => (n.data.kind === 'converter' || n.data.kind === 'gate' ? { ...n, data: { ...n.data, mode } } : n)) as LoopNode[]

describe('#471 — a Converter plans before it takes (fixed in v1 / v2)', () => {
  it('V1: output room short — the input is taken at the same fraction as the output is made (was: taken in full)', () => {
    const nodes = [pool('a', 100), conv('C'), pool('x', 0, 50)]
    const edges = [res('e1', 'a', 'C', '100'), res('o1', 'C', 'x', '100')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 50, o1: 50 })
    close(r.pools, { a: 50, x: 50 })
    const all = run(inMode(nodes, 'pullAll'), edges)
    close(all.moved, { e1: 0, o1: 0 })
    close(all.pools, { a: 100, x: 0 })
  })

  it('V1, shared output: the second Converter into a nearly full Pool takes only what it can turn into output (was: took 80, made 20)', () => {
    const nodes = [pool('a1', 100), pool('a2', 100), conv('c1'), conv('c2'), pool('x', 0, 100)]
    const edges = [res('e1', 'a1', 'c1', '80'), res('o1', 'c1', 'x', '80'), res('e2', 'a2', 'c2', '80'), res('o2', 'c2', 'x', '80')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 80, o1: 80, e2: 20, o2: 20 })
    close(r.pools, { a1: 20, a2: 80, x: 100 })
  })

  it('V2: two input Pools, one short — one f on every connection (was: the full input taken, the two summed)', () => {
    const nodes = [pool('a', 100), pool('b', 20), conv('C'), pool('x', 0)]
    const edges = [res('e1', 'a', 'C', '100'), res('e2', 'b', 'C', '50'), res('o1', 'C', 'x', '150')]
    const r = run(nodes, edges) // f = min(100/100, 20/50) = 0.4
    close(r.moved, { e1: 40, e2: 20, o1: 60 })
    close(r.pools, { a: 60, b: 0, x: 60 })
  })

  it('V2, unequal rates and two outputs: the limiting input sets f for all four connections', () => {
    // 100 water + 30 power → 45 + 55; power short (20 of 30): f = 2/3
    const n6 = [pool('w', 100), pool('p', 20), conv('C'), pool('perm', 0), pool('brine', 0)]
    const edges = [res('e1', 'w', 'C', '100'), res('e2', 'p', 'C', '30'), res('o1', 'C', 'perm', '45'), res('o2', 'C', 'brine', '55')]
    const r6 = run(n6, edges)
    close(r6.moved, { e1: 200 / 3, e2: 20, o1: 30, o2: 110 / 3 })
    close(r6.pools, { w: 100 - 200 / 3, p: 0, perm: 30, brine: 110 / 3 })
    // water short (60 of 100): f = 0.6
    const n7 = [pool('w', 60), pool('p', 30), conv('C'), pool('perm', 0), pool('brine', 0)]
    const r7 = run(n7, edges)
    close(r7.moved, { e1: 60, e2: 18, o1: 27, o2: 33 })
    close(r7.pools, { w: 0, p: 12, perm: 27, brine: 33 })
  })

  it('V2, one Pool twice: two connections off one Pool share what it has (was: 50 + 10)', () => {
    const nodes = [pool('a', 60), conv('C'), pool('x', 0)]
    const edges = [res('e1', 'a', 'C', '50'), res('e2', 'a', 'C', '50'), res('o1', 'C', 'x', '100')]
    const r = run(nodes, edges) // f = 60 / 100
    close(r.moved, { e1: 30, e2: 30, o1: 60 })
    close(r.pools, { a: 0, x: 60 })
    const all = run(inMode(nodes, 'pullAll'), edges)
    close(all.moved, { e1: 0, e2: 0, o1: 0 })
    close(all.pools, { a: 60, x: 0 })
  })

  it('V3: two outputs into one capped Pool share its room, both modes (was: 100 made into room 60, 40 cut at commit)', () => {
    const nodes = [pool('a', 100), conv('C'), pool('x', 0, 60)]
    const edges = [res('e1', 'a', 'C', '100'), res('o1', 'C', 'x', '50'), res('o2', 'C', 'x', '50')]
    const r = run(nodes, edges) // f = 60 / (50 + 50)
    close(r.moved, { e1: 60, o1: 30, o2: 30 })
    close(r.pools, { a: 40, x: 60 })
    const all = run(inMode(nodes, 'pullAll'), edges)
    close(all.moved, { e1: 0, o1: 0, o2: 0 })
    close(all.pools, { a: 100, x: 0 })
  })

  it("V3g: a Gate's two branches into one capped Pool share its room, both modes (was: 100 sent into room 60, 40 cut)", () => {
    const nodes = [pool('a', 100), gate('g'), pool('x', 0, 60)]
    const edges = [res('e1', 'a', 'g', '100'), res('o1', 'g', 'x', '50'), res('o2', 'g', 'x', '50')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 60, o1: 30, o2: 30 })
    close(r.pools, { a: 40, x: 60 })
    const all = run(inMode(nodes, 'pullAll'), edges)
    close(all.moved, { e1: 0, o1: 0, o2: 0 })
    close(all.pools, { a: 100, x: 0 })
  })

  it("V3r: a Converter's two outputs into one Gate are sized by what the Gate can pass on, both modes (was: 40 left in the Gate and lost; under pull all, all 100)", () => {
    const nodes = [pool('a', 100), conv('C'), gate('g'), pool('x', 0, 60)]
    const edges = [res('e1', 'a', 'C', '100'), res('o1', 'C', 'g', '50'), res('o2', 'C', 'g', '50'), res('h1', 'g', 'x', '100')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 60, o1: 30, o2: 30, h1: 60 })
    close(r.pools, { a: 40, x: 60 })
    const all = run(inMode(nodes, 'pullAll'), edges)
    close(all.moved, { e1: 0, o1: 0, o2: 0, h1: 0 })
    close(all.pools, { a: 100, x: 0 })
  })
})

describe('#471 — rules that must not move (pins)', () => {
  it('shared input Pool: the Converter earlier in canonical order takes first; under pull all the second gets nothing', () => {
    const nodes = [pool('a', 100), conv('c1'), conv('c2'), pool('x1', 0), pool('x2', 0)]
    const edges = [res('e1', 'a', 'c1', '80'), res('o1', 'c1', 'x1', '80'), res('e2', 'a', 'c2', '80'), res('o2', 'c2', 'x2', '80')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 80, o1: 80, e2: 20, o2: 20 })
    close(r.pools, { a: 0, x1: 80, x2: 20 })
    const all = run(inMode(nodes, 'pullAll'), edges)
    close(all.moved, { e1: 80, o1: 80, e2: 0, o2: 0 })
    close(all.pools, { a: 20, x1: 80, x2: 0 })
  })

  it('shared output Pool under pull all: the first fills, the second moves nothing', () => {
    const nodes = inMode([pool('a1', 100), pool('a2', 100), conv('c1'), conv('c2'), pool('x', 0, 100)], 'pullAll')
    const edges = [res('e1', 'a1', 'c1', '80'), res('o1', 'c1', 'x', '80'), res('e2', 'a2', 'c2', '80'), res('o2', 'c2', 'x', '80')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 80, o1: 80, e2: 0, o2: 0 })
    close(r.pools, { a1: 20, a2: 100, x: 80 })
  })

  it('a Gate-fed input with the output room short: the Gate already sizes its delivery by the Converter, 50 in → 50 out', () => {
    const nodes = [pool('a', 100), gate('g'), conv('C'), pool('x', 0, 50)]
    const edges = [res('e1', 'a', 'g', '100'), res('g1', 'g', 'C', '100'), res('o1', 'C', 'x', '100')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 50, g1: 50, o1: 50 })
    close(r.pools, { a: 50, x: 50 })
  })

  it("`all` on a Converter connection reads as the rate 1 per run, not 'all of the Pool' (#471 item 5 — recorded, the rule is open)", () => {
    const nodes = [pool('a', 100), conv('C'), pool('x', 0)]
    const edges = [res('e1', 'a', 'C', 'all'), res('o1', 'C', 'x', '10')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 1, o1: 10 })
    close(r.pools, { a: 99, x: 10 })
    // and as the output of a Gate into the Converter: weight 1, need 1
    const viaGate = [pool('a', 100), gate('g'), conv('C'), pool('x', 0)]
    const gEdges = [res('e1', 'a', 'g', '5'), res('g1', 'g', 'C', 'all'), res('o1', 'C', 'x', '10')]
    const rg = run(viaGate, gEdges)
    close(rg.moved, { e1: 1, g1: 1, o1: 10 })
  })

  it('a Pool that is both input and output of one Converter is bounded on the net amount, room / (make − need) (#471 item 5 — recorded, the rule is open)', () => {
    // P 100 of 120; C takes 50 and makes 80 into P: net +30 per run, room 20 ⇒ f = 2/3
    const nodes = [pool('P', 100, 120), conv('C')]
    const edges = [res('e1', 'P', 'C', '50'), res('o1', 'C', 'P', '80')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 100 / 3, o1: 160 / 3 })
    close(r.pools, { P: 120 })
    expect(r.diagnostics).toEqual([])
  })
})

describe('#471 — Phase B targets: a router-fed input beside a Pool input (the joint plan across routers; not fixed yet)', () => {
  // G1: a 100 →(50) g →(50) C; b 10 →(50) C; C →(100) x. One f = 0.2 means the
  // Gate delivers 10, not 50. Today the Gate delivers the full 50, the Pool
  // gives 10, and C makes 60 (V2b).
  it.fails('G1: the Gate delivers at the same fraction as the short Pool input', () => {
    const nodes = [pool('a', 100), pool('b', 10), gate('g'), conv('C'), pool('x', 0)]
    const edges = [res('e1', 'a', 'g', '50'), res('g1', 'g', 'C', '50'), res('e2', 'b', 'C', '50'), res('o1', 'C', 'x', '100')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 10, g1: 10, e2: 10, o1: 20 })
    close(r.pools, { a: 90, b: 0, x: 20 })
  })

  // G2: one Pool b (60) feeds both the Gate and C: 50 s + 50 s ≤ 60 ⇒ s = 0.6.
  it.fails('G2: one Pool feeding the Gate and the Converter is shared by the plan', () => {
    const nodes = [pool('b', 60), gate('g'), conv('C'), pool('x', 0)]
    const edges = [res('e1', 'b', 'g', '50'), res('g1', 'g', 'C', '50'), res('e2', 'b', 'C', '50'), res('o1', 'C', 'x', '100')]
    const r = run(nodes, edges)
    close(r.moved, { e1: 30, g1: 30, e2: 30, o1: 60 })
    close(r.pools, { b: 0, x: 60 })
  })

  // G3: a Gate splits into two Converters; C2's Pool input is short (10 of 50).
  // The fixed split ties the two, so s = 0.2 for the whole group.
  it.fails('G3: a short input on one branch limits every branch, as a short Pool downstream already does', () => {
    const nodes = [pool('a', 100), pool('b1', 100), pool('b2', 10), gate('g'), conv('C1'), conv('C2'), pool('x1', 0), pool('x2', 0)]
    const edges = [
      res('e1', 'a', 'g', '100'), res('g1', 'g', 'C1', '50'), res('g2', 'g', 'C2', '50'),
      res('f1', 'b1', 'C1', '50'), res('f2', 'b2', 'C2', '50'), res('o1', 'C1', 'x1', '100'), res('o2', 'C2', 'x2', '100'),
    ]
    const r = run(nodes, edges)
    close(r.moved, { e1: 20, g1: 10, g2: 10, f1: 10, f2: 10, o1: 20, o2: 20 })
    close(r.pools, { a: 80, b1: 90, b2: 0, x1: 20, x2: 20 })
  })

  // G4: a split that rejoins — g0 splits to g1 and g2, both feed C, and g1
  // also feeds y. The only exact plan is zero. The new rule refuses this
  // shape BEFORE the run (nothing moves, with a message); today C receives
  // 30, needs 20, and 10 vanish (V4). The message text is Deploy 2's.
  it.fails('G4: a split that rejoins is refused before the run — nothing moves and nothing vanishes', () => {
    const nodes = [pool('a', 100), gate('g0'), gate('g1'), gate('g2'), conv('C'), pool('x', 0), pool('y', 0)]
    const edges = [
      res('e0', 'a', 'g0', '40'), res('h1', 'g0', 'g1', '1'), res('h2', 'g0', 'g2', '1'),
      res('k1', 'g1', 'C', '10'), res('k2', 'g1', 'y', '10'), res('k3', 'g2', 'C', '10'), res('o1', 'C', 'x', '20'),
    ]
    const r = run(nodes, edges)
    expect(Object.values(r.moved).every((a) => a === 0)).toBe(true)
    close(r.pools, { a: 100, x: 0, y: 0 })
  })
})
