// SEMANTICS-M5.md §M5-8 — water balance with a table, in the three levels that
// need no steady tank. The document is built for this test and holds example
// assumptions, not measured data: a Source fills a capped tank, a table takes
// water out, and the tank both fills and empties during the run.
import { describe, expect, it } from 'vitest'
import { initSim, step } from '../src/engine/step'
import { EPSILON, type SimState } from '../src/engine/types'
import type { ResourceKindDecl } from '../src/model/kinds'
import { add, cmp, exactDouble, fromInt, mul, parseDecimal, rational, sub, type Rational } from '../src/model/rational'
import { exactPlan, timetableIntegral, timetableRateFactor, type Timetable } from '../src/model/timetable'
import type { LoopEdge, LoopNode } from '../src/model/types'
import type { DocTime } from '../src/model/units'

const water: ResourceKindDecl = { name: 'water', conserved: true, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }], units: [{ name: 'L', factor: '0.001' }] }
const kinds = [water]
const time: DocTime = { step: { value: 1, unit: 'h' } }
const STEPS = 48

const intake: Timetable = {
  id: 'intake', label: 'Intake', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'linear', end: '24', after: 'repeat',
  points: [['0', '310.7'], ['6', '421.3'], ['13', '280.1'], ['20', '505.9']],
}
const demand: Timetable = {
  id: 'demand', label: 'Demand', source: 'Example assumption', unit: 'CMH', timeUnit: 'h', read: 'hold', end: '24', after: 'repeat',
  points: [['0', '250.3'], ['7', '640.9'], ['18', '333.3']],
}
const timetables = [intake, demand]

const node = (id: string, kind: string, extra: object = {}) =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id, activation: 'automatic', ...extra } }) as unknown as LoopNode
const line = (id: string, source: string, target: string, flow: string) =>
  ({ id, source, target, data: { kind: 'resource', flow } }) as unknown as LoopEdge

const doc = (initial: number, capacity: number | null) => ({
  nodes: [node('sea', 'source'), node('tank', 'pool', { initial, capacity, resourceType: 'water' }), node('city', 'drain')],
  edges: [line('in', 'sea', 'tank', '~intake'), line('out', 'tank', 'city', '~demand')],
})

function run(d: ReturnType<typeof doc>) {
  let st: SimState = initSim(d.nodes, { kinds, time })
  const steps = []
  for (let k = 1; k <= STEPS; k++) {
    const start = st.values.tank
    const r = step(d.nodes, d.edges, st, 1, 5, { kinds, time, timetables })
    st = r.state
    steps.push({ k, start, end: st.values.tank, lines: r.report.timetableLines!, events: r.report.events })
  }
  return steps
}

const plan = (t: Timetable, k: number) => exactPlan(t, k, timetableRateFactor(t, water, time)!, time)
const abs = (r: Rational) => (r.num < 0n ? rational(-r.num, r.den) : r)
const sumExact = (xs: number[]) => xs.reduce<Rational>((s, x) => add(s, exactDouble(x)), fromInt(0))
const U = rational(1n, 2n ** 53n)

describe('level 1: the ledger, for any run at every step', () => {
  it('closes through a full tank and an empty one, inside a bound read from the run', () => {
    const steps = run(doc(800, 1500))
    expect(steps.some((s) => s.end === 1500 || s.lines[0].moved < s.lines[0].planned)).toBe(true) // it does fill
    expect(steps.some((s) => s.lines[1].moved < s.lines[1].planned)).toBe(true) // it does run short
    let ledger = exactDouble(800)
    let bound = fromInt(0)
    for (const s of steps) {
      const inflow = s.lines[0].moved
      ledger = sub(add(ledger, exactDouble(inflow)), exactDouble(s.lines[1].moved))
      // two updates of one Pool, each rounding by at most u × its result
      bound = add(bound, mul(mul(fromInt(3), U), add(exactDouble(s.start), exactDouble(inflow))))
      expect(cmp(abs(sub(exactDouble(s.end), ledger)), bound)).toBeLessThanOrEqual(0)
    }
  })
})

describe('level 2: the exact path, while nothing clamps', () => {
  it('tracks the rational stock until the first step a precondition fails, and reports that step', () => {
    const initial = parseDecimal('2000')!
    const capacity = parseDecimal('2600')!
    const steps = run(doc(2000, 2600))
    let S = initial
    let D = fromInt(0)
    let failed: number | null = null
    for (const s of steps) {
      const a = plan(intake, s.k)
      const b = plan(demand, s.k)
      // the model alone: the Pool can give its whole outflow and fit its whole inflow
      if (cmp(add(S, a), capacity) > 0 || cmp(add(S, a), b) < 0) {
        failed = s.k
        break
      }
      const rho = add(abs(sub(exactDouble(s.lines[0].planned), a)), abs(sub(exactDouble(s.lines[1].planned), b)))
      D = add(add(D, rho), mul(mul(fromInt(3), U), add(add(S, D), a)))
      S = sub(add(S, a), b)
      expect(cmp(abs(sub(exactDouble(s.end), S)), D)).toBeLessThanOrEqual(0)
    }
    expect(failed).toBeGreaterThan(1) // the proof ran, and it stops here rather than past here
    expect(failed).toBeLessThan(STEPS)
    const k = failed!
    const short = steps[k - 1].lines.some((l) => l.moved < l.planned)
    expect(short).toBe(true) // the first failed precondition is a real clamp
  })
})

describe('level 3: the plan is accounted for', () => {
  it('over rationals, the plans sum to the exact integral, at every step length', () => {
    for (const value of [1, 2, 3, 4, 6, 8, 12, 24]) {
      const t: DocTime = { step: { value, unit: 'h' } }
      const f = timetableRateFactor(intake, water, t)!
      let total = fromInt(0)
      for (let k = 1; k <= 48 / value; k++) total = add(total, exactPlan(intake, k, f, t))
      expect(cmp(total, timetableIntegral(intake, fromInt(48)))).toBe(0)
    }
  })

  it('over doubles, unmet is never negative, and a line that met its plan moved it bit for bit', () => {
    let met = 0
    let short = 0
    for (const s of run(doc(800, 1500))) {
      for (const l of s.lines) {
        expect(cmp(exactDouble(l.moved), exactDouble(l.planned))).toBeLessThanOrEqual(0)
        if (l.moved === l.planned) met++
        else short++
      }
    }
    expect(met).toBeGreaterThan(0)
    expect(short).toBeGreaterThan(0)
  })

  it('between the two, each step is one rounding from its plan, and the run stays inside the sum', () => {
    const steps = run(doc(800, null))
    let exactTotal = fromInt(0)
    let allowed = fromInt(0)
    for (const s of steps) {
      const P = plan(intake, s.k)
      const gap = abs(sub(exactDouble(s.lines[0].planned), P))
      expect(cmp(gap, mul(P, U))).toBeLessThanOrEqual(0)
      exactTotal = add(exactTotal, P)
      allowed = add(allowed, mul(P, U))
    }
    const planned = sumExact(steps.map((s) => s.lines[0].planned))
    expect(cmp(abs(sub(planned, exactTotal)), allowed)).toBeLessThanOrEqual(0)
    expect(cmp(exactTotal, timetableIntegral(intake, fromInt(STEPS)))).toBe(0)
  })

  it('a shortfall above the epsilon is what the message reports', () => {
    const d = doc(100, 1500)
    let st = initSim(d.nodes, { kinds, time })
    const r = step(d.nodes, d.edges, st, 1, 5, { kinds, time, timetables })
    st = r.state
    const [, out] = r.report.timetableLines!
    const notice = r.report.notices.find((n) => n.kind === 'timetableUnmet')
    expect(out.planned - out.moved > EPSILON).toBe(notice !== undefined)
  })
})
