import { describe, expect, it } from 'vitest'
import { add, cmp, div, exactDouble, fromInt, gcd, parseDecimal, sub, type Rational } from '../model/rational'
import { graphWithSmallRates, graphWithSourceLines, plainGraph, type Graph } from './generatedGraphs.fixture'
import { EPSILON, initSim, step, type StepMove } from './index'

// SEMANTICS-E.md, read off the record of a step's moves alone (issue #572). Every check below
// works from `report.moves` and the values before and after the step, in exact fractions: none
// reads the engine's own arithmetic.
//
//   E1  a Gate's moves in equal its moves out; a Converter is at one part of a run on all its lines
//   E3  every Pool's level is within its bounds after every move of the record
//   E4  every stored value is the double nearest the Pool's exact level
//   E9  a node that a move leaves has fired; a node that has fired has a move
//   E15 the events are the record's moves above the display threshold, as the nearest doubles
//
// Generated graphs (`generatedGraphs.fixture.ts`): plain, with lines from a Source, and with
// lines of a rate at or under 1e-9; every amount times 10^n for the scales below (two of them
// put every amount under the display threshold); three steps each.

const ZERO = fromInt(0)
const amountOf = (m: StepMove): Rational => ({ num: BigInt(m.num), den: BigInt(m.den) })
const F = new Float64Array(1)
const U = new BigUint64Array(F.buffer)
/** the double next to `x` (x ≥ 0), up or down */
const beside = (x: number, up: boolean): number => {
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE
  F[0] = x
  U[0] += up ? 1n : -1n
  return F[0]
}
const dist = (a: Rational, b: Rational): Rational => (cmp(a, b) >= 0 ? sub(a, b) : sub(b, a))
/** is `d` a double nearest the fraction `r` (r ≥ 0)? */
const isNearest = (d: number, r: Rational): boolean => {
  if (!(d >= 0) || !Number.isFinite(d)) return false
  const own = dist(exactDouble(d), r)
  return cmp(own, dist(exactDouble(beside(d, true)), r)) <= 0 && (d === 0 || cmp(own, dist(exactDouble(beside(d, false)), r)) <= 0)
}

type Finding = string
/** every rule a step's record breaks, as text */
function check(g: Graph, before: Record<string, number>, r: ReturnType<typeof step>, where: string, opts: { converterParts: boolean }): Finding[] {
  const out: Finding[] = []
  const moves = r.report.moves ?? []
  const kind = new Map(g.nodes.map((n) => [n.id, n.data.kind]))
  const cap = new Map(g.nodes.filter((n) => n.data.kind === 'pool').map((n) => [n.id, (n.data as { capacity: number | null }).capacity]))
  // the record itself: amounts above 0, in lowest terms, each with the double nearest it
  for (const m of moves) {
    const a = amountOf(m)
    if (!(a.num > 0n && a.den > 0n)) out.push(`${where}: a move of ${m.num}/${m.den} on ${m.edgeId}`)
    else if (gcd(a.num, a.den) !== 1n) out.push(`${where}: the amount on ${m.edgeId} is not in lowest terms`)
    else if (!isNearest(m.shown, a)) out.push(`${where}: \`shown\` of ${m.edgeId} is ${m.shown}, not the double nearest ${m.num}/${m.den}`)
  }
  // E15
  const shown = moves.filter((m) => m.shown > EPSILON).map((m) => ({ edgeId: m.edgeId, from: m.from, to: m.to, amount: m.shown }))
  if (JSON.stringify(shown) !== JSON.stringify(r.report.events)) out.push(`${where}: the events are not the record above the threshold`)
  // E3, E4: each Pool's level, move by move
  const level = new Map<string, Rational>()
  for (const [id, k] of kind) if (k === 'pool') level.set(id, exactDouble(before[id] ?? 0))
  for (const m of moves) {
    const a = amountOf(m)
    if (level.has(m.from)) {
      const l = sub(level.get(m.from)!, a)
      level.set(m.from, l)
      if (cmp(l, ZERO) < 0) out.push(`${where}: Pool ${m.from} is under 0 after the move on ${m.edgeId}`)
    }
    if (level.has(m.to)) {
      const l = add(level.get(m.to)!, a)
      level.set(m.to, l)
      const c = cap.get(m.to)
      if (c != null && cmp(l, exactDouble(c)) > 0) out.push(`${where}: Pool ${m.to} is over its capacity after the move on ${m.edgeId}`)
    }
  }
  for (const [id, l] of level) if (cmp(l, ZERO) >= 0 && !isNearest(r.state.values[id], l)) out.push(`${where}: Pool ${id} is stored as ${r.state.values[id]}, not the double nearest its exact level`)
  // E1: the routers
  const sum = (xs: StepMove[]) => xs.reduce((t, m) => add(t, amountOf(m)), ZERO)
  for (const n of g.nodes) {
    const into = moves.filter((m) => m.to === n.id)
    const from = moves.filter((m) => m.from === n.id)
    if (n.data.kind === 'gate' && cmp(sum(into), sum(from)) !== 0) out.push(`${where}: Gate ${n.id} takes and hands on different amounts`)
    if (n.data.kind === 'converter' && opts.converterParts) {
      // the part of a run on each of its lines that moved: the amount over the written rate
      const parts = new Map<string, Rational>()
      for (const m of [...into, ...from]) parts.set(m.edgeId, add(parts.get(m.edgeId) ?? ZERO, amountOf(m)))
      let first: Rational | null = null
      for (const [edgeId, moved] of parts) {
        const rate = parseDecimal((g.edges.find((e) => e.id === edgeId)!.data as { flow: string }).flow)!
        const part = div(moved, rate)
        first ??= part
        if (cmp(part, first) !== 0) out.push(`${where}: Converter ${n.id} is not at one part of a run (line ${edgeId})`)
      }
    }
    // E9
    const fired = r.report.fired.includes(n.id)
    if (n.data.kind !== 'pool' && from.length > 0 && !fired) out.push(`${where}: ${n.id} moved something on and has not fired`)
    if (fired && into.length + from.length === 0) out.push(`${where}: ${n.id} has fired and the record has no move of its own`)
  }
  return out
}

const SEEDS = 400
const SCALES = [-12, -10, -3, 0, 9]
const STEPS = 3

function sweep(make: (seed: number, n: number) => Graph, name: string, opts: { converterParts: boolean }) {
  const found: Finding[] = []
  let steps = 0
  let moves = 0
  let notShown = 0
  for (const n of SCALES) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const g = make(seed, n)
      let st = initSim(g.nodes)
      for (let i = 0; i < STEPS; i++) {
        const before = st.values
        const r = step(g.nodes, g.edges, st, 7, 2)
        if (r.report.diagnostics.some((d) => /^Can't run/.test(d))) break
        steps++
        moves += r.report.moves?.length ?? 0
        notShown += (r.report.moves ?? []).filter((m) => !(m.shown > EPSILON)).length
        found.push(...check(g, before, r, `${name}, seed ${seed}, × 10^${n}, step ${i + 1}`, opts))
        st = r.state
      }
    }
  }
  return { found, steps, moves, notShown }
}

describe('the record of a step`s moves holds the rules of SEMANTICS-E.md on generated graphs', () => {
  it('plain graphs', { timeout: 120_000 }, () => {
    const r = sweep(plainGraph, 'plain', { converterParts: true })
    expect(r.found.slice(0, 20)).toEqual([])
    // the sweep reaches what it is for: steps that ran, and moves under the display threshold among them
    expect(r.steps).toBeGreaterThan(4000)
    expect(r.notShown).toBeGreaterThan(1000)
  })

  it('graphs with lines of a rate at or under 1e-9', { timeout: 120_000 }, () => {
    const r = sweep(graphWithSmallRates, 'small rates', { converterParts: true })
    expect(r.found.slice(0, 20)).toEqual([])
    expect(r.steps).toBeGreaterThan(4000)
    expect(r.notShown).toBeGreaterThan(1000)
  })

  // A Converter with a line from a Source is issue #581's shape (it runs from its Pool lines
  // alone, off one part of a run); that rule is not this document's, so a Converter's parts are
  // not asked here. Every other check is.
  it('graphs with lines from a Source (a Converter`s parts of a run apart: issue #581)', { timeout: 120_000 }, () => {
    const r = sweep(graphWithSourceLines, 'source lines', { converterParts: false })
    expect(r.found.slice(0, 20)).toEqual([])
    expect(r.steps).toBeGreaterThan(4000)
    expect(r.notShown).toBeGreaterThan(1000)
  })
})
