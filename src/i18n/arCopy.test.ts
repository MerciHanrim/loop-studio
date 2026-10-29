import { describe, expect, it } from 'vitest'

import ar from './locales/ar'

// docs/localization.md §L9.2 (2026-10-29) — the layout stays LTR for every
// locale, and an Arabic paragraph in the chrome takes its reading direction from
// `unicode-bidi: plaintext` (src/index.css): the paragraph reads in the
// direction of its FIRST STRONG character. An Arabic string that opens with a
// Latin word (`JSON المخطط`) would therefore read left to right. The catalog
// carries no bidi control characters (src/i18n/bidiControls.test.ts), so a
// leading mark is not the fix: such a string is worded to open with Arabic.
//
// `{…}` arguments are skipped, as the bidi algorithm skips them: every
// interpolated value is isolated at the render argument (§L9.3), and the
// characters inside an isolate do not take part in finding the first strong
// character (UAX #9, rule P2).

const ARABIC = /\p{Script=Arabic}/u
const LETTER = /\p{L}/u

/** the first strong character outside `{…}`: 'R' (Arabic), 'L', or null */
function firstStrong(s: string): 'R' | 'L' | null {
  let depth = 0
  for (const ch of s) {
    if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
    else if (depth === 0) {
      if (ARABIC.test(ch)) return 'R'
      if (LETTER.test(ch)) return 'L'
    }
  }
  return null
}

describe('ar — every Arabic string opens with an Arabic strong character', () => {
  it('the rule reads the first strong character outside the arguments', () => {
    expect(firstStrong('JSON المخطط')).toBe('L')
    expect(firstStrong('المخطط بصيغة JSON')).toBe('R')
    expect(firstStrong('{name} المخطط')).toBe('R')
    expect(firstStrong('CSV')).toBe('L')
    expect(firstStrong('1, 2')).toBeNull()
  })

  it('holds for the whole catalog', () => {
    const latinFirst = Object.entries(ar as Record<string, string>)
      .filter(([, v]) => ARABIC.test(v) && firstStrong(v) === 'L')
      .map(([k, v]) => `${k}: ${v}`)
    expect(latinFirst).toEqual([])
  })
})
