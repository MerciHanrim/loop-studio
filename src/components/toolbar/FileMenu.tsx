import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useT } from '../../i18n'
import { AuthorMenuItem, ExportMenuItems } from '../ExportMenu'
import { StructureMenuItems } from '../StructureMenuItems'
import type { Viewport } from '../../store/workspaceIO'
import type { ToolbarDialog } from './dialogTypes'
import { DescribedMenu } from './DescribedMenu'
import { useMenuOpenStore } from './menuOpenStore'
import { useOutsideDismiss } from './useOutsideDismiss'
import { useSubmenuPosition } from './useAnchoredPosition'
import { useMenuKeyboard, useMenuTrigger, type MenuEntry } from '../../ui/useMenuKeyboard'

// docs/workbench.md §WB2.2 — the menu bar's File: New, Import; Templates ▸
// and Export ▸, two submenus; the two structure rows (save a selected
// structure, insert a saved one); then Set the export author… and Storage &
// privacy…. Every row is a name on one line; File and each submenu describe
// the current row in one area at their foot (`DescribedMenu`). A submenu opens
// on a click, or Arrow Right / Enter / Space on its row; Arrow Left or Escape
// closes it alone; Tab closes File. Modeled on `OverflowMenu.tsx`'s
// trigger+popover pattern (outside-click close, Escape close, focus return);
// `New`/`Import` are reused JSX built by `Toolbar.tsx` (their dialog/ancestor-
// close wiring lives there).

type Props = {
  buttonRef?: (el: HTMLButtonElement | null) => void
  newButton: ReactNode
  importButton: ReactNode
  /** the Templates submenu's rows (Templates.tsx `TemplateMenuItems`) and the
   *  Storage and privacy row, moved here from the Templates button and from
   *  Settings (the workbench, 2026-10) */
  templateItems?: ReactNode
  storageButton?: ReactNode
  getViewport: () => Viewport
  onOpenDialog: (desc: ToolbarDialog) => void
  onLeave: () => void
}

export type FileMenuHandle = { close: () => void }

type Sub = 'templates' | 'export'

export const FileMenu = forwardRef<FileMenuHandle, Props>(function FileMenu(
  { buttonRef, newButton, importButton, templateItems, storageButton, getViewport, onOpenDialog, onLeave },
  ref,
) {
  const t = useT()
  const [open, setOpenState] = useState(false)
  const [chosenSub, setSub] = useState<Sub | null>(null)
  const [subEntry, setSubEntry] = useState<MenuEntry>(null)
  // the open submenu: only while File is open. Opening File starts with none
  // (reset where File opens, not synchronised after it closes).
  const sub = open ? chosenSub : null
  const setOpen = useCallback((v: boolean) => {
    if (v) setSub(null)
    setOpenState(v)
  }, [])
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const subMenuRef = useRef<HTMLDivElement>(null)
  const subPanelRef = useRef<HTMLDivElement>(null)
  const templatesRow = useRef<HTMLButtonElement>(null)
  const exportRow = useRef<HTMLButtonElement>(null)
  /** the open submenu's row: where its Escape / Arrow Left return focus */
  const subRow = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()
  const subId = useId()

  useOutsideDismiss(open, wrapRef, () => setOpen(false))

  const openSub = useCallback((s: Sub, at: MenuEntry) => {
    subRow.current = s === 'templates' ? templatesRow.current : exportRow.current
    setSubEntry(at)
    setSub(s)
  }, [])
  const closeSub = useCallback(() => {
    setSub(null)
    subRow.current?.focus()
  }, [])

  // arrow / Home / End / Escape. The hook owns Escape now -- this menu used
  // to close and return focus from its own `window` listener, which would run
  // a second time behind the hook. With a submenu open, the submenu's own
  // keyboard (below) takes the keys while focus is in it, and File's Escape
  // closes the submenu first.
  const close = useCallback(() => setOpen(false), [setOpen])
  const { entry, triggerProps } = useMenuTrigger(open, setOpen)
  useMenuKeyboard(open, popRef, btnRef, close, entry, {
    yieldWhile: () => !!subMenuRef.current?.contains(document.activeElement),
    beforeEscape: () => {
      if (!subMenuRef.current) return false
      closeSub()
      return true
    },
  })
  useMenuKeyboard(sub != null, subMenuRef, subRow, () => setSub(null), subEntry, {
    onTab: () => {
      flushSync(() => setOpen(false))
      btnRef.current?.focus()
    },
    returnFocusTo: btnRef,
  })
  // Arrow Right on a submenu's row opens it at its first row; Arrow Left in a
  // submenu closes it (captured on `window`, as the hook's keys are, so the
  // canvas never sees them)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const at = document.activeElement
      if (e.key === 'ArrowRight') {
        const s: Sub | null = at === templatesRow.current ? 'templates' : at === exportRow.current ? 'export' : null
        if (!s) return
        e.preventDefault()
        e.stopPropagation()
        openSub(s, 'first')
      } else if (e.key === 'ArrowLeft') {
        if (!subMenuRef.current?.contains(at)) return
        e.preventDefault()
        e.stopPropagation()
        closeSub()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, openSub, closeSub])

  const subPos = useSubmenuPosition(subRow, panelRef, subPanelRef, sub)

  useImperativeHandle(ref, () => ({ close: () => setOpen(false) }), [setOpen])

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('file', open)
    return () => useMenuOpenStore.getState().setOpen('file', false)
  }, [open])

  const subRowButton = (s: Sub, label: string) => (
    <button
      ref={s === 'templates' ? templatesRow : exportRow}
      type="button"
      className="menu__item dmenu__parent"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={sub === s}
      aria-controls={sub === s ? subId : undefined}
      data-submenu={s}
      onClick={(e) => (sub === s ? setSub(null) : openSub(s, e.detail === 0 ? 'first' : null))}
    >
      <span className="menu__name">{label}</span>
      <span className="dmenu__chev" aria-hidden="true">
        ›
      </span>
    </button>
  )

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
        <DescribedMenu
          className="menu__pop--wide toolbar__filemenu-pop"
          menuRef={popRef}
          panelRef={panelRef}
          id={menuId}
          label={t('toolbar.file.menuLabel')}
          // focus moving to another of File's rows closes an open submenu
          onRowFocus={(row) => {
            if (sub && row !== subRow.current) setSub(null)
          }}
        >
          {newButton}
          {importButton}
          <div className="menu__divider" role="separator" />
          {templateItems ? subRowButton('templates', t('workbench.menu.templates')) : null}
          {subRowButton('export', t('workbench.file.export'))}
          {/* 2026-10 — what remains of "Insert module ▾": save a selected
              structure, insert a saved one into THIS document (Import, above,
              opens a whole document instead) */}
          <StructureMenuItems onOpenDialog={onOpenDialog} onLeave={onLeave} />
          <div className="menu__divider" role="separator" />
          <AuthorMenuItem onOpenDialog={onOpenDialog} />
          {storageButton}
        </DescribedMenu>
      ) : null}
      {open && sub ? (
        <DescribedMenu
          // one instance per submenu: switching Templates ⇄ Export starts its
          // selection and description state afresh, whether or not the browser
          // gave the parent row focus on the way
          key={sub}
          className="menu__pop--wide dmenu--sub"
          menuRef={subMenuRef}
          panelRef={subPanelRef}
          id={subId}
          label={sub === 'templates' ? t('workbench.menu.templates') : t('workbench.file.export')}
          style={
            subPos
              ? { position: 'fixed', top: subPos.top, left: subPos.left, right: 'auto', visibility: 'visible' }
              : { position: 'fixed', top: 0, left: 0, right: 'auto', visibility: 'hidden' }
          }
        >
          {sub === 'templates' ? templateItems : <ExportMenuItems getViewport={getViewport} onOpenDialog={onOpenDialog} onLeave={onLeave} />}
        </DescribedMenu>
      ) : null}
    </div>
  )
})
