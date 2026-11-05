// loop-model/5 (SEMANTICS-M5.md) — a timetable through the real engine, and the
// failure shapes of the design, each with its expected result written first.
import { describe, expect, it } from 'vitest'
import type { ResourceKindDecl } from '../model/kinds'
import { add, cmp, exactDouble, fromInt, mul, parseDecimal, rational, sub, type Rational } from '../model/rational'
import { checkTimetable, exactPlan, firstUncoveredStep, readTimetables, timetableIntegral, timetableRateFactor, type Timetable } from '../model/timetable'
import type { LoopEdge, LoopNode } from '../model/types'
import type { DocTime, TimeUnit } from '../model/units'
import { initSim, step } from './step'
import { EPSILON, type SimState, type TimetableLineReport } from './types'

const water: ResourceKindDecl = {
  name: 'water',
  conserved: true,
  baseUnit: 'm³',
  units: [{ name: 'L', factor: '0.001' }],
  rateUnits: [
    { name: 'CMD', factor: '1', per: 'd' },
    { name: 'CMH', factor: '1', per: 'h' },
  ],
}
const kinds = [water]
const hours = (value: number, unit: TimeUnit = 'h'): DocTime => ({ step: { value, unit } })

const table = (over: Partial<Timetable> = {}): Timetable => ({
  id: 'intake',
  label: 'Intake',
  source: 'Example assumption',
  unit: 'CMH',
  timeUnit: 'h',
  read: 'hold',
  end: '6',
  after: 'stop',
  points: [['0', '10'], ['3', '20']],
  ...over,
})

const node = (id: string, kind: string, extra: object = {}): LoopNode =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id, ...extra } }) as unknown as LoopNode
const line = (id: string, source: string, target: string, flow: string): LoopEdge =>
  ({ id, source, target, data: { kind: 'resource', flow } }) as unknown as LoopEdge
const pool = (id: string, extra: object = {}) =>
  node(id, 'pool', { initial: 0, capacity: null, resourceType: 'water', activation: 'automatic', ...extra })

type Doc = { nodes: LoopNode[]; edges: LoopEdge[]; time?: DocTime; timetables: Timetable[] }

const intakeDoc = (t: Timetable, time: DocTime | undefined = hours(1), tank: object = {}): Doc => ({
  nodes: [node('src', 'source', { activation: 'automatic' }), pool('tank', tank)],
  edges: [line('in', 'src', 'tank', `~${t.id}`)],
  time,
  timetables: [t],
})

function run(d: Doc, steps: number) {
  let st: SimState = initSim(d.nodes, { kinds, time: d.time })
  const lines: TimetableLineReport[][] = []
  const reports = []
  for (let i = 0; i < steps; i++) {
    const r = step(d.nodes, d.edges, st, 1, 5, { kinds, time: d.time, timetables: d.timetables })
    st = r.state
    reports.push(r.report)
    lines.push(r.report.timetableLines ?? [])
  }
  return { st, lines, reports }
}

const r = (text: string): Rational => parseDecimal(text)!
const exact = (x: number) => exactDouble(x)
const factorOf = (t: Timetable, time: DocTime) => timetableRateFactor(t, water, time)!
const sumPlan = (t: Timetable, n: number, time: DocTime): Rational => {
  let total = fromInt(0)
  for (let k = 1; k <= n; k++) total = add(total, exactPlan(t, k, factorOf(t, time), time))
  return total
}

describe('a step amount is the table added up over the step', () => {
  it('holds a rate until the next point, across a step that holds the jump', () => {
    const t = table()
    // 10 for 3 h, 20 for 3 h, in 2 h steps: 20, 10 + 20, 40
    expect(run(intakeDoc(t, hours(2)), 3).lines.map((l) => l[0].planned)).toEqual([20, 30, 40])
  })

  it('reads a straight line between points', () => {
    const t = table({ read: 'linear', end: '3' })
    // from 10 to 20 over 3 h: the first hour runs from 10 to 40/3, so 35/3
    const k1 = exactPlan(t, 1, factorOf(t, hours(1)), hours(1))
    expect(cmp(k1, rational(35n, 3n))).toBe(0)
  })

  it.each([
    ['hold', table(), '90'],
    ['linear', table({ read: 'linear', end: '6', points: [['0', '10'], ['6', '15']] }), '75'],
  ])('sums to the exact integral at every step length: %s', (_n, t, whole) => {
    for (const [S, n] of [[1, 6], [2, 3], [3, 2], [6, 1]]) expect(cmp(sumPlan(t, n, hours(S)), r(whole))).toBe(0)
  })

  it('a step length that does not divide a table interval loses nothing', () => {
    const t = table({ end: '8', points: [['0', '10'], ['3', '20'], ['5', '0']], after: 'zero' })
    // 30 + 40 + 0 over 8 h; 90 min steps cross every point
    const S = hours(90, 'min')
    expect(cmp(sumPlan(t, 8, S), r('70'))).toBe(0)
  })

  it('keeps its meaning when the step length changes: the rate is per time', () => {
    const t = table({ unit: 'CMD' }) // 10 m³ per day for 3 h is 1.25 m³
    expect(cmp(sumPlan(t, 3, hours(1)), r('1.25'))).toBe(0)
    expect(cmp(sumPlan(t, 1, hours(3)), r('1.25'))).toBe(0)
  })

  it('reads the nearest double of the plan: one rounding at most', () => {
    const t = table({ unit: 'CMD', points: [['0', '7'], ['3', '11']] })
    const time = hours(1)
    const lines = run(intakeDoc(t, time), 6).lines
    lines.forEach(([l], i) => {
      const P = exactPlan(t, i + 1, factorOf(t, time), time)
      const gap = sub(exact(l.planned), P)
      const size = gap.num < 0n ? rational(-gap.num, gap.den) : gap
      expect(cmp(size, mul(P, rational(1n, 2n ** 53n)))).toBeLessThanOrEqual(0)
    })
  })

  it('does not depend on the state of the run: a step can be replayed', () => {
    const t = table()
    const d = intakeDoc(t, hours(1))
    const first = run(d, 4)
    expect(run(d, 4).lines).toEqual(first.lines)
    expect(first.st.values.tank).toBe(10 + 10 + 10 + 20)
  })
})

describe('the end of a table', () => {
  it('stop: the run ends before the first step the table does not fully cover', () => {
    const t = table({ end: '5' })
    const out = run(intakeDoc(t, hours(2)), 4) // 0-2, 2-4, then 4-6 passes the end
    expect(firstUncoveredStep(t, hours(2))).toBe(3)
    expect(out.st.ended).toBe(true)
    expect(out.st.step).toBe(2)
    expect(out.st.values.tank).toBe(20 + 30)
    expect(out.reports[2].timetableEnded).toEqual({ tableId: 'intake', label: 'Intake' })
    expect(out.reports[2].events).toEqual([])
  })

  it('hold: the last rate continues past the end', () => {
    expect(run(intakeDoc(table({ after: 'hold' }), hours(3)), 3).lines.map((l) => l[0].planned)).toEqual([30, 60, 60])
  })

  it('zero: the rate is 0 past the end, and a step crossing it is added in two parts', () => {
    expect(run(intakeDoc(table({ after: 'zero', end: '4' }), hours(3)), 3).lines.map((l) => l[0].planned)).toEqual([30, 20, 0])
  })

  it('repeat: the table starts again, and a period need not be whole steps', () => {
    const t = table({ after: 'repeat', end: '5' }) // 10 for 3 h, 20 for 2 h: 70 a period
    // the third step is 1 h of 20 and 1 h of 10, across the end of the period
    expect(run(intakeDoc(t, hours(2)), 5).lines.map((l) => l[0].planned)).toEqual([20, 30, 30, 20, 40])
    expect(cmp(sumPlan(t, 5, hours(2)), r('140'))).toBe(0)
  })

  it('repeat under linear: a straight line from the last point back to the first value', () => {
    const t = table({ read: 'linear', after: 'repeat', end: '6', points: [['0', '10'], ['3', '20']] })
    expect(cmp(timetableIntegral(t, r('6')), r('90'))).toBe(0)
    expect(cmp(timetableIntegral(t, r('12')), r('180'))).toBe(0)
  })

  it('a step that crosses the end of a repeat is exact at every step length', () => {
    const t = table({ after: 'repeat', end: '24', points: [['0', '300'], ['6', '420'], ['18', '360']] })
    const day = r('9000') // 300×6 + 420×12 + 360×6
    expect(cmp(timetableIntegral(t, r('24')), day)).toBe(0)
    for (const [S, n] of [[1, 72], [5, 15], [7, 24]]) {
      const hoursRun = S * n
      expect(cmp(sumPlan(t, n, hours(S)), timetableIntegral(t, fromInt(hoursRun)))).toBe(0)
    }
    expect(cmp(timetableIntegral(t, r('72')), mul(day, fromInt(3)))).toBe(0)
  })
})

describe('planned against moved', () => {
  it('an unclamped line moves its plan bit for bit', () => {
    const t = table({ unit: 'CMD', points: [['0', '7'], ['3', '11']] })
    for (const [l] of run(intakeDoc(t), 6).lines) expect(l.moved).toBe(l.planned)
  })

  it('a tank that fills: a Source moves only the room, and nothing is negative', () => {
    const out = run(intakeDoc(table(), hours(1), { capacity: 25 }), 4).lines.map((l) => l[0])
    expect(out.map((l) => l.moved)).toEqual([10, 10, 5, 0])
    expect(out.map((l) => l.planned)).toEqual([10, 10, 10, 20])
    for (const l of out) expect(cmp(sub(exact(l.planned), exact(l.moved)), fromInt(0))).toBeGreaterThanOrEqual(0)
  })

  it('a tank that empties: a Drain takes only what is there', () => {
    const t = table()
    const d: Doc = {
      nodes: [pool('tank', { initial: 25 }), node('out', 'drain', { activation: 'automatic' })],
      edges: [line('o', 'tank', 'out', '~intake')],
      time: hours(1),
      timetables: [t],
    }
    const out = run(d, 4).lines.map((l) => l[0])
    expect(out.map((l) => l.moved)).toEqual([10, 10, 5, 0])
    expect(run(d, 4).st.values.tank).toBe(0)
  })

  it('a plan below the engine epsilon moves nothing: unmet in the numbers, no amount', () => {
    const t = table({ unit: 'CMD', points: [['0', '0.00000001']], end: '3' })
    const [l] = run(intakeDoc(t), 1).lines[0]
    expect(l.planned).toBeLessThan(EPSILON)
    expect(l.planned).toBeGreaterThan(0)
    expect(l.moved).toBe(0)
  })

  it('the ledger closes through a full tank and an empty one, against the plan', () => {
    const t = table()
    const d: Doc = {
      nodes: [node('src', 'source', { activation: 'automatic' }), pool('tank', { capacity: 25 }), node('out', 'drain', { activation: 'automatic' })],
      edges: [line('in', 'src', 'tank', '~intake'), line('o', 'tank', 'out', '4')],
      time: hours(1),
      timetables: [t],
    }
    let st = initSim(d.nodes, { kinds, time: d.time })
    let inTotal = 0
    let outTotal = 0
    for (let i = 0; i < 6; i++) {
      const res = step(d.nodes, d.edges, st, 1, 5, { kinds, time: d.time, timetables: d.timetables })
      st = res.state
      for (const ev of res.report.events) {
        if (ev.edgeId === 'in') inTotal += ev.amount
        if (ev.edgeId === 'o') outTotal += ev.amount
      }
    }
    expect(st.values.tank).toBeCloseTo(inTotal - outTotal, 9)
  })
})

describe('a table that cannot run refuses the step', () => {
  const refused = (d: Doc) => {
    const res = step(d.nodes, d.edges, initSim(d.nodes, { kinds, time: d.time }), 1, 5, { kinds, time: d.time, timetables: d.timetables })
    expect(res.state.step).toBe(0)
    expect(res.state.ended).toBe(false)
    expect(res.report.events).toEqual([])
    return res.report.diagnostics.join(' ')
  }

  it('on a Converter line', () => {
    const d: Doc = {
      nodes: [pool('a', { initial: 100 }), node('c', 'converter', { activation: 'automatic' }), pool('b')],
      edges: [line('x', 'a', 'c', '~intake'), line('y', 'c', 'b', '1')],
      time: hours(1),
      timetables: [table()],
    }
    expect(refused(d)).toContain('only Source to Pool')
  })

  it('on a Gate line', () => {
    const d: Doc = {
      nodes: [pool('a', { initial: 100 }), node('g', 'gate', { activation: 'automatic' }), pool('b')],
      edges: [line('x', 'a', 'g', '~intake'), line('y', 'g', 'b', '1')],
      time: hours(1),
      timetables: [table()],
    }
    expect(refused(d)).toContain('only Source to Pool')
  })

  it('with no step length', () => expect(refused({ ...intakeDoc(table()), time: undefined })).toContain('no step length'))

  it('naming a table the document does not hold', () => {
    const d = intakeDoc(table())
    d.timetables = []
    expect(refused(d)).toContain('does not hold')
  })

  it('in a unit that is not a rate of the kind', () => {
    expect(refused(intakeDoc(table({ unit: 'L' })))).toContain('not a rate')
    expect(refused(intakeDoc(table({ unit: 'watts' })))).toContain('not a rate')
  })

  it('on two lines of different kinds', () => {
    const t = table()
    const d: Doc = {
      nodes: [node('s', 'source', { activation: 'automatic' }), pool('w'), node('s2', 'source', { activation: 'automatic' }), pool('e', { resourceType: 'power' })],
      edges: [line('a', 's', 'w', '~intake'), line('b', 's2', 'e', '~intake')],
      time: hours(1),
      timetables: [t],
    }
    expect(refused(d)).toContain('different kind')
  })
})

describe('a bad table is refused whole, with the row named', () => {
  const problem = (over: Partial<Timetable> | object) => {
    const out = readTimetables([{ ...table(), ...over }])
    return out.ok ? null : out.problem
  }

  it('reads a good table and defaults after to stop', () => {
    const { after: _a, ...rest } = table()
    const out = checkTimetable(rest)
    expect(out.ok && out.table.after).toBe('stop')
  })

  it('a gap in a table', () => expect(problem({ points: [['0', '10'], ['1', ''], ['2', '30']] })).toEqual({ code: 'bad-point', tableId: 'intake', row: 2 }))
  it('a time out of order', () => expect(problem({ points: [['0', '10'], ['3', '20'], ['2', '30']] })).toEqual({ code: 'time-out-of-order', tableId: 'intake', row: 3 }))
  it('a repeated time', () => expect(problem({ points: [['0', '10'], ['0', '20']] })).toEqual({ code: 'time-out-of-order', tableId: 'intake', row: 2 }))
  it('a first time that is not 0', () => expect(problem({ points: [['1', '10']] })).toEqual({ code: 'first-not-zero', tableId: 'intake', row: 1 }))
  it('a negative value', () => expect(problem({ points: [['0', '-1']] })).toEqual({ code: 'bad-point', tableId: 'intake', row: 1 }))
  it('too many points', () => {
    const points = Array.from({ length: 20_001 }, (_, i) => [String(i), '1'])
    expect(problem({ points, end: '30000' })?.code).toBe('too-many-points')
  })

  it.each([
    ['hold whose end is the last point', { read: 'hold', after: 'stop', end: '3' }],
    ['hold whose end is before the last point', { read: 'hold', after: 'hold', end: '2' }],
    ['linear, not repeating, whose end is past the last point', { read: 'linear', after: 'stop', end: '4' }],
    ['linear, repeating, whose end is the last point', { read: 'linear', after: 'repeat', end: '3' }],
    ['no end at all', { end: undefined }],
  ])('a table whose end breaks the rule: %s', (_n, over) => expect(problem(over)?.code).toBe('bad-end'))

  it('two tables with one id', () => {
    const out = readTimetables([table(), table()])
    expect(!out.ok && out.problem.code).toBe('duplicate-id')
  })
})

describe('no timetable, no change', () => {
  it('a version 4 document reads a leading ~ as it always did', () => {
    const d = intakeDoc(table())
    const res = step(d.nodes, d.edges, initSim(d.nodes), 1, 4, {})
    expect(res.report.timetableLines).toBeUndefined()
    expect(res.state.values.tank).toBe(1) // an unparseable flow behaves like an empty one
  })

  it('a version 5 document with no table line has no report key', () => {
    const d = intakeDoc(table())
    d.edges = [line('in', 'src', 'tank', '3')]
    const res = step(d.nodes, d.edges, initSim(d.nodes), 1, 5, { timetables: d.timetables })
    expect('timetableLines' in res.report).toBe(false)
    expect(res.state.values.tank).toBe(3)
  })
})
