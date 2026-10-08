import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useUiStore } from '../../store/uiStore'
import { useMenuKeyboard, useMenuTrigger } from '../../ui/useMenuKeyboard'
import type { ToolbarDialog } from '../toolbar/dialogTypes'
import { useMenuOpenStore } from '../toolbar/menuOpenStore'
import { useOutsideDismiss } from '../toolbar/useOutsideDismiss'
import { Icon } from '../../ui/icons'

// docs/data-import.md §DI16 Phase 1B/2 — the toolbar trigger. Phase 1B
// shipped this as a single plain button (its own label already ends in "▾",
// foreshadowing this); Phase 2 turns it into an actual small dropdown with a
// second entry, "Manage bindings…", so the SAME one toolbar button gains
// refresh access without touching the toolbar's measured-fit width system
// (the exact regression Phase 1B's own round-1 review found and fixed).
//
// Review condition 3: the wizard and the refresh/manage dialog no longer
// live here — they're lifted to `Toolbar.tsx`'s `DialogHost` (a stable
// ancestor) so this menu's own popover (and the ⋯ overflow menu, when
// collapsed) can close without unmounting a dialog it just opened.

export function DataImportMenu({
  buttonRef,
  onOpenDialog,
}: {
  buttonRef?: (el: HTMLButtonElement | null) => void
  onOpenDialog: (desc: ToolbarDialog) => void
}) {
  const t = useT()
  // #334 — both wizard entries end in adding Parameters to the document, so
  // they wait for the edit lock to be lifted; Manage bindings stays (its own
  // refresh and rename are disabled inside, its exports are not)
  const editLocked = useUiStore((s) => s.canvasLocked)
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useOutsideDismiss(menuOpen, wrapRef, () => setMenuOpen(false))

  // the menu keyboard contract (issue #307): the shared hook owns Escape now,
  // with the focus return this menu's own listener never did
  const close = useCallback(() => setMenuOpen(false), [])
  const { entry, triggerProps } = useMenuTrigger(menuOpen, setMenuOpen)
  useMenuKeyboard(menuOpen, popRef, btnRef, close, entry)

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('data', menuOpen)
    return () => useMenuOpenStore.getState().setOpen('data', false)
  }, [menuOpen])

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={(el) => {
          btnRef.current = el
          buttonRef?.(el)
        }}
        type="button"
        className="btn"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        {...triggerProps}
      >
        {t('import.button')}
        <Icon name="chevron-down" className="icon--caret" />
      </button>
      {menuOpen && (
        <div className="menu__pop" role="menu" ref={popRef}>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            disabled={editLocked}
            onClick={() => {
              setMenuOpen(false)
              onOpenDialog({ kind: 'dataImport-wizard' })
            }}
          >
            <span className="menu__name">{t('import.menu.import')}</span>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              onOpenDialog({ kind: 'dataImport-manage' })
            }}
          >
            <span className="menu__name">{t('import.menu.manage')}</span>
          </button>
          {/* docs/data-import.md §DI17 — the in-app guide entry: the same
              wizard, with its quick-start block forced open. */}
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            disabled={editLocked}
            onClick={() => {
              setMenuOpen(false)
              onOpenDialog({ kind: 'dataImport-wizard', quickStart: true })
            }}
          >
            <span className="menu__name">{t('import.menu.guide')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
