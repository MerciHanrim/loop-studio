import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useDialogFocus } from './useDialogFocus'
import { DialogScrim } from './DialogScrim'
import { LicensesView } from './LicensesView'
import { Icon } from '../ui/icons'

// docs/guided-tour.md §GT7.1 — a small, static, read-only "About Loop Studio"
// dialog (the creator / copyright are otherwise only in README.md). Opening or
// closing it mutates nothing and leaves no persisted state. A normal modal:
// Escape / backdrop / close button each dismiss; focus returns to the Help
// trigger (the Help menu having closed when About opened).
//
// The product name, the `v… · build …` line, and the `Copyright © …` line are
// shown VERBATIM in every locale — not catalog strings (§GT8). Version + build
// SHA come from the same globals as the toolbar stamp. The GitHub link points
// at the project repository; its visible text and accessible name are keyed
// (`about.repo` / `about.repoAria`), the href is fixed. It opens in a new tab.
//
// Issue #301 — "Third-party open-source licenses" turns the SAME dialog into
// the licence view (LicensesView), no second modal: Back returns to About and
// puts focus back on that button; Escape, the backdrop and × still close the
// whole dialog. Every opening starts on About.

export const REPO_URL = 'https://github.com/MerciHanrim/loop-studio'

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

type View = 'about' | 'licenses'

export function AboutDialog({ open, onClose, returnFocusTo }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [view, setView] = useState<View>('about')
  const licensesRef = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  // where focus goes once the view has changed: Back on entering, the
  // licences button on returning (null = leave focus alone)
  const focusNext = useRef<'back' | 'licenses' | null>(null)
  useDialogFocus(open, ref, onClose, returnFocusTo)

  useEffect(() => {
    const target = focusNext.current === 'back' ? backRef.current : focusNext.current === 'licenses' ? licensesRef.current : null
    focusNext.current = null
    target?.focus()
  }, [view])

  // a closed dialog opens on About next time
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setView('about')
  }

  if (!open) return null
  const licenses = view === 'licenses'

  return (
    <DialogScrim onMouseDown={onClose}>
      <div
        ref={ref}
        className={`mcdlg mcdlg--about${licenses ? ' mcdlg--licenses' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-about-view={view}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{licenses ? t('about.licenses') : 'Loop Studio'}</span>
          <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
            <Icon name="close" />
          </button>
        </div>
        {licenses ? (
          <div className="mcdlg__body">
            <LicensesView
              backRef={backRef}
              onBack={() => {
                focusNext.current = 'licenses'
                setView('about')
              }}
            />
          </div>
        ) : (
          <div className="mcdlg__body about">
            <p className="about__version" dir="ltr">
              v{__APP_VERSION__}
              {__BUILD_SHA__ ? ` · build ${__BUILD_SHA__}` : ''}
            </p>
            <p className="about__by">
              {t('about.createdBy')} Hanrim
              <br />
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={t('about.repoAria')}
              >
                {t('about.repo')}
              </a>
            </p>
            <p className="about__copyright">Copyright © 2026 Hanrim. All rights reserved.</p>
            <p className="about__note">{t('about.notAffiliated')}</p>
            <p className="about__licenses">
              <button
                ref={licensesRef}
                type="button"
                className="btn"
                data-about-licenses
                onClick={() => {
                  focusNext.current = 'back'
                  setView('licenses')
                }}
              >
                {t('about.licenses')}
              </button>
            </p>
          </div>
        )}
      </div>
    </DialogScrim>
  )
}
