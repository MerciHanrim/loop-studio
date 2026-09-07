import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'

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

export function OverflowMenu({ children, buttonRef, ghost }: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // if every item leaves the menu (viewport widened) close it
  useEffect(() => {
    if (ghost && open) setOpen(false)
  }, [ghost, open])

  return (
    <div className="toolbar__overflow" ref={wrapRef} data-ghost={ghost ? '' : undefined}>
      <button
        ref={(el) => {
          btnRef.current = el
          buttonRef?.(el)
        }}
        type="button"
        className="btn btn--icon toolbar__overflow-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('toolbar.more')}
        title={t('toolbar.more')}
        onClick={() => setOpen((v) => !v)}
        tabIndex={ghost ? -1 : undefined}
      >
        ⋯
      </button>
      {open ? (
        <div className="menu__pop toolbar__overflow-pop" id={menuId} role="menu">
          {children}
        </div>
      ) : null}
    </div>
  )
}
