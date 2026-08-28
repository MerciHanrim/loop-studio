import { describe, expect, it } from 'vitest'
import { buildTermChart } from './TerminationSparkline'

// Pure geometry for the termination sparkline: cumulative ended / completedRuns
// mapped into the plot box. Covers the four shapes Lumi called out —
// 0% / partial / 100% / early-clustered.

const SIZE = { w: 200, h: 34 }
// PAD = { l: 26, r: 16, t: 6, b: 14 } → y(0) = 20, y(1) = 6, x(last) = 184
const Y0 = 20
const Y1 = 6

const mk = (atOrBeforeStep: number[], completedRuns: number) => ({
  endedRuns: { atOrBeforeStep },
  completedRuns,
})

/** y of the point at step index `s` from the "M/L x y" path string */
const yAt = (path: string, s: number) => Number(path.trim().split(/\s+/)[s * 3 + 2])

describe('buildTermChart', () => {
  it('0% — nothing ended: no line, no Bead (NaN coords), just the note', () => {
    const c = buildTermChart(mk([0, 0, 0, 0], 100), SIZE)
    expect(c.anyEnded).toBe(false)
    expect(c.finalRate).toBe(0)
    expect(c.linePath).toBe('')
    expect(c.rates).toEqual([0, 0, 0, 0])
    expect(Number.isNaN(c.beadX)).toBe(true)
    expect(Number.isNaN(c.beadY)).toBe(true)
  })

  it('100% — every run ended: line reaches the top, bead at 100%', () => {
    const c = buildTermChart(mk([0, 40, 100, 100], 100), SIZE)
    expect(c.anyEnded).toBe(true)
    expect(c.finalRate).toBe(1)
    expect(c.rates).toEqual([0, 0.4, 1, 1])
    expect(c.linePath.startsWith('M ')).toBe(true)
    expect(yAt(c.linePath, 0)).toBeCloseTo(Y0) // step 0 at rate 0
    expect(yAt(c.linePath, 3)).toBeCloseTo(Y1) // final at rate 1 (top)
    expect(c.beadY).toBeCloseTo(Y1)
  })

  it('partial — half the runs ended', () => {
    const c = buildTermChart(mk([0, 10, 25, 50], 100), SIZE)
    expect(c.anyEnded).toBe(true)
    expect(c.finalRate).toBeCloseTo(0.5)
    expect(c.beadY).toBeCloseTo((Y0 + Y1) / 2) // 13
    // monotone non-decreasing rate ⇒ monotone non-increasing y
    const ys = [0, 1, 2, 3].map((s) => yAt(c.linePath, s))
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 1e-6)
  })

  it('early-clustered vs spread — the early curve rises faster off step 0', () => {
    const early = buildTermChart(mk([0, 80, 90, 95], 100), SIZE)
    const spread = buildTermChart(mk([0, 20, 55, 95], 100), SIZE)
    // same endpoint …
    expect(early.finalRate).toBeCloseTo(spread.finalRate)
    // … but the early set is already near the top by step 1
    expect(early.rates[1]).toBeGreaterThan(0.7)
    expect(spread.rates[1]).toBeLessThan(0.3)
    expect(yAt(early.linePath, 1)).toBeLessThan(yAt(spread.linePath, 1))
  })

  it('guards completedRuns = 0 without dividing by zero', () => {
    const c = buildTermChart(mk([0, 0], 0), SIZE)
    expect(c.anyEnded).toBe(false)
    expect(c.finalRate).toBe(0)
    expect(c.rates).toEqual([0, 0])
    expect(c.linePath).toBe('')
  })
})
