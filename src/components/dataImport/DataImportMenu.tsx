import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { DataImportRefreshMenu } from './DataImportRefreshMenu'
import { DataImportWizard } from './DataImportWizard'

// docs/data-import.md §DI16 Phase 1B/2 — the toolbar trigger. Phase 1B
// shipped this as a single plain button (its own label already ends in "▾",
// foreshadowing this); Phase 2 turns it into an actual small dropdown with a
// second entry, "Manage bindings…", so the SAME one toolbar button gains
// refresh access without touching the toolbar's measured-fit width system
// (the exact regression Phase 1B's own round-1 review found and fixed).

export function DataImportMenu() {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
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

  return (
    <div className="menu" ref={wrapRef}>
      <button type="button" className="btn" aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
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
              setWizardOpen(true)
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
              setManageOpen(true)
            }}
          >
            <span className="menu__name">{t('import.menu.manage')}</span>
          </button>
        </div>
      )}
      <DataImportWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <DataImportRefreshMenu open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  )
}
