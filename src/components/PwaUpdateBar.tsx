import { useRef, useState } from 'react'
import { useMcStore } from '../store/mcStore'
import { selectUpdateReady, usePwaStore } from '../store/pwaStore'
import { sessionHasWork } from '../store/sessionActions'
import { selectTemporary, useSessionStore } from '../store/sessionStore'
import { useSimStore } from '../store/simStore'
import { useT } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'

// docs/pwa.md §P4.2 — shown ONLY while a service worker is actually waiting and
// the user hasn't dismissed it for this deploy. Applying an update reloads the
// page, which resets the live run and drops an unexported Monte-Carlo result —
// the bar says so. A run in progress asks once more, now via the in-app
// ConfirmDialog (docs/localization.md Slice 2b): `apply()` runs only from the
// Confirm click; Cancel / Escape / backdrop keep the run and never reload.
//
// Issue #297 — in a temporary session the reload also loses the diagram, which
// is saved nowhere. Such a session with work asks first, and says to export;
// a run in progress is asked about after that, as before.

export function PwaUpdateBar() {
  const t = useT()
  const show = usePwaStore(selectUpdateReady)
  const apply = usePwaStore((s) => s.apply)
  const dismiss = usePwaStore((s) => s.dismiss)
  const temporary = useSessionStore(selectTemporary)
  const [confirmRunning, setConfirmRunning] = useState(false)
  const [confirmTemporary, setConfirmTemporary] = useState(false)
  const updateBtnRef = useRef<HTMLButtonElement>(null)

  if (!show && !confirmRunning && !confirmTemporary) return null

  const proceed = () => {
    const running =
      useSimStore.getState().status === 'running' || useMcStore.getState().status === 'running'
    if (!running) {
      apply() // register-sw messages the waiting worker + reloads once
      return
    }
    setConfirmRunning(true)
  }

  const onUpdate = () => {
    if (temporary && sessionHasWork()) {
      setConfirmTemporary(true)
      return
    }
    proceed()
  }

  return (
    <>
      {show ? (
        <div className="pwa-update" role="status">
          <span className="pwa-update__text">{t('pwa.text')}</span>
          <span className="pwa-update__actions">
            <button ref={updateBtnRef} type="button" className="btn btn--sm" onClick={onUpdate}>
              {t('pwa.update')}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={dismiss}>
              {t('pwa.dismiss')}
            </button>
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmTemporary}
        title={t('session.temporary.updateTitle')}
        body={t('session.temporary.updateBody')}
        confirmLabel={t('session.temporary.updateConfirm')}
        onConfirm={() => {
          setConfirmTemporary(false)
          proceed()
        }}
        onCancel={() => setConfirmTemporary(false)}
        returnFocusTo={() => updateBtnRef.current}
      />

      <ConfirmDialog
        open={confirmRunning}
        title={t('pwa.running.title')}
        body={t('pwa.running.body')}
        confirmLabel={t('pwa.running.confirm')}
        onConfirm={() => {
          setConfirmRunning(false)
          apply()
        }}
        onCancel={() => setConfirmRunning(false)}
        returnFocusTo={() => updateBtnRef.current}
      />
    </>
  )
}
