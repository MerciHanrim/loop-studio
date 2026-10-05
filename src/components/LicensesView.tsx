import { useEffect, useState, type RefObject } from 'react'
import { useT } from '../i18n'
import { loadNotices, noticesFileUrl, noticesHaveFile } from '../licenses/notices'
import { ArrowIcon } from '../ui/icons'

// Issue #301 - the About dialog's licence view: the third-party notices of
// this build (src/licenses/notices.ts), in the dialog itself, not a second
// modal. The lead says first that these are the notices of the third-party
// components, not a licence of Loop Studio. The text is the notices file's,
// unchanged and untranslated, in a scrollable, focusable <pre> that the
// browser can search, select and copy. It is a React text child: never
// `innerHTML` / `dangerouslySetInnerHTML` (scripts/check-licence-screen.mjs).
// Loading and a failed read have their own states; Back stays usable in both.

type State = { kind: 'loading' } | { kind: 'ready'; text: string } | { kind: 'error' }

export function LicensesView({ backRef, onBack }: { backRef: RefObject<HTMLButtonElement | null>; onBack: () => void }) {
  const t = useT()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    loadNotices().then(
      (text) => {
        if (live) setState({ kind: 'ready', text })
      },
      () => {
        if (live) setState({ kind: 'error' })
      },
    )
    return () => {
      live = false
    }
  }, [attempt])

  return (
    <div className="licenses" data-licenses-state={state.kind}>
      <button ref={backRef} type="button" className="btn licenses__back" onClick={onBack} data-licenses-back>
        {t('licenses.back')}
      </button>
      <p className="licenses__lead">{t('licenses.lead')}</p>
      {noticesHaveFile() ? (
        <a className="licenses__file" href={noticesFileUrl()} target="_blank" rel="noopener noreferrer" aria-label={t('licenses.openFileAria')} data-licenses-file>
          {t('licenses.openFile')} <ArrowIcon unit="external-link" className="menu__ext" />
        </a>
      ) : null}
      {state.kind === 'loading' ? (
        <p className="licenses__status" role="status">
          {t('licenses.loading')}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <div className="licenses__status" role="alert">
          <p>{t('licenses.error')}</p>
          <button
            type="button"
            className="btn"
            data-licenses-retry
            onClick={() => {
              setState({ kind: 'loading' })
              setAttempt((n) => n + 1)
            }}
          >
            {t('licenses.retry')}
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' ? (
        <pre className="licenses__text" tabIndex={0} dir="ltr" lang="en" aria-label={t('licenses.textLabel')} data-licenses-text>
          {state.text}
        </pre>
      ) : null}
    </div>
  )
}
