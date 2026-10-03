import { useId, useRef, useState } from 'react'
import { useT } from '../i18n'
import {
  deleteWorkData,
  exportableDocument,
  resetAllData,
  switchToPersonal,
  switchToTemporary,
} from '../store/sessionActions'
import { useSessionStore } from '../store/sessionStore'
import { downloadText } from '../ui/download'
import { Icon } from '../ui/icons'
import { DialogScrim } from './DialogScrim'
import { useDialogFocus } from './useDialogFocus'

// Issue #297 — the `Storage and privacy` area: what this browser profile keeps,
// which kind of session is running, whether the gate is skipped next time, the
// way into the other kind of session, and the two deletions.
//
// One dialog with steps. The first step is the area itself; each action opens
// a step that explains what it covers, offers the export, and asks for the
// confirmation - nothing happens before the Confirm button (docs/localization.md
// Slice 2b). Escape on a step goes back to the area; Escape on the area closes.
//
// Two deletions, deliberately apart:
//   Delete work data          the document record only
//   Reset all Loop Studio data  every key the app stores, then a restart into the gate
//
// The "Restore automatically" box is the gate's "trust this personal browser"
// choice, seen from inside the app: the same stored key, the same meaning, and
// in the portable file the same answer - there is no such box.
//
// The dialog's own state (which step, the notice) lives in the inner component,
// which is mounted only while the dialog is open: each opening starts fresh at
// the step the opener asked for, with no effect needed to reset anything.

export type StorageStep = 'menu' | 'toTemporary' | 'copy' | 'toPersonal' | 'deleteWork' | 'resetAll'

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
  /** open on a confirmation step straight away (the temporary-session chip's "Save in this browser…") */
  initialStep?: StorageStep
}

const FILE_NAME = 'loop-studio-graph.json'

export function StoragePrivacyDialog({ open, onClose, returnFocusTo, initialStep = 'menu' }: Props) {
  if (!open) return null
  return <StorageArea onClose={onClose} returnFocusTo={returnFocusTo} initialStep={initialStep} />
}

function StorageArea({ onClose, returnFocusTo, initialStep }: Required<Pick<Props, 'onClose' | 'initialStep'>> & Pick<Props, 'returnFocusTo'>) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const mode = useSessionStore((s) => s.mode)
  const remembered = useSessionStore((s) => s.remembered)
  const build = useSessionStore((s) => s.build)
  const setRemembered = useSessionStore((s) => s.setRemembered)
  const [step, setStep] = useState<StorageStep>(initialStep)
  /** what the last deletion did: `done` shows on the area, `failed` on the step it failed on */
  const [notice, setNotice] = useState<{ kind: 'done' | 'failed'; text: string } | null>(null)

  const back = () => {
    setStep('menu')
    setNotice((n) => (n?.kind === 'failed' ? null : n))
  }
  useDialogFocus(true, ref, step === 'menu' ? onClose : back, returnFocusTo)

  const temporary = mode === 'temporary'
  const portable = build === 'portable'
  const exportNow = () => downloadText(exportableDocument(), FILE_NAME)

  const steps: Record<Exclude<StorageStep, 'menu'>, { title: string; body: string; confirm: string; run: () => void }> = {
    toTemporary: {
      title: t('storage.switch.toTemporaryTitle'),
      body: t('storage.switch.toTemporaryBody'),
      confirm: t('storage.switch.toTemporaryConfirm'),
      run: () => {
        switchToTemporary(false)
        onClose()
      },
    },
    copy: {
      title: t('storage.switch.copyTitle'),
      body: t('storage.switch.copyBody'),
      confirm: t('storage.switch.copyConfirm'),
      run: () => {
        switchToTemporary(true)
        onClose()
      },
    },
    toPersonal: {
      title: t('storage.switch.toPersonalTitle'),
      body: t('storage.switch.toPersonalBody'),
      confirm: t('storage.switch.toPersonalConfirm'),
      run: () => {
        switchToPersonal()
        onClose()
      },
    },
    deleteWork: {
      title: t('storage.delete.workTitle'),
      body: temporary
        ? `${t('storage.delete.workBody')} ${t('storage.delete.workKeepsTemporary')}`
        : `${t('storage.delete.workBody')} ${t('storage.delete.workCanvas')}`,
      confirm: t('storage.delete.workConfirm'),
      run: () => {
        // a deletion that failed is never reported as done: the step stays, says
        // so, and says the record may still be there (Lumi, 2026-10-04)
        try {
          deleteWorkData()
        } catch {
          setNotice({ kind: 'failed', text: t('storage.delete.workFailed') })
          return
        }
        setNotice({ kind: 'done', text: t('storage.delete.workDone') })
        setStep('menu')
      },
    },
    resetAll: {
      title: t('storage.delete.allTitle'),
      body: t('storage.delete.allBody'),
      confirm: t('storage.delete.allConfirm'),
      run: () => {
        resetAllData()
      },
    },
  }

  return (
    <DialogScrim onMouseDown={step === 'menu' ? onClose : back}>
      <div
        ref={ref}
        className="mcdlg mcdlg--storage"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-storage-step={step}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {step === 'menu' ? (
          <>
            <div className="mcdlg__head">
              <span id={titleId}>{t('storage.title')}</span>
              <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
                <Icon name="close" />
              </button>
            </div>
            <div className="mcdlg__body storage">
              <section className="storage__section">
                <h3 className="storage__h">{t('storage.mode.label')}</h3>
                <p className="storage__mode" data-storage-mode={mode}>
                  {t(temporary ? 'storage.mode.temporary' : 'storage.mode.personal')}
                </p>
              </section>
              <p className="storage__text">{t('storage.statement')}</p>
              <p className="storage__sub">{t('storage.notSecurity')}</p>

              <section className="storage__section">
                <h3 className="storage__h">{t('storage.restore.label')}</h3>
                {portable ? (
                  <p className="storage__sub">{t('storage.restore.portable')}</p>
                ) : (
                  <>
                    <label className="storage__toggle">
                      <input
                        type="checkbox"
                        data-storage-toggle="restore"
                        checked={remembered === 'personal'}
                        disabled={temporary}
                        onChange={(e) => setRemembered(e.currentTarget.checked ? 'personal' : null)}
                      />
                      <span>{t('gate.personal.remember')}</span>
                    </label>
                    <p className="storage__sub">{remembered === 'personal' ? t('storage.restore.on') : t('storage.restore.off')}</p>
                    {temporary ? (
                      <label className="storage__toggle">
                        <input
                          type="checkbox"
                          data-storage-toggle="always-temporary"
                          checked={remembered === 'temporary'}
                          onChange={(e) => setRemembered(e.currentTarget.checked ? 'temporary' : null)}
                        />
                        <span>{t('gate.temporary.remember')}</span>
                      </label>
                    ) : null}
                  </>
                )}
              </section>

              <section className="storage__section storage__actions">
                {temporary ? (
                  <button type="button" className="btn" data-storage-action="to-personal" onClick={() => setStep('toPersonal')}>
                    {t('storage.switch.toPersonal')}
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn" data-storage-action="to-temporary" onClick={() => setStep('toTemporary')}>
                      {t('storage.switch.toTemporary')}
                    </button>
                    <button type="button" className="btn" data-storage-action="copy" onClick={() => setStep('copy')}>
                      {t('storage.switch.copyToTemporary')}
                    </button>
                  </>
                )}
                <button type="button" className="btn" data-storage-action="delete-work" onClick={() => setStep('deleteWork')}>
                  {t('storage.delete.work')}
                </button>
                <button type="button" className="btn" data-storage-action="reset-all" onClick={() => setStep('resetAll')}>
                  {t('storage.delete.all')}
                </button>
              </section>
              {notice?.kind === 'done' ? (
                <p className="storage__done" role="status" data-storage-notice="done">
                  {notice.text}
                </p>
              ) : null}
            </div>
            <div className="mcdlg__foot">
              <button type="button" className="btn" onClick={onClose}>
                {t('dialog.close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mcdlg__head">
              <span id={titleId}>{steps[step].title}</span>
            </div>
            <div className="mcdlg__body storage">
              <p className="storage__text">{steps[step].body}</p>
              {notice?.kind === 'failed' ? (
                <p className="storage__failed" role="alert" data-storage-notice="failed">
                  {notice.text}
                </p>
              ) : null}
            </div>
            <div className="mcdlg__foot mcdlg__foot--spread">
              <button type="button" className="btn" data-storage-export="" onClick={exportNow}>
                {t('storage.export')}
              </button>
              <button type="button" className="btn" onClick={back}>
                {t('dialog.cancel')}
              </button>
              <button type="button" className="btn btn--primary" data-storage-confirm="" onClick={steps[step].run}>
                {steps[step].confirm}
              </button>
            </div>
          </>
        )}
      </div>
    </DialogScrim>
  )
}
