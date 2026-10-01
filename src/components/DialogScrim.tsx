import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The one layer every modal dialog is drawn in.
//
// A dialog used to be drawn where it was declared. That made its layer depend on
// its ancestors: on mobile, a dialog declared inside a sheet lived in the
// sheet's stacking context (`--z-sheet`), and the dialog's own `--z-mc-dialog`
// only competed with the sheet's other children. The fixed run bar and the
// "Open a file" card (`--z-runbar`) were therefore drawn OVER it. Measured at
// 390 px on a profile that still shows the open-file card: the card covered the
// title and the close button of the contextual-tips dialog, and the run bar
// stayed bright and pressable under the scrim.
//
// A z-index on one dialog cannot fix that, because the ceiling is the ancestor's
// layer. So every dialog's scrim is rendered into the document body, where
// `--z-mc-dialog` means what it says, wherever the dialog is declared.
//
// What does not change: React events still bubble along the REACT tree, so a
// sheet that contains a dialog still sees, and still stops, a press inside it;
// `useDialogFocus` traps Tab inside the dialog's own element; and the dialog
// still unmounts with whatever declared it.

type Props = {
  /** a press on the backdrop itself; a press inside the dialog is stopped there */
  onMouseDown?: () => void
  children: ReactNode
}

export function DialogScrim({ onMouseDown, children }: Props) {
  return createPortal(
    <div className="mcdlg__scrim" onMouseDown={onMouseDown}>
      {children}
    </div>,
    document.body,
  )
}
