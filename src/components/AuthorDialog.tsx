import { useRef, useState } from 'react'
import {
  AUTHOR_NAME_KEY,
  AUTHOR_NAME_MAX_BYTES,
  AUTHOR_NOTE_MAX_BYTES,
  truncBytes,
} from '../model/revision'
import { useT } from '../i18n'
import { useDialogFocus } from './useDialogFocus'

// SEMANTICS-R.md §R8 — the device-local author label. Stored only here
// (`localStorage['loop-studio:author']`), byte-capped, and attached UNVERIFIED
// to every Project revision / proposal export. The disclosure states plainly
// that it travels inside the file.

function readAuthor(): { name: string; note: string } {
  try {
    const v = JSON.parse(localStorage.getItem(AUTHOR_NAME_KEY) ?? '{}') as {
      name?: unknown
      note?: unknown
    }
    return {
      name: typeof v.name === 'string' ? v.name : '',
      note: typeof v.note === 'string' ? v.note : '',
    }
  } catch {
    return { name: '', note: '' }
  }
}

export function AuthorDialog({
  open,
  onClose,
  returnFocusTo,
}: {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [{ name, note }, setState] = useState(readAuthor)
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null

  const save = () => {
    const n = truncBytes(name.trim(), AUTHOR_NAME_MAX_BYTES)
    const nt = truncBytes(note.trim(), AUTHOR_NOTE_MAX_BYTES)
    try {
      if (n || nt) {
        localStorage.setItem(AUTHOR_NAME_KEY, JSON.stringify({ ...(n ? { name: n } : {}), ...(nt ? { note: nt } : {}) }))
      } else {
        localStorage.removeItem(AUTHOR_NAME_KEY)
      }
    } catch {
      /* storage unavailable — nothing to persist */
    }
    onClose()
  }

  return (
    <div className="mcdlg__scrim" onMouseDown={onClose}>
      <div
        ref={ref}
        className="mcdlg mcdlg--confirm"
        role="dialog"
        aria-modal="true"
        aria-label={t('author.title')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span>{t('author.title')}</span>
        </div>
        <div className="mcdlg__body">
          <label className="review__field">
            <span>{t('author.name')}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
              placeholder={t('author.namePlaceholder')}
            />
          </label>
          <label className="review__field">
            <span>{t('author.note')}</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setState((s) => ({ ...s, note: e.target.value }))}
              placeholder={t('author.notePlaceholder')}
            />
          </label>
          <p className="mcdlg__note">{t('author.disclosure')}</p>
        </div>
        <div className="mcdlg__foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            {t('author.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
