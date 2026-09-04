import { useId, useRef } from 'react'
import { useT } from '../i18n'
import { useDialogFocus } from './useDialogFocus'

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

const REPO_URL = 'https://github.com/MerciHanrim/loop-studio'

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function AboutDialog({ open, onClose, returnFocusTo }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null

  return (
    <div className="mcdlg__scrim" onMouseDown={onClose}>
      <div
        ref={ref}
        className="mcdlg mcdlg--about"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>Loop Studio</span>
          <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
            ✕
          </button>
        </div>
        <div className="mcdlg__body about">
          <p className="about__version">
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
        </div>
      </div>
    </div>
  )
}
