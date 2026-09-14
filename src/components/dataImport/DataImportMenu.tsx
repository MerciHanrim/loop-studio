import { useState } from 'react'
import { useT } from '../../i18n'
import { DataImportWizard } from './DataImportWizard'

// docs/data-import.md §DI16 Phase 1B — the toolbar trigger. A NEW, separate
// standing control (own state, own file) — deliberately not folded into the
// existing Import button (which imports Graph/Workspace JSON), so that
// button's existing behaviour and e2e coverage are untouched.

export function DataImportMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {t('import.button')}
      </button>
      <DataImportWizard open={open} onClose={() => setOpen(false)} />
    </>
  )
}
