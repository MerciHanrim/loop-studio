import { useMcStore } from '../store/mcStore'
import { decideUpdate, selectUpdateReady, usePwaStore } from '../store/pwaStore'
import { useSimStore } from '../store/simStore'

// docs/pwa.md §P4.2 — shown ONLY while a service worker is actually waiting and
// the user hasn't dismissed it for this deploy. Applying an update reloads the
// page, which resets the live run and drops an unexported Monte-Carlo result —
// the bar says so. A run in progress asks once more.

export function PwaUpdateBar() {
  const show = usePwaStore(selectUpdateReady)
  const apply = usePwaStore((s) => s.apply)
  const dismiss = usePwaStore((s) => s.dismiss)

  if (!show) return null

  const onUpdate = () => {
    const running =
      useSimStore.getState().status === 'running' || useMcStore.getState().status === 'running'
    if (
      decideUpdate(running, () =>
        window.confirm('A run is in progress. Apply the update and reload anyway?'),
      )
    ) {
      apply() // register-sw messages the waiting worker + reloads once on controllerchange
    }
  }

  return (
    <div className="pwa-update" role="status">
      <span className="pwa-update__text">
        A new version of Loop Studio is ready. Applying it reloads the app and{' '}
        <strong>resets the current run and any unsaved results</strong>. Your diagram is saved.
      </span>
      <span className="pwa-update__actions">
        <button type="button" className="btn btn--sm" onClick={onUpdate}>
          Update
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  )
}
