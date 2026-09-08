// docs/localization.md §L4.5 — the atomic-activation state machine. Selecting a
// locale (a) persists the preference and (b) starts an activation request;
// `activeLocale` / `activeCatalog` / `<html lang>` / `<html dir>` change in ONE
// commit, and ONLY after BOTH the target UI catalog AND its template-label
// dictionary have loaded. A late completion whose generation is stale is
// dropped; a failed load keeps the current screen and raises `loadError` so the
// UI can show a dismissible notice.

import { create } from 'zustand'
import type { MessageCatalog } from './locales/en'
import { ensureTemplateLabelDict } from './templateLabels/dicts'
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
  /** set when a locale's catalog OR template-label dict fails to load — the
   *  screen stays on `activeLocale`. `code` is the language that failed,
   *  `current` the one still shown. Cleared by `dismissLoadError` and by the
   *  next successful `setLocale`. */
  loadError: { code: string; current: string } | null
  /** (a) persist the preference, (b) start an activation request. Re-selecting
   *  the active locale (while not mid-load) is a no-op. Unknown codes ignored. */
  setLocale: (code: string) => void
  dismissLoadError: () => void
}

function applyHtml(code: string): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.setAttribute('lang', code)
  el.setAttribute('dir', getEntry(code)?.direction ?? 'ltr')
}

/** Both halves a locale needs before it can be activated: its UI catalog and
 *  its template-label dictionary. `ensureTemplateLabelDict` is a no-op for the
 *  base locale and for a locale with no dictionary. */
function loadLocaleAssets(code: string): Promise<MessageCatalog> {
  const entry = getEntry(code)
  if (!entry) return Promise.reject(new Error(`unregistered locale "${code}"`))
  return Promise.all([entry.catalog(), ensureTemplateLabelDict(code)]).then(([cat]) => cat)
}

export const useI18n = create<I18nState>((set, get) => ({
  activeLocale: BASE_LOCALE,
  activeCatalog: BASE_CATALOG,
  requestedLocale: BASE_LOCALE,
  requestGeneration: 0,
  loading: false,
  loadError: null,

  setLocale: (code) => {
    const s = get()
    const entry = getEntry(code)
    if (!entry) return // unknown code — ignored, no state change (§L5.1)
    if (code === s.activeLocale && !s.loading) return // no-op re-select (§L4.5)

    writeStoredLocale(code) // (a) persist intent — synchronous, unconditional

    const gen = s.requestGeneration + 1 // (b) an activation request
    set({ requestedLocale: code, requestGeneration: gen, loading: true })

    loadLocaleAssets(code).then(
      (cat) => {
        if (get().requestGeneration !== gen) return // stale — dropped whole
        set({ activeLocale: code, activeCatalog: cat, loading: false, loadError: null }) // ONE commit
        applyHtml(code)
      },
      () => {
        if (get().requestGeneration !== gen) return
        // keep activeLocale / activeCatalog / <html lang|dir> / the stored value
        set({ loading: false, loadError: { code, current: get().activeLocale } })
        console.warn(
          `[i18n] failed to load the "${code}" language; staying on "${get().activeLocale}"`,
        )
      },
    )
  },

  dismissLoadError: () => set({ loadError: null }),
}))

/** DEV / E2E ONLY — `?lang=<code>` forces a registered locale for the session
 *  without touching `localStorage` and without entering the §L5.2 order (§L11).
 *  Guarded by `import.meta.env.DEV`, which is statically false in the production
 *  and portable builds, so this function and its `'lang'` query key are
 *  tree-shaken out entirely (asserted by `e2e/portable-file.spec.ts`).
 *  It is a debugging convenience, never a product feature: it is not persisted
 *  and never propagates to a Workspace / Share payload. */
function devLocaleOverride(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    return q && getEntry(q) ? q : null
  } catch {
    return null
  }
}

/** §L5.2 — resolve + load the initial catalog BEFORE React mounts. Falls back
 *  to the embedded `en` if the chosen non-`en` locale's assets reject at boot
 *  (and raises `loadError` so the returning user learns their saved language
 *  could not load this time). */
export async function initI18n(): Promise<void> {
  const code =
    (import.meta.env.DEV ? devLocaleOverride() : null) ??
    resolveInitialLocale(readStoredLocale(), navigatorLanguages())
  const entry = getEntry(code) ?? BASE_ENTRY
  try {
    const cat = await loadLocaleAssets(entry.code)
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
      loadError: entry.code === BASE_LOCALE ? null : { code: entry.code, current: BASE_LOCALE },
    })
    applyHtml(BASE_LOCALE)
    console.warn(`[i18n] failed to load the "${code}" language at boot; started on "${BASE_LOCALE}"`)
  }
}

/** docs/localization.md §L4.5 — a future seam for pre-loading a locale's chunks
 *  (UI catalog + template-label dict) WITHOUT activating it. Only meaningful for
 *  a not-yet-loaded language: an already-resident one resolves without a
 *  network request. Not called anywhere yet — the FR / zh preloading work will
 *  use it. Swallows a rejection: a failed prefetch must never surface. */
export async function preloadLocale(code: string): Promise<void> {
  try {
    await loadLocaleAssets(code)
  } catch {
    console.warn(`[i18n] preloadLocale("${code}") failed; will retry on demand`)
  }
}
