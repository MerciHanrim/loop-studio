import { describe, expect, it } from 'vitest'
import { add, cmp, exactDouble, fromInt, mul, parseDecimal, sub, type Rational } from '../model/rational'
import { graphWithSourceLines, plainGraph, type Graph } from './generatedGraphs.fixture'
import { initSim, step, type StepMove } from './index'

// The boundaries SEMANTICS-E.md does not settle (issue #572), on generated graphs
// (`generatedGraphs.fixture.ts`). Each is stated twice: a plain test for what runs today, and an
// `it.fails` for what is to be, which passes while the boundary stands and fails on the day the
// engine closes it (it is then turned into a plain test).
//   E-open 3  a `pull all` Gate held by a room a last place short: `graphWithSourceLines(3763, -8)`
// (What a `pull all` node may be short of, and what it records then, were two more boundaries
// here; they are rules now, §E11a and §E11b, and their tests are in pullAllShort.test.ts. E-open 2
// and 4, a planned `pull all` Converter whose verdict read amounts under 1e-9 as nothing, are
// settled from engine revision 20, and E-open 1, a loop that balances at one number only, from
// engine revision 21 (§E22); their tests are in exactMovesCases.test.ts.)
// And one consequence of §E14 that is meant, pinned as it is and not an expected failure: a
// room a hair short of what the written rates ask, `plainGraph(4088, -12)`.

const ZERO: Rational = fromInt(0)
const dec = (text: string) => parseDecimal(text)!
const same = (a: Rational, b: Rational) => cmp(a, b) === 0
const amountOf = (m: StepMove): Rational => ({ num: BigInt(m.num), den: BigInt(m.den) })

/** Every Pool that the record takes under 0 or over its capacity (SEMANTICS-E.md §E3): each
 *  Pool's level is walked from its value before the step, move by move, in exact fractions. */
function outsideBounds(g: Graph, before: Record<string, number>, moves: StepMove[]): string[] {
  const level = new Map<string, Rational>()
  const cap = new Map<string, number | null>()
  for (const n of g.nodes) {
    if (n.data.kind !== 'pool') continue
    level.set(n.id, exactDouble(before[n.id] ?? 0))
    cap.set(n.id, n.data.capacity)
  }
  const out: string[] = []
  for (const m of moves) {
    if (level.has(m.from)) {
      const l = sub(level.get(m.from)!, amountOf(m))
      level.set(m.from, l)
      if (cmp(l, ZERO) < 0) out.push(`${m.from} is under 0 after the move on ${m.edgeId}`)
    }
    if (level.has(m.to)) {
      const l = add(level.get(m.to)!, amountOf(m))
      level.set(m.to, l)
      const c = cap.get(m.to)
      if (c != null && cmp(l, exactDouble(c)) > 0) out.push(`${m.to} is over its capacity after the move on ${m.edgeId}`)
    }
  }
  return out
}

type StepOut = {
  /** the exact amount the step moved on a line */
  moved: (edge: string) => Rational
  /** what the record moved into a router less what it moved out of it */
  balance: (router: string) => Rational
  outside: string[]
}
function run(g: Graph, steps = 1): StepOut[] {
  let st = initSim(g.nodes)
  const out: StepOut[] = []
  for (let i = 0; i < steps; i++) {
    const r = step(g.nodes, g.edges, st, 7, 2)
    const moves = r.report.moves ?? []
    const on = (keep: (m: StepMove) => boolean) => moves.filter(keep).reduce((t, m) => add(t, amountOf(m)), ZERO)
    out.push({
      moved: (edge) => on((m) => m.edgeId === edge),
      balance: (id) => sub(on((m) => m.to === id), on((m) => m.from === id)),
      outside: outsideBounds(g, st.values, moves),
    })
    st = r.state
  }
  return out
}

describe('E-open 3 (SEMANTICS-E.md): a `pull all` Gate held by a room a last place short, on a path other than §E12`s', () => {
  // Generated graph with Source lines, seed 3763, step 1. The `pull all` Gate g1 takes 1 and 6
  // of p1 and 1 of p3 and hands half of it back into p3, which at its turn has room for exactly
  // that half (it holds 13 of 17). As the doubles stand that room is exact at scale 1, a last
  // place over the 4 at 10^-9, and a last place UNDER it at 10^-8: there the Gate moves nothing.
  // Not about small amounts (10^-8 is above every threshold). For a `pull all` Gate with two
  // supplies that is the rule (§E12, §E14); this Gate is not one, and which test holds it is not
  // found.
  it('generated graph with Source lines, seed 3763: at scale 1 and at 10^-9 the Gate takes the 6 (times the scale) on its line e4', { timeout: 60_000 }, () => {
    for (const [n, unit] of [[0, '1'], [-9, '0.000000001']] as const) {
      const [s] = run(graphWithSourceLines(3763, n))
      expect(same(s.moved('e4'), mul(fromInt(6), dec(unit))), `10^${n}`).toBe(true)
      expect(s.outside).toEqual([])
    }
  })
  it.fails('generated graph with Source lines, seed 3763, at 10^-8: the Gate moves nothing (to be: 6e-8 on e4, as at the other scales)', () => {
    const [s] = run(graphWithSourceLines(3763, -8))
    expect(cmp(s.moved('e4'), ZERO)).toBe(1)
  })
})

describe('a room a hair short of what the written rates ask (SEMANTICS-E.md §E14, the second consequence): as it is, and meant', () => {
  // Generated graph, seed 4088, at 10^-12: p3 holds 1.3e-11 of 1.6e-11; as doubles that leaves
  // 2.9999999999999993e-12, a hair under the 3e-12 the tree's deliveries need on balance. The
  // capacity is tested exactly (§E13): the tree is planned at that room and not at 4e-12, and its
  // Gate, which pulls its lines in order, does not come to its third line. No Pool leaves its
  // bounds.
  it('generated graph, seed 4088, at 10^-12: the room holds the tree to it, the Gate does not come to its third line, and no Pool leaves its bounds', () => {
    const [s] = run(plainGraph(4088, -12))
    expect(cmp(s.moved('e0'), ZERO)).toBe(1)
    expect(cmp(s.moved('e1'), ZERO)).toBe(1)
    expect(same(s.moved('e2'), ZERO)).toBe(true) // at scale 1 this line moves 1
    expect(same(s.balance('g0'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
})
