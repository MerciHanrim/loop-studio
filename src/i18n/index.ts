// docs/localization.md — public i18n API.
//
//   useT()  — the hook form; re-renders the component on a locale switch.
//   t()     — imperative; bound to the CURRENT active locale, for non-React
//             call sites (e.g. the PlaybackAnnouncer's deferred timer).
//
// §L4.4 — the fallback chain, applied per call:
//   1. format the active-locale message with the given params;
//   2. if that fails, format the SAME key's `en` message with the same params;
//   3. if that also fails, a stable **localised** failure notice carrying the
//      message key (`i18n.messageError`);
//   4. never throw, never render a raw ICU pattern.

import { useCallback } from 'react'
import { tryFormat, type FormatParams } from './format'
import type { MessageKey } from './locales/en'
import { BASE_CATALOG, BASE_LOCALE } from './registry'
import { useI18n } from './store'

const ERROR_KEY: MessageKey = 'i18n.messageError'

function render(
  locale: string,
  catalog: Partial<Record<MessageKey, string>>,
  key: MessageKey,
  params?: FormatParams,
): string {
  // 1 — the active-locale message
  const activeMsg = catalog[key]
  if (activeMsg != null) {
    const r = tryFormat(locale, `${locale} ${key}`, activeMsg, params)
    if (r != null) return r
  }
  // 2 — the `en` message, same params
  const enMsg = BASE_CATALOG[key]
  if (enMsg != null && enMsg !== activeMsg) {
    const r = tryFormat(BASE_LOCALE, `${BASE_LOCALE} ${key}`, enMsg, params)
    if (r != null) return r
  }
  // 3 — a stable localised failure notice + the key (never the raw pattern)
  if (key !== ERROR_KEY) {
    const notice = catalog[ERROR_KEY] ?? BASE_CATALOG[ERROR_KEY]
    if (notice != null) {
      const r =
        tryFormat(locale, `${locale} ${ERROR_KEY}`, notice, { key }) ??
        tryFormat(BASE_LOCALE, `${BASE_LOCALE} ${ERROR_KEY}`, BASE_CATALOG[ERROR_KEY], { key })
      if (r != null) return r
    }
  }
  // 4 — last resort: the bare key text
  return key
}

/** imperative — reads the current store state each call. */
export function t(key: MessageKey, params?: FormatParams): string {
  const { activeLocale, activeCatalog } = useI18n.getState()
  return render(activeLocale, activeCatalog, key, params)
}

/** hook — the returned `t` closes over the active locale + catalog, so the
 *  component re-renders when either changes. The function's IDENTITY is
 *  stable across renders and changes only with the locale / catalog (audit
 *  ②-8b): `t` sits in effect / memo dependency lists throughout the app
 *  (PlayBar's steady-state announcer, Canvas's ref-insert verdict, …), and a
 *  fresh closure on every render re-ran those on every render for nothing. */
export function useT(): (key: MessageKey, params?: FormatParams) => string {
  const activeLocale = useI18n((s) => s.activeLocale)
  const activeCatalog = useI18n((s) => s.activeCatalog)
  return useCallback(
    (key: MessageKey, params?: FormatParams) => render(activeLocale, activeCatalog, key, params),
    [activeLocale, activeCatalog],
  )
}

/** the active locale code, as a reactive value. */
export function useLocale(): string {
  return useI18n((s) => s.activeLocale)
}

export { useI18n, initI18n } from './store'
export { LOCALES, enabledLocales, type LocaleEntry } from './registry'
export {
  LANGUAGE_SEARCH_THRESHOLD,
  foldForSearch,
  labelsEquivalent,
  matchesLanguageQuery,
  shouldShowLanguageSearch,
} from './languageOptions'
export type { MessageKey } from './locales/en'
