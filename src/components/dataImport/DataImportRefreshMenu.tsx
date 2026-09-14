import { useId, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { buildChangeProposalCsv } from '../../model/dataImportExportCsv'
import { useDataImportStore } from '../../store/dataImportStore'
import { useGraphStore } from '../../store/graphStore'
import { useDialogFocus } from '../useDialogFocus'
import { DataImportRefreshWizard } from './DataImportRefreshWizard'

// docs/data-import.md §DI16 Phase 2 -- "Manage bindings…": lists every
// already-bound table with a rename field and a Refresh trigger, plus the
// change-proposal CSV export (§DI12.2) over ALL bound tables at once.

function downloadCsv(text: string, name: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function DataImportRefreshMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const tables = useDataImportStore((s) => s.tables)
  const hostNodes = useGraphStore((s) => s.nodes)
  const renameDataImportTable = useGraphStore((s) => s.renameDataImportTable)

  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({})
  const [renameError, setRenameError] = useState<Record<string, 'empty-table-name' | 'label-too-long'>>({})
  const [csvBlocked, setCsvBlocked] = useState(false)

  // Only ONE modal is ever active at a time: while the refresh wizard is
  // open, THIS dialog's own focus trap / Escape handler must detach --
  // otherwise both dialogs' independent `window` keydown listeners fire on
  // a single Escape (closing both at once), and the accessibility tree
  // carries two simultaneous `aria-modal="true"` elements. Passing
  // `refreshingId === null` here (rather than the raw `open` prop) ties
  // this hook's own lifecycle to whether THIS dialog is actually the
  // top-most one.
  useDialogFocus(open && refreshingId === null, ref, onClose)

  if (!open) return null

  if (refreshingId) {
    // the manage dialog's own markup is unmounted entirely while the
    // wizard is open (not just visually hidden) -- so only the wizard's
    // `role="dialog"`/`aria-modal` exists in the tree, and closing it
    // (`onClose` below) returns here, remounting the manage dialog and its
    // own focus trap fresh.
    return <DataImportRefreshWizard sourceTableId={refreshingId} onClose={() => setRefreshingId(null)} />
  }

  const commitRename = (id: string, current: string) => {
    const draft = renameDrafts[id]
    if (draft === undefined || draft === current) return
    const r = renameDataImportTable(id, draft)
    if (!r.ok) {
      setRenameError((prev) => ({ ...prev, [id]: r.reason }))
      return
    }
    setRenameError((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setRenameDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const exportCsv = () => {
    const r = buildChangeProposalCsv(tables, hostNodes)
    if (!r.ok) {
      setCsvBlocked(true)
      return
    }
    setCsvBlocked(false)
    downloadCsv(r.csv, 'loop-studio-change-proposal.csv')
  }

  return (
    <div className="mcdlg__scrim" onMouseDown={onClose}>
      <div ref={ref} className="mcdlg mcdlg--dataimport" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mcdlg__head">
          <span id={titleId}>{t('import.refresh.manageTitle')}</span>
        </div>
        <div className="mcdlg__body">
          {tables.length === 0 ? (
            <p>{t('import.refresh.noBindings')}</p>
          ) : (
            <ul className="import__bindings">
              {tables.map((table) => (
                <li key={table.sourceTableId} className="import__binding">
                  <label>
                    {t('import.refresh.renameLabel')}
                    <input
                      type="text"
                      value={renameDrafts[table.sourceTableId] ?? table.label}
                      onChange={(e) => setRenameDrafts((prev) => ({ ...prev, [table.sourceTableId]: e.target.value }))}
                      onBlur={() => commitRename(table.sourceTableId, table.label)}
                    />
                  </label>
                  {renameError[table.sourceTableId] && (
                    <p className="import__error">
                      {t(renameError[table.sourceTableId] === 'empty-table-name' ? 'import.issue.empty-table-name' : 'import.issue.label-too-long', { max: 200 })}
                    </p>
                  )}
                  <span>{t('import.refresh.rowCount', { n: table.rows.length })}</span>
                  <button type="button" className="btn" onClick={() => setRefreshingId(table.sourceTableId)}>
                    {t('import.refresh.refreshButton')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn" disabled={tables.length === 0} onClick={exportCsv}>
            {t('import.refresh.exportCsv')}
          </button>
          {csvBlocked && <p className="import__error">{t('import.refresh.exportBlockedDuplicate')}</p>}
        </div>
        <div className="mcdlg__foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
