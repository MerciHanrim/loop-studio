import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_URL } from '../feedback'
import { useT } from '../i18n'
import { useTourStore } from '../store/tourStore'
import { AboutDialog } from './AboutDialog'
import { ContextualHelpDialog } from './ContextualHelpDialog'

// docs/guided-tour.md §GT7 / docs/contextual-inline-help.md §CIH4 — the
// desktop Help (`?`) menu: `Take a tour` (replays the tour; never rewrites
// the stored key, §GT6.4), `Contextual help`, `Send feedback` (an external
// link to the feedback form, opens a new tab), and `About Loop Studio`.

export function HelpMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [contextualOpen, setContextualOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const startReplay = useTourStore((s) => s.startReplay)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn btn--icon"
        data-tour="help-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('tour.help.menuLabel')}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open ? (
        <div className="menu__pop menu__pop--right" role="menu">
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              startReplay('desktop')
            }}
          >
            <span className="menu__name">{t('tour.help.takeTour')}</span>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setContextualOpen(true)
            }}
          >
            <span className="menu__name">{t('help.contextual.menuLabel')}</span>
          </button>
          <a
            className="menu__item"
            role="menuitem"
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('tour.help.feedbackAria')}
            onClick={() => setOpen(false)}
          >
            <span className="menu__name">
              {t('tour.help.feedback')} <span className="menu__ext" aria-hidden="true">↗</span>
            </span>
          </a>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setAboutOpen(true)
            }}
          >
            <span className="menu__name">{t('tour.help.about')}</span>
          </button>
        </div>
      ) : null}

      <ContextualHelpDialog
        open={contextualOpen}
        onClose={() => setContextualOpen(false)}
        returnFocusTo={() => btnRef.current}
      />
      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        returnFocusTo={() => btnRef.current}
      />
    </div>
  )
}
