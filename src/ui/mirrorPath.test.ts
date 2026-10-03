import { describe, expect, it } from 'vitest'
import { mirrorPathX } from './mirrorPath'

// Issue #298 — the mirrored drawing is derived, so these pin what "mirrored" means.

describe('mirrorPathX', () => {
  it('reflects every x across the centre and leaves y alone', () => {
    expect(mirrorPathX('M2 3 L14 3 L8 13 Z')).toBe('M 14 3 L 2 3 L 8 13 Z')
    expect(mirrorPathX('M1 1 H15 V15', 16)).toBe('M 15 1 H 1 V 15')
  })

  it('turns an arc the other way round and negates its rotation', () => {
    // a half circle drawn clockwise from the left becomes one drawn anticlockwise from the right
    expect(mirrorPathX('M3 8 A5 5 30 1 1 13 8')).toBe('M 13 8 A 5 5 -30 1 0 3 8')
  })

  it('handles curves and implicit repeats', () => {
    expect(mirrorPathX('M0 0 C1 2 3 4 5 6 Q7 8 9 10 T11 12')).toBe('M 16 0 C 15 2 13 4 11 6 Q 9 8 7 10 T 5 12')
    expect(mirrorPathX('M0 0 L1 1 2 2')).toBe('M 16 0 L 15 1 14 2')
  })

  it('is an involution: mirroring twice gives the same drawing', () => {
    const d = 'M9 3 H13 V7 M13 3 L7 9 M11 9 V12.5 H3.5 V4.5 H7 M4.5 6.5 A3 3 0 0 1 7.5 3.5 Z'
    const twice = mirrorPathX(mirrorPathX(d))
    expect(twice).toBe(mirrorPathX(mirrorPathX(twice)))
    const norm = (s: string) => s.match(/[A-Z]|-?[\d.]+/g)
    expect(norm(twice)).toEqual(norm(d.replace(/([A-Z])/g, ' $1 ').trim()))
  })

  it('refuses a relative or unknown command rather than guessing', () => {
    expect(() => mirrorPathX('M2 2 l4 4')).toThrow(/relative command "l"/)
    expect(() => mirrorPathX('M2 2 X4')).toThrow(/unsupported command "X"/)
    expect(() => mirrorPathX('M2')).toThrow(/needs 2 numbers/)
  })
})
