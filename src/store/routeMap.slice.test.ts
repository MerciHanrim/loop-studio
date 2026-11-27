import { describe, expect, it } from 'vitest'
import { __slicesFor, SLICE_MS, sliceTakesAnotherStep } from './routeMap'

// issue #617 item 2 — §ER14.5: a full generation runs in slices of about
// `SLICE_MS`; after a step, another runs in the same slice only when the LAST
// step's length still fits. One slow step must not make every later slice one
// step long.

describe('#617 item 2 — the slice budget is the last step, not the slowest so far', () => {
  it('after a slow step, a short one still lets another step run in the slice', () => {
    // the job's slowest step so far (20 ms) is not part of the check any more
    expect(sliceTakesAnotherStep(2, 0.5)).toBe(true)
    expect(__slicesFor([20, 0.5, 0.5])).toEqual([[0], [1, 2]])
  })

  it('one slow step, then 100 short ones: the short ones share slices', () => {
    const durations = [20, ...Array.from({ length: 100 }, () => 0.5)]
    const slices = __slicesFor(durations)
    // 0.5 ms steps fit 16 to a slice of 8 ms: about 7 slices after the slow one, not 100
    expect(slices.length).toBeLessThanOrEqual(1 + Math.ceil(100 / (SLICE_MS / 0.5 - 1)))
    expect(slices[0]).toEqual([0])
  })

  it('controls: a slice ends once the last step no longer fits, and steady steps keep their pairs', () => {
    expect(sliceTakesAnotherStep(6, 3)).toBe(false)
    expect(sliceTakesAnotherStep(5, 3)).toBe(true)
    // a slow step is run in the slice it starts in (its length is not known before), then ends it
    expect(__slicesFor([0.5, 20, 0.5])).toEqual([[0, 1], [2]])
    // steady 3 ms steps: two to a slice
    expect(__slicesFor([3, 3, 3, 3, 3]).map((s) => s.length)).toEqual([2, 2, 1])
  })
})
