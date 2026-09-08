import { useI18n, useT } from '../i18n'
import { getEntry } from '../i18n/registry'

// docs/localization.md §L4.5 / Slice 2b — a dismissible, non-blocking banner
// when a language's chunk (UI catalog or template-label dict) fails to load.
// The screen stays on the current language; this just tells the user their
// pick did not take, so nothing-happened does not read as a bug. Mirrors
// BootNotice.tsx. Auto-clears on the next successful `setLocale`.

export function LocaleLoadNotice() {
  const t = useT()
  const err = useI18n((s) => s.loadError)
  const dismiss = useI18n((s) => s.dismissLoadError)
  if (!err) return null

  // language names are endonyms — readable regardless of the active UI language
  const language = getEntry(err.code)?.nativeName ?? err.code
  const current = getEntry(err.current)?.nativeName ?? err.current

  return (
    <div className="boot-notice" role="status">
      <span className="boot-notice__text">{t('i18n.loadFailed', { language, current })}</span>
      <button type="button" className="btn btn--sm" onClick={dismiss}>
        {t('bootNotice.dismiss')}
      </button>
    </div>
  )
}
