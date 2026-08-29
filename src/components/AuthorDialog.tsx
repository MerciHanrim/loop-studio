import { useRef, useState } from 'react'
import {
  AUTHOR_NAME_KEY,
  AUTHOR_NAME_MAX_BYTES,
  AUTHOR_NOTE_MAX_BYTES,
  truncBytes,
} from '../model/revision'
import { AUTHOR_DISCLOSURE } from '../ui/revisionActions'
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
  const ref = useRef<HTMLDivElement>(null)
  const [{ name, note }, setState] = useState(readAuthor)
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null

  const save = () => {
    const n = truncBytes(name.trim(), AUTHOR_NAME_MAX_BYTES)
    const t = truncBytes(note.trim(), AUTHOR_NOTE_MAX_BYTES)
    try {
      if (n || t) {
        localStorage.setItem(AUTHOR_NAME_KEY, JSON.stringify({ ...(n ? { name: n } : {}), ...(t ? { note: t } : {}) }))
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
        aria-label="Author for exports"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span>Author for exports</span>
        </div>
        <div className="mcdlg__body">
          <label className="review__field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
              placeholder="e.g. Alex"
            />
          </label>
          <label className="review__field">
            <span>Note (optional)</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setState((s) => ({ ...s, note: e.target.value }))}
              placeholder="a short message that travels with the file"
            />
          </label>
          <p className="mcdlg__note">{AUTHOR_DISCLOSURE}</p>
        </div>
        <div className="mcdlg__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
