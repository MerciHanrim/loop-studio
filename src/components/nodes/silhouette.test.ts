import { describe, expect, it } from 'vitest'
import type { NodeKind } from '../../model/types'
import {
  BASE_NODE_H,
  clampNodeHeight,
  MAX_NODE_H,
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
// at 64 or taller draws exactly as before the compact floor (FC-7)
const HISTORIC: Record<NodeKind, string> = {
  pool: 'M32 6 H88 Q95 6 96 13 L112 52 Q113 58 107 58 H13 Q7 58 8 52 L24 13 Q25 6 32 6 Z',
  source: 'M14 8 Q8 8 8 14 V50 Q8 56 14 56 H84 L114 32 L84 8 Z',
  drain: 'M6 32 L34 8 H104 Q112 8 112 15 V49 Q112 56 104 56 H34 Z',
  gate: 'M60 3 L117 32 L60 61 L3 32 Z',
  converter:
    'M14 8 H106 Q112 8 112 14 L82 32 L112 50 Q112 56 106 56 H14 Q8 56 8 50 L38 32 L8 14 Q8 8 14 8 Z',
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
