import { describe, expect, it } from 'vitest'
import { samplePath } from './pathSample'

const chordSum = (pts: { x: number; y: number }[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y), 0)

describe('samplePath — a route at equal steps along its length', () => {
  it('a straight line: ceil(length / step) steps, both ends exact, every step the same', () => {
    const pts = samplePath('M 0,0L 30,40', 2)!
    expect(pts).toHaveLength(26) // 50 / 2 = 25 steps
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[25]).toEqual({ x: 30, y: 40 })
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)).toBeCloseTo(2, 9)
  })

  it('a rounded orthogonal corner (L, Q, L) has the arc length the browser reports', () => {
    // Chromium's getTotalLength for these two paths: 16.232254 and 296.2323
    expect(chordSum(samplePath('M 0 0 Q 10 0 10 10', 0.001)!)).toBeCloseTo(16.232254, 4)
    const pts = samplePath('M 0 0 L 90 0 Q 100 0 100 10 L 100 200', 2)!
    expect(chordSum(samplePath('M 0 0 L 90 0 Q 100 0 100 10 L 100 200', 0.001)!)).toBeCloseTo(296.2323, 3)
    expect(pts).toHaveLength(Math.ceil(296.2323 / 2) + 1)
    expect(pts[pts.length - 1]!.x).toBeCloseTo(100, 9)
    expect(pts[pts.length - 1]!.y).toBeCloseTo(200, 9)
  })

  it('an automatic curve (C): the point at half its length is the centre of a symmetric S', () => {
    const pts = samplePath('M 0,0 C 50,0 50,100 100,100', 0.5)!
    expect((pts.length - 1) % 2).toBe(0)
    const mid = pts[(pts.length - 1) / 2]!
    expect(mid.x).toBeCloseTo(50, 6)
    expect(mid.y).toBeCloseTo(50, 6)
    // Chromium: 149.52821
    expect(chordSum(samplePath('M 0,0 C 50,0 50,100 100,100', 0.001)!)).toBeCloseTo(149.52821, 3)
  })

  it('on an orthogonal route with rounded corners, every point of a straight run keeps the run’s exact coordinate', () => {
    // a badge's box against a body edge is decided on these coordinates: no drift on a run
    const pts = samplePath('M 100 32 L 200 32 Q 210 32 210 42 L 210 300 Q 210 310 220 310 L 400 310', 2)!
    const onFirst = pts.filter((p) => p.x <= 200)
    const onSecond = pts.filter((p) => p.y >= 42 && p.y <= 300)
    const onLast = pts.filter((p) => p.x >= 220)
    expect(onFirst.length).toBeGreaterThan(40)
    expect(onSecond.length).toBeGreaterThan(120)
    expect(onLast.length).toBeGreaterThan(80)
    for (const p of onFirst) expect(p.y).toBe(32)
    for (const p of onSecond) expect(p.x).toBe(210)
    for (const p of onLast) expect(p.y).toBe(310)
    expect(pts[pts.length - 1]).toEqual({ x: 400, y: 310 })
  })

  it('the browser length, when given, sets the count', () => {
    expect(samplePath('M 0,0L 10,0', 2)).toHaveLength(6)
    expect(samplePath('M 0,0L 10,0', 2, 10.0001)).toHaveLength(7)
    const pts = samplePath('M 0,0L 10,0', 2, 10.0001)!
    expect(pts[6]).toEqual({ x: 10, y: 0 })
  })

  it('H, V and a closing Z are read; a zero-length piece is passed over', () => {
    const pts = samplePath('M 0 0 L 0 0 H 10 V 10 Z', 1)!
    // 10 + 10 + the diagonal back to the start
    expect(pts).toHaveLength(Math.ceil(20 + Math.SQRT2 * 10) + 1)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1]!.x).toBeCloseTo(0, 9)
    expect(pts[pts.length - 1]!.y).toBeCloseTo(0, 9)
    // every point is on the outline: the top edge, the right edge or the diagonal
    for (const p of pts) expect(Math.abs(p.y) < 1e-9 || Math.abs(p.x - 10) < 1e-9 || Math.abs(p.x - p.y) < 1e-9).toBe(true)
  })

  it('anything the app does not write is left to the DOM: relative commands, arcs, a second contour', () => {
    expect(samplePath('m 0 0 l 10 0', 2)).toBeNull()
    expect(samplePath('M 0 0 A 5 5 0 0 1 10 0', 2)).toBeNull()
    expect(samplePath('M 0 0 L 10 0 M 20 0 L 30 0', 2)).toBeNull()
    expect(samplePath('M 0 0 Z L 10 0', 2)).toBeNull()
    expect(samplePath('L 10 0', 2)).toBeNull()
  })
})
