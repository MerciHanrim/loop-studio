import { useEffect, useId, useRef } from 'react'
import { useT } from '../i18n'
import { RELEASE_NOTES } from '../releaseNotes/releaseNotes'
import { useWhatsNewStore } from '../store/whatsNewStore'
import { DialogScrim } from './DialogScrim'
import { useDialogFocus } from './useDialogFocus'

// Issue #296 — the What's new panel: every release note, newest first. A normal
// modal, like About: Escape, the backdrop and the close button each dismiss it.
//
// It can be reached at any time from the Help menu (desktop) and the Help sheet
// (mobile), and from the update notice. Really opening it is what records
// `opened` and clears the `New` marker; closing the notice does not.
//
// The version and the date are shown verbatim in every language, the way About
// shows the version: `v0.15.0` and an ISO date read the same everywhere and
// need no calendar or digit decision per locale. The items are catalog strings,
// so every shipped language carries every line.
//
// Like every dialog it is drawn in the shared dialog layer (`DialogScrim`), not
// where it is declared: opened from the mobile Help sheet it would otherwise sit
// in the sheet's layer, under the run bar and the "Open a file" card.
//
// The notes ship inside the bundle. Nothing is fetched, so the panel reads
// offline in the PWA and in the portable build.

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function WhatsNewPanel({ open, onClose, returnFocusTo }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const markOpened = useWhatsNewStore((s) => s.markOpened)
  useDialogFocus(open, ref, onClose, returnFocusTo)

  // recorded when the panel is really on screen, not when something asks for it
  useEffect(() => {
    if (open) markOpened()
  }, [open, markOpened])

  if (!open) return null

  return (
    <DialogScrim onMouseDown={onClose}>
      <div
        ref={ref}
        className="mcdlg mcdlg--whatsnew"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-whatsnew="panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{t('whatsNew.title')}</span>
          <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
            ✕
          </button>
        </div>
        <div className="mcdlg__body whatsnew">
          {RELEASE_NOTES.map((note) => (
            <section key={note.id} className="whatsnew__entry" aria-labelledby={`${titleId}-${note.version}`}>
              <h3 className="whatsnew__version" id={`${titleId}-${note.version}`} dir="ltr">
                {'v' + note.version}
                <time className="whatsnew__date" dateTime={note.date}>
                  {note.date}
                </time>
              </h3>
              <ul className="whatsnew__items">
                {note.items.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </DialogScrim>
  )
}
