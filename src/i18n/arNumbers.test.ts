import { describe, expect, it } from 'vitest'
import { getEntry } from './registry'

// docs/localization.md §L8 / §L9 — Arabic renders LATIN digits, as a PRODUCT
// DECISION, and this file is where that decision is pinned.
//
// WHY IT NEEDS PINNING AT ALL
//
// `numberLocale` is a BCP-47 tag handed to `Intl`, and which digits come back
// is decided by the tag's default numbering system, not by anything this repo
// writes. MEASURED on this platform:
//
//   ar      1234567.89 -> 1,234,567.89      numberingSystem `latn`
//   ar-EG   1234567.89 -> ١٬٢٣٤٬٥٦٧٫٨٩      numberingSystem `arab`
//   ar-SA   1234567.89 -> ١٬٢٣٤٬٥٦٧٫٨٩      numberingSystem `arab`
//
// So the choice between Latin and Arabic-Indic digits was made the moment the
// registry said `'ar'` rather than `'ar-EG'`. Left unstated, that reads like an
// accident of tagging; it is not. Every number the product renders — pool
// values, step counts, Monte-Carlo percentages, CSV previews — follows it.
//
// The decision: LATIN DIGITS. Arabic readers routinely read Latin digits, the
// engine tokens beside them are already Latin, and the digits in a user's own
// spreadsheet arrive as whatever they typed. Switching to Arabic-Indic digits
// is a deliberate product change, not a locale-registration side effect: it
// would need `numberLocale: 'ar-EG'` (or an explicit `-u-nu-arab`), a re-read
// of every mixed number/token string, and its own geometry baseline.
//
// WHY THE ASSERTION IS ON `numberingSystem` AND NOT ON THE FORMATTED STRING
//
// Comparing `format(1234.5)` to a literal would pass for the wrong reason the
// day a platform changed a separator. The invariant that carries the decision
// is the NUMBERING SYSTEM; the separators are then whatever CLDR says for that
// system. `e2e/i18n-ar.spec.ts` asserts the same resolved value inside a real
// browser, because Node and the browser ship their own ICU data and only one of
// them is what a reader sees.

const AR = 'ar'

describe('Arabic renders Latin digits — the product decision behind `numberLocale`', () => {
  it('the registry hands `Intl` a tag whose numbering system is `latn`', () => {
    const entry = getEntry(AR)
    expect(entry).toBeDefined()
    expect(entry!.numberLocale).toBe('ar')
    const resolved = new Intl.NumberFormat(entry!.numberLocale).resolvedOptions()
    expect(resolved.numberingSystem, 'the decision is Latin digits; see this file').toBe('latn')
  })

  it('every digit it produces is ASCII 0-9, over a range that would expose a switch', () => {
    const nf = new Intl.NumberFormat(getEntry(AR)!.numberLocale)
    for (const n of [0, 1, 9, 10, 42, 100, 1000, 1234567.89, -5, 0.125]) {
      const s = nf.format(n)
      const digits = [...s].filter((c) => /\p{Nd}/u.test(c))
      expect(digits.length, `${n} formatted as ${JSON.stringify(s)} has no digits`).toBeGreaterThan(0)
      for (const d of digits) {
        expect(
          d.codePointAt(0)!,
          `${n} formatted as ${JSON.stringify(s)} contains a non-ASCII digit U+${d.codePointAt(0)!.toString(16).toUpperCase()}`,
        ).toBeLessThanOrEqual(0x39)
      }
    }
  })

  it('the percent path takes the same numbering system', () => {
    const resolved = new Intl.NumberFormat(getEntry(AR)!.numberLocale, { style: 'percent' }).resolvedOptions()
    expect(resolved.numberingSystem).toBe('latn')
    const s = new Intl.NumberFormat(getEntry(AR)!.numberLocale, { style: 'percent' }).format(0.84)
    expect(s).toContain('84')
  })

  it('names the alternative, so switching is a decision and not a discovery', () => {
    // the tags that WOULD have given Arabic-Indic digits, asserted so this file
    // fails if the platform ever stops distinguishing them and the choice
    // quietly stops meaning anything
    for (const tag of ['ar-EG', 'ar-SA']) {
      expect(new Intl.NumberFormat(tag).resolvedOptions().numberingSystem, tag).toBe('arab')
    }
    // and the explicit form, which is how a future change should be written
    expect(new Intl.NumberFormat('ar-u-nu-arab').resolvedOptions().numberingSystem).toBe('arab')
    expect(new Intl.NumberFormat('ar-u-nu-latn').resolvedOptions().numberingSystem).toBe('latn')
  })
})
