import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '../i18n'
import { buildKind } from '../storage/buildKind'
import type { StorageMode } from '../storage/storagePort'

// Issue #297 — the storage gate: the choice between a personal browser and a
// temporary session, drawn BEFORE anything stored is read.
//
// It is rendered by the boot module (`src/main.tsx`) while the storage port is
// still shut, so it cannot show a title, a preview or a node count of the
// stored work even by mistake: nothing has been read. It is in the browser's
// language, not a stored one, and in the system theme, not a stored one, for
// the same reason.
//
// Neutral: two equal buttons, neither primary, and nothing pre-selected. The
// one exception is the portable file, where the temporary session carries a
// "Recommended" mark, because in Chrome every local HTML file in the profile
// shares that storage (docs/… and `src/storage/buildKind.ts`).
//
// Remembering is explicit and opt-in: a box under each choice, unticked, and
// pressing a button without the box remembers nothing - the gate returns at
// the next start. The portable file has no boxes: it asks every time.

type Props = {
  /** the address carries a share link: say that a temporary session keeps the
   *  shared document out of this browser's storage */
  shareLinkWaiting: boolean
  /** the person pressed a button; `remember` is true only when the box under it was ticked */
  onAnswer: (mode: StorageMode, remember: boolean) => void
}

export function StorageGate({ shareLinkWaiting, onAnswer }: Props) {
  const t = useT()
  const portable = buildKind() === 'portable'
  const [rememberPersonal, setRememberPersonal] = useState(false)
  const [rememberTemporary, setRememberTemporary] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const leadId = useId()

  // focus goes to the heading, not to either choice: a keyboard user reads the
  // explanation first and no option is favoured
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main className="gate" data-gate={portable ? 'portable' : 'web'}>
      <section className="gate__card" aria-labelledby={titleId} aria-describedby={leadId}>
        <h1 id={titleId} className="gate__title" ref={headingRef} tabIndex={-1}>
          {t('gate.title')}
        </h1>
        <p id={leadId} className="gate__lead">
          {t('gate.lead')}
        </p>
        <p className="gate__lead">{t('gate.cannotTell')}</p>
        {shareLinkWaiting ? (
          <p className="gate__note" data-gate-note="share-link">
            {t('gate.shareLink.note')}
          </p>
        ) : null}
        {portable ? (
          <p className="gate__note" data-gate-note="portable">
            {t('gate.portable.note')}
          </p>
        ) : null}

        <div className="gate__choices">
          <div className="gate__choice" data-gate-choice="personal">
            <button type="button" className="btn gate__btn" onClick={() => onAnswer('personal', rememberPersonal && !portable)}>
              {t('gate.personal.button')}
            </button>
            <p className="gate__sub">{t('gate.personal.sub')}</p>
            {portable ? null : (
              <>
                <label className="gate__remember">
                  <input type="checkbox" checked={rememberPersonal} onChange={(e) => setRememberPersonal(e.currentTarget.checked)} />
                  <span>{t('gate.personal.remember')}</span>
                </label>
                <p className="gate__help">{t('gate.personal.rememberHelp')}</p>
              </>
            )}
          </div>

          <div className="gate__choice" data-gate-choice="temporary">
            <button type="button" className="btn gate__btn" onClick={() => onAnswer('temporary', rememberTemporary && !portable)}>
              {t('gate.temporary.button')}
              {portable ? <span className="gate__badge">{t('gate.recommended')}</span> : null}
            </button>
            <p className="gate__sub">{t('gate.temporary.sub')}</p>
            {portable ? null : (
              <>
                <label className="gate__remember">
                  <input type="checkbox" checked={rememberTemporary} onChange={(e) => setRememberTemporary(e.currentTarget.checked)} />
                  <span>{t('gate.temporary.remember')}</span>
                </label>
                <p className="gate__help">{t('gate.temporary.rememberHelp')}</p>
              </>
            )}
          </div>
        </div>

        <p className="gate__later">{t('gate.later')}</p>
      </section>
    </main>
  )
}
