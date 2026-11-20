import { describe, expect, it } from 'vitest'
import { add, cmp, exactDouble, fromInt, mul, parseDecimal, sub, type Rational } from '../model/rational'
import { graphWithSourceLines, plainGraph, shift, type Graph } from './generatedGraphs.fixture'
import { initSim, step, type StepMove } from './index'

// The stops that SEMANTICS-E.md once left open (issue #572), on generated graphs
// (`generatedGraphs.fixture.ts`), pinned as they are: each is what the rules make of doubles that
// are a last place off the decimals a person wrote, and it is meant.
//   E-open 3   a `pull all` Gate whose piece is held by a room a last place short:
//              `graphWithSourceLines(3763, n)` (§E13, §E14, §E11)
//   seed 2950  a `pull all` Gate whose Pool holds a last place under its line after three
//              steps: `plainGraph(2950, n)` (§E5, §E11)
//   §E14       a room a hair short of what the written rates ask: `plainGraph(4088, -12)`
// (What a `pull all` node may be short of, and what it records then, were two more boundaries
// here; they are rules now, §E11a and §E11b, and their tests are in pullAllShort.test.ts. E-open 2
// and 4, a planned `pull all` Converter whose verdict read amounts under 1e-9 as nothing, are
// settled from engine revision 20, and E-open 1, a loop that balances at one number only, from
// engine revision 21 (§E22); their tests are in exactMovesCases.test.ts.)

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
  /** the stored values the step started from */
  before: Record<string, number>
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
      before: st.values,
    })
    st = r.state
  }
  return out
}

describe('E-open 3, settled as meant (SEMANTICS-E.md §E13, §E14, §E11): a `pull all` Gate whose piece is held by a room a last place short', () => {
  // Generated graph with Source lines, seed 3763, step 1. A plan with two supplies: g2 takes from
  // g0, from g1 and from its own lines. The `pull all` Gate g1 heads a piece of it: it takes 1 (e2)
  // and 6 (e4) of p1 and then 1 (e3) of p3, and hands half of its 8 back into p3 (e10). p3 holds
  // 11 of 17 and the Source pushes 3 into it first, so its room is 3: exactly what g1's whole run
  // puts into it on balance (4 in, 1 out). Under 7, g1 takes nothing of p3 and its numbers that fit
  // are up to 6; at 8 it fits again. The room is the doubles' capacity less their level less the
  // push, tested exactly (§E13, §E14). Where that is a last place under 3 times the scale, 8 does
  // not fit: the piece's largest number is just under 6, short of g1's demand of 8 by far more than
  // the absolute epsilon (§E11), and the piece is planned at 0. g1 moves nothing; the rest of the
  // group runs. Where it is a last place over or exact, g1 runs in full.
  const unit = (n: number) => dec(shift('1', n))
  const roomShort = (n: number): boolean => {
    const g = graphWithSourceLines(3763, n)
    const p3 = g.nodes.find((x) => x.id === 'p3')!.data as { initial: number; capacity: number }
    const flow = (id: string) => dec((g.edges.find((e) => e.id === id)!.data as { flow: string }).flow)
    const room = sub(exactDouble(p3.capacity), add(exactDouble(p3.initial), flow('x2')))
    return cmp(room, sub(dec(shift('4', n)), flow('e3'))) < 0
  }
  it('where p3`s room is not short (1, 10^-2, -3, -5, -6, -9, -11, -13, -14, 10^3, 10^9): g1 takes 1, 6 and 1 and hands 4 into p3, times the scale', { timeout: 60_000 }, () => {
    for (const n of [0, -2, -3, -5, -6, -9, -11, -13, -14, 3, 9]) {
      expect(roomShort(n), `10^${n}`).toBe(false)
      const [s] = run(graphWithSourceLines(3763, n))
      for (const [e, k] of [['e2', 1], ['e4', 6], ['e3', 1], ['e10', 4]] as const) expect(same(s.moved(e), mul(fromInt(k), unit(n))), `10^${n} ${e}`).toBe(true)
      expect(s.outside).toEqual([])
    }
  })
  it('where p3`s room is a last place short (10^-1, -4, -7, -8, -10, -12, -15): g1 moves nothing on any of its lines, and the rest of the group runs', { timeout: 60_000 }, () => {
    for (const n of [-1, -4, -7, -8, -10, -12, -15]) {
      expect(roomShort(n), `10^${n}`).toBe(true)
      const [s] = run(graphWithSourceLines(3763, n))
      for (const e of ['e2', 'e4', 'e3', 'e6', 'e10']) expect(same(s.moved(e), ZERO), `10^${n} ${e}`).toBe(true)
      expect(same(s.moved('e0'), mul(fromInt(4), unit(n))), `10^${n} e0`).toBe(true)
      expect(same(s.moved('e7'), mul(fromInt(7), unit(n))), `10^${n} e7`).toBe(true)
      expect(s.outside).toEqual([])
    }
  })
})

describe('seed 2950, settled as meant (SEMANTICS-E.md §E5, §E11): a `pull all` Gate whose Pool holds a last place under its line', () => {
  // Generated graph, seed 2950. The `pull all` Gate g0 asks 5 of p1 and 5 of p2. After three
  // steps p1 holds the double nearest its exact level, a last place under 5 (§E5: the next step
  // starts from the stored double). At scale 1 that is 8.9e-16 short, within the absolute epsilon:
  // g0 takes what p1 holds (§E11, §E11b). At 10^8 and 10^9 the same last place is 6e-8 and 9.5e-7,
  // more than the epsilon: g0 stops, and with it the group.
  it('step 4 at scale 1: p1 holds a last place under 5 and g0 takes all of it', () => {
    const s = run(plainGraph(2950, 0), 4)[3]
    expect(cmp(exactDouble(s.before.p1), dec('5'))).toBe(-1)
    expect(same(s.moved('e1'), exactDouble(s.before.p1))).toBe(true)
    expect(same(s.moved('e0'), dec('5'))).toBe(true)
  })
  it('step 4 at 10^8 and 10^9: p1 holds a last place under 5 times the scale, more than 1e-9 short, and nothing moves', () => {
    for (const n of [8, 9]) {
      const s = run(plainGraph(2950, n), 4)[3]
      expect(cmp(add(exactDouble(s.before.p1), dec('0.000000001')), dec(shift('5', n))), `10^${n}`).toBe(-1)
      for (const e of ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']) expect(same(s.moved(e), ZERO), `10^${n} ${e}`).toBe(true)
      expect(s.outside).toEqual([])
    }
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
