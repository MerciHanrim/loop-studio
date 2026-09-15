import { AboutDialog } from '../AboutDialog'
import { AuthorDialog } from '../AuthorDialog'
import { ConfirmDialog } from '../ConfirmDialog'
import { ContextualHelpDialog } from '../ContextualHelpDialog'
import { DataImportRefreshMenu } from '../dataImport/DataImportRefreshMenu'
import { DataImportWizard } from '../dataImport/DataImportWizard'
import { useT } from '../../i18n'
import { exportProjectRevision } from '../../ui/revisionActions'
import type { ToolbarDialog } from './dialogTypes'

type Props = {
  activeDialog: ToolbarDialog
  onClose: () => void
  returnFocusTo: () => HTMLElement | null | undefined
}

// Toolbar-level host for every MODAL dialog that used to live inside
// ExportMenu / DataImportMenu / HelpMenu (review condition 3) — rendered
// unconditionally at Toolbar.tsx's own stable top level, exactly like
// `confirmNew`'s `ConfirmDialog` already is, so File/Data/Settings/Help/the
// ⋯ overflow menu can close around a dialog without unmounting it. Share's
// flow is deliberately NOT here — see `ShareSurface`/`useShareSurface`,
// since `.share-pop` is a non-modal anchored popover, not a `.mcdlg` modal.
export function DialogHost({ activeDialog, onClose, returnFocusTo }: Props) {
  const t = useT()

  const runProjectRevision = () => {
    onClose()
    const r = exportProjectRevision()
    if (!r.ok) window.alert(r.message)
  }

  return (
    <>
      <ConfirmDialog
        open={activeDialog?.kind === 'export-revision'}
        title={t('export.projectRevision.disclosure.title')}
        body={t('export.projectRevision.disclosure.body')}
        confirmLabel={t('export.projectRevision.disclosure.confirm')}
        onConfirm={runProjectRevision}
        onCancel={onClose}
        returnFocusTo={returnFocusTo}
      />
      <ConfirmDialog
        open={activeDialog?.kind === 'export-workspace'}
        title={t('export.workspace.title')}
        body={activeDialog?.kind === 'export-workspace' ? activeDialog.body : ''}
        confirmLabel={activeDialog?.kind === 'export-workspace' ? activeDialog.confirmLabel : ''}
        onConfirm={() => {
          const desc = activeDialog
          onClose()
          if (desc?.kind === 'export-workspace') desc.run()
        }}
        onCancel={onClose}
        returnFocusTo={returnFocusTo}
      />
      <AuthorDialog
        open={activeDialog?.kind === 'export-author'}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
      />
      <DataImportWizard
        open={activeDialog?.kind === 'dataImport-wizard'}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
      />
      <DataImportRefreshMenu
        open={activeDialog?.kind === 'dataImport-manage'}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
      />
      <AboutDialog
        open={activeDialog?.kind === 'about'}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
      />
      <ContextualHelpDialog
        open={activeDialog?.kind === 'contextualHelp'}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
      />
      <ConfirmDialog
        open={activeDialog?.kind === 'module-promote'}
        title={t('modules.promote.title')}
        body={t('modules.promote.body')}
        confirmLabel={t('modules.promote.confirm')}
        onConfirm={() => {
          const desc = activeDialog
          onClose()
          if (desc?.kind === 'module-promote') desc.run()
        }}
        onCancel={onClose}
        returnFocusTo={returnFocusTo}
      />
      <ConfirmDialog
        open={activeDialog?.kind === 'module-frames'}
        title={t('modules.frames.title')}
        body={activeDialog?.kind === 'module-frames' ? activeDialog.body : ''}
        confirmLabel={t('modules.frames.continue')}
        onConfirm={() => {
          const desc = activeDialog
          onClose()
          if (desc?.kind === 'module-frames') desc.run()
        }}
        onCancel={onClose}
        returnFocusTo={returnFocusTo}
      />
    </>
  )
}
