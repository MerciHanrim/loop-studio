import { useProjectStore } from '../store/projectStore'

// A one-time, dismissible banner for a boot-time condition the user should know
// about. Currently the only case is SEMANTICS-R.md §R8's reboot rule: a proposal
// session whose pinned base was not (and per the frozen spec cannot be) saved
// locally, so it reopened as a plain graph.

export function BootNotice() {
  const notice = useProjectStore((s) => s.bootNotice)
  const dismiss = useProjectStore((s) => s.dismissBootNotice)
  if (!notice) return null
  return (
    <div className="boot-notice" role="status">
      <span className="boot-notice__text">{notice}</span>
      <button type="button" className="btn btn--sm" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  )
}
