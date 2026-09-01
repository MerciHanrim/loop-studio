import { useProjectStore } from '../store/projectStore'
import { useT, type MessageKey } from '../i18n'

const NOTICE_KEY: Record<'proposalReboot', MessageKey> = {
  proposalReboot: 'bootNotice.proposalReboot',
}

// A one-time, dismissible banner for a boot-time condition the user should know
// about. Currently the only case is SEMANTICS-R.md §R8's reboot rule: a proposal
// session whose pinned base was not (and per the frozen spec cannot be) saved
// locally, so it reopened as a plain graph. `projectStore` emits a stable code;
// the text is localized here (docs/localization.md Slice 2b).

export function BootNotice() {
  const t = useT()
  const notice = useProjectStore((s) => s.bootNotice)
  const dismiss = useProjectStore((s) => s.dismissBootNotice)
  if (!notice) return null
  return (
    <div className="boot-notice" role="status">
      <span className="boot-notice__text">{t(NOTICE_KEY[notice])}</span>
      <button type="button" className="btn btn--sm" onClick={dismiss}>
        {t('bootNotice.dismiss')}
      </button>
    </div>
  )
}
