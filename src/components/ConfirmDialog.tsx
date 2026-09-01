import { useId, useRef } from 'react'
import { useT } from '../i18n'
import { useDialogFocus } from './useDialogFocus'

// A themed replacement for window.confirm() — same Warm Mineral Lab surface,
// keyboard support, and focus handling as the other app dialogs.
//
// docs/localization.md Slice 2b contract:
//  - the caller does NO external effect (share URL, clipboard, download,
//    import, GraphDoc swap) until `onConfirm` fires;
//  - Cancel / Escape / backdrop are the same cancel path (`onCancel`);
//  - focus is trapped while open and returns to the trigger on close
//    (`useDialogFocus`); initial focus lands on **Cancel** (first in the
//    foot) so Enter never fires a destructive confirm by accident;
//  - `title` / `body` / labels are live values — a locale switch while the
//    dialog is open re-renders them in the new locale;
//  - user-activation work (clipboard, download) runs inside the caller's
//    `onConfirm`, which is invoked from the Confirm button's click event.

type Props = {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  /** true → the confirm button is styled as a destructive / primary action */
  confirmPrimary?: boolean
  /** a mousedown on the scrim cancels; set false for a flow where an accidental
   *  backdrop click must not dismiss (none in Slice 2b — all cancels are safe) */
  dismissOnBackdrop?: boolean
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
  cancelLabel,
  confirmPrimary = true,
  dismissOnBackdrop = true,
  onConfirm,
  onCancel,
  returnFocusTo,
}: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()
  useDialogFocus(open, ref, onCancel, returnFocusTo)
  if (!open) return null

  return (
    <div className="mcdlg__scrim" onMouseDown={dismissOnBackdrop ? onCancel : undefined}>
      <div
        ref={ref}
        className="mcdlg mcdlg--confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{title}</span>
        </div>
        <div className="mcdlg__body">
          <p id={bodyId} className="mcdlg__note">
            {body}
          </p>
        </div>
        <div className="mcdlg__foot">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel ?? t('dialog.cancel')}
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
