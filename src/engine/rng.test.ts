import { describe, expect, it } from 'vitest'
import { RNG_SPEC, categorical, die, fnv1a32, rangeInt, sample, utf8Bytes } from './rng'

// Frozen vectors — SEMANTICS-B1.md §B7. Any change here is a spec change.

describe('rng — loop-rng/1 spec id', () => {
  it('is loop-rng/1', () => {
    expect(RNG_SPEC).toBe('loop-rng/1')
  })
})

describe('rng — utf8Bytes matches TextEncoder', () => {
  const cases = [
    '1|1|e1|flow-die|0',
    '1|42|tpl-e6|gate-route|0',
    '4294967295|9999|node_abcXYZ_12|flow-range|3',
    'café — ☕ 汉字 😀', // 2-byte, 3-byte, 4-byte (emoji surrogate pair)
    '\ud800', // lone high surrogate → U+FFFD
    '\udc00', // lone low surrogate → U+FFFD
  ]
  const ref = new TextEncoder()
  for (const s of cases) {
    it(JSON.stringify(s), () => {
      expect(utf8Bytes(s)).toEqual([...ref.encode(s)])
    })
  }
})

describe('rng — FNV-1a 32-bit', () => {
  it('offset basis on empty string', () => {
    expect(fnv1a32('') >>> 0).toBe(0x811c9dc5)
  })
  it('known key hashes (frozen)', () => {
    expect(fnv1a32('1|1|e1|flow-die|0') >>> 0).toBe(0x31a1fe5a)
    expect(fnv1a32('1|1|e1|flow-die|1') >>> 0).toBe(0x32a1ffed)
    expect(fnv1a32('1|1|e1|flow-range|0') >>> 0).toBe(0x0a9078c9)
    expect(fnv1a32('1|1|G|gate-route|0') >>> 0).toBe(0xea0ec4b5)
    expect(fnv1a32('2|1|e1|flow-range|0') >>> 0).toBe(0x60bfd79c)
  })
})

describe('rng — sample() stage vectors (frozen)', () => {
  const vec: Array<[[number, number, string, 'flow-die' | 'flow-range' | 'gate-route', number], number, number, number]> = [
    [[1, 1, 'e1', 'flow-die', 0], 0x31a1fe5a, 3827404282, 0.891137],
    [[1, 1, 'e1', 'flow-die', 1], 0x32a1ffed, 4280748691, 0.996689],
    [[1, 1, 'e1', 'flow-range', 0], 0x0a9078c9, 1628349630, 0.379130],
    [[1, 1, 'G', 'gate-route', 0], 0xea0ec4b5, 198040717, 0.046110],
    [[2, 1, 'e1', 'flow-range', 0], 0x60bfd79c, 1987613312, 0.462777],
  ]
  for (const [k, hash, out, u] of vec) {
    it(k.join('|'), () => {
      const s = sample(...k)
      expect(s.key).toBe(k.join('|'))
      expect(s.hash >>> 0).toBe(hash >>> 0)
      expect(s.out).toBe(out)
      expect(s.u).toBeCloseTo(u, 6)
      expect(s.u).toBeGreaterThanOrEqual(0)
      expect(s.u).toBeLessThan(1)
    })
  }

  it('is pure — same key, same result, every call', () => {
    const a = sample(1, 3, 'e9', 'flow-die', 2)
    const b = sample(1, 3, 'e9', 'flow-die', 2)
    expect(b).toEqual(a)
  })

  it('every field participates — changing any one changes the draw', () => {
    const base = sample(1, 1, 'e1', 'flow-die', 0).out
    expect(sample(2, 1, 'e1', 'flow-die', 0).out).not.toBe(base)
    expect(sample(1, 2, 'e1', 'flow-die', 0).out).not.toBe(base)
    expect(sample(1, 1, 'e2', 'flow-die', 0).out).not.toBe(base)
    expect(sample(1, 1, 'e1', 'flow-range', 0).out).not.toBe(base)
    expect(sample(1, 1, 'e1', 'flow-die', 1).out).not.toBe(base)
  })
})

describe('rng — value derivation', () => {
  it('rangeInt is inclusive and stays in [lo, hi] across the unit interval', () => {
    for (let i = 0; i < 1000; i++) {
      const u = i / 1000
      const v = rangeInt(1, 3, u)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(3)
      expect(Number.isInteger(v)).toBe(true)
    }
    expect(rangeInt(1, 3, 0)).toBe(1)
    expect(rangeInt(1, 3, 0.999999)).toBe(3)
    expect(rangeInt(5, 5, 0.7)).toBe(5)
  })

  it('die is in [1, d]', () => {
    expect(die(6, 0)).toBe(1)
    expect(die(6, 0.999999)).toBe(6)
    for (let i = 0; i < 600; i++) {
      const v = die(6, i / 600)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  it('2D6 for edge "e1" at seed 1 step 1 = 6 + 6 = 12 (frozen, R1 step 1)', () => {
    const d0 = die(6, sample(1, 1, 'e1', 'flow-die', 0).u)
    const d1 = die(6, sample(1, 1, 'e1', 'flow-die', 1).u)
    expect([d0, d1]).toEqual([6, 6])
  })
})

describe('rng — categorical inverse-CDF', () => {
  it('p = [0.25, 0.75]: u < 0.25 → 0, else → 1', () => {
    expect(categorical([1, 3], 0.0)).toBe(0)
    expect(categorical([1, 3], 0.249999)).toBe(0)
    expect(categorical([1, 3], 0.25)).toBe(1)
    expect(categorical([1, 3], 0.999999)).toBe(1)
  })
  it('gate G at seed 1 step 1: u = 0.046110 → branch 0 (frozen, R3 step 1)', () => {
    expect(categorical([1, 3], sample(1, 1, 'G', 'gate-route', 0).u)).toBe(0)
  })
  it('zero weight branches are never selected', () => {
    expect(categorical([0, 1], 0.0)).toBe(1)
  })
  it('invalid → -1: negative, NaN, ±Infinity, or zero sum', () => {
    expect(categorical([-1, 2], 0.5)).toBe(-1)
    expect(categorical([Number.NaN, 2], 0.5)).toBe(-1)
    expect(categorical([Infinity, 2], 0.5)).toBe(-1)
    expect(categorical([0, 0], 0.5)).toBe(-1)
    expect(categorical([], 0.5)).toBe(-1)
  })
})
