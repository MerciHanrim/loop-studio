import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useT } from '../../i18n'
import { useMenuOpenStore } from './menuOpenStore'
import { useOutsideDismiss } from './useOutsideDismiss'
import { useReturnFocusAfterKeyboardChoice } from '../../ui/useMenuKeyboard'
import { Icon } from '../../ui/icons'

// The toolbar "⋯" overflow menu. It holds whichever trailing controls the
// measured layout could not fit on the toolbar (see `useToolbarOverflow`). The
// controls are rendered verbatim inside the popup — Export / Help / Language
// keep their own nested dropdowns — so behaviour, keyboard access and ARIA are
// unchanged; only their location moves. Matches the outside-click / Escape /
// focus-return contract of the other toolbar menus.

type Props = {
  /** the collapsed controls, in display order */
  children: ReactNode
  /** ref setter for the trigger button (width measurement) */
  buttonRef?: (el: HTMLButtonElement | null) => void
  /** keep the trigger measurable but out of layout flow (nothing collapsed yet) */
  ghost?: boolean
}

export type OverflowMenuHandle = {
  /** close the popover without touching focus — used by `closeAncestors`
   *  (Toolbar.tsx) so a wrapped trigger's lifted dialog never has this menu
   *  left open behind it. A no-op if already closed. */
  close: () => void
}

export const OverflowMenu = forwardRef<OverflowMenuHandle, Props>(function OverflowMenu(
  { children, buttonRef, ghost },
  ref,
) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useOutsideDismiss(open, wrapRef, () => setOpen(false))
  // issue #307 - a choice made from the keyboard inside a group that lives
  // here (an item of Help, say) closes this popup with its own trigger; focus
  // then comes back to this button rather than being lost
  useReturnFocusAfterKeyboardChoice(open, popRef, btnRef)

  useEffect(() => {
    if (!open) return
    // Capture phase — runs BEFORE any nested control's own (bubble-phase) Escape
    // handler. If a nested dropdown (Export / Help / Language) is still open, let
    // this Escape fall through to close just that one; the ⋯ menu takes the next
    // Escape. React 18 flushes discrete events synchronously, so a bubble-phase
    // check here would always see the nested menu already gone.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (
        wrapRef.current?.querySelector(
          '.toolbar__overflow-pop [aria-expanded="true"], .toolbar__overflow-pop .menu__pop:not(.toolbar__overflow-pop)',
        )
      )
        return
      setOpen(false)
      btnRef.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // if every item leaves the menu (viewport widened) close it
  useEffect(() => {
    if (ghost && open) setOpen(false)
  }, [ghost, open])

  useImperativeHandle(ref, () => ({ close: () => setOpen(false) }), [])

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu (or whatever's nested
  // inside it) is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('overflow', open)
    return () => useMenuOpenStore.getState().setOpen('overflow', false)
  }, [open])

  return (
    <div className="toolbar__overflow" ref={wrapRef} data-ghost={ghost ? '' : undefined}>
      <button
        ref={(el) => {
          btnRef.current = el
          buttonRef?.(el)
        }}
        type="button"
        className="btn btn--icon toolbar__overflow-btn"
        // issue #307 - a disclosure, not a menu: it holds the toolbar groups
        // that did not fit (buttons that open their own menus), reached with
        // Tab; opening leaves focus on this button
        aria-expanded={open}
        // only while the panel exists: an id that names nothing, while closed,
        // stopped Narrator reading "expanded" once it opened (issue #307)
        aria-controls={open ? menuId : undefined}
        aria-label={t('toolbar.more')}
        title={t('toolbar.more')}
        onClick={() => setOpen((v) => !v)}
        tabIndex={ghost ? -1 : undefined}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div className="menu__pop toolbar__overflow-pop" id={menuId} ref={popRef} role="group" aria-label={t('toolbar.more')}>
          {children}
        </div>
      ) : null}
    </div>
  )
})
