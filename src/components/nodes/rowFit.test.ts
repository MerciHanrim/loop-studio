import { describe, expect, it } from 'vitest'
import type { NodeKind } from '../../model/types'
import { fitRows, type FrameGeometry, headRim, type MeasuredRow, NODE_MAX_W, NODE_MIN_W, ROW_CLEAR, TITLE_SLACK } from './rowFit'
import { fillSpanAt, NODE_RINGS } from './silhouette'

// issue #332 — the value / detail row fit of a Parameter and a Register. The
// Pool's rows moved to ./outlineFit with its width-parametric outline (#337);
// its #332 rules are tested in ./outlineFit.test.

describe('fillSpanAt', () => {
  it('reads the fill straight from the drawn path', () => {
    // pool at 58 (width-parametric, #337): the left side runs (16, 13) → (8, 46)
    // at every width, the right keeps the same distance from the right edge
    expect(fillSpanAt('pool', 58, 29.5)).toEqual([12, 108])
    expect(fillSpanAt('pool', 58, 29.5, 200)).toEqual([12, 188])
    // register at 64 (the historic cut): its ends bulge to x6 / x118 at mid-height
    const [l, r] = fillSpanAt('register', 64, 32)!
    expect(l).toBeCloseTo(6, 1)
    expect(r).toBeCloseTo(118, 1)
  })

  it('leaves the Parameter tab out: text keeps clear of the body edge x8', () => {
    expect(fillSpanAt('parameter', 70, 35)![0]).toBe(8)
  })

  it('is null above or below the vessel', () => {
    expect(fillSpanAt('pool', 58, 2)).toBeNull()
    expect(fillSpanAt('register', 86, 80)).toBeNull()
  })

  it('clamps the height to the kind range, like the drawn path', () => {
    expect(fillSpanAt('pool', 20, 29.5)).toEqual(fillSpanAt('pool', 56, 29.5))
    expect(fillSpanAt('pool', 400, 29.5)).toEqual(fillSpanAt('pool', 132, 29.5))
  })
})

// geometry close to what NodeFrame measures in the shipped layout (index.css):
// Parameter / Register padding 15 / 15, the head carrying the width-scaled rim
const capsule = (kind: 'parameter' | 'register', width: number, over: Partial<FrameGeometry> = {}): FrameGeometry => ({
  height: 86, width, stackStart: 15, padEnd: 15, titleStart: 29 + headRim(kind, width), titleWidth: 70,
  titleTop: 16, titleBottom: 32, titleWrapped: false, titleMax: 135, ...over,
})
const CAPSULE_ROWS = (value: number, sub = 40): MeasuredRow[] => [
  { key: 'value', top: 33, bottom: 54, width: value },
  { key: 'sub', top: 55, bottom: 70, width: sub },
]

/** the extreme fill edges across a row, in CSS px at width `w` */
function edges(kind: NodeKind, h: number, r: MeasuredRow, w: number): [number, number] {
  let l = -Infinity
  let rt = Infinity
  for (let k = 0; k <= 4; k++) {
    const s = fillSpanAt(kind, h, r.top + ((r.bottom - r.top) * k) / 4)
    if (!s) continue
    l = Math.max(l, s[0])
    rt = Math.min(rt, s[1])
  }
  return [(l * w) / 120, (rt * w) / 120]
}

describe('fitRows', () => {
  it('keeps ROW_CLEAR at the inner focus ring plus 2', () => {
    expect(ROW_CLEAR).toBe(NODE_RINGS.focus.to + 2)
    expect(ROW_CLEAR).toBe(8)
  })

  it('starts each row at the title text, and keeps the size when it already fits', () => {
    const r = fitRows('register', capsule('register', 118), CAPSULE_ROWS(20, 30))
    expect(r).toEqual({ width: 118, start: { value: 14, sub: 14 }, minWidth: null, maxWidth: {} })
  })

  it('widens a Register by the minimum that holds the row whole', () => {
    const rows = CAPSULE_ROWS(100)
    const fit = fitRows('register', capsule('register', 137), rows)
    expect(fit.minWidth).not.toBeNull()
    const w = fit.minWidth!
    const at = (width: number) => fitRows('register', capsule('register', width), rows)
    // at the width it settled on, the row is whole and 8 px clear at its end
    const end = 15 + at(w).start.value! + 100
    expect(end).toBeLessThanOrEqual(edges('register', 86, rows[0], w)[1] - ROW_CLEAR + 0.01)
    expect(at(w).maxWidth.value).toBeUndefined()
    // half a px narrower, it would not be
    const s = 15 + at(w - 0.5).start.value!
    expect(Math.min(edges('register', 86, rows[0], w - 0.5)[1] - ROW_CLEAR, w - 0.5 - 15 - 1) - s).toBeLessThan(100)
  })

  it('never widens for a row too long even for the widest node: it is cut where it is', () => {
    const rows = CAPSULE_ROWS(30, 400)
    const fit = fitRows('register', capsule('register', 260), rows)
    expect(fit.minWidth).toBe(NODE_MAX_W)
    expect(fit.maxWidth.sub).toBeGreaterThan(0)
    expect(fit.maxWidth.sub!).toBeLessThan(400)
    // the shorter value row still fits whole
    expect(fit.maxWidth.value).toBeUndefined()
  })

  it('lets a title that had 8 px or more lose at most TITLE_SLACK, never below 8', () => {
    // a Parameter whose 78 px unit (`items per hour`) needs a wider node: below
    // ~129 px the head's rim is 0, so the body edge (x8) creeps toward the title
    const g = capsule('parameter', 118)
    const rows = CAPSULE_ROWS(30, 78.5)
    const fit = fitRows('parameter', g, rows)
    const titleEdge = Math.max(...[16, 20, 24, 28, 32].map((y) => fillSpanAt('parameter', 86, y)![0]))
    const clear = (w: number) => g.titleStart + headRim('parameter', w) - headRim('parameter', 118) - (titleEdge * w) / 120
    expect(fit.minWidth).toBeGreaterThan(118)
    expect(clear(118)).toBeGreaterThan(ROW_CLEAR)
    expect(clear(fit.width)).toBeGreaterThanOrEqual(Math.max(ROW_CLEAR, clear(118) - TITLE_SLACK) - 0.01)
    expect(TITLE_SLACK).toBe(0.5)
  })

  it('never changes the height: a title wrapped for want of room keeps its width', () => {
    // the 110 px `= expr` set the shipped width: 15 + 110 + 15
    const rows = CAPSULE_ROWS(30, 110)
    const free = fitRows('register', capsule('register', 140), rows)
    expect(free.minWidth).toBeGreaterThan(140)
    // a 100 px title wraps at 140 (93 px of room); it would unwrap from ~149
    const wrapped = fitRows('register', capsule('register', 140, { titleWrapped: true, titleWidth: 100, titleBottom: 48 }), rows)
    const w = wrapped.minWidth!
    expect(w).toBeGreaterThanOrEqual(140)
    expect(w).toBeLessThan(free.minWidth!)
    expect(w - 30 - 2 * headRim('register', w) - 14).toBeLessThan(100)
    expect(wrapped.maxWidth.sub).toBeLessThan(110)
  })

  it('still widens a node whose title wraps at its own max width', () => {
    // a 220 px title wraps at its 135 px max width: widening cannot unwrap it
    const rows = CAPSULE_ROWS(30, 200)
    const g = capsule('register', 200, { titleWrapped: true, titleWidth: 220, titleBottom: 48 })
    expect(fitRows('register', g, rows).minWidth).toBeGreaterThan(200)
  })

  // the contract over a grid: every row it returns starts at or after the
  // title, keeps ROW_CLEAR inside the outline at both ends, and the node never
  // leaves the CSS width range
  it.each([
    ['parameter', [118, 140, 200, 260]],
    ['register', [118, 140, 200, 260]],
  ] as const)('%s rows stay inside the outline at every width', (kind, widths) => {
    for (const width of widths) {
      for (const value of [10, 60, 120, 240, 500]) {
        for (const sub of [20, 90, 300]) {
          const g = capsule(kind, width)
          const rows = CAPSULE_ROWS(value, sub)
          const fit = fitRows(kind, g, rows)
          const w = fit.width
          if (fit.minWidth != null) expect(fit.minWidth).toBe(w)
          expect(w).toBeGreaterThanOrEqual(NODE_MIN_W)
          expect(w).toBeLessThanOrEqual(NODE_MAX_W)
          const titleAt = g.titleStart + headRim(kind, w) - headRim(kind, width)
          for (const r of rows) {
            const [l, rt] = edges(kind, g.height, r, w)
            const s = g.stackStart + fit.start[r.key]!
            const e = s + Math.min(r.width, fit.maxWidth[r.key] ?? Infinity)
            expect(s).toBeGreaterThanOrEqual(Math.min(titleAt, NODE_MAX_W) - 0.01)
            expect(s - l).toBeGreaterThanOrEqual(ROW_CLEAR - 0.01)
            expect(rt - e).toBeGreaterThanOrEqual(ROW_CLEAR - 0.01)
          }
        }
      }
    }
  })
})
