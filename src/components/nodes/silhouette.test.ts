import { describe, expect, it } from 'vitest'
import type { NodeKind } from '../../model/types'
import {
  BASE_NODE_H,
  clampNodeHeight,
  FIXED_DEPTH_KINDS,
  fillSpanAt,
  MAX_NODE_H,
  OUTLINE_DEPTH,
  silhouettePath,
} from './silhouette'

const KINDS: NodeKind[] = [
  'pool',
  'source',
  'drain',
  'gate',
  'converter',
  'end',
  'parameter',
  'register',
]

// the historic hard-coded silhouettes, drawn at 64 — the parametric function
// must still return these byte-for-byte at 64, so a node whose content keeps it
// at 64 or taller draws exactly as before the compact floor (FC-7). Issue #337:
// the five width-parametric kinds have their own outline since v0.21.4, given
// here at width 120 (Pool slant 8, Source arrow 16, Drain notch 16, Converter
// waist 16, Gate a hexagon with 16 px points).
const HISTORIC: Record<NodeKind, string> = {
  pool: 'M24 6 H96 Q103 6 104 13 L112 52 Q113 58 107 58 H13 Q7 58 8 52 L16 13 Q17 6 24 6 Z',
  source: 'M14 8 Q8 8 8 14 V50 Q8 56 14 56 H98 L114 32 L98 8 Z',
  drain: 'M6 32 L22 8 H104 Q112 8 112 15 V49 Q112 56 104 56 H22 Z',
  gate: 'M19 3 H101 L117 32 L101 61 H19 L3 32 Z',
  converter:
    'M14 8 H106 Q112 8 112 14 L96 32 L112 50 Q112 56 106 56 H14 Q8 56 8 50 L24 32 L8 14 Q8 8 14 8 Z',
  end: 'M28 8 H92 Q112 8 112 32 Q112 56 92 56 H28 Q8 56 8 32 Q8 8 28 8 Z',
  parameter: 'M14 12 H106 Q112 12 112 18 V46 Q112 52 106 52 H14 Q8 52 8 46 V40 H1 V24 H8 V18 Q8 12 14 12 Z',
  register: 'M14 12 H110 Q118 12 118 32 Q118 52 110 52 H14 Q6 52 6 32 Q6 12 14 12 Z',
}

// pull every number out of a path string, in order
const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
// the top cap of every shape lives in y ∈ [3, 20] and must not move as h grows.
// It is always drawn by the `M` + the first curve, so only the leading 8
// numbers are examined — past that a lone `H`/`V` can shift the x/y parity a
// grown path inserts a vertical-growth command into (a re-cut register with a
// bottom-edge `H14` would otherwise read its x as a y).
const topCapYs = (d: string) => nums(d).slice(0, 8).filter((v, i) => i % 2 === 1 && v <= 20)

/** every point the path names, in drawing order (control points included), for
 *  the `M H V L Q Z` commands these silhouettes use */
function points(d: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  let x = 0
  let y = 0
  for (const [, cmd, args] of d.matchAll(/([MHVLQZ])([^MHVLQZ]*)/g)) {
    const a = nums(args)
    if (cmd === 'H') x = a[0]
    else if (cmd === 'V') y = a[0]
    else if (cmd === 'M' || cmd === 'L') [x, y] = a
    else if (cmd === 'Q') {
      out.push({ x: a[0], y: a[1] })
      ;[x, y] = [a[2], a[3]]
    } else continue
    out.push({ x, y })
  }
  return out
}

/** how many times the outline's y changes direction going once around it: a
 *  vessel that goes down one side and back up the other changes exactly twice;
 *  a reversed segment (a cap drawn past its own end) adds two more */
function yTurns(d: string): number {
  const ys = points(d).map((p) => p.y)
  const steps = ys.map((v, i) => Math.sign(ys[(i + 1) % ys.length] - v)).filter((s) => s !== 0)
  let turns = 0
  for (let i = 0; i < steps.length; i++) if (steps[i] !== steps[(i + 1) % steps.length]) turns++
  return turns
}

describe('silhouettePath — the compact floor (FC-7)', () => {
  it('the base height is 56', () => {
    expect(BASE_NODE_H).toBe(56)
  })
  for (const k of KINDS) {
    it(`${k}: h = 64 still returns the historic path verbatim`, () => {
      expect(silhouettePath(k, 64)).toBe(HISTORIC[k])
    })
    it(`${k}: below the floor it draws the floor`, () => {
      expect(silhouettePath(k, 40)).toBe(silhouettePath(k, BASE_NODE_H))
      expect(silhouettePath(k)).toBe(silhouettePath(k, BASE_NODE_H))
    })
    it(`${k}: at every height from the floor to its ceiling the outline stays inside the box and never reverses`, () => {
      for (let H = BASE_NODE_H; H <= MAX_NODE_H[k]; H++) {
        const d = silhouettePath(k, H)
        for (const p of points(d)) {
          expect(p.x, `${k} at ${H}`).toBeGreaterThanOrEqual(0)
          expect(p.x, `${k} at ${H}`).toBeLessThanOrEqual(120)
          expect(p.y, `${k} at ${H}`).toBeGreaterThanOrEqual(0)
          expect(p.y, `${k} at ${H}`).toBeLessThanOrEqual(H)
        }
        expect(yTurns(d), `${k} at ${H}: ${d}`).toBe(2)
      }
    })
  }
  it('the End and the Register meet their caps at mid-height below 64', () => {
    expect(silhouettePath('end', 56)).toBe('M28 8 H92 Q112 8 112 28 Q112 48 92 48 H28 Q8 48 8 28 Q8 8 28 8 Z')
    expect(silhouettePath('register', 56)).toBe('M14 12 H110 Q118 12 118 28 Q118 44 110 44 H14 Q6 44 6 28 Q6 12 14 12 Z')
  })
})

describe('silhouettePath — growth', () => {
  for (const k of KINDS) {
    const grown = silhouettePath(k, 88)
    it(`${k}: a taller path differs from the historic one and is still a closed subpath`, () => {
      expect(grown).not.toBe(HISTORIC[k])
      expect(grown.startsWith('M')).toBe(true)
      expect(grown.trimEnd().endsWith('Z')).toBe(true)
      // only the vertical-growth commands may be added (end / register gain a `V`)
      const extra = grown.replace(/[-\d.\s]+/g, '').replace(/[MHQLVZ]/g, (c) =>
        HISTORIC[k].includes(c) ? '' : c,
      )
      expect(extra.replace(/V/g, '')).toBe('')
    })
    it(`${k}: the top-cap Y coordinates are unchanged`, () => {
      for (const y of topCapYs(HISTORIC[k])) expect(topCapYs(grown)).toContain(y)
    })
    it(`${k}: some coordinate reaches below the historic shape's extent`, () => {
      const baseMaxY = Math.max(...nums(HISTORIC[k]))
      expect(Math.max(...nums(grown))).toBeGreaterThan(baseMaxY - 1)
      // the grown path names a Y at least (88 - 12) = 76, past the historic ~58 bottom
      expect(nums(grown).some((v) => v >= 76)).toBe(true)
    })
  }

  it('gate / converter stop growing at their identity ceiling', () => {
    expect(silhouettePath('gate', 200)).toBe(silhouettePath('gate', MAX_NODE_H.gate))
    expect(silhouettePath('converter', 200)).toBe(
      silhouettePath('converter', MAX_NODE_H.converter),
    )
  })
})

// issue #337 — the five width-parametric outlines keep every feature's px depth
describe('silhouettePath — width-parametric (#337)', () => {
  const FIXED = [...FIXED_DEPTH_KINDS]
  const WIDTHS = [118, 134, 160, 200, 260]

  it('covers exactly the Pool, Source, Drain, Converter and Gate', () => {
    expect(FIXED.sort()).toEqual(['converter', 'drain', 'gate', 'pool', 'source'])
    expect(OUTLINE_DEPTH).toEqual({ poolSlant: 8, sourceArrow: 16, drainNotch: 16, converterWaist: 16, gatePoint: 16 })
  })

  for (const k of FIXED) {
    it(`${k}: at every width and height the outline stays in the w × h box and never reverses`, () => {
      for (const w of WIDTHS) {
        for (const H of [BASE_NODE_H, 64, 74, MAX_NODE_H[k]]) {
          const d = silhouettePath(k, H, w)
          for (const p of points(d)) {
            expect(p.x, `${k} ${w}×${H}`).toBeGreaterThanOrEqual(0)
            expect(p.x, `${k} ${w}×${H}`).toBeLessThanOrEqual(w)
            expect(p.y, `${k} ${w}×${H}`).toBeGreaterThanOrEqual(0)
            expect(p.y, `${k} ${w}×${H}`).toBeLessThanOrEqual(H)
          }
          expect(yTurns(d), `${k} ${w}×${H}: ${d}`).toBe(2)
        }
      }
    })

    it(`${k}: the left side is the same at every width, the right keeps its distance from the right edge`, () => {
      for (const H of [BASE_NODE_H, 74]) {
        for (let y = 4; y < H - 3; y += 3) {
          const ref = fillSpanAt(k, H, y, 1000)
          for (const w of WIDTHS) {
            const s = fillSpanAt(k, H, y, w)
            if (!ref) { expect(s).toBeNull(); continue }
            expect(s![0], `${k} ${w}×${H} at ${y}`).toBeCloseTo(ref[0], 6)
            expect(w - s![1], `${k} ${w}×${H} at ${y}`).toBeCloseTo(1000 - ref[1], 6)
          }
        }
      }
    })
  }

  it('each feature has its decided depth at the mid-height, at any width', () => {
    const H = 56, y = 28
    for (const w of WIDTHS) {
      // Source: the arrow tip 6 px in from the right, its root 16 px before it
      expect(w - fillSpanAt('source', H, y, w)![1]).toBeCloseTo(6, 6)
      expect(w - fillSpanAt('source', H, 8.001, w)![1]).toBeCloseTo(6 + OUTLINE_DEPTH.sourceArrow, 1)
      // Drain: the notch's point 6 px in from the left, the body 16 px past it
      expect(fillSpanAt('drain', H, y, w)![0]).toBeCloseTo(6, 6)
      expect(fillSpanAt('drain', H, 8.001, w)![0]).toBeCloseTo(6 + OUTLINE_DEPTH.drainNotch, 1)
      // Converter: each waist 16 px deep from the 8 px body edge
      expect(fillSpanAt('converter', H, y, w)![0]).toBeCloseTo(8 + OUTLINE_DEPTH.converterWaist, 6)
      expect(w - fillSpanAt('converter', H, y, w)![1]).toBeCloseTo(8 + OUTLINE_DEPTH.converterWaist, 6)
      // Gate: points 3 px in, the flat top starting 16 px further in
      expect(fillSpanAt('gate', H, y, w)![0]).toBeCloseTo(3, 6)
      expect(fillSpanAt('gate', H, 3.001, w)![0]).toBeCloseTo(3 + OUTLINE_DEPTH.gatePoint, 1)
      // Pool: the slant runs 8 px from its shoulder (y 13) to its foot (y H - 12)
      expect(fillSpanAt('pool', H, 13, w)![0] - fillSpanAt('pool', H, H - 12, w)![0]).toBeCloseTo(OUTLINE_DEPTH.poolSlant, 6)
    }
  })

  it('the End, the Parameter and the Register keep their 120-wide viewBox: the width does not change their path', () => {
    for (const k of ['end', 'parameter', 'register'] as const) expect(silhouettePath(k, 64, 260)).toBe(HISTORIC[k])
  })
})

describe('clampNodeHeight', () => {
  it('floors at the base height', () => {
    expect(clampNodeHeight('pool', 40)).toBe(56)
    expect(clampNodeHeight('pool', 56)).toBe(56)
    expect(clampNodeHeight('pool', 58)).toBe(58)
  })
  it('caps at the per-kind ceiling', () => {
    expect(clampNodeHeight('gate', 500)).toBe(MAX_NODE_H.gate)
    expect(clampNodeHeight('pool', 500)).toBe(MAX_NODE_H.pool)
  })
  it('passes a value inside the range through (rounded)', () => {
    expect(clampNodeHeight('pool', 83.4)).toBe(83)
  })
})
