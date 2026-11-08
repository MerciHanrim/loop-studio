import { useId, useRef } from 'react'
import { useT } from '../i18n'
import { useDialogFocus } from './useDialogFocus'
import { DialogScrim } from './DialogScrim'
import { Icon } from '../ui/icons'

// Help ▸ How a run rule reads a tank (SEMANTICS-M6.md §M6-9). A rule is read once a step,
// so the one-step delay and the step-length warnings are what a person needs in words.
// The numbers in the text are pinned against the engine in `src/engine/runRuleHelp.test.ts`.

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function RunRuleHelpDialog({ open, onClose, returnFocusTo }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null
  return (
    <DialogScrim onMouseDown={onClose}>
      <div ref={ref} className="mcdlg mcdlg--contextual-help" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mcdlg__head">
          <span id={titleId}>{t('help.runRule.title')}</span>
          <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
            <Icon name="close" />
          </button>
        </div>
        <div className="mcdlg__body contextual-help">
          <p className="contextual-help__intro">{t('help.runRule.p1')}</p>
          <p className="contextual-help__intro">{t('help.runRule.p2')}</p>
          <p className="contextual-help__intro">{t('help.runRule.p3')}</p>
          <p className="contextual-help__intro">{t('help.runRule.p4')}</p>
          {/* #520 — the start warning, which holds with or without a rule */}
          <p className="contextual-help__intro">{t('help.runRule.p6')}</p>
          <p className="contextual-help__intro">{t('help.runRule.p5')}</p>
        </div>
      </div>
    </DialogScrim>
  )
}
