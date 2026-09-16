import { useAutosaveStore } from '../store/autosaveStore'
import { useGraphStore } from '../store/graphStore'
import { recommendedRunConfigForExport } from '../store/mcStore'
import { downloadText } from '../ui/download'
import { useT } from '../i18n'

// Audit ①-4 — a PERSISTENT banner while the autosave write is failing (the
// browser's storage quota is exhausted, or storage is blocked). It has no
// Dismiss on purpose: as long as edits are not being saved on this device the
// user must keep seeing it; it disappears by itself the moment a write
// succeeds again. The one action it offers is the way out — a file export.
// Same visual surface as BootNotice / LocaleLoadNotice.

export function AutosaveNotice() {
  const t = useT()
  const failed = useAutosaveStore((s) => s.failed)
  const reason = useAutosaveStore((s) => s.reason)
  const exportJSON = useGraphStore((s) => s.exportJSON)
  if (!failed) return null
  return (
    <div className="boot-notice boot-notice--autosave" role="alert" data-reason={reason ?? undefined}>
      <span className="boot-notice__text">
        {t(reason === 'quota' ? 'autosave.failed.quota' : 'autosave.failed.unavailable')}
      </span>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => downloadText(exportJSON(recommendedRunConfigForExport()), 'loop-studio-graph.json')}
      >
        {t('autosave.exportButton')}
      </button>
    </div>
  )
}
