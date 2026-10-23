import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { ExportMenuItems } from '../ExportMenu'
import { StructureMenuItems } from '../StructureMenuItems'
import type { Viewport } from '../../store/workspaceIO'
import type { ToolbarDialog } from './dialogTypes'
import { useMenuOpenStore } from './menuOpenStore'
import { useOutsideDismiss } from './useOutsideDismiss'
import { useMenuKeyboard, useMenuTrigger } from '../../ui/useMenuKeyboard'

// docs/toolbar-responsive.md — the `File ▾` Tier-1 group: New, Import, then
// Export's 5 actions flattened directly into this SAME popover (a divider
// separates them from New/Import) — Hanrim's visual review (2026-09-15)
// found a nested `Export ▾` sub-trigger read as a small pill button
// awkwardly inserted into the popover, not a proper menu row. Modeled on
// `OverflowMenu.tsx`'s trigger+popover pattern (outside-click close, Escape
// close, focus return); `New`/`Import` are reused JSX built by
// `Toolbar.tsx` (their dialog/ancestor-close wiring lives there). The last
// group (2026-10) saves a selected structure and inserts a saved one
// (`StructureMenuItems`).

type Props = {
  buttonRef?: (el: HTMLButtonElement | null) => void
  newButton: ReactNode
  importButton: ReactNode
  /** the workbench (2026-10): the Templates section (Templates.tsx
   *  `TemplateMenuItems`) and the Storage and privacy row, moved here from the
   *  Templates button and from Settings */
  templateItems?: ReactNode
  storageButton?: ReactNode
  getViewport: () => Viewport
  onOpenDialog: (desc: ToolbarDialog) => void
  onLeave: () => void
}

export type FileMenuHandle = { close: () => void }

export const FileMenu = forwardRef<FileMenuHandle, Props>(function FileMenu(
  { buttonRef, newButton, importButton, templateItems, storageButton, getViewport, onOpenDialog, onLeave },
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
  const { entry, triggerProps } = useMenuTrigger(open, setOpen)
  useMenuKeyboard(open, popRef, btnRef, close, entry)

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
        className="wb-mb"
        aria-haspopup="true"
        aria-expanded={open}
        // only while the menu exists (issue #307): an id that names nothing
        // while closed stopped Narrator reading "expanded" once it opened
        aria-controls={open ? menuId : undefined}
        {...triggerProps}
      >
        {t('toolbar.file.button')}
      </button>
      {open ? (
        <div
          // wide, as the Templates menu it took in was (2026-10-20): its
          // descriptions read in two lines at 300 px, not at 260
          className="menu__pop menu__pop--scrollable menu__pop--wide toolbar__filemenu-pop"
          id={menuId}
          ref={popRef}
          role="menu"
          aria-label={t('toolbar.file.menuLabel')}
        >
          {newButton}
          {importButton}
          {templateItems ? (
            <>
              <div className="menu__divider" role="separator" />
              {templateItems}
            </>
          ) : null}
          <ExportMenuItems getViewport={getViewport} onOpenDialog={onOpenDialog} onLeave={onLeave} />
          {/* 2026-10 — what remains of "Insert module ▾": save a selected
              structure, insert a saved one into THIS document (Import, above,
              opens a whole document instead) */}
          <StructureMenuItems onOpenDialog={onOpenDialog} onLeave={onLeave} />
          {storageButton ? (
            <>
              <div className="menu__divider" role="separator" />
              {storageButton}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
