import { describe, expect, it } from 'vitest'
import { BASE_LOCALE, isRegistered, resolveInitialLocale } from './registry'

// docs/localization.md §L5.2 — the fully deterministic locale-decision order.

describe('resolveInitialLocale', () => {
  it('1. a stored value that is EXACTLY a registered code wins', () => {
    expect(resolveInitialLocale('ko', ['en-US'])).toBe('ko')
    expect(resolveInitialLocale('en', ['ko-KR'])).toBe('en')
  })

  it('1. no case / separator repair on the stored value', () => {
    for (const bad of ['KO', 'ko_KR', ' ko ', 'ko-KR', 'kor', '']) {
      // falls through to the navigator list (here: en) — the bad value is ignored
      expect(resolveInitialLocale(bad, ['en-US'])).toBe('en')
    }
  })

  it('2. walks navigator.languages in order — exact, then BCP-47 base', () => {
    expect(resolveInitialLocale(null, ['ko-KR', 'en-US'])).toBe('ko') // base match ko-KR -> ko
    expect(resolveInitialLocale(null, ['en-GB'])).toBe('en') // base match en-GB -> en
    expect(resolveInitialLocale(null, ['fr-FR', 'ko'])).toBe('ko') // first that resolves wins
    expect(resolveInitialLocale(null, ['KO-kr'])).toBe('ko') // navigator matched case-insensitively
  })

  it('3. canonical fallback when nothing resolves', () => {
    expect(resolveInitialLocale(null, ['fr-FR', 'de-DE'])).toBe(BASE_LOCALE)
    expect(resolveInitialLocale(null, [])).toBe(BASE_LOCALE)
    expect(resolveInitialLocale('xx', ['zz'])).toBe(BASE_LOCALE)
  })

  it('a stored value not in the registry is ignored (not honoured, not thrown)', () => {
    expect(isRegistered('xx')).toBe(false)
    expect(() => resolveInitialLocale('xx', ['ko'])).not.toThrow()
    expect(resolveInitialLocale('xx', ['ko'])).toBe('ko')
  })
})
