import { describe, expect, it } from 'vitest'
import type { LoopNode } from '../../model/types'
import {
  ACTIVITY_MAX_OPACITY,
  ACTIVITY_WINDOW,
  activityOpacityById,
  FRAME_MIN_SCREEN_PX,
  frameIsCreatable,
  nodeRect,
  normaliseRect,
  rectContains,
} from './frameGeom'

// docs/large-graph-readability.md §LGR6 — pure geometry + activity-score helpers.

const node = (id: string, x: number, y: number, w = 150, h = 40): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, measured: { width: w, height: h }, data: { kind: 'pool', label: id } }) as LoopNode

describe('normaliseRect — direction-agnostic', () => {
  it('L→R / R→L / T→B / B→T all give the same positive-size rect', () => {
    const want = { x: 10, y: 20, w: 90, h: 80 }
    expect(normaliseRect({ x: 10, y: 20 }, { x: 100, y: 100 })).toEqual(want)
    expect(normaliseRect({ x: 100, y: 100 }, { x: 10, y: 20 })).toEqual(want)
    expect(normaliseRect({ x: 100, y: 20 }, { x: 10, y: 100 })).toEqual(want)
    expect(normaliseRect({ x: 10, y: 100 }, { x: 100, y: 20 })).toEqual(want)
  })
})

describe('rectContains / nodeRect', () => {
  it('a node fully inside vs straddling the edge', () => {
    const frame = { x: 0, y: 0, w: 200, h: 200 }
    expect(rectContains(frame, nodeRect(node('a', 10, 10, 50, 30)))).toBe(true)
    expect(rectContains(frame, nodeRect(node('b', 180, 10, 50, 30)))).toBe(false) // right edge crosses
  })
  it('nodeRect falls back to a default size with no measurement', () => {
    expect(nodeRect({ position: { x: 5, y: 5 } })).toEqual({ x: 5, y: 5, w: 150, h: 40 })
  })
})

describe('frameIsCreatable — BOTH the min-size AND ≥1 fully-contained node', () => {
  const nodes = [node('n1', 40, 40, 100, 40)]
  it('rejects a rect smaller than the on-screen minimum', () => {
    const tiny = { x: 40, y: 40, w: FRAME_MIN_SCREEN_PX - 5, h: 100 }
    expect(frameIsCreatable(tiny, 1, nodes)).toBe(false)
  })
  it('the minimum is measured ON SCREEN (rect * zoom)', () => {
    const rect = { x: 0, y: 0, w: 30, h: 30 } // 30 flow-units
    expect(frameIsCreatable(rect, 1, [node('c', 2, 2, 20, 20)])).toBe(false) // 30 px < 48
    expect(frameIsCreatable(rect, 2, [node('c', 2, 2, 20, 20)])).toBe(true) //  60 px ≥ 48
  })
  it('rejects a big rect that contains no node fully', () => {
    expect(frameIsCreatable({ x: 300, y: 300, w: 200, h: 200 }, 1, nodes)).toBe(false)
    // straddling is not "contained"
    expect(frameIsCreatable({ x: 60, y: 60, w: 200, h: 200 }, 1, nodes)).toBe(false)
  })
  it('accepts a rect that clears both', () => {
    expect(frameIsCreatable({ x: 20, y: 20, w: 200, h: 120 }, 1, nodes)).toBe(true)
  })
})

describe('activityOpacityById — recent-frequency, linear recency weight', () => {
  const S = (...ids: string[]) => new Set(ids)

  it('empty history ⇒ empty map', () => {
    expect(activityOpacityById([]).size).toBe(0)
  })

  it('active every step in the window ⇒ the max opacity; never above the cap', () => {
    const steps = Array.from({ length: ACTIVITY_WINDOW }, () => S('x'))
    expect(activityOpacityById(steps).get('x')).toBeCloseTo(ACTIVITY_MAX_OPACITY, 6)
  })

  it('a hit only in the OLDEST slot weighs less than one only in the NEWEST', () => {
    const w = ACTIVITY_WINDOW
    const oldOnly = [S('old'), ...Array.from({ length: w - 1 }, () => S<string>())]
    const newOnly = [...Array.from({ length: w - 1 }, () => S<string>()), S('new')]
    const a = activityOpacityById(oldOnly).get('old')!
    const b = activityOpacityById(newOnly).get('new')!
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
  })

  it('only the last `ACTIVITY_WINDOW` steps count', () => {
    const steps = [
      S('ancient'),
      ...Array.from({ length: ACTIVITY_WINDOW }, () => S('recent')),
    ]
    const m = activityOpacityById(steps)
    expect(m.has('ancient')).toBe(false)
    expect(m.get('recent')).toBeCloseTo(ACTIVITY_MAX_OPACITY, 6)
  })

  it('binary per step — an id counts once whether it appeared once or many times', () => {
    // (the store already de-dupes into a Set; this asserts the scorer treats a
    //  Set membership as 1)
    const half = [S('e'), S<string>(), S('e'), S<string>()]
    const score = activityOpacityById(half).get('e')!
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(ACTIVITY_MAX_OPACITY)
  })
})
