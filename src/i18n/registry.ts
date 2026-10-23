// docs/localization.md §L2 — the locale registry. `en` and `ko` are its two
// entries; the switch UI, the checks, and the fallback all read this list and
// never name a locale literally (except `BASE_LOCALE`). Adding a language = one
// `LOCALES` entry + one `src/i18n/locales/<code>/` folder, no edits elsewhere —
// the one exception is Chinese, whose script subtag no browser sends, so
// `chineseScript()` below maps `zh-CN` / `zh-TW` and friends onto a registered
// script locale, should one be added again.
//
// §L2.0 (2026-10) — SUPPORTED: English and Korean only. The sixteen other
// languages that shipped before are archived as translation material in
// `archive/i18n/` (outside the build and the checks; see its README). A stored
// choice of one of them is listed in `RETIRED_LOCALES` and starts in English
// (`resolveInitialLocale`). Their former registry entries — number formats,
// plural rules, fonts — are kept in this file's git history.

import type { MessageCatalog, MessageKey } from './locales/en'
import en from './locales/en'
import { storagePort } from '../storage/storagePort'
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
   *  but hidden from the switch UI. */
  enabled: boolean
  /** §L5.2 step 4 — the BCP-47 base subtag this locale answers for when no
   *  registered code matches a navigator tag exactly (`es-419` owned `es`).
   *
   *  Only needed by a locale whose CODE is not its own base subtag. At most one
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
]

/** §L2.0 — the languages that shipped before 2026-10 and are archived now
 *  (`archive/i18n/`). Not registered: never offered, never loaded. A STORED
 *  value naming one starts the app in `BASE_LOCALE` (`resolveInitialLocale`),
 *  whatever the browser asks for — the user had chosen a language, and English
 *  is the stated replacement for it. Nothing in a document changes. */
export const RETIRED_LOCALES: readonly string[] = [
  'ar', 'de', 'es-419', 'es-ES', 'fr', 'it', 'ja', 'nl',
  'pt-BR', 'pt-PT', 'ru', 'th', 'tr', 'vi', 'zh-Hans', 'zh-Hant',
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
    {
      // §L9.2 — the RTL pseudo-locale. It keeps the reading-direction layout
      // exercised and REGRESSION-GUARDED with no right-to-left language shipped:
      // `direction: 'rtl'` travels the same `directionOf` path a real RTL
      // locale would.
      //
      // `enabled: false` on purpose — registered, so the resolver, the checkers
      // and `?lang=ar-XB` all see it, but NOT offered in the picker.
      //
      // Its catalog is `en` verbatim: this locale tests DIRECTION, not
      // translation. Latin text under `dir=rtl` is in fact the harder case for
      // layout — every mirrored box is visible against text that still reads
      // left to right.
      code: 'ar-XB',
      englishName: 'Pseudo RTL (QA)',
      nativeName: 'Pseudo RTL (QA)',
      displayNameKey: 'language.english',
      direction: 'rtl',
      // Latin digits and separators, so a number that moves is a LAYOUT change
      // and never a formatting one.
      numberLocale: 'en',
      enabled: false,
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
/** Looked up BY CODE, never by position. It was `LOCALES[0]` until §L5.6: the
 *  array's order is the order languages happened to ship, and a positional
 *  read makes it load-bearing. The picker sorts a COPY instead
 *  (`languageOptions.ts`), and this reads the registry as an unordered set. */
export const BASE_ENTRY: LocaleEntry = LOCALES.find((l) => l.code === BASE_LOCALE) as LocaleEntry
export const BASE_CATALOG: MessageCatalog = en

/** the one `localStorage` key (§L5.1) — a bare registered `code`, nothing else */
export const LOCALE_STORAGE_KEY = 'loop-studio/ui-locale/1'

export function getEntry(code: string): LocaleEntry | undefined {
  return LOCALES.find((l) => l.code === code)
}

/**
 * §L9.2 — the ONE place a reading direction comes from: the locale's own registry
 * entry. `<html dir>` (`store.ts`) and every element-level `dir` attribute read
 * it through here, so the chrome and an individual input can never disagree, and
 * a locale's direction is decided in exactly one line of data.
 *
 * Deliberately NOT derived from the code string. A subtag test or a name list
 * would be a second, silently divergent source of truth — and it would answer for
 * codes the app does not ship. An unregistered code gets `ltr`, which is what
 * `applyHtml` fell back to before this existed.
 *
 * Deliberately NOT read back from `document.dir`: the attribute is an OUTPUT of
 * the active locale, so reading it would race the commit that writes it and make
 * the value untestable outside a browser.
 */
export function directionOf(code: string): LocaleDir {
  return getEntry(code)?.direction ?? 'ltr'
}

/** the locales a user may pick — `enabled` registry entries, in registry order. */
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
    return storagePort.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null
  }
}

/** §L5.1 — a locale change updates ONLY this key. Best-effort. */
export function writeStoredLocale(code: string): void {
  try {
    storagePort.setItem(LOCALE_STORAGE_KEY, code)
  } catch {
    /* storage unavailable — the runtime choice still applies for this session */
  }
}

/** §L5.2a — Chinese is the one language whose SCRIPT, not its base subtag,
 *  decides the locale, and no browser sends the script: Chrome sends `zh-CN`,
 *  `zh-TW`, `zh-HK`. This table is consulted between the exact match and the
 *  base match, and only ever returns a code the registry actually has — an
 *  unregistered target falls through to the ordinary rules and, ultimately, to
 *  English (which is what every Chinese tag reaches while no Chinese locale is
 *  registered, §L2.0).
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

/** §L5.2 — the fully deterministic locale-decision order. Pure; the caller
 *  passes the stored value and the browser language list so it is trivially
 *  testable.
 *
 *  1. a stored value that is EXACTLY a registered `code` (no case / separator
 *     repair) wins — an unregistered stored value is NEVER normalised into a
 *     navigator-style fallback, it is simply ignored;
 *  1a. §L2.0 — a stored value that is a RETIRED code gives `BASE_LOCALE`,
 *     before the browser list is read: the user chose a language, and English
 *     replaces it, even where the browser would ask for Korean;
 *  2. else walk `navLangs` IN ORDER and apply EVERY step to a tag before
 *     moving to the next one — exact `code`, Chinese script, an exact
 *     base-subtag code (`ko-KR` → `ko`), then a `baseFallbackFor` owner.
 *     Sweeping the whole array per STEP instead would let a later tag's exact
 *     match beat an earlier tag's base fallback, which is the wrong
 *     preference: the user put their first tag first.
 *  3. else the canonical `BASE_LOCALE`, only after every tag is exhausted.
 *
 *  The registry list is a PARAMETER with the real registry as its default, so
 *  the priority rules can be tested against a hypothetical registry through
 *  THIS function rather than a test-only copy of it. Production always calls
 *  it with the defaults. */
export function resolveInitialLocale(
  stored: string | null,
  navLangs: readonly string[],
  locales: readonly LocaleEntry[] = LOCALES,
  retired: readonly string[] = RETIRED_LOCALES,
): string {
  if (stored != null && locales.some((l) => l.code === stored)) return stored
  if (stored != null && retired.includes(stored)) return BASE_LOCALE

  // §L5.2 / §L9.2 — a STORED code may be any registered locale (that is how
  // `?lang=` and a QA session reach one); a NAVIGATOR tag may only reach an
  // ENABLED one. `enabled` is the right predicate and `pseudo` is not: `en-XA`
  // is an enabled QA locale whose tag has always been honoured, so filtering on
  // `pseudo` would silently change that measured behaviour, while `ar-XB` — which
  // is Chrome's own RTL pseudo-tag, and would otherwise boot a real user into the
  // QA locale — is excluded because it is DISABLED.
  const offered = locales.filter((l) => l.enabled)

  for (const raw of navLangs) {
    if (typeof raw !== 'string' || raw === '') continue
    const lc = raw.toLowerCase()

    // 1 — the whole tag is a registered code
    const exact = offered.find((l) => l.code.toLowerCase() === lc)
    if (exact) return exact.code

    // 2 — Chinese decides by script, which no browser sends
    const script = chineseScript(lc)
    if (script != null && offered.some((l) => l.code === script)) return script

    const base = lc.split('-')[0]
    if (!base) continue

    // 3 — a registered code that IS the base subtag (`ko-KR` → `ko`)
    const baseHit = offered.find((l) => l.code.toLowerCase() === base)
    if (baseHit) return baseHit.code

    // 4 — the locale that explicitly owns this base. Always AFTER the exact
    //     match.
    const owner = offered.find((l) => l.baseFallbackFor?.toLowerCase() === base)
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
