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

// the historic hard-coded silhouettes — the parametric function must return
// these byte-for-byte at (and below) the base height
const HISTORIC: Record<NodeKind, string> = {
  pool: 'M32 6 H88 Q95 6 96 13 L112 52 Q113 58 107 58 H13 Q7 58 8 52 L24 13 Q25 6 32 6 Z',
  source: 'M14 8 Q8 8 8 14 V50 Q8 56 14 56 H84 L114 32 L84 8 Z',
  drain: 'M6 32 L34 8 H104 Q112 8 112 15 V49 Q112 56 104 56 H34 Z',
  gate: 'M60 3 L117 32 L60 61 L3 32 Z',
  converter:
    'M14 8 H106 Q112 8 112 14 L82 32 L112 50 Q112 56 106 56 H14 Q8 56 8 50 L38 32 L8 14 Q8 8 14 8 Z',
  end: 'M28 8 H92 Q112 8 112 32 Q112 56 92 56 H28 Q8 56 8 32 Q8 8 28 8 Z',
  parameter: 'M14 12 H106 Q112 12 112 18 V46 Q112 52 106 52 H14 Q8 52 8 46 V40 H1 V24 H8 V18 Q8 12 14 12 Z',
  register: 'M16 12 H108 Q116 12 116 20 V44 Q116 52 108 52 H16 Q8 52 8 44 V20 Q8 12 16 12 Z',
}

// pull every number out of a path string, in order
const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
// the top cap of every shape lives in y ∈ [3, 20] and must not move as h grows
const topCapYs = (d: string) => nums(d).filter((v, i) => i % 2 === 1 && v <= 20)

describe('silhouettePath — base height is byte-identical', () => {
  for (const k of KINDS) {
    it(`${k}: h = 64 returns the historic path verbatim`, () => {
      expect(silhouettePath(k, BASE_NODE_H)).toBe(HISTORIC[k])
    })
    it(`${k}: any h ≤ 64 returns the historic path`, () => {
      expect(silhouettePath(k, 40)).toBe(HISTORIC[k])
      expect(silhouettePath(k)).toBe(HISTORIC[k])
    })
  }
})

describe('silhouettePath — growth', () => {
  for (const k of KINDS) {
    const grown = silhouettePath(k, 88)
    it(`${k}: a taller path differs from the base and is still a closed subpath`, () => {
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
    it(`${k}: some coordinate reaches below the base shape's extent`, () => {
      const baseMaxY = Math.max(...nums(HISTORIC[k]))
      expect(Math.max(...nums(grown))).toBeGreaterThan(baseMaxY - 1)
      // the grown path names a Y at least (88 - 12) = 76, past the base's ~58 bottom
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
    expect(clampNodeHeight('pool', 40)).toBe(64)
    expect(clampNodeHeight('pool', 64)).toBe(64)
  })
  it('caps at the per-kind ceiling', () => {
    expect(clampNodeHeight('gate', 500)).toBe(MAX_NODE_H.gate)
    expect(clampNodeHeight('pool', 500)).toBe(MAX_NODE_H.pool)
  })
  it('passes a value inside the range through (rounded)', () => {
    expect(clampNodeHeight('pool', 83.4)).toBe(83)
  })
})
