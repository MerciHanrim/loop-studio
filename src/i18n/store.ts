// docs/localization.md §L4.5 — the atomic-activation state machine. Selecting a
// locale (a) persists the preference and (b) starts an activation request;
// `activeLocale` / `activeCatalog` / `<html lang>` / `<html dir>` change in ONE
// commit, and ONLY after the target catalog has loaded. A late completion whose
// generation is stale is dropped; a failed load keeps the current screen.

import { create } from 'zustand'
import type { MessageCatalog } from './locales/en'
import {
  BASE_CATALOG,
  BASE_ENTRY,
  BASE_LOCALE,
  getEntry,
  navigatorLanguages,
  readStoredLocale,
  resolveInitialLocale,
  writeStoredLocale,
} from './registry'

type I18nState = {
  activeLocale: string
  activeCatalog: MessageCatalog
  requestedLocale: string
  requestGeneration: number
  loading: boolean
  /** (a) persist the preference, (b) start an activation request. Re-selecting
   *  the active locale (while not mid-load) is a no-op. Unknown codes ignored. */
  setLocale: (code: string) => void
}

function applyHtml(code: string): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.setAttribute('lang', code)
  el.setAttribute('dir', getEntry(code)?.dir ?? 'ltr')
}

export const useI18n = create<I18nState>((set, get) => ({
  activeLocale: BASE_LOCALE,
  activeCatalog: BASE_CATALOG,
  requestedLocale: BASE_LOCALE,
  requestGeneration: 0,
  loading: false,

  setLocale: (code) => {
    const s = get()
    const entry = getEntry(code)
    if (!entry) return // unknown code — ignored, no state change (§L5.1)
    if (code === s.activeLocale && !s.loading) return // no-op re-select (§L4.5)

    writeStoredLocale(code) // (a) persist intent — synchronous, unconditional

    const gen = s.requestGeneration + 1 // (b) an activation request
    set({ requestedLocale: code, requestGeneration: gen, loading: true })

    entry.catalog().then(
      (cat) => {
        if (get().requestGeneration !== gen) return // stale — dropped whole
        set({ activeLocale: code, activeCatalog: cat, loading: false }) // ONE commit
        applyHtml(code)
      },
      () => {
        if (get().requestGeneration !== gen) return
        set({ loading: false }) // keep activeLocale / activeCatalog / <html lang>
        // Slice 1: a console notice. A visible non-blocking bar is Slice 2b.
        console.warn(
          `[i18n] failed to load the "${code}" catalog; staying on "${get().activeLocale}"`,
        )
      },
    )
  },
}))

/** dev / e2e only — `?lang=<code>` forces a locale for the session without
 *  touching `localStorage` (§L11). */
function forcedLangParam(): string | null {
  if (!import.meta.env.DEV) return null
  try {
    return new URLSearchParams(window.location.search).get('lang')
  } catch {
    return null
  }
}

/** §L5.2 — resolve + load the initial catalog BEFORE React mounts. Falls back
 *  to the embedded `en` if the chosen non-`en` catalog rejects at boot. */
export async function initI18n(): Promise<void> {
  const forced = forcedLangParam()
  const code =
    forced != null && getEntry(forced)
      ? forced
      : resolveInitialLocale(readStoredLocale(), navigatorLanguages())
  const entry = getEntry(code) ?? BASE_ENTRY
  try {
    const cat = await entry.catalog()
    useI18n.setState({
      activeLocale: entry.code,
      activeCatalog: cat,
      requestedLocale: entry.code,
    })
    applyHtml(entry.code)
  } catch {
    useI18n.setState({
      activeLocale: BASE_LOCALE,
      activeCatalog: BASE_CATALOG,
      requestedLocale: BASE_LOCALE,
    })
    applyHtml(BASE_LOCALE)
    console.warn(`[i18n] failed to load the "${code}" catalog at boot; started on "${BASE_LOCALE}"`)
  }
}
