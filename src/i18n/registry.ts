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
 *     repair) wins;
 *  2. else walk `navLangs` in order — for each, an exact `code` match, then a
 *     BCP-47 base-language match (`ko-KR` → `ko`);
 *  3. else the canonical `BASE_LOCALE`.
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

export function resolveInitialLocale(
  stored: string | null,
  navLangs: readonly string[],
): string {
  if (stored != null && isRegistered(stored)) return stored

  for (const raw of navLangs) {
    if (typeof raw !== 'string' || raw === '') continue
    const lc = raw.toLowerCase()
    const exact = LOCALES.find((l) => l.code.toLowerCase() === lc)
    if (exact) return exact.code
    const script = chineseScript(lc)
    if (script != null && isRegistered(script)) return script
    const base = lc.split('-')[0]
    const baseHit = base ? LOCALES.find((l) => l.code.toLowerCase() === base) : undefined
    if (baseHit) return baseHit.code
  }

  return BASE_LOCALE
}

/** the browser's language list, defensively (empty in SSR / a stubbed env) */
export function navigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages
  return navigator.language ? [navigator.language] : []
}
