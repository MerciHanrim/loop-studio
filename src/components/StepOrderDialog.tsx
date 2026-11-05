import { useId, useRef } from 'react'
import { useT } from '../i18n'
import { useDialogFocus } from './useDialogFocus'
import { DialogScrim } from './DialogScrim'
import { Icon } from '../ui/icons'

// Help ▸ How a step fills and empties a Pool (SEMANTICS-M5.md §M5-12). A varying
// input makes the order inside a step visible, and it does not read as one would
// guess: a Pool fills first, a line then takes what the Pool held when the step
// began, and the Timeline draws the end of the step. The numbers in the text are
// pinned against the engine in `src/engine/stepOrderHelp.test.ts`.

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function StepOrderDialog({ open, onClose, returnFocusTo }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null
  return (
    <DialogScrim onMouseDown={onClose}>
      <div ref={ref} className="mcdlg mcdlg--contextual-help" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mcdlg__head">
          <span id={titleId}>{t('help.stepOrder.title')}</span>
          <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
            <Icon name="close" />
          </button>
        </div>
        <div className="mcdlg__body contextual-help">
          <p className="contextual-help__intro">{t('help.stepOrder.p1')}</p>
          <p className="contextual-help__intro">{t('help.stepOrder.p2')}</p>
          <p className="contextual-help__intro">{t('help.stepOrder.p3')}</p>
        </div>
      </div>
    </DialogScrim>
  )
}
