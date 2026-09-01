import { useRef, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { useDialogFocus } from '../useDialogFocus'

// docs/mobile.md §MV5 — the shared bottom-sheet chrome: a scrim (tap to close),
// a titled header with a 44px Close, Escape + tab-trap + focus-return via
// useDialogFocus. Exactly one exclusive overlay uses it at a time (uiStore).

export function MobileSheet({
  title,
  onClose,
  returnFocusTo,
  className,
  children,
}: {
  title: string
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
  className?: string
  children: ReactNode
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(true, ref, onClose, returnFocusTo)
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
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
