import { describe, expect, it } from 'vitest'
import {
  formatRegisterValue,
  initialPoolValues,
  registerSeriesRuns,
  registersOfSnapshot,
} from './observe'
import type { RegisterOutcome } from './registers'

// loop-model/1 §M3 / §M3.5 / §M6.2 — R(t) = evaluate every Register against the
// committed snapshot S(t). Pure, one value per step index, invalid ⇒ no value.

type N = { id: string; data: Record<string, unknown> }
const pool = (id: string, initial = 0): N => ({ id, data: { kind: 'pool', label: id, initial } })
const param = (id: string, value: number): N => ({ id, data: { kind: 'parameter', label: id, value } })
const reg = (id: string, expr: string): N => ({ id, data: { kind: 'register', label: id, expr } })

describe('registersOfSnapshot — R(t) is a pure function of S(t) and the graph', () => {
  const nodes: N[] = [
    pool('pool_rev', 100),
    pool('pool_cost', 40),
    param('p_rate', 1.5),
    reg('r_gross', '@pool_rev * @p_rate'),
    reg('r_net', '@r_gross - @pool_cost'),
  ]

  it('evaluates pools, parameters and prior registers against the given snapshot', () => {
    const r = registersOfSnapshot(nodes, { pool_rev: 100, pool_cost: 40 })
    expect(r.get('r_gross')).toEqual({ invalid: false, value: 150 })
    expect(r.get('r_net')).toEqual({ invalid: false, value: 110 })
  })

  it('is deterministic — same nodes + same snapshot ⇒ identical map', () => {
    const a = registersOfSnapshot(nodes, { pool_rev: 7, pool_cost: 2 })
    const b = registersOfSnapshot(nodes, { pool_rev: 7, pool_cost: 2 })
    expect([...a]).toEqual([...b])
  })

  it('R(0) uses the pools’ initial values via initialPoolValues', () => {
    const s0 = initialPoolValues(nodes)
    expect(s0).toEqual({ pool_rev: 100, pool_cost: 40 })
    expect(registersOfSnapshot(nodes, s0).get('r_net')).toEqual({ invalid: false, value: 110 })
  })

  it('does not mutate the nodes or the snapshot', () => {
    const snap = { pool_rev: 5, pool_cost: 1 }
    const snapCopy = JSON.stringify(snap)
    const nodesCopy = JSON.stringify(nodes)
    registersOfSnapshot(nodes, snap)
    expect(JSON.stringify(snap)).toBe(snapCopy)
    expect(JSON.stringify(nodes)).toBe(nodesCopy)
  })
})

describe('invalid Registers — §M3.4 codes, cascade, non-fatal, no value', () => {
  it('cycle / self-cycle / dangling ref / wrong-kind / depends-on-invalid', () => {
    const g: N[] = [
      pool('p'),
      reg('r_self', '@r_self + 1'),
      reg('r_a', '@r_b'),
      reg('r_b', '@r_a'),
      reg('r_dangling', '@nope + 1'),
      reg('r_wrongkind', '@p_edge'), // not a node → unknown; a real non-model node would be wrong-kind
      reg('r_div', '1 / 0'),
      reg('r_dep', '@r_div + 1'),
      reg('r_ok', '2 + 2'),
    ]
    const r = registersOfSnapshot(g, { p: 0 })
    expect(r.get('r_self')).toMatchObject({ invalid: true, code: 'M_REG_CYCLE' })
    expect(r.get('r_a')).toMatchObject({ invalid: true, code: 'M_REG_CYCLE' })
    expect(r.get('r_b')).toMatchObject({ invalid: true, code: 'M_REG_CYCLE' })
    expect(r.get('r_dangling')).toMatchObject({ invalid: true, code: 'M_REG_UNKNOWN_REF' })
    expect(r.get('r_div')).toMatchObject({ invalid: true, code: 'M_REG_EVAL' })
    expect(r.get('r_dep')).toMatchObject({ invalid: true, code: 'M_REG_DEPENDS_ON_INVALID' })
    // an invalid Register never stops the others (§M6.1)
    expect(r.get('r_ok')).toEqual({ invalid: false, value: 4 })
  })

  it('wrong-kind: a reference to a non-{pool,parameter,register} node', () => {
    const g: N[] = [
      { id: 'gate1', data: { kind: 'gate', label: 'G' } },
      reg('r', '@gate1 + 1'),
    ]
    expect(registersOfSnapshot(g, {}).get('r')).toMatchObject({ invalid: true, code: 'M_REG_WRONG_KIND' })
  })

  it('an unreadable register (expr not a string) is invalid, not a crash', () => {
    const g: N[] = [{ id: 'r', data: { kind: 'register', label: 'r', expr: 42 } }, reg('r2', '1')]
    const out = registersOfSnapshot(g, {})
    expect(out.get('r')).toMatchObject({ invalid: true })
    expect(out.get('r2')).toEqual({ invalid: false, value: 1 })
  })
})

describe('Timeline — point at t is R(t); an invalid step is a gap (never bridged)', () => {
  const nodes: N[] = [pool('p', 0), param('k', 0), reg('r', '10 / @k')] // r is 10/k → invalid when k = 0

  it('per-step evaluation over a series yields a value only where R(t) is valid', () => {
    // S(t): k stays a Parameter (constant) but imagine the run varies a pool the
    // Register divides by. Simpler: vary the divisor pool.
    const g: N[] = [pool('d', 0), reg('r', '100 / @d')]
    const series = [
      { step: 0, values: { d: 0 } }, // /0 ⇒ invalid
      { step: 1, values: { d: 4 } }, // 25
      { step: 2, values: { d: 0 } }, // invalid again
      { step: 3, values: { d: 5 } }, // 20
    ]
    const points = series
      .map((pt) => ({ step: pt.step, o: registersOfSnapshot(g, pt.values).get('r')! }))
      .filter((x) => !x.o.invalid)
      .map((x) => ({ step: x.step, value: (x.o as { value: number }).value }))
    expect(points).toEqual([
      { step: 1, value: 25 },
      { step: 3, value: 20 },
    ])
    // the invalid steps produced NO point — not a 0, not a carried value
    expect(points.find((p) => p.step === 0 || p.step === 2)).toBeUndefined()
    void nodes
  })

  it('registerSeriesRuns splits at every invalid step — separate runs, never bridged', () => {
    const ok = (v: number): RegisterOutcome => ({ invalid: false, value: v })
    const bad: RegisterOutcome = { invalid: true, code: 'M_REG_EVAL' }
    const byStep = [
      { step: 0, outcomes: new Map([['r', bad]]) },
      { step: 1, outcomes: new Map([['r', ok(25)]]) },
      { step: 2, outcomes: new Map([['r', bad]]) },
      { step: 3, outcomes: new Map([['r', ok(20)]]) },
      { step: 4, outcomes: new Map([['r', ok(21)]]) },
    ]
    const runs = registerSeriesRuns(byStep, 'r')
    expect(runs).toEqual([
      [{ step: 1, value: 25 }],
      [
        { step: 3, value: 20 },
        { step: 4, value: 21 },
      ],
    ])
    // the rendered `d` a caller would build has TWO subpaths (two `M`), and no
    // `L` connects step 1 to step 3
    const d = runs
      .map((run) => run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.step} ${p.value}`).join(' '))
      .join(' ')
    expect(d.match(/M /g)).toHaveLength(2)
    expect(d).toBe('M 1 25 M 3 20 L 4 21')
  })

  it('scrub / replay: evaluating a past snapshot gives the same R(t) as at run time', () => {
    const g: N[] = [pool('a', 0), reg('r', '@a * @a')]
    const past = { a: 6 }
    const atRunTime = registersOfSnapshot(g, past).get('r')
    const onScrub = registersOfSnapshot(g, past).get('r')
    expect(onScrub).toEqual(atRunTime)
    expect(onScrub).toEqual({ invalid: false, value: 36 })
  })
})

describe('formatRegisterValue — display only', () => {
  it('int rounds, percent scales, float is as-is', () => {
    expect(formatRegisterValue(3.6, 'int')).toBe('4')
    expect(formatRegisterValue(0.25, 'percent')).toBe('25%')
    expect(formatRegisterValue(3.5, 'float')).toBe('3.5')
    expect(formatRegisterValue(-0)).toBe('0')
  })
})
