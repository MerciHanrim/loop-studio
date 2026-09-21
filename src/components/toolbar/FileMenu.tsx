import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { ExportMenuItems } from '../ExportMenu'
import type { Viewport } from '../../store/workspaceIO'
import type { ToolbarDialog } from './dialogTypes'
import { useMenuOpenStore } from './menuOpenStore'
import { useOutsideDismiss } from './useOutsideDismiss'
import { useMenuKeyboard } from '../../ui/useMenuKeyboard'

// docs/toolbar-responsive.md — the `File ▾` Tier-1 group: New, Import, then
// Export's 5 actions flattened directly into this SAME popover (a divider
// separates them from New/Import) — Hanrim's visual review (2026-09-15)
// found a nested `Export ▾` sub-trigger read as a small pill button
// awkwardly inserted into the popover, not a proper menu row. Modeled on
// `OverflowMenu.tsx`'s trigger+popover pattern (outside-click close, Escape
// close, focus return); `New`/`Import` are reused JSX built by
// `Toolbar.tsx` (their dialog/ancestor-close wiring lives there).

type Props = {
  buttonRef?: (el: HTMLButtonElement | null) => void
  newButton: ReactNode
  importButton: ReactNode
  getViewport: () => Viewport
  onOpenDialog: (desc: ToolbarDialog) => void
  onLeave: () => void
}

export type FileMenuHandle = { close: () => void }

export const FileMenu = forwardRef<FileMenuHandle, Props>(function FileMenu(
  { buttonRef, newButton, importButton, getViewport, onOpenDialog, onLeave },
  ref,
) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useOutsideDismiss(open, wrapRef, () => setOpen(false))

  // arrow / Home / End / Escape. The hook owns Escape now -- this menu used
  // to close and return focus from its own `window` listener, which would run
  // a second time behind the hook.
  const close = useCallback(() => setOpen(false), [])
  useMenuKeyboard(open, popRef, btnRef, close)

  useImperativeHandle(ref, () => ({ close: () => setOpen(false) }), [])

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('file', open)
    return () => useMenuOpenStore.getState().setOpen('file', false)
  }, [open])

  return (
    <div className="menu toolbar__filemenu" ref={wrapRef}>
      <button
        ref={(el) => {
          btnRef.current = el
          buttonRef?.(el)
        }}
        type="button"
        className="btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {t('toolbar.file.button')}
      </button>
      {open ? (
        <div
          className="menu__pop menu__pop--scrollable toolbar__filemenu-pop"
          id={menuId}
          ref={popRef}
          role="menu"
          aria-label={t('toolbar.file.menuLabel')}
        >
          {newButton}
          {importButton}
          <ExportMenuItems getViewport={getViewport} onOpenDialog={onOpenDialog} onLeave={onLeave} />
        </div>
      ) : null}
    </div>
  )
})
