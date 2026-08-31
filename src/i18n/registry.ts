// docs/localization.md §L2 — the locale registry. `en` and `ko` are simply its
// first two entries; the switch UI, the checks, and the fallback all read this
// list and never name a locale literally (except `BASE_LOCALE`). Adding a
// language = one `LOCALES` entry + one `src/i18n/locales/<code>.ts` file, no
// edits elsewhere.

import type { MessageCatalog } from './locales/en'
import en from './locales/en'
import ko from './locales/ko'

export type LocaleDir = 'ltr' | 'rtl'

export type LocaleEntry = {
  /** BCP-47 primary subtag; the catalog key and the persisted value */
  code: string
  /** for docs / logs */
  englishName: string
  /** shown in the switch UI, written in that language */
  nativeName: string
  /** `<html dir>` — metadata only in v0.8.0 (§L9); no RTL layout is promised */
  dir: LocaleDir
  /** BCP-47 tag handed to `Intl.*` when a UI-chrome number is formatted (§L8);
   *  never touches stored / digested data */
  numberLocale: string
  /** the async seam (§L4.5). Static in v0.8.0 (both catalogs are in the one
   *  bundle); a later move to per-locale chunks swaps this body only. */
  catalog: () => Promise<MessageCatalog>
}

export const LOCALES: readonly LocaleEntry[] = [
  {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    dir: 'ltr',
    numberLocale: 'en',
    catalog: () => Promise.resolve(en),
  },
  {
    code: 'ko',
    englishName: 'Korean',
    nativeName: '한국어',
    dir: 'ltr',
    numberLocale: 'ko',
    catalog: () => Promise.resolve(ko),
  },
] as const

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
