import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, SyntheticEvent } from 'react'
import { useT, type MessageKey } from '../../i18n'
import { passwordRule, protectedShareAvailable } from '../../model/shareProtected'
import { shareKb, type ProtectedShareLinkResult } from '../../ui/shareAction'
import { DialogScrim } from '../DialogScrim'
import { useDialogFocus } from '../useDialogFocus'
import { shareDisclosureBody } from './shareDisclosure'

// Issue #300 — the dialog a share link is created from, on desktop and on the
// phone alike (SEMANTICS-P.md SS P5). It is the plain link's disclosure
// (SEMANTICS-U.md SS U7) with one more choice:
//
//   plain link (the default)  -> `onCreatePlain`, exactly as before
//   protect with a password   -> two password fields, then `onCreateProtected`
//
// The password lives in the two <input> elements and nowhere else: not in
// React state, not in a store. It is read once, on submit, handed to
// `onCreateProtected`, and the fields are emptied when the dialog closes.
// Whether a browser or a password manager offers to save it is theirs to
// decide (`autocomplete="new-password"`); the dialog says so.
//
// While the key is derived the dialog stays open with a status line and
// everything disabled; a result the caller cannot turn into a link (over the
// size cap, no public address, no Web Crypto) is shown here, inline.

type Problem =
  | { kind: 'short' | 'long' | 'mismatch' | 'unavailable' | 'no-base' }
  | { kind: 'too-large'; bytes: number; cap: number }

type Props = {
  open: boolean
  /** a temporary session adds its one sentence to the disclosure (issue #297) */
  temporary: boolean
  onCancel: () => void
  /** the plain link: the caller closes the dialog and does the rest, as before */
  onCreatePlain: () => void
  /** seal + build + copy. `ok` means the caller has closed the dialog. */
  onCreateProtected: (password: string) => Promise<ProtectedShareLinkResult>
  returnFocusTo?: () => HTMLElement | null | undefined
}

const PROBLEM_KEY = {
  short: 'share.protect.error.short',
  long: 'share.protect.error.long',
  mismatch: 'share.protect.error.mismatch',
  unavailable: 'share.protect.unavailable',
  'no-base': 'share.noBase',
} as const satisfies Record<string, MessageKey>

// Closed = forgotten. The body is mounted only while the dialog is open, so the
// choice, both fields and any message go when it closes - nothing to reset.
export function ShareCreateDialog({ open, ...rest }: Props) {
  return open ? <ShareCreateBody {...rest} /> : null
}

function ShareCreateBody({ temporary, onCancel, onCreatePlain, onCreateProtected, returnFocusTo }: Omit<Props, 'open'>) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const formId = useId()
  const ruleId = useId()
  const problemId = useId()
  const [protect, setProtect] = useState(false)
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  // one creation at a time; a ref, because two clicks in one tick both see the
  // same render's `busy` (see `useShareSurface`)
  const busyRef = useRef(false)
  const available = protectedShareAvailable()

  useDialogFocus(true, ref, () => {
    if (!busyRef.current) onCancel()
  }, returnFocusTo)
  // The disclosure's contract (docs/localization.md Slice 2b): focus starts on
  // Cancel, so Enter never creates a link by accident. `useDialogFocus` prefers
  // the first field - here the checkbox - so this runs after it.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  // the fields appear when the box is ticked: put the caret in the first one
  useEffect(() => {
    if (protect) passwordRef.current?.focus()
  }, [protect])

  const submitProtected = async (e: SyntheticEvent) => {
    e.preventDefault()
    if (busyRef.current) return
    const password = passwordRef.current?.value ?? ''
    const again = confirmRef.current?.value ?? ''
    const rule = passwordRule(password)
    if (rule !== 'ok') {
      setProblem({ kind: rule === 'too-short' ? 'short' : 'long' })
      passwordRef.current?.focus()
      return
    }
    if (password.normalize('NFC') !== again.normalize('NFC')) {
      setProblem({ kind: 'mismatch' })
      confirmRef.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setProblem(null)
    try {
      const result = await onCreateProtected(password)
      if (result.status === 'ok') return // the caller has closed the dialog; the fields go with it
      if (result.status === 'too-large') setProblem({ kind: 'too-large', bytes: result.bytes, cap: result.cap })
      else if (result.status === 'password') setProblem({ kind: 'short' })
      else setProblem({ kind: result.status })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // Enter that only commits an IME composition must not submit the form
  const guardComposition = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
  }

  const problemText =
    problem == null
      ? null
      : problem.kind === 'too-large'
        ? t('share.tooLarge', { size: shareKb(problem.bytes), cap: shareKb(problem.cap) })
        : t(PROBLEM_KEY[problem.kind])

  return (
    <DialogScrim onMouseDown={busy ? undefined : onCancel}>
      <div
        ref={ref}
        className="mcdlg mcdlg--confirm mcdlg--share"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-share-create={protect ? 'protected' : 'plain'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{t('share.disclosure.title')}</span>
        </div>
        <div className="mcdlg__body">
          <p id={bodyId} className="mcdlg__note">
            {shareDisclosureBody(t, temporary)}
          </p>
          <label className="share-protect__option">
            <input
              type="checkbox"
              checked={protect}
              disabled={!available || busy}
              data-share-protect="option"
              onChange={(e) => {
                setProtect(e.currentTarget.checked)
                setProblem(null)
              }}
            />
            <span>{t('share.protect.option')}</span>
          </label>
          <p className="share-protect__help" data-share-protect={available ? 'help' : 'unavailable'}>
            {available ? t('share.protect.optionHelp') : t('share.protect.unavailable')}
          </p>
          {protect ? (
            <form id={formId} className="share-protect" onSubmit={submitProtected} noValidate>
              <label className="share-protect__field">
                <span>{t('share.protect.password')}</span>
                <input
                  ref={passwordRef}
                  type={shown ? 'text' : 'password'}
                  name="new-password"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                  aria-describedby={problem ? `${ruleId} ${problemId}` : ruleId}
                  aria-invalid={problem?.kind === 'short' || problem?.kind === 'long' ? true : undefined}
                  data-share-protect="password"
                  onKeyDown={guardComposition}
                  onInput={() => setProblem(null)}
                />
              </label>
              <label className="share-protect__field">
                <span>{t('share.protect.confirm')}</span>
                <input
                  ref={confirmRef}
                  type={shown ? 'text' : 'password'}
                  name="confirm-password"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                  aria-invalid={problem?.kind === 'mismatch' ? true : undefined}
                  aria-describedby={problem?.kind === 'mismatch' ? problemId : undefined}
                  data-share-protect="confirm"
                  onKeyDown={guardComposition}
                  onInput={() => setProblem(null)}
                />
              </label>
              <button
                type="button"
                className="btn btn--sm share-protect__reveal"
                aria-pressed={shown}
                disabled={busy}
                data-share-protect="reveal"
                onClick={() => setShown((v) => !v)}
              >
                {shown ? t('share.protect.hide') : t('share.protect.show')}
              </button>
              <p id={ruleId} className="share-protect__help">
                {t('share.protect.rule')}
              </p>
              <ul className="share-protect__notes">
                <li>{t('share.protect.note.channel')}</li>
                <li>{t('share.protect.note.lost')}</li>
                <li>{t('share.protect.note.strength')}</li>
                <li>{t('share.protect.note.contract')}</li>
              </ul>
            </form>
          ) : null}
          {problemText ? (
            <p id={problemId} className="share-protect__problem" role="alert" data-share-protect="problem">
              {problemText}
            </p>
          ) : null}
          <p className="share-protect__status" role="status" data-share-protect="status">
            {busy ? t('share.protect.busy') : ''}
          </p>
        </div>
        <div className="mcdlg__foot">
          <button ref={cancelRef} type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t('dialog.cancel')}
          </button>
          {protect ? (
            <button type="submit" form={formId} className="btn btn--primary" disabled={busy}>
              {t('share.disclosure.confirm')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (busyRef.current) return
                busyRef.current = true
                onCreatePlain()
              }}
            >
              {t('share.disclosure.confirm')}
            </button>
          )}
        </div>
      </div>
    </DialogScrim>
  )
}
