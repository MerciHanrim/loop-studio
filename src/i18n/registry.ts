// docs/localization.md §L2 — the locale registry. `en` and `ko` are simply its
// first two entries; the switch UI, the checks, and the fallback all read this
// list and never name a locale literally (except `BASE_LOCALE`). Adding a
// language = one `LOCALES` entry + one `src/i18n/locales/<code>.ts` file, no
// edits elsewhere — the one exception is Chinese, whose script subtag no
// browser sends, so `chineseScript()` below maps `zh-CN` / `zh-TW` and friends
// onto the registered script locales.

import type { MessageCatalog, MessageKey } from './locales/en'
import en from './locales/en'
// docs/localization.md §L4.5 — only the base (`en`) catalog is statically
// bundled; every other locale is its own `import()`-ed chunk (see `catalog`
// below).

export type LocaleDir = 'ltr' | 'rtl'

export type LocaleEntry = {
  /** BCP-47 primary subtag; the catalog key and the persisted value */
  code: string
  /** for docs / logs */
  englishName: string
  /** the language's own name, written in that language (endonym) — the switch
   *  UI's primary label. Never a catalog lookup: it must read correctly
   *  regardless of the active UI language. */
  nativeName: string
  /** catalog key for this language's name IN THE ACTIVE UI LANGUAGE — the
   *  switch UI's secondary label (e.g. `language.korean` → "Korean" / "한국어").
   *  Required: adding a locale must add its `language.<name>` key to every
   *  catalog, so `check-i18n` fails on a half-added language. */
  displayNameKey: MessageKey
  /** `<html dir>` — metadata only in v0.8.0 (§L9); no RTL layout is promised */
  direction: LocaleDir
  /** BCP-47 tag handed to `Intl.*` when a UI-chrome number is formatted (§L8);
   *  never touches stored / digested data */
  numberLocale: string
  /** offered to users. `false` = registered (resolver / checks still see it)
   *  but hidden from the switch UI. Every shipped locale is `true` today; the
   *  selector work is what will consume this. */
  enabled: boolean
  /** §L5.2 step 4 — the BCP-47 base subtag this locale answers for when no
   *  registered code matches a navigator tag exactly. `es-419` owns `es`, so
   *  `es-MX` / `es-AR` / `es-ES` reach it; a later `pt-BR` would own `pt`.
   *
   *  Only needed by a locale whose CODE is not its own base subtag — `fr`,
   *  `de` and `ko` are reached by step 3 and declare nothing. At most one
   *  locale may own a base, and the base must be that locale's own language
   *  subtag; `registry.test.ts` enforces both, so this can never silently
   *  become a second, competing resolver. */
  baseFallbackFor?: string
  /** the async seam (§L4.5) — `en` resolves synchronously (statically bundled,
   *  the fallback, must never fail to load); every other locale is a dynamic
   *  `import()` of its own chunk, runtime-cached by the SW (docs/pwa.md §P8). */
  catalog: () => Promise<MessageCatalog>
  /** a DEV/QA-only entry that is not a shipped language. It is selectable and
   *  searchable like any other, but it must never be COUNTED as a language a
   *  user has (§L5.4) — a pseudo-locale inflating the picker's
   *  search-box threshold would show the box one real language too early. */
  pseudo?: boolean
}

const SHIPPED_LOCALES: readonly LocaleEntry[] = [
  {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    displayNameKey: 'language.english',
    direction: 'ltr',
    numberLocale: 'en',
    enabled: true,
    catalog: () => Promise.resolve(en),
  },
  {
    code: 'ko',
    englishName: 'Korean',
    nativeName: '한국어',
    displayNameKey: 'language.korean',
    direction: 'ltr',
    numberLocale: 'ko',
    enabled: true,
    catalog: () => import('./locales/ko').then((m) => m.default),
  },
  {
    code: 'ja',
    englishName: 'Japanese',
    nativeName: '日本語',
    displayNameKey: 'language.japanese',
    direction: 'ltr',
    numberLocale: 'ja-JP',
    enabled: true,
    catalog: () => import('./locales/ja').then((m) => m.default),
  },
  {
    // Simplified and Traditional Chinese are separate locales, never a
    // conversion of one another: the terminology differs, not only the
    // glyphs. The script subtag is part of the code because a browser sends
    // a REGION (`zh-CN`, `zh-TW`), which `chineseScript()` below maps.
    code: 'zh-Hans',
    englishName: 'Chinese (Simplified)',
    nativeName: '简体中文',
    displayNameKey: 'language.chineseSimplified',
    direction: 'ltr',
    numberLocale: 'zh-Hans',
    enabled: true,
    catalog: () => import('./locales/zh-Hans').then((m) => m.default),
  },
  {
    // Traditional Chinese, written to the TAIWAN convention (軟體 / 資料 /
    // 網路 / 專案 / 範本 / 匯入·匯出). `zh-HK` and `zh-MO` map here too: the
    // divergences from Hong Kong usage are lexical and mutually legible, not
    // semantic, so one catalog serves all three (§L2.4). It is NOT a Hong
    // Kong localisation.
    code: 'zh-Hant',
    englishName: 'Chinese (Traditional)',
    nativeName: '繁體中文',
    displayNameKey: 'language.chineseTraditional',
    direction: 'ltr',
    numberLocale: 'zh-Hant',
    enabled: true,
    catalog: () => import('./locales/zh-Hant').then((m) => m.default),
  },
  {
    // France French. `fr-FR` / `fr-BE` / `fr-CH` / `fr-CA` / `fr-LU` all land
    // here through the ordinary base-subtag rule — French needs no script
    // mapping of its own. It is NOT a separate Canadian localisation: the
    // divergences in this product's vocabulary are lexical, not semantic.
    code: 'fr',
    englishName: 'French',
    nativeName: 'Français',
    displayNameKey: 'language.french',
    direction: 'ltr',
    numberLocale: 'fr',
    enabled: true,
    catalog: () => import('./locales/fr').then((m) => m.default),
  },
  {
    // Germany Standard German. `de-DE` / `de-AT` / `de-CH` / `de-LI` /
    // `de-LU` and every other `de-*` land here through the ordinary
    // base-subtag rule, so German needs no mapping of its own.
    //
    // This is deliberately ONE catalog, written in Germany Standard German,
    // and it does not pretend to be Swiss or Austrian: Swiss German writes
    // `ss` where this catalog writes `ß`, so a `de-CH` reader sees spelling
    // that is not theirs. Splitting `de-CH` would not be a mechanical
    // `ß`->`ss` pass either (the vocabulary diverges too), so it stays a
    // stated trade-off rather than a hidden one (docs/localization.md §L2.12).
    code: 'de',
    englishName: 'German',
    nativeName: 'Deutsch',
    displayNameKey: 'language.german',
    direction: 'ltr',
    numberLocale: 'de',
    enabled: true,
    catalog: () => import('./locales/de').then((m) => m.default),
  },
  {
    // Neutral Latin American Spanish. The code carries the UN M49 region 419
    // because the catalog IS regional — `Billetera`, `Retiros`, `ustedes` —
    // and saying so keeps the door open for an `es-ES` later without renaming
    // this one or migrating anyone's stored value.
    //
    // No browser sends `es-419`; it sends `es-MX`, `es-AR`, `es`, `es-ES`.
    // The code is therefore NOT its own base subtag, which is why this is the
    // first locale to declare `baseFallbackFor` (§L5.2 step 4). Without it
    // every Spanish reader would get English — or, through
    // `navigator.languages`, whatever unrelated language came next.
    //
    // `es-ES` and `es-GQ` land here too. Peninsular and Latin American Spanish
    // are mutually intelligible, so a Spain reader seeing `computadora` and
    // `ustedes` is a stated trade-off (docs/localization.md §L2.13); English
    // would be strictly worse. Register `es-ES` later and step 1 gives it that
    // tag automatically.
    code: 'es-419',
    englishName: 'Spanish (Latin America)',
    nativeName: 'Español (Latinoamérica)',
    displayNameKey: 'language.spanishLatinAmerica',
    direction: 'ltr',
    // CLDR gives `es-419` the `1,234,567.89` convention. Latin America is not
    // uniform here — Argentina, Colombia, Chile and Peru write `1.234.567,89`
    // — but the formatter must agree with the code this locale is registered
    // under, so it stays `es-419` rather than borrowing `es` (§L2.13).
    numberLocale: 'es-419',
    enabled: true,
    baseFallbackFor: 'es',
    catalog: () => import('./locales/es-419').then((m) => m.default),
  },
  {
    // Brazilian Portuguese. Like `es-419`, the code is NOT its own base
    // subtag: a browser sends `pt-BR`, `pt`, `pt-PT`, `pt-AO`. Measured with
    // the real resolver before this entry existed, every one of those gave
    // `en` — and `["pt-AO","de-DE"]` gave `de`, `["pt","es-MX"]` gave
    // `es-419`, i.e. a Portuguese reader was handed German or Spanish. So it
    // declares `baseFallbackFor: 'pt'` (§L5.2 step 4).
    //
    // `pt-PT` and the African Portuguese tags land here TOO, and that is a
    // stated trade-off, not an oversight: European Portuguese differs from
    // this catalog in vocabulary (`ficheiro` / `ecrã` / `guardar` /
    // `utilizador` / `carácter`) and even in plural rules — CLDR gives
    // `pt-BR` 0 -> `one` and `pt-PT` 0 -> `other`. Brazilian Portuguese is
    // still far closer to those readers than English, which is the only other
    // option today. `pt-PT` is on the roadmap; registering it later makes step
    // 1 (exact code) win its own tag with no change to the resolver, exactly
    // as `es-ES` will beside `es-419`.
    code: 'pt-BR',
    englishName: 'Portuguese (Brazil)',
    nativeName: 'Português (Brasil)',
    displayNameKey: 'language.portugueseBrazil',
    direction: 'ltr',
    // `1.234.567,89` and `83,5%` — the first shipped locale whose DECIMAL
    // separator is a comma and whose group separator is a period. Nothing in
    // the product calls `Intl.NumberFormat` today (§L8); the live number path
    // is ICU `#`, which takes the locale CODE and renders integer counts only,
    // so only the group separator can appear.
    numberLocale: 'pt-BR',
    enabled: true,
    baseFallbackFor: 'pt',
    catalog: () => import('./locales/pt-BR').then((m) => m.default),
  },
]

// A dev / e2e-only pseudo-locale so tests can prove the switch, the resolver,
// and every check reach an Nth locale without special-casing `en` / `ko`. Its
// catalog is `en` verbatim. `import.meta.env.DEV` is statically false in the
// production and portable builds, so `SHIPPED_LOCALES` is all that ships (the
// byte-level `e2e/portable-file.spec.ts` gate asserts `devPseudoLocales` and
// `en-XA` are absent).
function devPseudoLocales(): readonly LocaleEntry[] {
  if (!import.meta.env.DEV) return []
  return [
    {
      code: 'en-XA',
      englishName: 'Pseudo (QA)',
      nativeName: 'Pseudo (QA)',
      // DEV-only QA locale; its catalog is `en` verbatim, so it reuses the
      // English display key rather than adding a prod catalog key for it.
      displayNameKey: 'language.english',
      direction: 'ltr',
      numberLocale: 'en',
      enabled: true,
      pseudo: true,
      catalog: () => Promise.resolve(en),
    },
  ]
}

export const LOCALES: readonly LocaleEntry[] = [...SHIPPED_LOCALES, ...devPseudoLocales()]

/** the base locale — its catalog is the canonical key set and the final
 *  fallback, and it is statically bundled so boot can never fail for want of it
 *  (§L2.3, §L4.5). */
export const BASE_LOCALE = 'en'
export const BASE_ENTRY: LocaleEntry = LOCALES[0]
export const BASE_CATALOG: MessageCatalog = en

/** the one `localStorage` key (§L5.1) — a bare registered `code`, nothing else */
export const LOCALE_STORAGE_KEY = 'loop-studio/ui-locale/1'

export function getEntry(code: string): LocaleEntry | undefined {
  return LOCALES.find((l) => l.code === code)
}

/** the locales a user may pick — `enabled` registry entries, in registry order.
 *  Everything is enabled today; the switch UI is what will call this. */
export function enabledLocales(): readonly LocaleEntry[] {
  return LOCALES.filter((l) => l.enabled)
}

export function isRegistered(code: string | null | undefined): boolean {
  return code != null && LOCALES.some((l) => l.code === code)
}

/** §L5.1 — read the stored value RAW. Never throws, never rewrites; validation
 *  (against the registry) happens in `resolveInitialLocale`. */
export function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null
  }
}

/** §L5.1 — a locale change updates ONLY this key. Best-effort. */
export function writeStoredLocale(code: string): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, code)
  } catch {
    /* storage unavailable — the runtime choice still applies for this session */
  }
}

/** §L5.2 — the fully deterministic locale-decision order. Pure; the caller
 *  passes the stored value and the browser language list so it is trivially
 *  testable.
 *
 *  1. a stored value that is EXACTLY a registered `code` (no case / separator
 *     repair) wins — an unregistered stored value is NEVER normalised into a
 *     navigator-style fallback, it is simply ignored;
 *  2. else walk `navLangs` IN ORDER and apply EVERY step to a tag before
 *     moving to the next one — exact `code`, Chinese script, an exact
 *     base-subtag code (`ko-KR` → `ko`), then a `baseFallbackFor` owner
 *     (`es-MX` → `es-419`). Sweeping the whole array per STEP instead would
 *     let a later tag's exact match beat an earlier tag's base fallback, which
 *     is the wrong preference: the user put their first tag first.
 *  3. else the canonical `BASE_LOCALE`, only after every tag is exhausted.
 */
/** §L5.2a — Chinese is the one language whose SCRIPT, not its base subtag,
 *  decides the locale, and no browser sends the script: Chrome sends `zh-CN`,
 *  `zh-TW`, `zh-HK`. The base-subtag rule below would look for a `zh` entry,
 *  find none, and hand a Chinese reader English. This table is consulted
 *  between the exact match and the base match, and only ever returns a code
 *  the registry actually has — an unregistered target falls through to the
 *  ordinary rules and, ultimately, to English.
 *
 *  Simplified: mainland China, Singapore, Malaysia. Traditional: Taiwan, Hong
 *  Kong, Macau. A bare `zh` takes Simplified, the larger population. */
function chineseScript(lowerTag: string): string | undefined {
  if (lowerTag !== 'zh' && !lowerTag.startsWith('zh-')) return undefined
  if (lowerTag === 'zh-hans' || lowerTag.startsWith('zh-hans-')) return 'zh-Hans'
  if (lowerTag === 'zh-hant' || lowerTag.startsWith('zh-hant-')) return 'zh-Hant'
  const region = lowerTag.split('-')[1]
  if (region === 'cn' || region === 'sg' || region === 'my') return 'zh-Hans'
  if (region === 'tw' || region === 'hk' || region === 'mo') return 'zh-Hant'
  return lowerTag === 'zh' ? 'zh-Hans' : undefined
}

/** The registry list is a PARAMETER with the real registry as its default, so
 *  the priority rules can be tested against a hypothetical future registry
 *  (an `es-ES` beside `es-419`) through THIS function rather than a test-only
 *  copy of it. Production always calls it with the default. */
export function resolveInitialLocale(
  stored: string | null,
  navLangs: readonly string[],
  locales: readonly LocaleEntry[] = LOCALES,
): string {
  if (stored != null && locales.some((l) => l.code === stored)) return stored

  for (const raw of navLangs) {
    if (typeof raw !== 'string' || raw === '') continue
    const lc = raw.toLowerCase()

    // 1 — the whole tag is a registered code (`es-419`, `zh-Hans`)
    const exact = locales.find((l) => l.code.toLowerCase() === lc)
    if (exact) return exact.code

    // 2 — Chinese decides by script, which no browser sends
    const script = chineseScript(lc)
    if (script != null && locales.some((l) => l.code === script)) return script

    const base = lc.split('-')[0]
    if (!base) continue

    // 3 — a registered code that IS the base subtag (`de-AT` → `de`)
    const baseHit = locales.find((l) => l.code.toLowerCase() === base)
    if (baseHit) return baseHit.code

    // 4 — the locale that explicitly owns this base (`es-MX` → `es-419`).
    //     Always AFTER the exact match, so registering `es-ES` later makes
    //     `es-ES` win its own tag without touching this code.
    const owner = locales.find((l) => l.baseFallbackFor?.toLowerCase() === base)
    if (owner) return owner.code
  }

  return BASE_LOCALE
}

/** the browser's language list, defensively (empty in SSR / a stubbed env) */
export function navigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages
  return navigator.language ? [navigator.language] : []
}
