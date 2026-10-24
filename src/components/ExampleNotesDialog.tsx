import { useId, useRef, useState } from 'react'
import { useT, type MessageKey } from '../i18n'
import { MENU_TEMPLATES } from '../model/templates'
import { TEMPLATE_KEY } from './templateKeys'
import { useDialogFocus } from './useDialogFocus'
import { DialogScrim } from './DialogScrim'
import { ArrowIcon, Icon } from '../ui/icons'

// Help ▸ Example notes (Lumi, 2026-10-20): every example the Templates menu
// offers, with its explanation readable at any time, in the app — no link,
// no one-time tip, no record of which Template a document came from. The same
// shell and list as Manage contextual tips (ContextualHelpDialog); each row is
// a disclosure that opens its example's paragraphs under its name and closes
// the one open before. The texts are the catalog's, so they follow the
// interface language.
//
// docs/localization.md §L7 precedent — a `Record`-typed table of literal
// `MessageKey`s, so `check-i18n.mjs`'s call-site scan sees every key.
const NOTES: Record<string, readonly MessageKey[]> = {
  equilibrium: ['help.examples.equilibrium.p1', 'help.examples.equilibrium.p2'],
  deadlock: ['help.examples.deadlock.p1', 'help.examples.deadlock.p2'],
  'coffee-roastery': ['help.examples.coffeeRoastery.p1', 'help.examples.coffeeRoastery.p2', 'help.examples.coffeeRoastery.p3'],
  'mmo-progression': ['help.examples.mmoProgression.p1', 'help.examples.mmoProgression.p2', 'help.examples.mmoProgression.p3'],
  'gacha-general': ['help.examples.gachaGeneral.p1', 'help.examples.gachaGeneral.p2', 'help.examples.gachaGeneral.p3'],
  'gacha-standard': ['help.examples.gachaStandard.p1', 'help.examples.gachaStandard.p2', 'help.examples.gachaStandard.p3'],
  'gacha-pickup': ['help.examples.gachaPickup.p1', 'help.examples.gachaPickup.p2', 'help.examples.gachaPickup.p3'],
  'gacha-banner-zones': ['help.examples.gachaBannerZones.p1', 'help.examples.gachaBannerZones.p2', 'help.examples.gachaBannerZones.p3'],
}

/** the menu's Templates that have notes, in the menu's order (every one does —
 *  `ExampleNotesDialog.test.ts` keeps it so) */
export const EXAMPLE_NOTE_IDS: readonly string[] = MENU_TEMPLATES.map((t) => t.id).filter((id) => NOTES[id])

type Props = {
  open: boolean
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null | undefined
}

export function ExampleNotesDialog({ open, onClose, returnFocusTo }: Props) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const baseId = useId()
  const [openId, setOpenId] = useState<string | null>(null)
  useDialogFocus(open, ref, onClose, returnFocusTo)
  if (!open) return null

  return (
    <DialogScrim onMouseDown={onClose}>
      <div
        ref={ref}
        className="mcdlg mcdlg--contextual-help mcdlg--example-notes"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mcdlg__head">
          <span id={titleId}>{t('help.examples.title')}</span>
          <button type="button" className="mcdlg__x" onClick={onClose} aria-label={t('dialog.close')}>
            <Icon name="close" />
          </button>
        </div>
        <div className="mcdlg__body contextual-help example-notes">
          <p className="contextual-help__intro">{t('help.examples.intro')}</p>
          <ul className="contextual-help__list">
            {EXAMPLE_NOTE_IDS.map((id) => {
              const expanded = openId === id
              const panelId = `${baseId}-${id}`
              const key = TEMPLATE_KEY[id as keyof typeof TEMPLATE_KEY]
              return (
                <li key={id} className="example-notes__row" data-example={id}>
                  <button
                    type="button"
                    className="example-notes__toggle"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpenId(expanded ? null : id)}
                  >
                    {/* the same caret as the side panels' folds (ModelPanels):
                        the submenu arrow mirrors in a right-to-left layout */}
                    <span className="example-notes__caret" aria-hidden="true">
                      {expanded ? <Icon name="chevron-down" /> : <ArrowIcon unit="submenu" />}
                    </span>
                    <span className="contextual-help__name">{t(key.name)}</span>
                  </button>
                  {expanded ? (
                    <div id={panelId} className="example-notes__text">
                      {NOTES[id].map((p) => (
                        <p key={p} dir="auto">
                          {t(p)}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </DialogScrim>
  )
}
