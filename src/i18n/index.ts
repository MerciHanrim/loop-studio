// docs/localization.md — public i18n API.
//
//   useT()  — the hook form; re-renders the component on a locale switch.
//   t()     — imperative; bound to the CURRENT active locale, for non-React
//             call sites (e.g. the PlaybackAnnouncer's deferred timer).
//
// Fallback per §L4.4: active catalog → the base (`en`) catalog → the visible
// key. A malformed ICU message falls through to the raw string in `format.ts`.

import { formatMessage, type FormatParams } from './format'
import type { MessageKey } from './locales/en'
import { BASE_CATALOG } from './registry'
import { useI18n } from './store'

function render(
  locale: string,
  catalog: Partial<Record<MessageKey, string>>,
  key: MessageKey,
  params?: FormatParams,
): string {
  const message = catalog[key] ?? BASE_CATALOG[key] ?? key
  return formatMessage(locale, key, message, params)
}

/** imperative — reads the current store state each call. */
export function t(key: MessageKey, params?: FormatParams): string {
  const { activeLocale, activeCatalog } = useI18n.getState()
  return render(activeLocale, activeCatalog, key, params)
}

/** hook — the returned `t` closes over the active locale + catalog, so the
 *  component re-renders when either changes. */
export function useT(): (key: MessageKey, params?: FormatParams) => string {
  const activeLocale = useI18n((s) => s.activeLocale)
  const activeCatalog = useI18n((s) => s.activeCatalog)
  return (key, params) => render(activeLocale, activeCatalog, key, params)
}

/** the active locale code, as a reactive value. */
export function useLocale(): string {
  return useI18n((s) => s.activeLocale)
}

export { useI18n, initI18n } from './store'
export { LOCALES, type LocaleEntry } from './registry'
export type { MessageKey } from './locales/en'
