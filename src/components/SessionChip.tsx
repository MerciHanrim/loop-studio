import { useCallback, useId, useRef, useState } from 'react'
import { useT } from '../i18n'
import { exportableDocument } from '../store/sessionActions'
import { selectTemporary, useSessionStore } from '../store/sessionStore'
import { downloadText } from '../ui/download'
import { useMenuKeyboard, useMenuTrigger } from '../ui/useMenuKeyboard'
import type { ToolbarDialog } from './toolbar/dialogTypes'
import { useOutsideDismiss } from './toolbar/useOutsideDismiss'

// Issue #297 — the temporary session's standing reminder, in the toolbar: the
// work is not saved in this browser. It is a small menu, because the reminder
// is only useful with the ways out beside it: export the diagram as a file,
// save it in this browser after all (the confirmation step of the Storage
// area), or open that area. Nothing here is shown in a personal browser.

const FILE_NAME = 'loop-studio-graph.json'

export function SessionChip({ onOpenDialog }: { onOpenDialog: (desc: ToolbarDialog, opener: HTMLElement | null) => void }) {
  const t = useT()
  const temporary = useSessionStore(selectTemporary)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const close = useCallback(() => setOpen(false), [])
  useOutsideDismiss(open, wrapRef, close)
  const { entry, triggerProps } = useMenuTrigger(open, setOpen)
  useMenuKeyboard(open, popRef, btnRef, close, entry)
  if (!temporary) return null

  return (
    <div className="menu session-chip" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="rev-chip session-chip__btn"
        aria-haspopup="true"
        aria-expanded={open}
        // only while the menu exists (issue #307): an id that names nothing
        // while closed stopped Narrator reading "expanded" once it opened
        aria-controls={open ? menuId : undefined}
        title={t('session.temporary.chipTitle')}
        data-session-chip="temporary"
        {...triggerProps}
      >
        {t('session.temporary.chip')}
      </button>
      {open ? (
        <div className="menu__pop session-chip__pop" id={menuId} ref={popRef} role="menu" aria-label={t('session.temporary.chip')}>
          <p className="session-chip__text">{t('session.temporary.chipTitle')}</p>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              downloadText(exportableDocument(), FILE_NAME)
            }}
          >
            <span className="menu__name">{t('session.temporary.menuExport')}</span>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpenDialog({ kind: 'storage-privacy', step: 'toPersonal' }, btnRef.current)
            }}
          >
            <span className="menu__name">{t('session.temporary.menuKeep')}</span>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpenDialog({ kind: 'storage-privacy' }, btnRef.current)
            }}
          >
            <span className="menu__name">{t('storage.menuLabel')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
