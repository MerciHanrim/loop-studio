import { useId, useRef } from 'react'
import { useT } from '../i18n'
import { useDialogFocus } from './useDialogFocus'
import { DialogScrim } from './DialogScrim'
import { Icon } from '../ui/icons'

// Help ▸ How a timetable is read (SEMANTICS-M7.md §M7-5, #519). A table is a plan or
// what is available, the meaning belongs to the table, so every line that reads one
// table reads it the same way, and a supply that is off is told by the strip, the
// Inspector and the CSV, not by the run bar.

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function TimetableHelpDialog({ open, onClose, returnFocusTo }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null
  return (
    <DialogScrim onMouseDown={onClose}>
      <div ref={ref} className="mcdlg mcdlg--contextual-help" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mcdlg__head">
          <span id={titleId}>{t('help.timetable.title')}</span>
          <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
            <Icon name="close" />
          </button>
        </div>
        <div className="mcdlg__body contextual-help">
          <p className="contextual-help__intro">{t('help.timetable.p1')}</p>
          <p className="contextual-help__intro">{t('help.timetable.p2')}</p>
          <p className="contextual-help__intro">{t('help.timetable.p3')}</p>
        </div>
      </div>
    </DialogScrim>
  )
}
