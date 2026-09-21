import { describe, expect, it } from 'vitest'
import {
  LANGUAGE_SEARCH_THRESHOLD,
  labelsEquivalent,
  matchesLanguageQuery,
  shouldShowLanguageSearch,
} from './languageOptions'
import { LOCALES } from './registry'

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

describe('labelsEquivalent — hide the redundant second line', () => {
  it('true when the endonym and the UI-language name read the same', () => {
    expect(labelsEquivalent('한국어', '한국어')).toBe(true) // KO UI: 한국어 / 한국어
    expect(labelsEquivalent('English', 'English')).toBe(true) // EN UI: English / English
    expect(labelsEquivalent(' English ', 'english')).toBe(true) // trim + case
  })

  it('false when they differ — the second line carries meaning', () => {
    expect(labelsEquivalent('한국어', 'Korean')).toBe(false) // EN UI row for KO
    expect(labelsEquivalent('English', '영어')).toBe(false) // KO UI row for EN
    expect(labelsEquivalent('日本語', 'Japanese')).toBe(false)
  })
})

describe('LANGUAGE_SEARCH_THRESHOLD', () => {
  it('is a small integer > the two shipped locales', () => {
    expect(Number.isInteger(LANGUAGE_SEARCH_THRESHOLD)).toBe(true)
    expect(LANGUAGE_SEARCH_THRESHOLD).toBeGreaterThan(2)
  })
})

// docs/localization.md — Simplified Chinese must be findable the three ways a
// user would look for it: the BCP-47 code, the English name, and the endonym.
// The picker only renders its search box from LANGUAGE_SEARCH_THRESHOLD
// enabled locales, so this contract lives here, on the predicate itself.
describe('matchesLanguageQuery — finding zh-Hans', () => {
  const entry = { code: 'zh-Hans', englishName: 'Chinese (Simplified)', nativeName: '简体中文' }

  it('finds it by code, by English name, and by endonym', () => {
    for (const q of ['zh', 'zh-Hans', 'ZH-HANS', 'Chinese', 'chinese', 'simplified', '简体', '简体中文']) {
      expect(matchesLanguageQuery(entry, '中文（简体）', q), q).toBe(true)
    }
  })

  it('finds it by its name in the ACTIVE UI language', () => {
    expect(matchesLanguageQuery(entry, '中国語（簡体字）', '中国語')).toBe(true) // JA UI
    expect(matchesLanguageQuery(entry, '중국어 간체', '간체')).toBe(true) // KO UI
  })

  it('does not match an unrelated query', () => {
    expect(matchesLanguageQuery(entry, 'Chinese (Simplified)', 'français')).toBe(false)
    expect(matchesLanguageQuery(entry, 'Chinese (Simplified)', '日本語')).toBe(false)
  })
})

// docs/localization.md — Traditional Chinese must be findable the same three
// ways, and must never be confused with Simplified.
describe('matchesLanguageQuery — finding zh-Hant', () => {
  const entry = { code: 'zh-Hant', englishName: 'Chinese (Traditional)', nativeName: '繁體中文' }

  it('finds it by code, by English name, and by endonym', () => {
    for (const q of ['zh', 'zh-Hant', 'ZH-HANT', 'Chinese', 'traditional', '繁體', '繁體中文']) {
      expect(matchesLanguageQuery(entry, '中文（繁體）', q), q).toBe(true)
    }
  })

  it('finds it by its name in the ACTIVE UI language', () => {
    expect(matchesLanguageQuery(entry, '中国語（繁体字）', '中国語')).toBe(true) // JA UI
    expect(matchesLanguageQuery(entry, '중국어 번체', '번체')).toBe(true) // KO UI
    expect(matchesLanguageQuery(entry, '繁体中文', '繁体')).toBe(true) // zh-Hans UI
  })

  it('is not confused with Simplified', () => {
    expect(matchesLanguageQuery(entry, 'Chinese (Traditional)', 'simplified')).toBe(false)
    expect(matchesLanguageQuery(entry, 'Chinese (Traditional)', '简体')).toBe(false)
  })
})

// §L5.4 — the search box is gated on the languages a USER has. The dev
// pseudo-locale is selectable and searchable, but counting it would show the
// box one real language early in dev while production still hid it.
describe('shouldShowLanguageSearch', () => {
  const real = (n: number) => Array.from({ length: n }, () => ({}))

  it('counts shipped languages, not the pseudo-locale', () => {
    expect(shouldShowLanguageSearch(real(LANGUAGE_SEARCH_THRESHOLD - 1))).toBe(false)
    expect(shouldShowLanguageSearch(real(LANGUAGE_SEARCH_THRESHOLD))).toBe(true)
    expect(
      shouldShowLanguageSearch([...real(LANGUAGE_SEARCH_THRESHOLD - 1), { pseudo: true }]),
    ).toBe(false)
  })

  it('stays hidden at the five languages this release ships', () => {
    expect(LOCALES.filter((l) => !l.pseudo)).toHaveLength(5)
    expect(shouldShowLanguageSearch(LOCALES)).toBe(false)
  })
})
