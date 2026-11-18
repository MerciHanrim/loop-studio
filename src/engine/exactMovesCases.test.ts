import { describe, expect, it } from 'vitest'
import { add, cmp, div, exactDouble, fromInt, mul, parseDecimal, sub, toDouble, type Rational } from '../model/rational'
import type { LoopEdge, LoopNode } from '../model/types'
import { conv, drain, gate, graphWithSourceLines, plainGraph, pool, res, source, type Graph, type Mode } from './generatedGraphs.fixture'
import { initSim, step, type StateEvent, type StepMove, type StepReport } from './index'

// SEMANTICS-E.md as hand cases (issue #572). Each test builds a small graph, runs a step and reads
// the record of its moves (`report.moves`) as exact fractions. The sections: what is promised into
// a Pool is a fraction (§E1, §E13); a plan's largest number; the room for what comes back through
// a Gate; a Pool a `label` edits (§E3, §E4); a Converter with a line from a Source (issue #581);
// an amount under 1e-9 in a plan (§E8) and a small net inflow (§E14); a rate above 0 is a line
// (§E10, §E7); and a planned `pull all` Gate that is short (§E11, §E12). Where a case names a seed,
// its graph is `plainGraph(seed, n)` or `graphWithSourceLines(seed, n)` of
// `generatedGraphs.fixture.ts`; a case "reduced from seed N" is a few nodes and lines of
// `graphWithSmallRates(N, 0)`, written out. The boundaries that are not settled are in
// `exactMovesOpen.test.ts`.

const ZERO: Rational = fromInt(0)
const dec = (text: string) => parseDecimal(text)!
const frac = (n: number, d: number): Rational => div(fromInt(n), fromInt(d))
const same = (a: Rational, b: Rational) => cmp(a, b) === 0
const amountOf = (m: StepMove): Rational => ({ num: BigInt(m.num), den: BigInt(m.den) })

const F64 = new Float64Array(1)
const U64 = new BigUint64Array(F64.buffer)
const beside = (x: number, d: 1 | -1): number => {
  if (x === 0) return d === 1 ? Number.MIN_VALUE : 0
  F64[0] = x
  U64[0] += BigInt(d)
  return F64[0]
}
/** the double nearest a fraction that is 0 or above (a tie goes to the even one), by exact comparison */
const nearest = (r: Rational): number => {
  if (cmp(r, ZERO) <= 0) return 0
  let v = toDouble(r)
  while (v > 0 && cmp(exactDouble(v), r) > 0) v = beside(v, -1)
  while (cmp(exactDouble(beside(v, 1)), r) <= 0) v = beside(v, 1)
  const up = beside(v, 1)
  const c = cmp(sub(r, exactDouble(v)), sub(exactDouble(up), r))
  if (c !== 0) return c < 0 ? v : up
  F64[0] = v
  return (U64[0] & 1n) === 0n ? v : up
}

/** The value a Pool's moves start from (SEMANTICS-E.md §E3): its stored value before the step
 *  plus the step's Phase-0 label term, in doubles. An `afterPull` label acts after the moves. */
function movesStart(before: Record<string, number>, stateEvents: StateEvent[]): Record<string, number> {
  const from = { ...before }
  for (const ev of stateEvents) {
    if (ev.effect.kind !== 'label' || 'applied' in ev.effect) continue
    from[ev.to] = (from[ev.to] ?? 0) + ev.effect.delta + ev.effect.clampAdjustment
  }
  return from
}

/** a Pool whose exact level is under 0 or over its capacity after the move on `edgeId`, and by how much */
type Outside = { pool: string; what: 'under' | 'over'; edgeId: string; by: Rational }
/** Every time the record takes a Pool out of its bounds (§E3): each Pool's level is walked from
 *  the value its moves start from, move by move in the record's order, in exact fractions. */
function outsideBounds(g: Graph, from: Record<string, number>, moves: StepMove[]): Outside[] {
  const level = new Map<string, Rational>()
  const cap = new Map<string, number | null>()
  for (const n of g.nodes) {
    if (n.data.kind !== 'pool') continue
    level.set(n.id, exactDouble(from[n.id] ?? 0))
    cap.set(n.id, n.data.capacity)
  }
  const out: Outside[] = []
  for (const m of moves) {
    if (level.has(m.from)) {
      const l = sub(level.get(m.from)!, amountOf(m))
      level.set(m.from, l)
      if (cmp(l, ZERO) < 0) out.push({ pool: m.from, what: 'under', edgeId: m.edgeId, by: sub(ZERO, l) })
    }
    if (level.has(m.to)) {
      const l = add(level.get(m.to)!, amountOf(m))
      level.set(m.to, l)
      const c = cap.get(m.to)
      if (c != null && cmp(l, exactDouble(c)) > 0) out.push({ pool: m.to, what: 'over', edgeId: m.edgeId, by: sub(l, exactDouble(c)) })
    }
  }
  return out
}

type StepOut = {
  /** the exact amount the step moved on a line */
  moved: (edge: string) => Rational
  /** a Pool's exact level after the step's moves */
  level: (pool: string) => Rational
  /** what the record moved into a router less what it moved out of it */
  balance: (router: string) => Rational
  stored: Record<string, number>
  outside: Outside[]
  notices: StepReport['notices']
  stateEvents: StateEvent[]
}
function run(g: Graph, steps = 1): StepOut[] {
  let st = initSim(g.nodes)
  const out: StepOut[] = []
  for (let i = 0; i < steps; i++) {
    const r = step(g.nodes, g.edges, st, 7, 2)
    const moves = r.report.moves ?? []
    const from = movesStart(st.values, r.report.stateEvents)
    const on = (keep: (m: StepMove) => boolean) => moves.filter(keep).reduce((t, m) => add(t, amountOf(m)), ZERO)
    out.push({
      moved: (edge) => on((m) => m.edgeId === edge),
      level: (p) => sub(add(exactDouble(from[p] ?? 0), on((m) => m.to === p)), on((m) => m.from === p)),
      balance: (id) => sub(on((m) => m.to === id), on((m) => m.from === id)),
      stored: r.state.values,
      outside: outsideBounds(g, from, moves),
      notices: r.report.notices,
      stateEvents: r.report.stateEvents,
    })
    st = r.state
  }
  return out
}
/** nothing moves on any line of the graph, nothing is reported lost, no Pool leaves its bounds */
const still = (s: StepOut, g: Graph) => {
  for (const e of g.edges) expect(same(s.moved(e.id), ZERO), e.id).toBe(true)
  expect(s.notices).toEqual([])
  expect(s.outside).toEqual([])
}

describe('what is promised into a Pool is a fraction (SEMANTICS-E.md §E1, §E13)', () => {
  // A planned Converter (c1) makes a third into a Pool of capacity 1; a Gate outside the plan
  // (b1: after the plan is made at a1's turn, before the Converter delivers) brings what is left
  // of the room. A third is not a double.
  const record = (): Graph => ({
    nodes: [pool('P', 1), pool('Z', 5), pool('Q', 0, 1), gate('a1'), conv('c1'), gate('b1')],
    edges: [res('p', 'P', 'a1', '1'), res('h', 'a1', 'c1', '3'), res('o', 'c1', 'Q', '1'), res('zi', 'Z', 'b1', '5'), res('zo', 'b1', 'Q', '1')],
  })
  it('a plan`s record: the Converter makes exactly 1/3, the Gate outside brings exactly 2/3, the Pool ends exactly full', () => {
    const [s] = run(record())
    expect(same(s.moved('o'), frac(1, 3))).toBe(true)
    expect(same(s.moved('zo'), frac(2, 3))).toBe(true)
    expect(same(s.level('Q'), fromInt(1))).toBe(true)
    expect(s.stored.Q).toBe(1)
    expect(s.outside).toEqual([])
  })
  // What a Gate hands a Gate that only passes on is promised downstream. g1 takes 1 and hands a
  // third of it to zh, which passes it into Q; z (before zh in the order) brings the rest.
  const handed = (): Graph => ({
    nodes: [pool('A', 1), pool('Z', 5), pool('Q', 0, 1), pool('R', 0), gate('g1'), gate('zh'), gate('z')],
    edges: [res('a', 'A', 'g1', '1'), res('x', 'g1', 'zh', '1'), res('r', 'g1', 'R', '2'), res('q', 'zh', 'Q', '1'), res('zi', 'Z', 'z', '5'), res('zo', 'z', 'Q', '1')],
  })
  it('an amount handed on: a third is promised for the Gate that will deliver it, and the other Gate brings exactly 2/3', () => {
    const [s] = run(handed())
    expect(same(s.moved('q'), frac(1, 3))).toBe(true)
    expect(same(s.moved('zo'), frac(2, 3))).toBe(true)
    expect(same(s.level('Q'), fromInt(1))).toBe(true)
    expect(same(s.balance('zh'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
  // A Gate that is handed something and has a Pool line of its own. g1 hands h a third; h also
  // asks 5 of B; its target has a capacity of 1. A Gate with a router above it and a Pool line
  // of its own has two supplies, so its group is planned: this pins that plan's exact record.
  const both = (): Graph => ({
    nodes: [pool('A', 1), pool('B', 10), pool('Q', 0, 1), pool('R', 0), gate('g1'), gate('h')],
    edges: [res('a', 'A', 'g1', '1'), res('x', 'g1', 'h', '1'), res('r', 'g1', 'R', '2'), res('b', 'B', 'h', '5'), res('q', 'h', 'Q', '1')],
  })
  it('a Gate handed a third, with a Pool line: it passes on all it was handed and its line brings exactly what is left of the room', () => {
    const [s] = run(both())
    expect(same(s.moved('x'), frac(1, 3))).toBe(true)
    expect(same(s.moved('b'), frac(2, 3))).toBe(true)
    expect(same(s.moved('q'), fromInt(1))).toBe(true)
    expect(same(s.balance('h'), ZERO)).toBe(true)
    expect(same(s.level('Q'), fromInt(1))).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('the same Gate where the room is exactly what it was handed (another Gate filled the rest): nothing of what it was handed is left with it', () => {
    // z, between g1 and zz in the order, fills Q up to the promise of a third; zz then has room for its third only
    const g: Graph = {
      nodes: [pool('A', 1), pool('B', 10), pool('Z', 5), pool('Q', 0, 1), pool('R', 0), gate('g1'), gate('zz'), gate('z')],
      edges: [res('a', 'A', 'g1', '1'), res('x', 'g1', 'zz', '1'), res('r', 'g1', 'R', '2'), res('b', 'B', 'zz', '5'), res('q', 'zz', 'Q', '1'), res('zi', 'Z', 'z', '5'), res('zo', 'z', 'Q', '1')],
    }
    const [s] = run(g)
    expect(same(s.balance('zz'), ZERO)).toBe(true) // lines in less lines out
    expect(same(s.moved('x'), frac(1, 3))).toBe(true)
    expect(same(add(s.moved('q'), s.moved('zo')), fromInt(1))).toBe(true)
    expect(same(s.level('Q'), fromInt(1))).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('the same Gate `pull all`: 4 2/3 short of what its line asks, it takes nothing of its line; what it was handed is not asked', () => {
    const g = both()
    ;(g.nodes.find((n) => n.id === 'h')!.data as { mode?: string }).mode = 'pullAll'
    const [s] = run(g)
    expect(same(s.moved('b'), ZERO)).toBe(true)
    expect(same(s.moved('q'), ZERO)).toBe(true)
  })
})

describe('the largest number of a plan where the numbers that fit are not one stretch from 0', () => {
  // Generated graph, seed 457, step 2: g3 takes 1 of p1 and 1 of p0 before it takes 5 of p2, and
  // part of what it hands on comes back into p2, which the plan has just filled. A little of g3
  // does not fit (p2 is full and nothing is taken of it yet); all of it does (5 are taken of p2).
  it('generated graph, seed 457, step 2: the Gate whose later line takes from the Pool it adds to moves all its lines can bring', () => {
    const [, s2] = run(plainGraph(457, 0), 2)
    expect(same(s2.moved('e8'), fromInt(5))).toBe(true)
    expect(same(s2.moved('e7'), fromInt(1))).toBe(true)
    expect(cmp(s2.moved('e11'), ZERO)).toBe(1)
    expect(cmp(s2.level('p2'), fromInt(6))).toBe(-1)
    expect(s2.outside).toEqual([])
  })
  it('generated graph, seed 1839, step 3: the same shape (a Gate that takes of a full Pool what it then adds to): it moves', () => {
    const [, , s3] = run(plainGraph(1839, 0), 3)
    expect(same(s3.moved('e3'), fromInt(1))).toBe(true)
    expect(cmp(s3.moved('e4'), ZERO)).toBe(1)
    expect(s3.outside).toEqual([])
  })
})

describe('what a Converter takes of a Pool is room for what comes back into it through a Gate that only passes on', () => {
  // The net room holds through such a Gate too. A Converter takes 2 a run of P (capacity 6,
  // holding 3) and hands 7 a run to a Gate that passes 8 of 11 of it back into P. At a part f of
  // a run: 3 - 2f + (56/11)f = 6, so f = 33/34.
  const net = (): Graph => ({
    nodes: [pool('P', 3, 6), pool('R', 0), conv('c'), gate('h')],
    edges: [res('t', 'P', 'c', '2'), res('x', 'c', 'h', '7'), res('b', 'h', 'P', '8'), res('r', 'h', 'R', '3')],
  })
  it('the least case: the Converter runs at 33/34 and the Pool ends exactly full, never over', () => {
    const [s] = run(net())
    expect(same(s.moved('t'), frac(33, 17))).toBe(true)
    expect(same(s.moved('x'), frac(231, 34))).toBe(true)
    expect(same(s.moved('b'), frac(84, 17))).toBe(true)
    expect(same(s.balance('h'), ZERO)).toBe(true)
    expect(same(s.level('P'), fromInt(6))).toBe(true)
    expect(s.stored.P).toBe(6)
    expect(s.outside).toEqual([]) // within the step too: never past the capacity
  })
  it('generated graph, seed 231, step 1: the same shape, the same part of a run', () => {
    const [s1] = run(plainGraph(231, 0), 1)
    expect(same(s1.moved('e0'), frac(33, 17))).toBe(true)
    expect(same(s1.moved('e7'), frac(231, 34))).toBe(true)
    expect(same(s1.moved('e11'), frac(84, 17))).toBe(true)
    expect(same(s1.moved('e12'), frac(63, 34))).toBe(true)
    expect(same(s1.level('p1'), fromInt(6))).toBe(true)
    expect(s1.stored.p1).toBe(6)
    expect(s1.outside).toEqual([])
  })
  it('a Pool the Converter does not take from gives no such room: the Gate`s share is held to the room as it stands', () => {
    // the same, the Converter fed from another Pool: P (capacity 6, holding 3) takes 3 at most: (56/11) f = 3
    const g: Graph = {
      nodes: [pool('S', 10), pool('P', 3, 6), pool('R', 0), conv('c'), gate('h')],
      edges: [res('t', 'S', 'c', '2'), res('x', 'c', 'h', '7'), res('b', 'h', 'P', '8'), res('r', 'h', 'R', '3')],
    }
    const [s] = run(g)
    expect(same(s.moved('b'), fromInt(3))).toBe(true)
    expect(same(s.moved('t'), frac(33, 28))).toBe(true)
    expect(same(s.level('P'), fromInt(6))).toBe(true)
    expect(s.outside).toEqual([])
  })
})

describe('a Pool a `label` state connection edits, and the record of moves (SEMANTICS-E.md §E3, §E4)', () => {
  // The edit is not a move. Before the moves (Phase 0) it changes the double the moves start
  // from; after them (`afterPull`) it changes the double the level was stored as.
  const label = (id: string, s: string, t: string, expr: string, more: { timing?: 'afterPull'; when?: 'source-fired' } = {}): LoopEdge => ({
    id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in',
    data: { kind: 'state', mode: 'label', expr, ...more },
  })
  // g takes 1 of A and hands a third of it to Q
  const base = (cap: number | null = null): Graph => ({
    nodes: [pool('A', 1), pool('L', 0), pool('Q', 0, cap), pool('R', 0), gate('g')],
    edges: [res('a', 'A', 'g', '1'), res('q', 'g', 'Q', '1'), res('r', 'g', 'R', '2')],
  })
  it('before the moves: the moves start from the edited double; the Pool is stored as the nearest double of 0.1 + 1/3', () => {
    const g = base()
    g.edges.push(label('l', 'L', 'Q', '+0.1'))
    const [s] = run(g)
    expect(same(s.moved('q'), frac(1, 3))).toBe(true)
    expect(s.stored.Q).toBe(nearest(add(exactDouble(0.1), frac(1, 3))))
    expect(s.outside).toEqual([])
  })
  it('before the moves, into a capped Pool: the room is what the edited level leaves, met exactly', () => {
    const g = base(0.35)
    g.edges.push(label('l', 'L', 'Q', '=0.3'))
    const [s] = run(g)
    expect(same(s.moved('q'), sub(exactDouble(0.35), exactDouble(0.3)))).toBe(true)
    expect(s.stored.Q).toBe(0.35)
    expect(same(s.balance('g'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('after the moves: the level is stored as its nearest double first, then the edit is added to that double', () => {
    const g = base()
    g.edges.push(label('l', 'g', 'Q', '+0.1', { timing: 'afterPull', when: 'source-fired' }))
    const [s] = run(g)
    expect(same(s.moved('q'), frac(1, 3))).toBe(true)
    expect(s.stored.Q).toBe(nearest(frac(1, 3)) + 0.1)
  })
  // One Pool that an edit changes, that a plan promises into, and that has a move from outside
  // the plan, in one step. The planned Converter c1 makes a third into Q; the Gate b1 outside the
  // plan brings what is left of Q's room; and Q is edited.
  const planned = (cap: number | null, p = 1): Graph => ({
    nodes: [pool('P', p), pool('Z', 5), pool('L', 0), pool('Q', 0, cap), gate('a1'), conv('c1'), gate('b1')],
    edges: [res('p', 'P', 'a1', '1'), res('h', 'a1', 'c1', '3'), res('o', 'c1', 'Q', '1'), res('zi', 'Z', 'b1', '5'), res('zo', 'b1', 'Q', '1')],
  })
  it('edited before the moves, a plan`s promise and a move from outside it: the plan makes 1/3, the Gate brings exactly the rest of what the edited level leaves, the Pool ends full', () => {
    const g = planned(1)
    g.edges.push(label('l', 'L', 'Q', '=0.3'))
    const [s] = run(g)
    expect(s.stateEvents.length).toBe(1)
    expect(same(s.moved('o'), frac(1, 3))).toBe(true)
    expect(same(s.moved('zo'), sub(sub(fromInt(1), exactDouble(0.3)), frac(1, 3)))).toBe(true)
    expect(same(add(exactDouble(0.3), add(s.moved('o'), s.moved('zo'))), fromInt(1))).toBe(true) // the edited start and the two moves: exactly the capacity
    expect(s.stored.Q).toBe(1)
    expect(same(s.balance('a1'), ZERO)).toBe(true)
    expect(same(s.balance('b1'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('the same where the edited level leaves less than the plan would make: the plan is held to that room exactly, and the Gate outside has none', () => {
    const g = planned(0.5)
    g.edges.push(label('l', 'L', 'Q', '=0.3'))
    const [s] = run(g)
    const room = sub(exactDouble(0.5), exactDouble(0.3))
    expect(same(s.moved('o'), room)).toBe(true)
    expect(same(s.moved('h'), add(room, add(room, room)))).toBe(true) // the Converter's one part of a run on its input: 3 a run
    expect(same(s.moved('zo'), ZERO)).toBe(true)
    expect(s.stored.Q).toBe(0.5)
    expect(s.outside).toEqual([])
  })
  it('edited after the moves: the plan and the Gate fill it exactly, it is stored as 1, and the edit of +0.1 is held to the capacity', () => {
    const g = planned(1)
    g.edges.push(label('l', 'b1', 'Q', '+0.1', { timing: 'afterPull', when: 'source-fired' }))
    const [s] = run(g)
    expect(same(s.moved('o'), frac(1, 3))).toBe(true)
    expect(same(s.moved('zo'), frac(2, 3))).toBe(true)
    expect(same(s.level('Q'), fromInt(1))).toBe(true)
    expect(s.stored.Q).toBe(1)
    expect(s.outside).toEqual([])
  })
  it('the Pool a plan takes from, lowered before the moves (1 to 0.3): the pull reads the Pool as the step began, and the record takes it under 0 (issue #582, the exception of §E4)', () => {
    // What a line may take of a Pool is its value at the start of the step less what the step
    // has taken; an edit before the moves changes the level the moves are applied to, not that.
    // So the plan takes 1 of a Pool the edit has set to 0.3: the exact level goes under 0 and
    // the value stored is held at 0. It is the one case here where the record leaves a Pool's
    // bounds; which reading a later specification takes is for issue #582.
    const g = planned(null)
    g.edges.push(label('l', 'L', 'P', '=0.3'))
    const [s] = run(g)
    expect(same(s.moved('p'), fromInt(1))).toBe(true)
    expect(same(s.moved('o'), frac(1, 3))).toBe(true)
    expect(s.stored.P).toBe(0)
    expect(same(s.balance('a1'), ZERO)).toBe(true)
    expect(s.outside.length).toBe(1)
    expect(s.outside[0].pool).toBe('P')
    expect(s.outside[0].what).toBe('under')
    expect(s.outside[0].edgeId).toBe('p')
    // by the 1 the line took less the double the edit left, 1 + (0.3 - 1)
    expect(same(s.outside[0].by, sub(fromInt(1), exactDouble(1 + (0.3 - 1))))).toBe(true)
  })
  it('the same Pool raised before the moves (0 to 0.3): nothing is taken of it in that step (the pull reads 0), and it holds 0.3 after', () => {
    const g = planned(null, 0)
    g.edges.push(label('l', 'L', 'P', '=0.3'))
    const [s] = run(g)
    expect(same(s.moved('p'), ZERO)).toBe(true)
    expect(s.stored.P).toBe(0.3)
    expect(s.outside).toEqual([])
  })
})

describe('a Converter outside every plan with a line from a Source (issue #581)', () => {
  // A line from a Source into a Converter makes no group, so the Converter is in no plan. The
  // Source pushes nothing into a Converter; its line still counts in a full run (2 + 3 = 5).
  // That rule is issue #581's and is unchanged (SEMANTICS-E.md, E-open 4); these pin that the
  // amounts it gives are exact.
  const fed = (a: number, cap: number | null = null, mode: Mode = 'pullAny'): Graph => ({
    nodes: [source('s'), pool('A', a), pool('Q', 0, cap), conv('c', mode)],
    edges: [res('x', 's', 'c', '2'), res('a', 'A', 'c', '3'), res('o', 'c', 'Q', '5')],
  })
  it('the Converter makes 3/5 of a run from its Pool line alone', () => {
    const [s] = run(fed(10))
    expect(same(s.moved('a'), fromInt(3))).toBe(true)
    expect(same(s.moved('o'), fromInt(3))).toBe(true)
  })
  it('a Pool holding 1 of the 3 a run takes: all of it is taken (a third of a run, exactly), nothing is left in it', () => {
    const [s1, s2] = run(fed(1), 2)
    expect(same(s1.moved('a'), fromInt(1))).toBe(true)
    expect(same(s1.moved('o'), fromInt(1))).toBe(true)
    expect(same(s1.level('A'), ZERO)).toBe(true)
    expect(same(s2.moved('a'), ZERO)).toBe(true) // (a third of a run as a double takes 1 - 2^-54 and leaves the rest for the next step)
  })
  it('an output Pool with room for 1.7: it is filled exactly, and the next step takes nothing', () => {
    const [s1, s2] = run(fed(10, 1.7), 2)
    expect(same(s1.moved('o'), exactDouble(1.7))).toBe(true)
    expect(same(s1.level('Q'), exactDouble(1.7))).toBe(true)
    expect(same(s1.moved('a'), fromInt(3))).toBe(true) // issue #581's rule: the Pool line in full; 1.3 is lost, with a notice
    expect(same(s2.moved('a'), ZERO)).toBe(true)
    expect(s1.outside).toEqual([])
  })
  it('`pull all`: the Source line never delivers, a full run is never there, nothing moves', () => {
    const [s] = run(fed(10, null, 'pullAll'))
    expect(same(s.moved('a'), ZERO)).toBe(true)
    expect(s.stored.A).toBe(10)
  })
})

describe('an amount under 1e-9 in a plan (SEMANTICS-E.md §E8), and a Pool`s room against a small net inflow (§E14)', () => {
  const near = (a: Rational, b: Rational) => {
    // the same amount to nine places (a Pool's 9e-12 is a double, a hair off the decimal)
    const d = cmp(a, b) >= 0 ? sub(a, b) : sub(b, a)
    return cmp(b, ZERO) === 0 ? cmp(a, ZERO) === 0 : cmp(div(d, b), dec('0.000000001')) <= 0
  }
  it('§E8, generated graph, seed 37: a tree of a Gate, a Gate and a Converter on a full Pool moves at 10^-12 what it moves at scale 1, line by line, times the scale', () => {
    const big = plainGraph(37, 0)
    const small = plainGraph(37, -12)
    const [a] = run(big)
    const [b] = run(small)
    const scale = dec('0.000000000001')
    let moved = 0
    for (const e of big.edges) {
      const want = mul(a.moved(e.id), scale)
      if (cmp(want, ZERO) > 0) moved++
      expect(near(b.moved(e.id), want), `${e.id}: ${Number(b.moved(e.id).num) / Number(b.moved(e.id).den)}`).toBe(true)
    }
    expect(moved).toBeGreaterThan(5) // the comparison is of a step in which lines move
    for (const g of ['g0', 'g1']) expect(same(b.balance(g), ZERO), g).toBe(true)
    expect(b.outside).toEqual([])
  })
  it('§E8, by hand: a Gate and a Converter that return to a Pool of 9e-12 at its capacity what they take from it move 9e-12', () => {
    // P 9e-12 of 9e-12; P -9e-12-> g ; g -9e-12-> c ; c -9e-12-> P. At scale 1 (9 of 9) it moves 9.
    const loop = (n: string, v: number): Graph => ({ nodes: [pool('P', v, v), gate('g'), conv('c')], edges: [res('a', 'P', 'g', n), res('b', 'g', 'c', n), res('o', 'c', 'P', n)] })
    const [a] = run(loop('9', 9))
    expect(same(a.moved('a'), fromInt(9))).toBe(true)
    const [b] = run(loop('0.000000000009', 9e-12))
    expect(cmp(b.moved('a'), ZERO)).toBe(1)
    expect(same(b.moved('a'), b.moved('b'))).toBe(true)
    expect(same(b.moved('b'), b.moved('o'))).toBe(true)
    expect(b.outside).toEqual([])
  })
  it('§E14, a Source line and a Pool at its capacity (generated graph with Source lines, seed 18): at 10^-12 nothing moves, as at scale 1; nothing is taken and lost', { timeout: 60_000 }, () => {
    for (const n of [0, -12]) {
      const g = graphWithSourceLines(18, n)
      const [s] = run(g)
      // the Converter c0 and its lines: nothing in, nothing out (the Source's push into a Pool is its own line)
      for (const e of g.edges.filter((x) => x.source === 'c0' || x.target === 'c0')) expect(same(s.moved(e.id), ZERO), `${e.id} at 10^${n}`).toBe(true)
      expect(s.outside).toEqual([])
    }
  })
  it('§E14, a Pool reached by two paths (generated graph with Source lines, seed 2514, at 10^-12): a Converter makes into a Pool directly and through a Gate, 1e-11 a run on balance; the Pool is not filled past its capacity', () => {
    const g = graphWithSourceLines(2514, -12)
    const [s] = run(g)
    expect(s.outside).toEqual([])
    expect(cmp(s.level('p0'), exactDouble(1e-11))).toBeLessThanOrEqual(0)
    expect(cmp(s.moved('e9'), ZERO)).toBe(1) // and the Converter does run, as far as the room goes
  })
  it('§E14, in a plan: a Converter that makes 1e-10 a run into a Pool at its capacity does not run; with room for it, it runs and the Pool holds what it made', () => {
    const made = (cap: number): Graph => ({ nodes: [pool('P', 10), pool('Q', 5, cap), gate('g'), conv('c')], edges: [res('a', 'P', 'g', '3'), res('b', 'g', 'c', '3'), res('o', 'c', 'Q', '0.0000000001')] })
    const [full] = run(made(5))
    for (const e of ['a', 'b', 'o']) expect(same(full.moved(e), ZERO), e).toBe(true)
    expect(full.stored).toEqual({ P: 10, Q: 5 })
    expect(full.outside).toEqual([])
    const [room] = run(made(6))
    expect(same(room.moved('a'), fromInt(3))).toBe(true)
    expect(same(room.moved('o'), dec('0.0000000001'))).toBe(true)
    expect(room.outside).toEqual([])
  })
  it('§E14, a Converter outside a plan with Pool lines only: the same (its net into the full Pool is 1e-10 a run)', () => {
    const made = (cap: number): Graph => ({ nodes: [pool('P', 10), pool('Q', 5, cap), conv('c')], edges: [res('a', 'P', 'c', '3'), res('o', 'c', 'Q', '0.0000000001')] })
    const [full] = run(made(5))
    for (const e of ['a', 'o']) expect(same(full.moved(e), ZERO), e).toBe(true)
    expect(full.stored).toEqual({ P: 10, Q: 5 })
    const [room] = run(made(6))
    expect(same(room.moved('a'), fromInt(3))).toBe(true)
    expect(same(room.moved('o'), dec('0.0000000001'))).toBe(true)
  })
})

// A line of any rate above 0 is live for the groups, a weight of its Gate's shares, an input or
// an output of a Converter, and is asked what its target accepts. A small share is neither
// dropped nor written off as a loss: what a target cannot take is settled above it, in the
// Gate's throughput and the group's plan.
describe('a rate above 0 is a line: a line of 1e-9 does what the same line at a rate of 1 does (SEMANTICS-E.md §E10, §E7)', () => {
  const T = '0.000000001'
  // g1 takes 1 of A and shares it over a line into the Gate h and a line into R; h has a line of
  // 5 from B and delivers into Q. A Gate with a router above it and a Pool line of its own is
  // planned with the Gate above, whatever the rate of the line between them.
  const reach = (xRate: string, rRate: string, cap: number | null = 1, mode: Mode = 'pullAny'): Graph => ({
    nodes: [pool('A', 1), pool('B', 10), pool('Q', 0, cap), pool('R', 0), gate('g1'), gate('h', mode)],
    edges: [res('a', 'A', 'g1', '1'), res('x', 'g1', 'h', xRate), res('r', 'g1', 'R', rRate), res('b', 'B', 'h', '5'), res('q', 'h', 'Q', '1')],
  })
  it('a Gate handed a share under the display threshold (1/4000000001) on a line of 5e-10: it passes it on, and its own line brings exactly the rest of the room', () => {
    const [s] = run(reach('0.0000000005', '2'))
    expect(same(s.moved('x'), frac(1, 4000000001))).toBe(true)
    expect(same(s.moved('b'), frac(4000000000, 4000000001))).toBe(true)
    expect(same(s.moved('q'), fromInt(1))).toBe(true)
    expect(same(s.balance('h'), ZERO)).toBe(true)
    expect(same(s.level('Q'), fromInt(1))).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('handed a third (both lines out of the Gate above at rates at or under 1e-9): its own line brings exactly 2/3', () => {
    const [s] = run(reach('0.0000000005', '0.000000001'))
    expect(same(s.moved('x'), frac(1, 3))).toBe(true)
    expect(same(s.moved('b'), frac(2, 3))).toBe(true)
    expect(same(s.moved('q'), fromInt(1))).toBe(true)
    expect(same(s.balance('h'), ZERO)).toBe(true)
    expect(same(s.level('Q'), fromInt(1))).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('with room for all, `pull all`: 5 of its line and the third, 16/3 on', () => {
    const [s] = run(reach('0.0000000005', '0.000000001', null, 'pullAll'))
    expect(same(s.moved('b'), fromInt(5))).toBe(true)
    expect(same(s.moved('q'), frac(16, 3))).toBe(true)
    expect(same(s.balance('h'), ZERO)).toBe(true)
  })
  it('`pull all` and short of room: the group moves nothing, and nothing is handed and held', () => {
    // before this change a third stayed with the Gate and was reported lost
    const g = reach('0.0000000005', '0.000000001', 1, 'pullAll')
    const [s] = run(g)
    still(s, g)
    expect(same(s.balance('h'), ZERO)).toBe(true)
    expect(s.stored.A).toBe(1)
    expect(s.stored.B).toBe(10)
  })
  it('a Gate whose only line out, at a rate of 7e-10, enters a `pull all` Gate that cannot bring what its own line asks: the Gate above takes nothing, and nothing is handed on and refused', () => {
    const g: Graph = { nodes: [pool('A', 1), pool('B', 0), pool('Q', 0), gate('g0'), gate('g1', 'pullAll')], edges: [res('a', 'A', 'g0', '1'), res('x', 'g0', 'g1', '0.0000000007'), res('b', 'B', 'g1', '5'), res('q', 'g1', 'Q', '2')] }
    const [s] = run(g)
    expect(same(s.moved('a'), ZERO)).toBe(true)
    expect(s.stored.A).toBe(1)
    expect(s.notices).toEqual([])
  })
  it('no Gate hands on what the Gate below cannot take: nothing moves and nothing is lost (reduced from seed 5148)', () => {
    // before this change 1 moved and 5e-10 of it was dropped without a record
    const g: Graph = {
      nodes: [pool('p0', 0), pool('p1', 1), gate('g0'), gate('g1'), gate('g2', 'pullAll'), gate('g3')],
      edges: [res('e0', 'p1', 'g0', '1'), res('e1', 'p1', 'g1', '1'), res('e3', 'g1', 'g2', T), res('e4', 'p1', 'g2', '1'), res('e5', 'g0', 'g3', T), res('e11', 'g0', 'p0', '2'), res('e12', 'g1', 'p1', T), res('e13', 'g2', 'p0', '1')],
    }
    const [s] = run(g)
    still(s, g)
    expect(s.stored).toEqual({ p0: 0, p1: 1 })
  })
  it('a line into a Gate with no line out holds the Gate above, at a rate of 1e-9 as at a rate of 1 (the rule is one rule)', () => {
    const at = (rate: string): Graph => ({ nodes: [pool('P', 1), pool('Q', 0), gate('g0'), gate('g3')], edges: [res('a', 'P', 'g0', '1'), res('t', 'g0', 'g3', rate), res('q', 'g0', 'Q', '2')] })
    for (const rate of [T, '1']) still(run(at(rate))[0], at(rate))
  })
  it('a Converter whose input line is 2e-10 runs once at most, so its Gate moves 4.0000000002 of the 5 it could; the Converter makes its 1 (reduced from seed 2622)', () => {
    const g: Graph = { nodes: [pool('p2', 11), gate('g0'), conv('c1')], edges: [res('e2', 'p2', 'g0', '5'), res('e3', 'g0', 'c1', '0.0000000002'), res('e4', 'g0', 'p2', '4'), res('e5', 'c1', 'p2', '1')] }
    const [s] = run(g)
    expect(same(s.moved('e2'), dec('4.0000000002'))).toBe(true)
    expect(same(s.moved('e3'), dec('0.0000000002'))).toBe(true)
    expect(same(s.moved('e4'), fromInt(4))).toBe(true)
    expect(same(s.moved('e5'), fromInt(1))).toBe(true) // one part of a run on its input and its output: 1
    expect(same(s.balance('g0'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('the share of 1/7000000001 on a line of 1e-9 is an input the Converter runs on, at one part of a run on both its lines (reduced from seed 108)', () => {
    const g: Graph = { nodes: [pool('p1', 0), pool('p2', 1), gate('g0'), conv('c1')], edges: [res('e1', 'p2', 'g0', '1'), res('e2', 'g0', 'c1', T), res('e6', 'g0', 'p1', '7'), res('e8', 'c1', 'p2', '1')] }
    const [s] = run(g)
    expect(same(s.moved('e2'), frac(1, 7000000001))).toBe(true)
    expect(same(s.moved('e6'), frac(7000000000, 7000000001))).toBe(true)
    expect(same(div(s.moved('e2'), dec(T)), div(s.moved('e8'), fromInt(1)))).toBe(true) // the Converter: one part of a run
    expect(same(s.balance('g0'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('a `pull all` Gate that cannot reach what its lines ask is in the plan of the Gate above: nothing moves, no share is handed to it and held (reduced from seed 536)', () => {
    const g: Graph = { nodes: [pool('p0', 0), pool('p2', 1), gate('g0'), gate('g2', 'pullAll')], edges: [res('e1', 'p2', 'g0', '1'), res('e6', 'g0', 'g2', T), res('e8', 'p2', 'g2', '1'), res('e10', 'g0', 'p2', '8'), res('e12', 'g2', 'p0', '1')] }
    const [s] = run(g)
    still(s, g)
    expect(same(s.balance('g2'), ZERO)).toBe(true)
  })
  it('a share that would go into a Pool at its capacity is not moved: the Gate above is held, and no Pool leaves its bounds (reduced from seed 474)', () => {
    const g: Graph = { nodes: [pool('p1', 3, 3), pool('p2', 1), conv('c0'), gate('g1'), gate('g3')], edges: [res('e2', 'c0', 'g1', '1'), res('e3', 'p2', 'g1', '1'), res('e8', 'g1', 'g3', T), res('e9', 'g1', 'p2', '6'), res('e11', 'g3', 'p1', '1')] }
    const [s] = run(g)
    still(s, g)
    expect(s.stored).toEqual({ p1: 3, p2: 1 })
  })
  it('a Converter with a line of 1e-9 from a Gate that brings nothing does not run, as with that line at a rate of 1 (the shape of seed 5162, by hand)', () => {
    const at = (rate: string, below: boolean): Graph =>
      below
        ? { nodes: [pool('P', 1), pool('R', 0), pool('Q', 0), gate('g0'), conv('c3'), gate('g4')], edges: [res('t', 'g0', 'c3', rate), res('p', 'P', 'c3', '1'), res('o', 'c3', 'g4', '1'), res('r', 'R', 'g4', '1'), res('q', 'g4', 'Q', '1')] }
        : { nodes: [pool('P', 1), pool('Q', 0), gate('g0'), conv('c3')], edges: [res('t', 'g0', 'c3', rate), res('p', 'P', 'c3', '1'), res('o', 'c3', 'Q', '1')] }
    for (const rate of [T, '1']) for (const below of [true, false]) still(run(at(rate, below))[0], at(rate, below))
  })
  // The lines of a Pool, with an amount under 1e-9 a step (§E7): 1e-9 is not a threshold that
  // takes a move away.
  const H = '0.0000000005'
  it('a Source pushes 5e-10 a step into a Pool: it is moved, and after two steps the Pool holds 1e-9', () => {
    const g: Graph = { nodes: [source('s'), pool('Q', 0)], edges: [res('in', 's', 'Q', H)] }
    const out = run(g, 2)
    expect(cmp(out[0].moved('in'), ZERO)).toBe(1)
    expect(out[1].stored.Q).toBe(1e-9)
    expect(out[1].outside).toEqual([])
  })
  it('a Drain pulls 5e-10 a step from a Pool: it is moved, and the Pool falls by it', () => {
    const [s] = run({ nodes: [pool('P', 1), drain('d')], edges: [res('out', 'P', 'd', H)] })
    expect(cmp(s.moved('out'), ZERO)).toBe(1)
    expect(s.stored.P).toBe(0.9999999995)
  })
  it('a line of 5e-10 from a Pool into a Gate, into a Converter as its only input, and out of a Converter as its only output: each is moved, a Converter at one part of a run on its lines', () => {
    const [g] = run({ nodes: [pool('P', 1), pool('Q', 0), gate('g')], edges: [res('a', 'P', 'g', H), res('q', 'g', 'Q', '1')] })
    expect(same(g.moved('a'), g.moved('q'))).toBe(true)
    expect(cmp(g.moved('a'), ZERO)).toBe(1)
    const [c] = run({ nodes: [pool('P', 1), pool('Q', 0), conv('c')], edges: [res('a', 'P', 'c', H), res('o', 'c', 'Q', '1')] })
    expect(same(c.moved('a'), dec(H))).toBe(true)
    expect(same(c.moved('o'), fromInt(1))).toBe(true)
    const [d] = run({ nodes: [pool('P', 2), pool('Q', 0), conv('c')], edges: [res('a', 'P', 'c', '1'), res('o', 'c', 'Q', H)] })
    expect(same(d.moved('a'), fromInt(1))).toBe(true)
    expect(same(d.moved('o'), dec(H))).toBe(true)
  })
  it('a Converter with inputs of 1 and 1e-9 from two Pools runs only as far as both inputs go (the small Pool empty: no run; holding 5e-10: about half a run)', () => {
    const two = (p: number): Graph => ({ nodes: [pool('P', p), pool('R', 1), pool('Q', 0), conv('c')], edges: [res('a', 'P', 'c', T), res('b', 'R', 'c', '1'), res('o', 'c', 'Q', '1')] })
    still(run(two(0))[0], two(0))
    const [h] = run(two(0.0000000005))
    expect(same(div(h.moved('a'), dec(T)), h.moved('b'))).toBe(true)
    expect(same(h.moved('b'), h.moved('o'))).toBe(true)
    expect(same(h.level('P'), ZERO)).toBe(true)
    const [f] = run(two(1))
    expect(same(f.moved('a'), dec(T))).toBe(true)
    expect(same(f.moved('o'), fromInt(1))).toBe(true)
  })
  it('a rate that is worked out is read as the same rate written: a Parameter of 2e-10, a percent of 0.0000001%', () => {
    const param = (id: string, value: number): LoopNode => ({ id, type: 'parameter', position: { x: 0, y: 0 }, data: { kind: 'parameter', label: id, value } })
    const fed = (rate: string, extra: Graph['nodes'] = []): Graph => ({ nodes: [pool('p2', 11), gate('g0'), conv('c1'), ...extra], edges: [res('e2', 'p2', 'g0', '5'), res('e3', 'g0', 'c1', rate), res('e4', 'g0', 'p2', '4'), res('e5', 'c1', 'p2', '1')] })
    const [w] = run(fed('0.0000000002'))
    const [p] = run(fed('@p', [param('p', 0.0000000002)]))
    for (const e of ['e2', 'e3', 'e4', 'e5']) expect(same(w.moved(e), p.moved(e)), e).toBe(true)
    expect(same(p.moved('e5'), fromInt(1))).toBe(true)
    const held = (rate: string): Graph => ({ nodes: [pool('P', 1), pool('Q', 0), gate('g0'), gate('g3')], edges: [res('a', 'P', 'g0', '1'), res('t', 'g0', 'g3', rate), res('q', 'g0', 'Q', '2')] })
    still(run(held('0.0000001%'))[0], held('0.0000001%'))
  })
})

describe('a planned `pull all` Gate that cannot bring what its lines ask (SEMANTICS-E.md §E11)', () => {
  // A group that does not rejoin. g0 (`pull all`) asks 7 of A; G has it and a line of its own (3
  // of B) as its two supplies and feeds the Converter c (20 a run, makes 2 into Q, capacity 1).
  // Outside the plan: y takes 1 of A; z brings what is left of Q's room.
  const open = (a: number): Graph => ({
    nodes: [pool('A', a), pool('B', 10), pool('Z', 5), pool('Q', 0, 1), pool('R', 0), gate('g0', 'pullAll'), gate('G'), conv('c'), gate('y'), gate('z')],
    edges: [
      res('a', 'A', 'g0', '7'), res('x', 'g0', 'G', '1'), res('b', 'B', 'G', '3'), res('h', 'G', 'c', '20'), res('o', 'c', 'Q', '2'),
      res('yi', 'A', 'y', '1'), res('yo', 'y', 'R', '1'), res('zi', 'Z', 'z', '5'), res('zo', 'z', 'Q', '1'),
    ],
  })
  it('with all its lines ask (A holds 8, the Gate asks 7): the Gate moves 7, G hands on 10, the Converter runs at a half', () => {
    const [s] = run(open(8))
    expect(same(s.moved('a'), fromInt(7))).toBe(true)
    expect(same(s.moved('h'), fromInt(10))).toBe(true)
    expect(same(s.moved('o'), fromInt(1))).toBe(true)
    expect(same(s.moved('zo'), ZERO)).toBe(true) // the room was promised to the Converter
    expect(same(s.moved('yi'), fromInt(1))).toBe(true) // what the plan did not claim of A
  })
  it('short (A holds 2): the Gate is planned at 0, and the others are planned without it: G moves its own 3, the Converter runs at 3/20', () => {
    const [s] = run(open(2))
    expect(same(s.moved('a'), ZERO)).toBe(true)
    expect(same(s.moved('x'), ZERO)).toBe(true)
    expect(same(s.moved('b'), fromInt(3))).toBe(true)
    expect(same(s.moved('h'), fromInt(3))).toBe(true)
    expect(same(s.moved('o'), dec('0.3'))).toBe(true)
  })
  it('and the promises are for that plan only: nothing of A is claimed (y takes its 1), and Q`s room beyond 0.3 is free (z brings exactly 0.7)', () => {
    const [s] = run(open(2))
    expect(same(s.moved('yi'), fromInt(1))).toBe(true)
    expect(same(s.moved('zo'), dec('0.7'))).toBe(true)
    expect(same(s.level('Q'), fromInt(1))).toBe(true)
    expect(same(s.level('A'), fromInt(1))).toBe(true)
    expect(s.outside).toEqual([])
  })

  // A group of Gates that splits and rejoins: g1 splits to g2 and J, g2 goes on to J. g0
  // (`pull all`, 7 of A) feeds g1, which also takes 3 of B. Outside: z into Q (capacity 4), y of B.
  const rejoin = (a: number): Graph => ({
    nodes: [pool('A', a), pool('B', 10), pool('Z', 5), pool('Q', 0, 4), pool('R', 0), gate('g0', 'pullAll'), gate('g1'), gate('g2'), gate('J'), gate('y'), gate('z')],
    edges: [
      res('a', 'A', 'g0', '7'), res('x', 'g0', 'g1', '1'), res('b', 'B', 'g1', '3'), res('s1', 'g1', 'g2', '1'), res('s2', 'g1', 'J', '1'), res('t', 'g2', 'J', '1'), res('o', 'J', 'Q', '1'),
      res('yi', 'B', 'y', '10'), res('yo', 'y', 'R', '1'), res('zi', 'Z', 'z', '5'), res('zo', 'z', 'Q', '1'),
    ],
  })
  const groupLines = ['a', 'x', 'b', 's1', 's2', 't', 'o']
  it('a group that rejoins, with all its lines ask (A holds 7), and room: the group runs (7 and 3 in, 10 through the join)', () => {
    const g = rejoin(7)
    ;(g.nodes.find((n) => n.id === 'Q')!.data as { capacity?: number | null }).capacity = null
    const [s] = run(g)
    expect(same(s.moved('a'), fromInt(7))).toBe(true)
    expect(same(s.moved('b'), fromInt(3))).toBe(true)
    expect(same(s.moved('s1'), fromInt(5))).toBe(true)
    expect(same(s.moved('t'), fromInt(5))).toBe(true)
    expect(same(s.moved('o'), fromInt(10))).toBe(true)
  })
  it('a group that rejoins, short (A holds 2): the whole group stops; nothing is claimed or promised for it', () => {
    const [s] = run(rejoin(2))
    for (const e of groupLines) expect(same(s.moved(e), ZERO), e).toBe(true)
    expect(same(s.moved('yi'), fromInt(10))).toBe(true) // all of B is free
    expect(same(s.moved('zo'), fromInt(4))).toBe(true) // all of Q's room is free
  })
  it('a group that rejoins, with nothing to bring (A holds 0): the same rule, the whole group stops', () => {
    const [s] = run(rejoin(0))
    for (const e of groupLines) expect(same(s.moved(e), ZERO), e).toBe(true)
    expect(same(s.moved('yi'), fromInt(10))).toBe(true)
    expect(same(s.moved('zo'), fromInt(4))).toBe(true)
  })
  it('the absolute epsilon is kept: 5e-10 short of what its lines ask, the Gate and the group run', () => {
    const g = rejoin(6.9999999995)
    ;(g.nodes.find((n) => n.id === 'Q')!.data as { capacity?: number | null }).capacity = null
    const [s] = run(g)
    expect(same(s.moved('a'), exactDouble(6.9999999995))).toBe(true)
    expect(same(s.moved('o'), add(exactDouble(6.9999999995), fromInt(3)))).toBe(true)
  })
  it('generated graph, seed 13 (a rejoin; its `pull all` Gate asks 9 of Pools that can bring 4): nothing of the group moves', () => {
    const g = plainGraph(13, 0)
    const [s1] = run(g, 1)
    for (const e of g.edges) expect(same(s1.moved(e.id), ZERO), e.id).toBe(true)
  })
})

describe('a group that rejoins whose join Gate is `pull all` with a Pool line of its own (SEMANTICS-E.md §E11)', () => {
  // g1 takes 4 of B and splits it to g2 and J; g2 goes on to J. J (`pull all`) is handed those and
  // asks 6 of C with a line of its own. Outside the group: w of B, y of C, z into Q (capacity 4).
  const join = (b: number, c: number, cap: number | null = null): Graph => ({
    nodes: [pool('B', b), pool('C', c), pool('Z', 5), pool('Q', 0, cap), pool('R', 0), gate('g1'), gate('g2'), gate('J', 'pullAll'), gate('w'), gate('y'), gate('z')],
    edges: [
      res('b', 'B', 'g1', '4'), res('s1', 'g1', 'g2', '1'), res('s2', 'g1', 'J', '1'), res('t', 'g2', 'J', '1'), res('c', 'C', 'J', '6'), res('o', 'J', 'Q', '1'),
      res('wi', 'B', 'w', '10'), res('wo', 'w', 'R', '1'), res('yi', 'C', 'y', '10'), res('yo', 'y', 'R', '1'), res('zi', 'Z', 'z', '5'), res('zo', 'z', 'Q', '1'),
    ],
  })
  const groupLines = ['b', 's1', 's2', 't', 'c', 'o']
  it('its line`s Pool holds what it asks: the group runs, 4 handed and 6 of its own', () => {
    const [s] = run(join(10, 6))
    expect(same(s.moved('b'), fromInt(4))).toBe(true)
    expect(same(s.moved('t'), fromInt(2))).toBe(true)
    expect(same(s.moved('c'), fromInt(6))).toBe(true)
    expect(same(s.moved('o'), fromInt(10))).toBe(true)
  })
  it('its own line short (C holds 2 of the 6 asked): the whole group stops, and nothing stays claimed or promised for it', () => {
    const [s] = run(join(10, 2, 4))
    for (const e of groupLines) expect(same(s.moved(e), ZERO), e).toBe(true)
    expect(same(s.moved('wi'), fromInt(10))).toBe(true) // all of B is free: the group's claim on it is gone
    expect(same(s.moved('yi'), fromInt(2))).toBe(true) // all of C is free
    expect(same(s.moved('zo'), fromInt(4))).toBe(true) // all of Q's room is free: nothing is promised
  })
  it('its own line`s Pool empty (C holds 0): the same rule, the whole group stops', () => {
    const [s] = run(join(10, 0, 4))
    for (const e of groupLines) expect(same(s.moved(e), ZERO), e).toBe(true)
    expect(same(s.moved('wi'), fromInt(10))).toBe(true)
    expect(same(s.moved('zo'), fromInt(4))).toBe(true)
  })
  it('5e-10 short of what its line asks: within the absolute epsilon, the group runs on what the Pool holds', () => {
    const [s] = run(join(10, 5.9999999995))
    expect(same(s.moved('c'), exactDouble(5.9999999995))).toBe(true)
    expect(same(s.moved('b'), fromInt(4))).toBe(true)
  })
  it('what it is handed is not a demand of its own: a Gate before it that can bring 3 of the 4 it asks hands on 3, and the group runs', () => {
    const [s] = run(join(3, 6))
    expect(same(s.moved('b'), fromInt(3))).toBe(true)
    expect(same(s.moved('c'), fromInt(6))).toBe(true)
    expect(same(s.moved('o'), fromInt(9))).toBe(true)
  })
})

describe('a planned `pull all` Gate with two supplies keeps the absolute epsilon of its turn (SEMANTICS-E.md §E11, §E12)', () => {
  // G (`pull all`) has a Gate and a line of its own (6 of A) as its supplies and feeds a Converter.
  const two = (a: number): Graph => ({
    nodes: [pool('P', 2), pool('A', a), pool('Q', 0), gate('g0'), gate('G', 'pullAll'), conv('c')],
    edges: [res('p', 'P', 'g0', '2'), res('x', 'g0', 'G', '1'), res('b', 'A', 'G', '6'), res('h', 'G', 'c', '16'), res('o', 'c', 'Q', '2')],
  })
  it('all its line asks is there: it moves 8 and the Converter runs at a half', () => {
    const [s] = run(two(6))
    expect(same(s.moved('b'), fromInt(6))).toBe(true)
    expect(same(s.moved('h'), fromInt(8))).toBe(true)
    expect(same(s.moved('o'), fromInt(1))).toBe(true)
  })
  it('5e-10 short of what its line asks: within the absolute epsilon, it runs on what the Pool holds', () => {
    const [s] = run(two(5.9999999995))
    expect(same(s.moved('b'), exactDouble(5.9999999995))).toBe(true)
    expect(same(s.moved('x'), fromInt(2))).toBe(true)
    expect(same(s.level('A'), ZERO)).toBe(true)
  })
  it('1 short: a real shortfall, nothing of the group moves', () => {
    const [s] = run(two(5))
    for (const e of ['p', 'x', 'b', 'h', 'o']) expect(same(s.moved(e), ZERO), e).toBe(true)
  })
  it('generated graph, seed 5904 at 10^-3, step 1: a line that writes 0.006 and a Pool whose double has 6.4e-19 less left: the Gate runs', () => {
    const [s1] = run(plainGraph(5904, -3), 1)
    expect(cmp(s1.moved('e7'), ZERO)).toBe(1)
    expect(cmp(sub(dec('0.006'), s1.moved('e7')), dec('0.000000001'))).toBe(-1)
    expect(s1.outside).toEqual([])
  })
  // The piece that brings the 0.008 is held 2e-18 under it by the room. Its Gate's lines put 0.001
  // and 0.007 into p0, which holds 0.001 of a capacity of 0.009: as doubles those leave 7e-19 less
  // room than the 0.008 the written rates ask. That is room that is short, by however little, and
  // the epsilon is not for it: nothing of the group moves (§E12; the first consequence listed
  // under §E14). Before this change it moved: in doubles 0.009 - 0.001 is not under 0.008.
  it('generated graph, seed 2184 at 10^-3, step 4: the room of p0 is 7e-19 short of what the lines ask (0.009 and 0.001 as doubles): nothing of the group moves', () => {
    const out = run(plainGraph(2184, -3), 4)
    for (const e of ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e9', 'e10']) expect(same(out[3].moved(e), ZERO), e).toBe(true)
    expect(out[3].outside).toEqual([])
  })
})

// The absolute epsilon in the plan of a `pull all` Gate with two supplies is for one case: a Pool
// that holds a hair less than its line asks. It is not for a fixed demand that would have to be
// made smaller because the room below is short: there the group moves nothing (SEMANTICS.md §6,
// erratum parts 3 and 9).
describe('the absolute epsilon of a planned `pull all` Gate with two supplies is for a Pool that is short, not for room that is short (SEMANTICS-E.md §E12)', () => {
  // The graph of fullPoolLoop.test.ts, B. F 10 of 10 ; F -3-> A ; A -1-> J , A -6-> F ; R -0.25-> J
  // (`pull all`) ; J -1-> c ; c -out-> F. The group returns to F what it takes when out = 12/19.
  const loopB = (out: string, r = 100): Graph => ({
    nodes: [pool('F', 10, 10), pool('R', r), gate('A'), gate('J', 'pullAll'), conv('c')],
    edges: [res('FA', 'F', 'A', '3'), res('AJ', 'A', 'J', '1'), res('AF', 'A', 'F', '6'), res('RJ', 'R', 'J', '0.25'), res('Jc', 'J', 'c', '1'), res('cF', 'c', 'F', out)],
  })
  const nothing = (s: StepOut) => {
    for (const e of ['FA', 'AJ', 'AF', 'RJ', 'Jc', 'cF']) expect(same(s.moved(e), ZERO), e).toBe(true)
  }
  it('the Pool holds 100 and the full demand returns 7.9e-14 too much to the full Pool: nothing moves (it is not made 8.5e-14 smaller)', () => {
    nothing(run(loopB('0.6315789473685'))[0])
  })
  it('to the last place: at 0.6315789473684211 (above 12/19) nothing moves; at 0.631578947368421 (below) it runs at its full demand', () => {
    nothing(run(loopB('0.6315789473684211'))[0])
    const [s] = run(loopB('0.631578947368421'))
    expect(same(s.moved('FA'), fromInt(3))).toBe(true)
    expect(same(s.moved('RJ'), dec('0.25'))).toBe(true)
  })
  it('the Pool holds exactly the 0.25 its line asks and the room is short: nothing moves (a Pool that is not short gives no leave)', () => {
    nothing(run(loopB('0.6315789473685', 0.25))[0])
  })
  it('the Pool holds 5e-10 less than its line asks and the room takes it: within the absolute epsilon, it runs on all the Pool holds', () => {
    const [s] = run(loopB('0.631578947368421', 0.2499999995))
    expect(same(s.moved('FA'), fromInt(3))).toBe(true)
    expect(same(s.moved('RJ'), exactDouble(0.2499999995))).toBe(true)
    expect(same(s.level('R'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('the Pool 5e-10 short, and a return that would be too much at the full demand but fits at what the Pool holds: it runs on all the Pool holds', () => {
    const [s] = run(loopB('0.6315789473685', 0.2499999995))
    expect(same(s.moved('RJ'), exactDouble(0.2499999995))).toBe(true)
    expect(same(s.level('R'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
  it('the Pool short by more than the absolute epsilon (0.249 of 0.25): nothing moves', () => {
    nothing(run(loopB('0.631578947368421', 0.249))[0])
  })
  // The mixed cases: a Pool that really is empty and room that is short. The leave given for the
  // Pool must not carry the room's shortfall through with it.
  it('mixed, one line: the Pool 5e-10 short and the return too much even at what the Pool holds (4.5e-11 of room): nothing moves; a rate just under that boundary runs on all the Pool holds', () => {
    // at what R holds the group returns exactly what it takes when out = (3/7) / (3/7 + 0.2499999995) = 0.63157894783...
    nothing(run(loopB('0.6315789479', 0.2499999995))[0])
    const [s] = run(loopB('0.6315789478', 0.2499999995))
    expect(same(s.moved('RJ'), exactDouble(0.2499999995))).toBe(true)
    expect(same(s.level('R'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
  })
  // G (`pull all`) has a Gate g0 and a line of its own (6 of A) as its supplies; g0 takes 1 of P1
  // and 1 of P2. P1 holds only 0.5 and is emptied; nothing is short of what g0 can bring (1.5).
  // G feeds a Converter that makes into Q: 7.5 on, 0.9375 into Q.
  const mixed = (cap: number, ownFirst: boolean): Graph => {
    const own = res('b', 'A', 'G', '6')
    const handed = res('x', 'g0', 'G', '1')
    return {
      nodes: [pool('P1', 0.5), pool('P2', 5), pool('A', 6), pool('Q', 0, cap), gate('g0'), gate('G', 'pullAll'), conv('c')],
      edges: [res('p1', 'P1', 'g0', '1'), res('p2', 'P2', 'g0', '1'), ...(ownFirst ? [own, handed] : [handed, own]), res('h', 'G', 'c', '16'), res('o', 'c', 'Q', '2')],
    }
  }
  it.each([[true], [false]])('mixed, a piece: one of its Pools is emptied and the room is 1e-10 short: nothing moves (own line first: %s)', (ownFirst) => {
    const g = mixed(0.9374999999, ownFirst)
    const [s] = run(g)
    for (const e of g.edges) expect(same(s.moved(e.id), ZERO), e.id).toBe(true)
    expect(s.stored).toEqual({ P1: 0.5, P2: 5, A: 6, Q: 0 })
  })
  it.each([[true], [false]])('the same with room for all: it runs at its full reach, 7.5 on and 0.9375 made (own line first: %s)', (ownFirst) => {
    const [s] = run(mixed(0.9375, ownFirst))
    expect(same(s.moved('h'), dec('7.5'))).toBe(true)
    expect(same(s.moved('o'), dec('0.9375'))).toBe(true)
    expect(same(s.level('P1'), ZERO)).toBe(true)
  })
  // Two pieces and no line of its own: gA takes 1 of P3; g0 takes 1 of P1 (which holds 0.5 and is
  // emptied) and 1 of P2. 2.5 on, 1.25 into Q. With Q 1e-10 short, the piece that is filled last
  // is held down by the room; if that is g0, one of its Pools is empty all the same.
  const twoPieces = (cap: number, emptiedLast: boolean): Graph => {
    const a = [gate('gA'), gate('g0')]
    return {
      nodes: [pool('P1', 0.5), pool('P2', 5), pool('P3', 5), pool('Q', 0, cap), ...(emptiedLast ? a : a.reverse()), gate('G', 'pullAll'), conv('c')],
      edges: [res('p3', 'P3', 'gA', '1'), res('p1', 'P1', 'g0', '1'), res('p2', 'P2', 'g0', '1'), ...(emptiedLast ? [res('xA', 'gA', 'G', '1'), res('x0', 'g0', 'G', '1')] : [res('x0', 'g0', 'G', '1'), res('xA', 'gA', 'G', '1')]), res('h', 'G', 'c', '4'), res('o', 'c', 'Q', '2')],
    }
  }
  it.each([[true], [false]])('mixed, two pieces: one has an emptied Pool, and the room is 1e-10 short: nothing moves (the piece with the emptied Pool filled last: %s)', (emptiedLast) => {
    const g = twoPieces(1.2499999999, emptiedLast)
    const [s] = run(g)
    for (const e of g.edges) expect(same(s.moved(e.id), ZERO), e.id).toBe(true)
  })
  // the pieces are filled in the order of their names: here the piece with the emptied Pool (gZ)
  // is the one filled last, and so the one the room holds down
  const twoPiecesZ = (cap: number): Graph => ({
    nodes: [pool('P1', 0.5), pool('P2', 5), pool('P3', 5), pool('Q', 0, cap), gate('g0'), gate('gZ'), gate('G', 'pullAll'), conv('c')],
    edges: [res('p3', 'P3', 'g0', '1'), res('p1', 'P1', 'gZ', '1'), res('p2', 'P2', 'gZ', '1'), res('x0', 'g0', 'G', '1'), res('xZ', 'gZ', 'G', '1'), res('h', 'G', 'c', '4'), res('o', 'c', 'Q', '2')],
  })
  it('mixed, two pieces: the piece held down by the room has an emptied Pool (it brings 1.4999999998 of 1.5; its Pool P1 is empty, its Pool P2 is not): nothing moves', () => {
    const g = twoPiecesZ(1.2499999999)
    const [s] = run(g)
    for (const e of g.edges) expect(same(s.moved(e.id), ZERO), e.id).toBe(true)
    const [t] = run(twoPiecesZ(1.25))
    expect(same(t.moved('h'), dec('2.5'))).toBe(true)
  })
  it.each([[true], [false]])('the same with room for all: 2.5 on, 1.25 made (the piece with the emptied Pool filled last: %s)', (emptiedLast) => {
    const [s] = run(twoPieces(1.25, emptiedLast))
    expect(same(s.moved('h'), dec('2.5'))).toBe(true)
    expect(same(s.moved('o'), dec('1.25'))).toBe(true)
  })
  // two pieces that take from one Pool: each alone reaches 1, together the Pool is 5e-10 short
  const shared = (p: number, cap: number): Graph => ({
    nodes: [pool('P', p), pool('Q', 0, cap), gate('g0'), gate('g1'), gate('G', 'pullAll'), conv('c')],
    edges: [res('p0', 'P', 'g0', '1'), res('p1', 'P', 'g1', '1'), res('x0', 'g0', 'G', '1'), res('x1', 'g1', 'G', '1'), res('h', 'G', 'c', '4'), res('o', 'c', 'Q', '2')],
  })
  it('mixed, two pieces on one Pool that is 5e-10 short of both: with room for what the Pool holds it runs on all of it; with room 5e-11 short of that, nothing moves', () => {
    const [s] = run(shared(1.9999999995, 1))
    expect(same(s.moved('h'), exactDouble(1.9999999995))).toBe(true)
    expect(same(s.level('P'), ZERO)).toBe(true)
    expect(s.outside).toEqual([])
    const g = shared(1.9999999995, 0.9999999997)
    const [t] = run(g)
    for (const e of g.edges) expect(same(t.moved(e.id), ZERO), e.id).toBe(true)
  })
})
