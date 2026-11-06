import { describe, expect, it } from 'vitest'
import { runStripPath } from './runStrip'

const x = (step: number) => step * 10
const y = (v: number) => 100 - v * 100

describe('a run strip’s path', () => {
  it('is stairs: a step holds its value across the whole step', () => {
    const path = runStripPath([{ step: 1, value: 0.5 }, { step: 2, value: 0.25 }], x, y, 0)
    expect(path).toBe('M0 50.00 H10 V50.00 H20 V75.00')
  })

  it('starts a new stretch after a step with no report, and draws no line across it', () => {
    const path = runStripPath([{ step: 1, value: 1 }, { step: 2, value: null }, { step: 3, value: 1 }], x, y, 0)
    expect(path.match(/M/g)).toHaveLength(2)
  })

  it('keeps a column’s lowest and highest, so one stopped step in a long run shows', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ step: i + 1, value: i === 500 ? 0 : 1 }))
    const path = runStripPath(points, (s) => s / 100, y, 0)
    expect(path).toContain('V100.00')
    expect(path.length).toBeLessThan(600)
  })

  it('leaves out what lies before the view', () => {
    expect(runStripPath([{ step: 1, value: 1 }, { step: 5, value: 0.5 }], x, y, 4)).toBe('M40 50.00 H50 V50.00')
  })

  it('is empty with nothing to draw', () => {
    expect(runStripPath([{ step: 1, value: null }], x, y, 0)).toBe('')
  })
})
