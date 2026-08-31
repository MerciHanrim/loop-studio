import { LOCALES, useI18n, useT } from '../i18n'

// docs/localization.md §L5 — the language control is AUTO-GENERATED from the
// registry. It shows the active locale's `nativeName` and, on click, advances to
// the next registered locale (wrapping) — so it needs no edit when a locale is
// added. Selecting starts the atomic activation (§L4.5). (A dropdown menu
// replaces the cycle once there are more than a couple of locales — Slice 2b.)
//
// It is a plain `.btn` so it is exactly the height of the sibling toolbar
// controls (no layout shift against the committed visual baselines).

export function LanguageSwitch() {
  const t = useT()
  const active = useI18n((s) => s.activeLocale)
  const setLocale = useI18n((s) => s.setLocale)

  const idx = Math.max(0, LOCALES.findIndex((l) => l.code === active))
  const current = LOCALES[idx] ?? LOCALES[0]
  const next = LOCALES[(idx + 1) % LOCALES.length]

  return (
    <button
      type="button"
      className="btn lang-switch"
      lang={current.code}
      aria-label={t('lang.title')}
      title={t('lang.title')}
      data-locale={current.code}
      onClick={() => setLocale(next.code)}
    >
      {current.nativeName}
    </button>
  )
}
