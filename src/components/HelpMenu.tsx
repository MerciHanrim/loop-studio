import { useCallback, useEffect, useRef, useState } from 'react'
import { FEEDBACK_URL } from '../feedback'
import { useT } from '../i18n'
import { useTourStore } from '../store/tourStore'
import { useWhatsNewStore } from '../store/whatsNewStore'
import type { ToolbarDialog } from './toolbar/dialogTypes'
import { useMenuOpenStore } from './toolbar/menuOpenStore'
import { useOutsideDismiss } from './toolbar/useOutsideDismiss'
import { useMenuKeyboard, useMenuTrigger } from '../ui/useMenuKeyboard'
import { ArrowIcon } from '../ui/icons'

// docs/guided-tour.md §GT7 / docs/contextual-inline-help.md §CIH4 /
// docs/release-notes.md — the desktop Help (`?`) menu, in three groups:
//
//   Restart the tour             replays the tour; never rewrites the stored key (§GT6.4)
//   Turn contextual tips back on opens the dialog that re-arms the one-time notes
//   ----
//   What's new            [New]  every release note; the marker stays until the
//                                newest one has been opened (issue #296)
//   ----
//   Send feedback                an external link to the form, opens a new tab
//   About Loop Studio
//
// The names say what each item does: the contextual entry is not a help
// document, it only turns the short one-time notes back on.
//
// Review condition 3: the dialogs (`About`, the contextual-tips dialog, `What's
// new`) do not live here —
// they're lifted to `Toolbar.tsx`'s `DialogHost` (a stable ancestor), since
// Help is first in `OVERFLOW_ORDER` and so hits the "closing `…` unmounts
// the dialog it just opened" bug soonest. `onOpenDialog` replaces that local
// state; `onLeave` is called first by the two actions that need the same
// ancestor-close treatment but open no dialog (Restart the tour, Send feedback).

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
  // §L9.3 — a direction-aware CHARACTER from the shared table, never a transform
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const startReplay = useTourStore((s) => s.startReplay)
  // issue #296 — the newest release note has not been opened yet
  const unread = useWhatsNewStore((s) => s.unread)

  useOutsideDismiss(open, wrapRef, () => setOpen(false))

  // The keyboard. MEASURED before this: Enter or Space opened the menu and left
  // focus on the button, and the arrow keys did nothing; only Tab reached an
  // item. A screen reader follows focus, so it was told that a menu had opened
  // and was given none of it to read. "Read the release notes again from Help"
  // has to work from a keyboard.
  //
  // - opened from the keyboard, focus goes to the first item; opened with the
  //   pointer, it stays on the button that was clicked
  // - the arrow keys, Home and End move through the items, skipping separators
  // - Escape closes the menu once and returns focus to the button. The shared
  //   hook owns that key now, so the listener this menu had is gone: it would
  //   run a second time behind the hook.
  //
  // Issue #307 made this the contract of every menu: the trigger's handlers
  // and the entry point come from the shared `useMenuTrigger`.
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const { entry, triggerProps } = useMenuTrigger(open, setOpen)
  useMenuKeyboard(open, popRef, triggerRef, close, entry)

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('help', open)
    return () => useMenuOpenStore.getState().setOpen('help', false)
  }, [open])

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={(el) => {
          triggerRef.current = el
          buttonRef?.(el)
        }}
        type="button"
        className="btn btn--icon"
        data-tour="help-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('tour.help.menuLabel')}
        {...triggerProps}
      >
        ?
      </button>
      {open ? (
        <div className="menu__pop menu__pop--right" role="menu" ref={popRef}>
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
          <div className="menu__divider" role="separator" />
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            data-whatsnew="menu-item"
            onClick={() => {
              setOpen(false)
              onOpenDialog({ kind: 'whatsNew' })
            }}
          >
            <span className="menu__name">
              {t('whatsNew.title')}
              {unread ? (
                <>
                  {' '}
                  <span className="menu__badge">{t('whatsNew.newMarker')}</span>
                </>
              ) : null}
            </span>
          </button>
          <div className="menu__divider" role="separator" />
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
              {t('tour.help.feedback')} <ArrowIcon unit="external-link" className="menu__ext" />
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
