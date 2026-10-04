import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, SyntheticEvent } from 'react'
import { useT, type MessageKey } from '../i18n'
import { PROTECTED_PASSWORD_MAX } from '../model/shareProtected'
import {
  type ProtectedNotice,
  cancelProtectedOpen,
  dismissProtectedNotice,
  submitProtectedPassword,
  useProtectedLinkStore,
} from '../store/protectedLink'
import { selectTemporary, useSessionStore } from '../store/sessionStore'
import { DialogScrim } from './DialogScrim'
import { useDialogFocus } from './useDialogFocus'

// Issue #300 — what a person sees when a protected share link is opened
// (SEMANTICS-P.md SS P6). One component for desktop and phone, mounted once at
// the app's root; the flow itself is `src/store/protectedLink.ts`.
//
// The prompt shows nothing derived from the link: there is no plaintext before
// a correct password, and the ciphertext's size is not shown either.
//
// The password is the <input>'s own value and nowhere else. It is read on
// submit and handed to the flow; after a wrong answer it stays in the field,
// selected, so it can be retyped or corrected. Closing the dialog unmounts the
// field. Whether a browser or a password manager offers to fill or save it is
// theirs to decide (`autocomplete="current-password"`).

const NOTICE_KEY = {
  damaged: 'share.open.notice.damaged',
  unavailable: 'share.open.notice.unavailable',
  newer: 'share.open.notice.newer',
  content: 'share.open.notice.content',
} as const satisfies Record<ProtectedNotice, MessageKey>

export function ProtectedLinkDialog() {
  const open = useProtectedLinkStore((s) => s.open)
  if (open.phase === 'prompt') return <Prompt busy={open.busy} failures={open.failures} />
  if (open.phase === 'notice') return <Notice notice={open.notice} />
  return null
}

function Prompt({ busy, failures }: { busy: boolean; failures: number }) {
  const t = useT()
  const temporary = useSessionStore(selectTemporary)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const errorId = useId()
  const [shown, setShown] = useState(false)
  const [empty, setEmpty] = useState(true)

  useDialogFocus(true, ref, cancelProtectedOpen)
  // a wrong answer: the field keeps what was typed, selected, ready to be
  // retyped or corrected
  useEffect(() => {
    if (failures === 0) return
    const el = inputRef.current
    el?.focus()
    el?.select()
  }, [failures])

  const submit = (e: SyntheticEvent) => {
    e.preventDefault()
    const password = inputRef.current?.value ?? ''
    if (password === '') return
    void submitProtectedPassword(password) // one at a time: the flow ignores a second call
  }
  // Enter that only commits an IME composition must not submit the form
  const guardComposition = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
  }

  return (
    <DialogScrim>
      <div
        ref={ref}
        className="mcdlg mcdlg--confirm mcdlg--share"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-protected-open="prompt"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{t('share.open.title')}</span>
        </div>
        <form className="share-protect share-protect--open" onSubmit={submit} noValidate>
          <div className="mcdlg__body">
            <p id={bodyId} className="mcdlg__note">
              {t('share.open.body')}
            </p>
            <label className="share-protect__field">
              <span>{t('share.protect.password')}</span>
              <input
                ref={inputRef}
                type={shown ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={PROTECTED_PASSWORD_MAX * 2}
                readOnly={busy}
                aria-invalid={failures > 0 ? true : undefined}
                aria-describedby={failures > 0 ? errorId : undefined}
                data-protected-open="password"
                onKeyDown={guardComposition}
                onInput={(e) => setEmpty(e.currentTarget.value === '')}
              />
            </label>
            <button
              type="button"
              className="btn btn--sm share-protect__reveal"
              aria-pressed={shown}
              disabled={busy}
              data-protected-open="reveal"
              onClick={() => setShown((v) => !v)}
            >
              {shown ? t('share.protect.hide') : t('share.protect.show')}
            </button>
            {failures > 0 && !busy ? (
              <p id={errorId} className="share-protect__problem" role="alert" data-protected-open="error" data-failures={failures}>
                {t('share.open.error.auth')}
              </p>
            ) : null}
            <p className="share-protect__help" data-protected-open="storage-note">
              {temporary ? t('share.open.note.temporary') : t('share.open.note.personal')}
            </p>
            <p className="share-protect__status" role="status" data-protected-open="status">
              {busy ? t('share.open.busy') : ''}
            </p>
          </div>
          <div className="mcdlg__foot">
            <button type="button" className="btn" onClick={cancelProtectedOpen}>
              {t('dialog.cancel')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || empty}>
              {t('share.open.submit')}
            </button>
          </div>
        </form>
      </div>
    </DialogScrim>
  )
}

function Notice({ notice }: { notice: ProtectedNotice }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()
  useDialogFocus(true, ref, dismissProtectedNotice)
  return (
    <DialogScrim onMouseDown={dismissProtectedNotice}>
      <div
        ref={ref}
        className="mcdlg mcdlg--confirm mcdlg--share"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-protected-open="notice"
        data-notice={notice}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{t('share.open.notice.title')}</span>
        </div>
        <div className="mcdlg__body">
          <p id={bodyId} className="mcdlg__note">
            {t(NOTICE_KEY[notice])}
          </p>
        </div>
        <div className="mcdlg__foot">
          <button type="button" className="btn btn--primary" onClick={dismissProtectedNotice}>
            {t('share.panel.close')}
          </button>
        </div>
      </div>
    </DialogScrim>
  )
}
