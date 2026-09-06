import { describe, expect, it } from 'vitest'
import { LANGUAGE_SEARCH_THRESHOLD, matchesLanguageQuery } from './languageOptions'

// docs/localization.md §L5.3 — the switch's shared search logic.
const KO = { code: 'ko', englishName: 'Korean', nativeName: '한국어' }
const JA = { code: 'ja', englishName: 'Japanese', nativeName: '日本語' }

describe('matchesLanguageQuery', () => {
  it('an empty / whitespace query matches everything', () => {
    expect(matchesLanguageQuery(KO, 'Korean', '')).toBe(true)
    expect(matchesLanguageQuery(KO, 'Korean', '   ')).toBe(true)
  })

  it('matches on the BCP-47 code', () => {
    expect(matchesLanguageQuery(KO, '한국어', 'ko')).toBe(true)
    expect(matchesLanguageQuery(KO, '한국어', 'KO')).toBe(true) // case-insensitive
  })

  it('matches on the English name', () => {
    expect(matchesLanguageQuery(KO, '한국어', 'kore')).toBe(true)
  })

  it('matches on the endonym', () => {
    expect(matchesLanguageQuery(JA, 'Japanese', '日本')).toBe(true)
  })

  it('matches on the name in the active UI language (displayName)', () => {
    expect(matchesLanguageQuery(JA, '일본어', '일본')).toBe(true)
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesLanguageQuery(KO, 'Korean', '  korea  ')).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(matchesLanguageQuery(KO, 'Korean', 'français')).toBe(false)
  })
})

describe('LANGUAGE_SEARCH_THRESHOLD', () => {
  it('is a small integer > the two shipped locales', () => {
    expect(Number.isInteger(LANGUAGE_SEARCH_THRESHOLD)).toBe(true)
    expect(LANGUAGE_SEARCH_THRESHOLD).toBeGreaterThan(2)
  })
})
