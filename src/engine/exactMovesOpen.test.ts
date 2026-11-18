import { describe, expect, it } from 'vitest'
import { add, cmp, exactDouble, fromInt, mul, parseDecimal, sub, type Rational } from '../model/rational'
import { graphWithSourceLines, plainGraph, type Graph } from './generatedGraphs.fixture'
import { initSim, step, type StepMove } from './index'

// The boundaries SEMANTICS-E.md does not settle (issue #572), on generated graphs
// (`generatedGraphs.fixture.ts`). Each is stated twice: a plain test for what runs today, and an
// `it.fails` for what is to be, which passes while the boundary stands and fails on the day the
// engine closes it (it is then turned into a plain test).
//   E-open 1  a loop that balances at one number only: `plainGraph(257, n)`
//   E-open 2  a `pull all` node that asks an amount above 0 and under 1e-9: `plainGraph(793, n)`
//   E-open 3  a group with two supplies, far under 1e-9: `graphWithSourceLines(777, n)`, step 2
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

describe('E-open 1 (SEMANTICS-E.md): a loop that balances at one number only', () => {
  // Generated graph, seed 257: p2 at its capacity; g0 takes 3 of p2 and 2 of p0, hands 5 to c1,
  // c1 returns 2 + 1 to p2. The group returns to p2 exactly what it takes at one number, 5 (times
  // the scale), and at no other. Where that number is a double (5; 0.5) it runs; where it is not
  // (0.005; 5e-12) no double fits and the group is planned at 0. It has nothing to do with the
  // epsilon, and it was so before the moves were exact, at 10^-3.
  it('generated graph, seed 257: the tree runs at scale 1 and at 10^-1, where its one number is a double', { timeout: 60_000 }, () => {
    for (const [n, unit] of [[0, '1'], [-1, '0.1']] as const) {
      const [s] = run(plainGraph(257, n))
      expect(same(s.moved('e2'), mul(fromInt(5), dec(unit))), `10^${n}`).toBe(true)
    }
  })
  it.fails('generated graph, seed 257, at 10^-3 and at 10^-12, where the number (0.005; 5e-12) is not a double: nothing moves (to be: 5 times the scale, as at scale 1)', { timeout: 60_000 }, () => {
    for (const [n, unit] of [[-3, '0.001'], [-12, '0.000000000001']] as const) {
      const [s] = run(plainGraph(257, n))
      expect(same(s.moved('e2'), mul(fromInt(5), dec(unit))), `10^${n}`).toBe(true)
    }
  })
})

// The shortfall of a `pull all` node is asked "what is it short of" in one place only, the planned
// Gate with two supplies (§E12). Everywhere else what it brought plus the absolute epsilon is
// compared with what it asks. So a `pull all` Gate that asks an amount above 0 and under 1e-9, and
// moves nothing, counts as having run, and the other members of its group move without it.
describe('E-open 2 (SEMANTICS-E.md): a `pull all` Gate that asks an amount above 0 and under 1e-9 and moves nothing does not stand for a run', () => {
  // Generated graph, seed 793: g1 (`pull all`) asks 6 of a Pool that holds 13 and can move none of
  // it for what is below it; g0, g2 and g3 are in its group.
  it('generated graph, seed 793, at scale 1: the group moves nothing: the Gate is 6 short', () => {
    const g = plainGraph(793, 0)
    const [s] = run(g)
    for (const e of g.edges) expect(same(s.moved(e.id), ZERO), e.id).toBe(true)
  })
  it.fails('generated graph, seed 793, at 10^-12: the same Gate is 6e-12 short, within the absolute epsilon, moves nothing, and 1e-12 moves through the rest of its group (to be: nothing moves, as at scale 1)', () => {
    const g = plainGraph(793, -12)
    const [s] = run(g)
    for (const e of g.edges) expect(same(s.moved(e.id), ZERO), e.id).toBe(true)
  })
})

describe('E-open 3 (SEMANTICS-E.md): a group with two supplies, far under 1e-9: a line that should move does not', () => {
  // Generated graph with Source lines, seed 777, step 2. Not E-open 1: it runs at 10^-3, where
  // seed 257 does not. The cause is not found. A group of a Converter and two Gates, planned
  // together; the Gate g1 has lines of 6 from p2 (which holds 1) and of 8 from p3. At scale 1 and
  // at 10^-3 it takes the 1 and the 8; at 10^-12 its number stops at what p2 holds and the line
  // from p3 moves nothing. Nothing is lost and no Pool leaves its bounds.
  it('generated graph with Source lines, seed 777, step 2: at scale 1 and at 10^-3 the Gate takes 8 (times the scale) on its second line', { timeout: 60_000 }, () => {
    for (const [n, unit] of [[0, '1'], [-3, '0.001']] as const) {
      const out = run(graphWithSourceLines(777, n), 2)
      expect(same(out[1].moved('e2'), mul(fromInt(8), dec(unit))), `10^${n}`).toBe(true)
    }
  })
  it.fails('generated graph with Source lines, seed 777, step 2, at 10^-12: the second line moves nothing (to be: 8e-12, as at the other scales)', () => {
    const out = run(graphWithSourceLines(777, -12), 2)
    expect(cmp(out[1].moved('e2'), ZERO)).toBe(1)
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
