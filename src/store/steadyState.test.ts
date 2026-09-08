import { describe, expect, it } from 'vitest'
import type { FlowEvent } from '../engine'
import {
  flowTotals,
  isSteady,
  STEADY_ABS_EPS,
  STEADY_MIN_FLOW,
  STEADY_N,
  type SteadySample,
} from './steadyState'

const S = (step: number, pools: Record<string, number>, flow: Record<string, number>): SteadySample => ({
  step,
  pools,
  flow,
})

// a plausible fixed-point window: pools unchanged, same flow each step
const eq = (step: number) => S(step, { a: 10, b: 3 }, { e1: 2, e2: 1 })

describe('flowTotals', () => {
  it('sums raw FlowEvent.amount per edge — unfiltered', () => {
    const evs: FlowEvent[] = [
      { edgeId: 'e1', from: 'a', to: 'b', amount: 2 },
      { edgeId: 'e1', from: 'a', to: 'b', amount: 0.5 }, // a second transfer on the same edge
      { edgeId: 'e2', from: 'b', to: 'c', amount: 1 },
    ]
    expect(flowTotals(evs)).toEqual({ e1: 2.5, e2: 1 })
    expect(flowTotals([])).toEqual({})
  })
})

describe('isSteady', () => {
  it(`needs exactly ${STEADY_N} consecutive committed samples`, () => {
    expect(isSteady([])).toBe(false)
    expect(isSteady([eq(1)])).toBe(false)
    expect(isSteady([eq(1), eq(2)])).toBe(false)
    expect(isSteady([eq(1), eq(2), eq(3)])).toBe(true)
  })

  it('rejects a non-consecutive window (a gap between committed steps)', () => {
    expect(isSteady([eq(1), eq(2), eq(4)])).toBe(false)
  })

  it('true only when BOTH adjacent pairs agree — a single differing step breaks it', () => {
    // step 2 differs from 1 and 3
    expect(isSteady([eq(1), S(2, { a: 11, b: 3 }, { e1: 2, e2: 1 }), eq(3)])).toBe(false)
    // last pair differs
    expect(isSteady([eq(1), eq(2), S(3, { a: 10, b: 3 }, { e1: 3, e2: 1 })])).toBe(false)
  })

  it('compares pools and flow by id (union, missing ⇒ 0), not by array order', () => {
    // e2 absent from the middle sample ⇒ treated as 0 ⇒ differs ⇒ not steady
    expect(isSteady([eq(1), S(2, { a: 10, b: 3 }, { e1: 2 }), eq(3)])).toBe(false)
    // key order shuffled but same values ⇒ steady
    expect(
      isSteady([
        S(1, { b: 3, a: 10 }, { e2: 1, e1: 2 }),
        S(2, { a: 10, b: 3 }, { e1: 2, e2: 1 }),
        S(3, { b: 3, a: 10 }, { e2: 1, e1: 2 }),
      ]),
    ).toBe(true)
  })

  it('a stopped run (Σ flow ≈ 0 anywhere in the window) is NOT steady', () => {
    const zero = (step: number) => S(step, { a: 10, b: 3 }, {})
    expect(isSteady([zero(1), zero(2), zero(3)])).toBe(false)
    // flows present in 2 of 3 steps, gone in the last ⇒ not steady
    expect(isSteady([eq(1), eq(2), zero(3)])).toBe(false)
  })

  it('sub-ε variation is treated as unchanged; a supra-ε drift is not', () => {
    const tiny = STEADY_ABS_EPS / 2
    expect(
      isSteady([
        S(1, { a: 10, b: 3 }, { e1: 2, e2: 1 }),
        S(2, { a: 10 + tiny, b: 3 }, { e1: 2 - tiny, e2: 1 }),
        S(3, { a: 10, b: 3 + tiny }, { e1: 2, e2: 1 }),
      ]),
    ).toBe(true)
    const big = STEADY_ABS_EPS * 100
    expect(
      isSteady([eq(1), S(2, { a: 10 + big, b: 3 }, { e1: 2, e2: 1 }), eq(3)]),
    ).toBe(false)
  })

  it('a window whose flow is positive but below STEADY_MIN_FLOW is not steady', () => {
    const faint = (step: number) => S(step, { a: 10 }, { e1: STEADY_MIN_FLOW / 2 })
    expect(isSteady([faint(1), faint(2), faint(3)])).toBe(false)
  })
})
