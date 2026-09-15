import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_URL } from '../feedback'
import { useT } from '../i18n'
import { useTourStore } from '../store/tourStore'
import type { ToolbarDialog } from './toolbar/dialogTypes'
import { useMenuOpenStore } from './toolbar/menuOpenStore'

// docs/guided-tour.md §GT7 / docs/contextual-inline-help.md §CIH4 — the
// desktop Help (`?`) menu: `Take a tour` (replays the tour; never rewrites
// the stored key, §GT6.4), `Contextual help`, `Send feedback` (an external
// link to the feedback form, opens a new tab), and `About Loop Studio`.
//
// Review condition 3: `About` and `Contextual help` no longer live here —
// they're lifted to `Toolbar.tsx`'s `DialogHost` (a stable ancestor), since
// Help is first in `OVERFLOW_ORDER` and so hits the "closing `…` unmounts
// the dialog it just opened" bug soonest. `onOpenDialog` replaces that local
// state; `onLeave` is called first by the two actions that need the same
// ancestor-close treatment but open no dialog (Take a tour, Send feedback).

export function HelpMenu({
  buttonRef,
  onOpenDialog,
  onLeave,
}: {
  buttonRef?: (el: HTMLButtonElement | null) => void
  onOpenDialog: (desc: ToolbarDialog) => void
  onLeave: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
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

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('help', open)
    return () => useMenuOpenStore.getState().setOpen('help', false)
  }, [open])

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={buttonRef}
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
              onLeave()
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
              onOpenDialog({ kind: 'contextualHelp' })
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
            onClick={() => {
              setOpen(false)
              onLeave()
            }}
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
              onOpenDialog({ kind: 'about' })
            }}
          >
            <span className="menu__name">{t('tour.help.about')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
