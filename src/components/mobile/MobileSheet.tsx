import { useRef, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { useDialogFocus } from '../useDialogFocus'
import { Icon } from '../../ui/icons'

// docs/mobile.md §MV5 — the shared bottom-sheet chrome: a scrim (tap to close),
// a titled header with a 44px Close, Escape + focus-return via useDialogFocus.
// Exactly one exclusive overlay uses it at a time (uiStore).
//
// Issue #307 — a sheet is NOT modal: no `aria-modal` and no Tab trap, because
// the run bar and the PWA update bar are used while a sheet is open (MV-D11,
// MV-D18, MV-D19); only what its scrim covers is made inert. Focus moves
// inside when it opens, and a real dialog opened over it is modal in turn
// (src/ui/overlayStack.ts). `onEscape` lets a sub-sheet go back one level (to
// the More sheet) instead of closing everything; Close and a tap on the scrim
// still call `onClose`. `initialFocus` picks where focus lands (the More sheet,
// returning from a sub-sheet, lands on the row that opened it).

export function MobileSheet({
  title,
  onClose,
  onEscape,
  returnFocusTo,
  initialFocus,
  className,
  children,
}: {
  title: string
  onClose: () => void
  onEscape?: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
  initialFocus?: () => HTMLElement | null | undefined
  className?: string
  children: ReactNode
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(true, ref, onEscape ?? onClose, returnFocusTo, { kind: 'sheet', initialFocus })
  return (
    <div className="sheet-scrim" onMouseDown={onClose}>
      <div
        ref={ref}
        className={`sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sheet__head">
          <span className="sheet__title">{title}</span>
          <button type="button" className="sheet__x" onClick={onClose} aria-label={t('dialog.close')}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
