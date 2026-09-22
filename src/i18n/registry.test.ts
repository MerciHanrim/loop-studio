import { describe, expect, it } from 'vitest'
import en from './locales/en'
import {
  BASE_LOCALE,
  LOCALES,
  enabledLocales,
  getEntry,
  isRegistered,
  resolveInitialLocale,
} from './registry'

// docs/localization.md §L2 — every registered locale carries the full required
// metadata set, so the switch UI / resolver / checks never need a per-locale
// special case and step 3's selector work does not have to reshape the registry.
describe('locale registry metadata', () => {
  it('every registered locale has the required fields, well-typed', () => {
    expect(LOCALES.length).toBeGreaterThan(0)
    for (const l of LOCALES) {
      expect(typeof l.code, `${l.code}: code`).toBe('string')
      expect(l.code.length, `${l.code}: code non-empty`).toBeGreaterThan(0)
      expect(typeof l.nativeName, `${l.code}: nativeName`).toBe('string')
      expect(l.nativeName.length, `${l.code}: nativeName non-empty`).toBeGreaterThan(0)
      expect(['ltr', 'rtl'], `${l.code}: direction`).toContain(l.direction)
      expect(typeof l.enabled, `${l.code}: enabled`).toBe('boolean')
      expect(typeof l.numberLocale, `${l.code}: numberLocale`).toBe('string')
      expect(typeof l.catalog, `${l.code}: catalog thunk`).toBe('function')
      // displayNameKey must resolve in the base catalog — a half-added locale
      // (registry entry but no `language.<name>` key) fails here and in CI.
      expect(l.displayNameKey, `${l.code}: displayNameKey`).toMatch(/^language\./)
      expect(en[l.displayNameKey], `${l.code}: displayNameKey resolves`).toBeTruthy()
    }
  })

  it('nativeName does not depend on the active UI language (it is the endonym)', () => {
    // a literal in the registry source, not a catalog key — the check is that it
    // is a plain non-empty string that is stable across the app's lifetime
    for (const l of LOCALES) expect(l.nativeName).toBe(l.nativeName.trim())
  })

  it('enabledLocales() returns the enabled entries, in registry order', () => {
    expect(enabledLocales()).toEqual(LOCALES.filter((l) => l.enabled))
    expect(enabledLocales().every((l) => l.enabled)).toBe(true)
  })

  it('every shipped locale is enabled today', () => {
    expect(enabledLocales().map((l) => l.code)).toEqual(LOCALES.map((l) => l.code))
  })

  // §L2.4 — Traditional Chinese is its own locale, never a conversion of
  // Simplified, and the dev pseudo-locale is not one of the shipped languages.
  it('ships exactly seven languages, the pseudo-locale aside', () => {
    const shipped = LOCALES.filter((l) => !l.pseudo).map((l) => l.code)
    expect([...shipped].sort()).toEqual(['de', 'en', 'fr', 'ja', 'ko', 'zh-Hans', 'zh-Hant'])
    expect(LOCALES.filter((l) => l.pseudo).every((l) => l.code === 'en-XA')).toBe(true)
  })

  it('fr carries its own endonym, display key and number locale', () => {
    const e = getEntry('fr')
    expect(e?.nativeName).toBe('Français')
    expect(e?.englishName).toBe('French')
    expect(e?.displayNameKey).toBe('language.french')
    expect(e?.direction).toBe('ltr')
    expect(e?.numberLocale).toBe('fr')
    expect(e?.pseudo).toBeUndefined()
    expect(isRegistered('fr')).toBe(true)
  })

  it('zh-Hant carries its own endonym, display key and number locale', () => {
    const e = getEntry('zh-Hant')
    expect(e?.nativeName).toBe('繁體中文')
    expect(e?.englishName).toBe('Chinese (Traditional)')
    expect(e?.displayNameKey).toBe('language.chineseTraditional')
    expect(e?.direction).toBe('ltr')
    expect(e?.numberLocale).toBe('zh-Hant')
    expect(e?.enabled).toBe(true)
    expect(e?.pseudo).toBeUndefined()
    expect(isRegistered('zh-Hant')).toBe(true)
  })
})

// docs/localization.md §L5.2 — the fully deterministic locale-decision order.

// docs/localization.md §L5.2a — Chinese is the one language whose SCRIPT, not
// its base subtag, picks the locale, and no browser sends the script. Every
// region a Chinese reader's browser actually reports has to land somewhere,
// and a region that maps to a locale the registry does NOT have must fall
// through to the ordinary rules rather than guess.
describe('resolveInitialLocale — Chinese script / region mapping', () => {
  it('maps every Simplified region, the explicit script, and a bare zh', () => {
    for (const tag of ['zh-CN', 'zh-SG', 'zh-MY', 'zh', 'zh-Hans', 'zh-Hans-CN', 'ZH-HANS']) {
      expect(resolveInitialLocale(null, [tag]), tag).toBe('zh-Hans')
    }
  })

  it('maps every Traditional region and the explicit script', () => {
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-hant', 'zh-Hant-TW', 'zh-Hant-HK']) {
      expect(resolveInitialLocale(null, [tag]), tag).toBe('zh-Hant')
    }
  })

  it('never hands a Traditional browser Simplified, or the other way round', () => {
    expect(resolveInitialLocale(null, ['zh-TW'])).not.toBe('zh-Hans')
    expect(resolveInitialLocale(null, ['zh-CN'])).not.toBe('zh-Hant')
  })

  it('leaves every other language alone', () => {
    expect(resolveInitialLocale(null, ['ko-KR'])).toBe('ko')
    expect(resolveInitialLocale(null, ['ja'])).toBe('ja')
    expect(resolveInitialLocale(null, ['nl-NL'])).toBe('en') // not registered yet
    expect(resolveInitialLocale(null, ['zhuang'])).toBe('en') // not a zh subtag
  })

  it('an earlier acceptable browser language still wins', () => {
    expect(resolveInitialLocale(null, ['ko', 'zh-CN'])).toBe('ko')
    expect(resolveInitialLocale(null, ['zh-CN', 'ko'])).toBe('zh-Hans')
    expect(resolveInitialLocale(null, ['zh-TW', 'zh-CN'])).toBe('zh-Hant')
    expect(resolveInitialLocale(null, ['zh-CN', 'zh-TW'])).toBe('zh-Hans')
  })

  it('a stored locale still beats the browser, and a bad stored value recovers', () => {
    expect(resolveInitialLocale('zh-Hans', ['ko-KR'])).toBe('zh-Hans')
    expect(resolveInitialLocale('en', ['zh-CN'])).toBe('en')
    expect(resolveInitialLocale('zh-Hant', ['zh-CN'])).toBe('zh-Hant') // registered → stored wins
    expect(resolveInitialLocale('zh-Hant-XX', ['zh-CN'])).toBe('zh-Hans') // unregistered → browser
    expect(resolveInitialLocale('zz-ZZ', ['zh-HK'])).toBe('zh-Hant')
    expect(resolveInitialLocale('zh-Hant-XX', ['en-US'])).toBe('en')
    expect(resolveInitialLocale('zh-CN', ['ko-KR'])).toBe('ko') // a REGION is not a code
  })
})

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
    expect(resolveInitialLocale(null, ['nl-NL', 'ko'])).toBe('ko') // first that resolves wins
    // §L2.9 — every French region reaches `fr` through the ordinary
    // base-subtag rule; French needed no mapping of its own.
    for (const tag of ['fr', 'fr-FR', 'fr-BE', 'fr-CH', 'fr-CA', 'fr-LU', 'FR-ca']) {
      expect(resolveInitialLocale(null, [tag]), tag).toBe('fr')
    }
    expect(resolveInitialLocale(null, ['KO-kr'])).toBe('ko') // navigator matched case-insensitively
  })

  it('3. canonical fallback when nothing resolves', () => {
    expect(resolveInitialLocale(null, ['nl-NL', 'sv-SE'])).toBe(BASE_LOCALE)
    expect(resolveInitialLocale(null, [])).toBe(BASE_LOCALE)
    expect(resolveInitialLocale('xx', ['zz'])).toBe(BASE_LOCALE)
  })

  it('a stored value not in the registry is ignored (not honoured, not thrown)', () => {
    expect(isRegistered('xx')).toBe(false)
    expect(() => resolveInitialLocale('xx', ['ko'])).not.toThrow()
    expect(resolveInitialLocale('xx', ['ko'])).toBe('ko')
  })
})
