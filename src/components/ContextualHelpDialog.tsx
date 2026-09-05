import { useId, useRef } from 'react'
import { useT, type MessageKey } from '../i18n'
import { useDialogFocus } from './useDialogFocus'
import { useHintStore, type HintId } from '../store/hintStore'

// docs/contextual-inline-help.md §CIH4 — the `Contextual help` Help-menu
// entry both Help surfaces already reserve a row for. Lists the v1 hints and
// lets the user re-arm one (§CIH4: "Show again next time" clears the
// persisted `seen` flag — it does NOT force the hint to render; the hint's
// own trigger / tier / cooldown rules decide when it next shows).

// docs/localization.md §L7 precedent (REG_CODE_KEY in Inspector.tsx) — a
// `Record`-typed map of literal `MessageKey`s, so `check-i18n.mjs`'s call-site
// scan sees each key as referenced even though the actual `t()` call below is
// dynamic.
const HINTS: readonly { id: HintId; name: MessageKey; desc: MessageKey }[] = [
  { id: 'empty-canvas', name: 'help.contextual.hint.emptyCanvas.name', desc: 'help.contextual.hint.emptyCanvas.desc' },
  { id: 'mc-first-open', name: 'help.contextual.hint.mc.name', desc: 'help.contextual.hint.mc.desc' },
  { id: 'review-first-open', name: 'help.contextual.hint.review.name', desc: 'help.contextual.hint.review.desc' },
  { id: 'focus-filter-discovery', name: 'help.contextual.hint.focusFilter.name', desc: 'help.contextual.hint.focusFilter.desc' },
] as const

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function ContextualHelpDialog({ open, onClose, returnFocusTo }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const seen = useHintStore((s) => s.seen)
  const rearm = useHintStore((s) => s.rearm)
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null

  return (
    <div className="mcdlg__scrim" onMouseDown={onClose}>
      <div
        ref={ref}
        className="mcdlg mcdlg--contextual-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{t('help.contextual.title')}</span>
          <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
            ✕
          </button>
        </div>
        <div className="mcdlg__body contextual-help">
          <p className="contextual-help__intro">{t('help.contextual.intro')}</p>
          <ul className="contextual-help__list">
            {HINTS.map((h) => (
              <li key={h.id} className="contextual-help__row">
                <div>
                  <p className="contextual-help__name">{t(h.name)}</p>
                  <p className="contextual-help__desc">{t(h.desc)}</p>
                </div>
                <button
                  type="button"
                  className="btn contextual-help__rearm"
                  disabled={!seen[h.id]}
                  onClick={() => rearm(h.id)}
                >
                  {t('help.contextual.rearm')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
