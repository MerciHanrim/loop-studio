import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import type { ToolbarDialog } from '../toolbar/dialogTypes'
import { useMenuOpenStore } from '../toolbar/menuOpenStore'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('data', menuOpen)
    return () => useMenuOpenStore.getState().setOpen('data', false)
  }, [menuOpen])

  return (
    <div className="menu" ref={wrapRef}>
      <button ref={buttonRef} type="button" className="btn" aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
        {t('import.button')}
      </button>
      {menuOpen && (
        <div className="menu__pop" role="menu">
          <button
            type="button"
            className="menu__item"
            role="menuitem"
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
        </div>
      )}
    </div>
  )
}
