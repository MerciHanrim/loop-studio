import { useRef } from 'react'
import { useDialogFocus } from './useDialogFocus'

// A themed replacement for window.confirm() — same Warm Mineral Lab surface,
// keyboard support, and focus handling as the other app dialogs.

type Props = {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  /** true → the confirm button is styled as a destructive / primary action */
  confirmPrimary?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** element to restore focus to after the dialog closes */
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmPrimary = true,
  onConfirm,
  onCancel,
  returnFocusTo,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(open, ref, onCancel, returnFocusTo)
  if (!open) return null

  return (
    <div className="mcdlg__scrim" onMouseDown={onCancel}>
      <div
        ref={ref}
        className="mcdlg mcdlg--confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id="confirm-title">{title}</span>
        </div>
        <div className="mcdlg__body">
          <p id="confirm-body" className="mcdlg__note">
            {body}
          </p>
        </div>
        <div className="mcdlg__foot">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn${confirmPrimary ? ' btn--primary' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
