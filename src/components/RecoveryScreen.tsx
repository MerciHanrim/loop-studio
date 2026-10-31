import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '../i18n'
import type { StoredRecordRead } from '../model/serialize'
import { downloadText } from '../ui/download'
import { ConfirmDialog } from './ConfirmDialog'

// #420 item (3) — the recovery screen: drawn by the boot module (`src/main.tsx`)
// INSTEAD of the app when the personal session's saved diagram cannot be read,
// or when storage cannot be read at all. Like the storage gate it imports no
// store, so while it is on screen nothing exists that could write: no autosave,
// no New / Template / import, no share link (the address keeps it). The record
// is also held at the storage port (`storageSession.holdWork`), so a write that
// somehow ran would be refused and reported, not silently done.
//
// Choices (Lumi, 2026-10-31):
//  - Download the saved diagram — the exact stored text; never deletes;
//  - Try again — reads the record again in place; readable ⇒ the app starts
//    with it, still unreadable ⇒ the screen stays and says so;
//  - Continue in a temporary session — the app starts in memory; the saved
//    diagram stays as it is (switching back to personal reads it again first);
//  - Discard the saved diagram — only after its own confirmation;
//  - for a diagram a newer version wrote: Reopen the app (a reload may bring
//    that version).
// Storage that cannot be read at all gets Try again and the temporary session
// only: there is nothing to download or discard.

export type RecoveryOutcome = 'start' | 'temporary'

type Props = {
  /** what boot read: an unreadable record, or a read the browser refused */
  initial: Extract<StoredRecordRead, { kind: 'unreadable' | 'read-failed' }>
  /** read the record again (the boot module's reader) */
  reread: () => StoredRecordRead
  /** remove the held record; throws what the browser throws */
  discard: () => void
  onDone: (outcome: RecoveryOutcome) => void
}

/** a file name with the local date and time, so two downloads never collide */
function downloadName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `loop-studio-saved-diagram-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`
}

export function RecoveryScreen({ initial, reread, discard, onDone }: Props) {
  const t = useT()
  const [read, setRead] = useState(initial)
  const [stillUnreadable, setStillUnreadable] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [discardFailed, setDiscardFailed] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const leadId = useId()

  // focus on the heading, as on the storage gate: the explanation is read
  // first and no choice is favoured
  useEffect(() => {
    headingRef.current?.focus({ focusVisible: false })
  }, [read.kind])

  const tryAgain = () => {
    const r = reread()
    if (r.kind === 'ok' || r.kind === 'none') {
      onDone('start')
      return
    }
    setRead(r)
    setStillUnreadable(true)
  }

  const doDiscard = () => {
    setConfirmDiscard(false)
    try {
      discard()
    } catch {
      setDiscardFailed(true)
      return
    }
    onDone('start')
  }

  const unreadable = read.kind === 'unreadable' ? read : null

  return (
    <main className="gate recovery" data-recovery={unreadable ? 'unreadable' : 'storage-error'}>
      <section className="gate__card" aria-labelledby={titleId} aria-describedby={leadId}>
        <h1 id={titleId} className="gate__title" ref={headingRef} tabIndex={-1}>
          {t(unreadable ? 'recovery.title' : 'recovery.storageError.title')}
        </h1>
        <p id={leadId} className="gate__lead">
          {t(unreadable ? 'recovery.body' : 'recovery.storageError.body')}
        </p>
        {unreadable?.newer ? <p className="gate__note" data-recovery-note="newer">{t('recovery.newer')}</p> : null}
        {stillUnreadable ? (
          <p className="gate__note" role="status" data-recovery-note="still">
            {t('recovery.stillUnreadable')}
          </p>
        ) : null}
        {discardFailed ? (
          <p className="gate__note" role="alert" data-recovery-note="discard-failed">
            {t('recovery.discard.failed')}
          </p>
        ) : null}

        <div className="recovery__actions">
          {unreadable ? (
            <button type="button" className="btn gate__btn" onClick={() => downloadText(unreadable.text, downloadName())}>
              {t('recovery.download')}
            </button>
          ) : null}
          <button type="button" className="btn gate__btn" onClick={tryAgain}>
            {t('recovery.retry')}
          </button>
          {unreadable?.newer ? (
            <button type="button" className="btn gate__btn" onClick={() => location.reload()}>
              {t('recovery.reopen')}
            </button>
          ) : null}
          <button type="button" className="btn gate__btn" onClick={() => onDone('temporary')}>
            {t('recovery.temporary')}
          </button>
          {unreadable ? (
            <button type="button" className="btn gate__btn" onClick={() => setConfirmDiscard(true)}>
              {t('recovery.discard')}
            </button>
          ) : null}
        </div>
        <p className="gate__sub">{t('recovery.temporary.sub')}</p>
      </section>
      <ConfirmDialog
        open={confirmDiscard}
        title={t('recovery.discard.title')}
        body={t('recovery.discard.body')}
        confirmLabel={t('recovery.discard.confirm')}
        onConfirm={doDiscard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </main>
  )
}
