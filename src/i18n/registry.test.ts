import { describe, expect, it } from 'vitest'
import en from './locales/en'
import {
  BASE_LOCALE,
  LOCALES,
  RETIRED_LOCALES,
  enabledLocales,
  getEntry,
  isRegistered,
  resolveInitialLocale,
  type LocaleEntry,
} from './registry'

// docs/localization.md §L2 — every registered locale carries the full required
// metadata set, so the switch UI / resolver / checks never need a per-locale
// special case.
//
// §L2.0a — the eighteen languages are registered again (2026-10-28/29), so the
// real registry exercises the Chinese script mapping, the base-subtag owners and
// the regional variants once more; the HYPOTHETICAL registry below, passed in as
// `resolveInitialLocale`'s third argument, keeps those rules pinned on their own
// shapes as well.
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
    for (const l of LOCALES) expect(l.nativeName).toBe(l.nativeName.trim())
  })

  // §L5.6 — the registry array is DATA and the picker sorts a copy, so what
  // `enabledLocales()` owes its caller is the SET, not an order.
  it('enabledLocales() returns the enabled entries as a set, order not promised', () => {
    const want = LOCALES.filter((l) => l.enabled)
    expect([...enabledLocales()].sort((a, b) => a.code.localeCompare(b.code))).toEqual(
      [...want].sort((a, b) => a.code.localeCompare(b.code)),
    )
    expect(enabledLocales().every((l) => l.enabled)).toBe(true)
  })

  it('every locale a user can reach is enabled, and only the RTL QA locale is not', () => {
    expect(LOCALES.filter((l) => !l.enabled).map((l) => l.code)).toEqual(['ar-XB'])
  })

  it('ships exactly the restored languages, the pseudo-locales aside (§L2.0, §L2.0a)', () => {
    const shipped = LOCALES.filter((l) => !l.pseudo).map((l) => l.code)
    expect([...shipped].sort()).toEqual([
      'ar', 'de', 'en', 'es-419', 'es-ES', 'fr', 'it', 'ja', 'ko', 'nl',
      'pt-BR', 'pt-PT', 'ru', 'th', 'tr', 'vi', 'zh-Hans', 'zh-Hant',
    ])
  })

  // §L5.4 / §L9.2 — SET relations: which locales ship, which are offered, and
  // which of the offered ones are QA affordances.
  describe('the shipped / enabled / pseudo sets', () => {
    const codes = (ls: readonly LocaleEntry[]) => [...ls.map((l) => l.code)].sort()
    const shipped = LOCALES.filter((l) => !l.pseudo)
    const enabled = LOCALES.filter((l) => l.enabled)
    const pseudo = LOCALES.filter((l) => l.pseudo)

    it('every shipped locale is enabled — shipped is a subset of enabled', () => {
      expect(shipped.every((l) => l.enabled)).toBe(true)
      expect(shipped.every((l) => enabled.includes(l))).toBe(true)
    })

    it('the enabled non-pseudo locales are exactly the shipped ones', () => {
      expect(codes(enabled.filter((l) => !l.pseudo))).toEqual(codes(shipped))
    })

    it('the only ENABLED pseudo-locale is en-XA — the picker offers one QA entry', () => {
      expect(codes(enabled.filter((l) => l.pseudo))).toEqual(['en-XA'])
    })

    it('the only DISABLED locale is the ar-XB RTL pseudo — registered, never offered', () => {
      const disabled = LOCALES.filter((l) => !l.enabled)
      expect(codes(disabled)).toEqual(['ar-XB'])
      expect(disabled.every((l) => l.pseudo)).toBe(true)
      // §L2.0a — Arabic is back and the RTL QA pseudo stays beside it; both
      // read rtl, and neither mirrors the layout (§L9.2, 2026-10-29)
      const rtl = LOCALES.filter((l) => l.direction === 'rtl')
      expect(codes(rtl).sort()).toEqual(['ar', 'ar-XB'])
    })

    it('every pseudo-locale is dev-only, so production ships none of them', () => {
      // `devPseudoLocales()` is the only source of `pseudo` entries and it is
      // `import.meta.env.DEV`-gated; `e2e/portable-file.spec.ts` asserts the
      // absence at the BYTE level in the built artefacts.
      expect(codes(pseudo)).toEqual(['ar-XB', 'en-XA'])
      expect(pseudo.every((l) => l.catalog !== undefined)).toBe(true)
      expect(shipped.some((l) => l.pseudo)).toBe(false)
    })
  })

  it('ko carries its own endonym, display key and number locale', () => {
    const e = getEntry('ko')
    expect(e?.nativeName).toBe('한국어')
    expect(e?.englishName).toBe('Korean')
    expect(e?.displayNameKey).toBe('language.korean')
    expect(e?.direction).toBe('ltr')
    expect(e?.numberLocale).toBe('ko')
    expect(e?.enabled).toBe(true)
    expect(e?.pseudo).toBeUndefined()
    expect(isRegistered('ko')).toBe(true)
  })
})

// docs/localization.md §L2.0 — the sixteen languages archived in 2026-10, all
// restored by §L2.0a (2026-10-28/29). The retired-locale rule stays in place
// with an empty list; whether to remove it is open for review.
describe('retired locales (§L2.0)', () => {
  it('none remain: every archived language is registered again', () => {
    expect([...RETIRED_LOCALES]).toEqual([])
    for (const code of RETIRED_LOCALES) expect(isRegistered(code), code).toBe(false)
  })

  it('the rule still holds for a retired list that is not empty (a hypothetical one)', () => {
    // the registry without `fr`, and `fr` retired: a stored `fr` starts in
    // English even under a French or Korean browser
    const reg = LOCALES.filter((l) => l.code !== 'fr')
    expect(resolveInitialLocale('fr', [], reg, ['fr'])).toBe('en')
    expect(resolveInitialLocale('fr', ['ko-KR'], reg, ['fr'])).toBe('en')
    expect(resolveInitialLocale('fr', ['fr-FR'], reg, ['fr'])).toBe('en')
    // and a browser asking for it is skipped like any unsupported tag
    expect(resolveInitialLocale(null, ['fr-FR', 'ko'], reg, ['fr'])).toBe('ko')
  })

  it('a STORED retired code starts in English, whatever the browser asks for', () => {
    for (const code of RETIRED_LOCALES) {
      expect(resolveInitialLocale(code, []), code).toBe('en')
      expect(resolveInitialLocale(code, ['ko-KR']), `${code} with a Korean browser`).toBe('en')
      expect(resolveInitialLocale(code, [code]), `${code} with a browser asking for it`).toBe('en')
    }
  })

  it('a browser asking for a shipped language gets its own; an unknown one English', () => {
    expect(resolveInitialLocale(null, ['qaa']), 'qaa').toBe('en')
    expect(resolveInitialLocale(null, ['ar-EG'])).toBe('ar')
    expect(resolveInitialLocale(null, ['ko-KR'])).toBe('ko')
    expect(resolveInitialLocale(null, ['de-DE'])).toBe('de')
    expect(resolveInitialLocale(null, ['ja-JP'])).toBe('ja')
    // §L2.0a — restored 2026-10-28, each through its own resolver step
    expect(resolveInitialLocale(null, ['fr-FR'])).toBe('fr')
    expect(resolveInitialLocale(null, ['es-MX'])).toBe('es-419')
    expect(resolveInitialLocale(null, ['es-ES'])).toBe('es-ES')
    expect(resolveInitialLocale(null, ['pt-BR'])).toBe('pt-BR')
    expect(resolveInitialLocale(null, ['pt-PT'])).toBe('pt-PT')
    expect(resolveInitialLocale(null, ['ru-RU'])).toBe('ru')
    expect(resolveInitialLocale(null, ['vi-VN'])).toBe('vi')
    // Chinese by region: no browser sends the script subtag
    expect(resolveInitialLocale(null, ['zh-CN'])).toBe('zh-Hans')
    expect(resolveInitialLocale(null, ['zh-TW'])).toBe('zh-Hant')
    expect(resolveInitialLocale(null, ['zh-HK'])).toBe('zh-Hant')
    // an unsupported first tag does not hide a supported later one
    expect(resolveInitialLocale(null, ['qaa', 'ko'])).toBe('ko')
  })

  it('a stored English or Korean choice is kept', () => {
    expect(resolveInitialLocale('ko', ['de-DE'])).toBe('ko')
    expect(resolveInitialLocale('en', ['ko-KR'])).toBe('en')
  })
})

describe('resolveInitialLocale — the real registry', () => {
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
    expect(resolveInitialLocale(null, ['qaa', 'ko'])).toBe('ko') // first that resolves wins
    expect(resolveInitialLocale(null, ['KO-kr'])).toBe('ko') // navigator matched case-insensitively
  })

  it('3. canonical fallback when nothing resolves', () => {
    expect(resolveInitialLocale(null, ['qaa', 'sv-SE'])).toBe(BASE_LOCALE)
    expect(resolveInitialLocale(null, [])).toBe(BASE_LOCALE)
    expect(resolveInitialLocale('xx', ['zz'])).toBe(BASE_LOCALE)
  })

  it('a stored value not in the registry (and not retired) is ignored, not thrown', () => {
    expect(isRegistered('xx')).toBe(false)
    expect(() => resolveInitialLocale('xx', ['ko'])).not.toThrow()
    expect(resolveInitialLocale('xx', ['ko'])).toBe('ko')
  })

  // §L5.2 / §L9.2 — a STORED code may be a pseudo-locale; a NAVIGATOR tag may
  // reach only an ENABLED one. `ar-XB` is Chrome's own RTL pseudo-tag.
  describe('a browser tag reaches only ENABLED locales; a stored code may be any registered one', () => {
    it('an ENABLED pseudo-locale is still served to a browser that asks for it', () => {
      expect(resolveInitialLocale(null, ['en-XA'])).toBe('en-XA')
      expect(resolveInitialLocale(null, ['en-xa'])).toBe('en-XA')
      expect(getEntry('en-XA')?.enabled).toBe(true)
    })

    it('a DISABLED locale is never reached from a browser tag', () => {
      expect(getEntry('ar-XB')?.enabled).toBe(false)
      // §L2.0a — with Arabic registered, the tag reaches `ar` through its base
      // subtag (§L5.2 step 3), never the disabled pseudo itself
      expect(resolveInitialLocale(null, ['ar-XB'])).toBe('ar')
      expect(resolveInitialLocale(null, ['qaa', 'ar-XB'])).toBe('ar')
    })

    it('every disabled locale is unreachable from a browser tag, whatever it is', () => {
      for (const l of LOCALES.filter((x) => !x.enabled)) {
        expect(resolveInitialLocale(null, [l.code]), l.code).not.toBe(l.code)
      }
      for (const l of LOCALES.filter((x) => x.enabled)) {
        expect(resolveInitialLocale(null, [l.code]), l.code).toBe(l.code)
      }
    })

    it('honours a disabled or pseudo locale that is the STORED code', () => {
      expect(resolveInitialLocale('ar-XB', [])).toBe('ar-XB')
      expect(resolveInitialLocale('ar-XB', ['ko'])).toBe('ar-XB')
      expect(resolveInitialLocale('en-XA', ['ko'])).toBe('en-XA')
    })
  })
})

// ── the resolver's rules for a LARGER registry, against a hypothetical one ──
// The same function, given a registry of the shape the product had before
// §L2.0; `retired` is empty so only the ordinary rules apply.
const entry = (code: string, extra: Partial<LocaleEntry> = {}): LocaleEntry => ({
  code,
  englishName: code,
  nativeName: code,
  displayNameKey: 'language.english',
  direction: 'ltr',
  numberLocale: code,
  enabled: true,
  catalog: () => Promise.resolve(en),
  ...extra,
})
// locale-subset: a hypothetical registry, one entry per resolver shape
const WIDE: readonly LocaleEntry[] = [
  entry('en'),
  entry('ko'),
  entry('ja'),
  entry('fr'),
  entry('de'),
  entry('zh-Hans'),
  entry('zh-Hant'),
  entry('es-419', { baseFallbackFor: 'es' }),
  entry('es-ES'),
  entry('pt-BR', { baseFallbackFor: 'pt' }),
  entry('pt-PT'),
  entry('ar', { direction: 'rtl' }),
  entry('ar-XB', { direction: 'rtl', enabled: false, pseudo: true }),
]
const r = (stored: string | null, nav: readonly string[]) => resolveInitialLocale(stored, nav, WIDE, [])

// docs/localization.md §L5.2a — Chinese is the one language whose SCRIPT, not
// its base subtag, picks the locale, and no browser sends the script.
describe('resolveInitialLocale — Chinese script / region mapping (hypothetical registry)', () => {
  it('maps every Simplified region, the explicit script, and a bare zh', () => {
    for (const tag of ['zh-CN', 'zh-SG', 'zh-MY', 'zh', 'zh-Hans', 'zh-Hans-CN', 'ZH-HANS']) {
      expect(r(null, [tag]), tag).toBe('zh-Hans')
    }
  })

  it('maps every Traditional region and the explicit script', () => {
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-hant', 'zh-Hant-TW', 'zh-Hant-HK']) {
      expect(r(null, [tag]), tag).toBe('zh-Hant')
    }
  })

  it('never hands a Traditional browser Simplified, or the other way round', () => {
    expect(r(null, ['zh-TW'])).not.toBe('zh-Hans')
    expect(r(null, ['zh-CN'])).not.toBe('zh-Hant')
  })

  it('leaves every other language alone', () => {
    expect(r(null, ['ko-KR'])).toBe('ko')
    expect(r(null, ['ja'])).toBe('ja')
    expect(r(null, ['qaa'])).toBe('en') // ISO 639-2 reserved for local use, never registrable
    expect(r(null, ['zhuang'])).toBe('en') // not a zh subtag
  })

  it('the real registry reaches its script locales the same way', () => {
    // §L2.0a — Chinese restored (2026-10-28)
    expect(resolveInitialLocale(null, ['zh-CN'])).toBe('zh-Hans')
    expect(resolveInitialLocale(null, ['zh'])).toBe('zh-Hans')
    expect(resolveInitialLocale(null, ['zh-TW'])).toBe('zh-Hant')
  })

  it('an earlier acceptable browser language still wins', () => {
    expect(r(null, ['ko', 'zh-CN'])).toBe('ko')
    expect(r(null, ['zh-CN', 'ko'])).toBe('zh-Hans')
    expect(r(null, ['zh-TW', 'zh-CN'])).toBe('zh-Hant')
  })

  it('a stored locale still beats the browser, and a bad stored value recovers', () => {
    expect(r('zh-Hans', ['ko-KR'])).toBe('zh-Hans')
    expect(r('en', ['zh-CN'])).toBe('en')
    expect(r('zh-Hant-XX', ['zh-CN'])).toBe('zh-Hans') // unregistered → browser
    expect(r('zz-ZZ', ['zh-HK'])).toBe('zh-Hant')
    expect(r('zh-CN', ['ko-KR'])).toBe('ko') // a REGION is not a code
  })

  it('an RTL language is reached by its own tags, never through the RTL pseudo', () => {
    for (const tag of ['ar', 'ar-SA', 'ar-EG', 'ar-Arab-EG', 'ar-EG-u-nu-latn']) expect(r(null, [tag]), tag).toBe('ar')
    expect(r(null, ['ar-XB'])).toBe('ar') // the pseudo is disabled; its base subtag answers
  })
})

// docs/localization.md §L5.2 step 4 — `baseFallbackFor`. A locale whose CODE is
// not its own base subtag (`es-419`, `pt-BR`) needs an explicit owner for the
// base, or every browser tag of that language reaches English.
describe('§L5.2 step 4 — baseFallbackFor (hypothetical registry)', () => {
  it('at most one locale owns a base subtag, in the real registry and the wide one', () => {
    for (const reg of [LOCALES, WIDE]) {
      const owners = new Map<string, string>()
      for (const l of reg) {
        if (l.baseFallbackFor == null) continue
        expect(owners.get(l.baseFallbackFor), `${l.baseFallbackFor} owned twice`).toBeUndefined()
        owners.set(l.baseFallbackFor, l.code)
      }
    }
  })

  it("a declared base is the locale's own language subtag", () => {
    for (const reg of [LOCALES, WIDE]) {
      for (const l of reg) {
        if (l.baseFallbackFor == null) continue
        expect(l.code.toLowerCase().split('-')[0], `${l.code} declares ${l.baseFallbackFor}`).toBe(l.baseFallbackFor.toLowerCase())
      }
    }
  })

  it('every Spanish tag a browser actually sends reaches the base owner', () => {
    for (const tag of ['es', 'es-419', 'es-MX', 'es-AR', 'es-CO', 'es-US', 'es-GQ', 'ES-mx', 'es-419-u-va-posix']) {
      expect(r(null, [tag]), tag).toBe('es-419')
    }
  })

  it('each navigator tag is fully resolved before the next one is tried', () => {
    expect(r(null, ['es-MX', 'de-DE'])).toBe('es-419')
    expect(r(null, ['de-DE', 'es-MX'])).toBe('de')
    expect(r(null, ['xx-YY', 'es-AR'])).toBe('es-419')
    expect(r(null, ['xx-YY', 'zz'])).toBe(BASE_LOCALE)
  })

  it('an exact code beats the base-fallback owner', () => {
    expect(r(null, ['es-ES'])).toBe('es-ES')
    expect(r(null, ['ES-es'])).toBe('es-ES')
    expect(r(null, ['es-MX'])).toBe('es-419')
    expect(r(null, ['es-MX', 'es-ES'])).toBe('es-419')
    expect(r(null, ['es-ES', 'es-MX'])).toBe('es-ES')
    expect(r(null, ['pt-PT'])).toBe('pt-PT')
    expect(r(null, ['pt-AO'])).toBe('pt-BR')
  })

  it('a script or extension subtag misses the exact match — known limit', () => {
    for (const tag of ['pt-Latn-PT', 'pt-PT-u-ca-gregory']) expect(r(null, [tag]), tag).toBe('pt-BR')
    expect(r(null, ['es-Latn-ES'])).toBe('es-419')
  })

  it('an unregistered stored value is never normalised into a fallback', () => {
    for (const stored of ['es', 'es-MX', 'ES-419', 'pt', 'pt-br']) expect(r(stored, ['en-US']), stored).toBe('en')
    expect(r('es-419', ['en-US'])).toBe('es-419')
    // stored values are matched exactly; navigator tags case-insensitively
    expect(r(null, ['pt-pt'])).toBe('pt-PT')
    expect(r('pt-pt', ['en-US'])).toBe('en')
  })
})
