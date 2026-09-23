import { describe, expect, it } from 'vitest'
import {
  LANGUAGE_SEARCH_THRESHOLD,
  foldForSearch,
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

  it('SHOWS for the languages this release ships — first reached at six', () => {
    expect(LOCALES.filter((l) => !l.pseudo).length).toBeGreaterThanOrEqual(
      LANGUAGE_SEARCH_THRESHOLD,
    )
    expect(shouldShowLanguageSearch(LOCALES)).toBe(true)
  })
})

// docs/localization.md §L5.5 — French must be findable without a French
// keyboard, and the folding must not damage any other writing system.
describe('foldForSearch', () => {
  it('drops a combining mark only when it sits on a LATIN letter', () => {
    expect(foldForSearch('Français')).toBe('francais')
    expect(foldForSearch('Élève')).toBe('eleve')
    expect(foldForSearch('Tiếng Việt')).toBe('tieng viet') // Vietnamese, for later
  })

  it('leaves Japanese voiced kana distinct — the obvious NFD strip would not', () => {
    expect(foldForSearch('ポ')).not.toBe(foldForSearch('ホ'))
    expect(foldForSearch('が')).not.toBe(foldForSearch('か'))
    expect(foldForSearch('日本語')).toBe('日本語')
  })

  it('leaves Hangul, Han and unmarked Cyrillic untouched', () => {
    expect(foldForSearch('한국어')).toBe('한국어')
    expect(foldForSearch('繁體中文')).toBe('繁體中文')
    expect(foldForSearch('Русский')).toBe('русский')
  })

  // The one Cyrillic exception (§L5.5). Every Russian string here is built
  // from code points rather than typed, because Cyrillic `е` / `у` / `о` are
  // homoglyphs of Latin letters and a literal could not be reviewed by eye.
  const YO = String.fromCharCode(0x451)
  const YO_UP = String.fromCharCode(0x401)
  const E = String.fromCharCode(0x435)
  const E_UP = String.fromCharCode(0x415)
  const I_SHORT = String.fromCharCode(0x439)
  const I = String.fromCharCode(0x438)
  // `упрощённый` and `упрощенный` — the Simplified-Chinese entry as the ru UI
  // spells it, and as a Russian speaker actually types it.
  const SIMPLIFIED_YO = String.fromCharCode(0x443, 0x43f, 0x440, 0x43e, 0x449, 0x451, 0x43d, 0x43d, 0x44b, 0x439)
  const SIMPLIFIED_E = String.fromCharCode(0x443, 0x43f, 0x440, 0x43e, 0x449, 0x435, 0x43d, 0x43d, 0x44b, 0x439)
  const CHINESE_RU = String.fromCharCode(0x41a, 0x438, 0x442, 0x430, 0x439, 0x441, 0x43a, 0x438, 0x439)

  it('folds the one Cyrillic case — `ё` searches as `е`', () => {
    expect(foldForSearch(YO)).toBe(foldForSearch(E))
    expect(foldForSearch(YO_UP)).toBe(foldForSearch(E_UP))
    expect(foldForSearch(YO_UP)).toBe(foldForSearch(E))
    expect(foldForSearch(SIMPLIFIED_YO)).toBe(foldForSearch(SIMPLIFIED_E))
  })

  it('does NOT fold `й` to `и` — the rule is one letter wide, not "Cyrillic"', () => {
    // `й` is also a base plus a combining mark under NFD, and it is a distinct
    // letter no Russian reader substitutes. This is the assertion that fails if
    // the narrow rule is ever widened to all Cyrillic marks.
    expect(foldForSearch(I_SHORT)).not.toBe(foldForSearch(I))
    expect(foldForSearch(CHINESE_RU)).not.toBe(
      foldForSearch(CHINESE_RU.replace(I_SHORT, I)),
    )
  })

  it('finds the Simplified Chinese entry from a Russian UI typed without `ё`', () => {
    const entry = { code: 'zh-Hans', englishName: 'Chinese (Simplified)', nativeName: '简体中文' }
    const displayName = CHINESE_RU + ' (' + SIMPLIFIED_YO + ')'
    for (const q of [SIMPLIFIED_E, SIMPLIFIED_YO, CHINESE_RU, 'simplified']) {
      expect(matchesLanguageQuery(entry, displayName, q), q).toBe(true)
    }
  })

  it('normalises NBSP and the narrow no-break space to one ASCII space', () => {
    expect(foldForSearch('a b')).toBe('a b')
    expect(foldForSearch('a b')).toBe('a b')
  })

  it('leaves a ligature alone — no ad-hoc transliteration', () => {
    expect(foldForSearch('œuf')).toBe('œuf')
  })
})

describe('matchesLanguageQuery — finding fr', () => {
  const entry = { code: 'fr', englishName: 'French', nativeName: 'Français' }

  it('finds French with or without the cedilla, and by code or English name', () => {
    for (const q of ['fr', 'FR', 'French', 'french', 'Français', 'français', 'francais', 'franc']) {
      expect(matchesLanguageQuery(entry, 'Français', q), q).toBe(true)
    }
  })

  it('finds it by its name in the active UI language', () => {
    expect(matchesLanguageQuery(entry, '프랑스어', '프랑스')).toBe(true) // KO UI
    expect(matchesLanguageQuery(entry, 'フランス語', 'フランス')).toBe(true) // JA UI
    expect(matchesLanguageQuery(entry, '法语', '法语')).toBe(true) // zh-Hans UI
  })

  it('does not collapse unrelated entries', () => {
    expect(matchesLanguageQuery(entry, 'French', 'deutsch')).toBe(false)
    expect(matchesLanguageQuery({ code: 'ja', englishName: 'Japanese', nativeName: '日本語' }, '日本語', 'ポ')).toBe(false)
  })
})
