import { describe, expect, it } from 'vitest'
import { LOCALES, directionOf, getEntry } from './registry'
import { useI18n } from './store'

// docs/localization.md §L9.2 / §L9.3 — there is ONE place a direction comes from:
// the active locale's registry entry. `<html dir>` and every element-level `dir`
// attribute read it through `directionOf`, so a locale can never have the chrome
// mirrored while an input disagrees, and PR C's real `ar` travels exactly the
// path PR B's RTL pseudo-locale already exercises.
//
// Three things this file exists to stop:
//   * a second source of truth — a `direction` field in the i18n store, a React
//     context, a prop threaded down. Any of them can drift from `<html dir>`.
//   * reading `document.dir` back. It is an OUTPUT of the locale, not an input,
//     and reading it makes the value untestable and racy against the commit that
//     sets it.
//   * re-deriving direction from the locale CODE (a name list, a regex on the
//     subtag). The registry entry is the answer; a code is just its key.
//
// What this suite can and cannot prove, stated precisely:
//   * it DOES prove there is no UNCONDITIONAL DOM read. It runs in vitest's
//     default NODE environment, where `document` does not exist, so a
//     `directionOf` that reached for `document.dir` would throw on every case.
//   * it does NOT rule out a conditional browser branch — a
//     `typeof document !== 'undefined'` path would be invisible here. The
//     evidence against that is the source (one expression, no such branch) and
//     the e2e that switches locale through the product and reads `<html dir>` and
//     `directionOf` together.
//   * it DOES prove the direction is not guessed from the code string: the cases
//     at the end are codes a subtag or name-list heuristic would call RTL.

describe('directionOf — the single direction path', () => {
  it('returns the registry entry direction for every registered locale', () => {
    expect(LOCALES.length).toBeGreaterThan(0)
    for (const entry of LOCALES) {
      expect(directionOf(entry.code), entry.code).toBe(entry.direction)
    }
  })

  it('answers with no DOM present, so it cannot read document.dir unconditionally', () => {
    // This rules out an UNCONDITIONAL DOM read only. A conditional
    // `typeof document !== 'undefined'` branch would pass here too; the e2e is
    // what closes that, by switching locale through the product and comparing
    // `<html dir>` with `directionOf` in the same transition.
    expect(typeof document).toBe('undefined')
    expect(() => directionOf(LOCALES[0]!.code)).not.toThrow()
  })

  it('falls back to ltr for a code that is not registered', () => {
    // `qaa` is in the ISO 639-2 reserved local-use range and is deliberately off
    // the locale roadmap, so it cannot become registered later and silently
    // invert this case
    expect(getEntry('qaa')).toBeUndefined()
    expect(directionOf('qaa')).toBe('ltr')
  })

  it('never infers a direction from the code string', () => {
    // Codes a name-based or subtag-based guess would call RTL. The assertion is
    // written against the REGISTRY, not against a hardcoded 'ltr', so adding any
    // of these as a real locale keeps the test meaningful instead of breaking it:
    // whatever the entry says is what `directionOf` must return, and while the
    // entry is absent the documented fallback is what it must return.
    for (const code of ['ar', 'he', 'fa', 'ur', 'yi', 'ar-EG', 'ARABIC']) {
      const entry = getEntry(code)
      expect(directionOf(code), code).toBe(entry ? entry.direction : 'ltr')
    }
  })

  it('is the only direction state — the i18n store holds none of its own', () => {
    const keys = Object.keys(useI18n.getState())
    expect(keys.filter((k) => /dir|direction|rtl|ltr/i.test(k))).toEqual([])
  })
})
