import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { Icon } from '../ui/icons'
import { useMenuKeyboard, useMenuTrigger } from '../ui/useMenuKeyboard'
import { useOutsideDismiss } from './toolbar/useOutsideDismiss'

// SEMANTICS-M4.md §M4-8 — the Timeline's CSV control while a view unit is on:
// the plain file, which never depends on the screen, and the file with shown
// values. With no view unit on, the Timeline keeps its single CSV button.

export function TimelineCsvMenu({ disabled, onPlain, onShown }: { disabled: boolean; onPlain: () => void; onShown: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideDismiss(open, ref, close)
  const { entry, triggerProps } = useMenuTrigger(open, setOpen)
  useMenuKeyboard(open, popRef, btnRef, close, entry)
  const choose = (save: () => void) => {
    save()
    setOpen(false)
  }
  // `.timeline__legend` clips its chips, so an absolute menu inside it is cut
  // away; `fixed` from the trigger's rect is not. Placed before paint and never
  // hidden, so the keyboard hook can focus into it at once.
  useLayoutEffect(() => {
    const btn = btnRef.current
    const pop = popRef.current
    if (!open || !btn || !pop) return
    const r = btn.getBoundingClientRect()
    const rtl = getComputedStyle(btn).direction === 'rtl'
    Object.assign(pop.style, {
      position: 'fixed',
      top: 'auto',
      bottom: `${window.innerHeight - r.top + 6}px`,
      left: rtl ? `${r.left}px` : 'auto',
      right: rtl ? 'auto' : `${window.innerWidth - r.right}px`,
    })
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="timeline__csv"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        title={t('timeline.csvTitle')}
        ref={btnRef}
        {...triggerProps}
      >
        {t('timeline.csv')}
        <Icon name="chevron-down" className="icon--caret" />
      </button>
      {open ? (
        <div className="menu__pop menu__pop--up" role="menu" ref={popRef}>
          <button type="button" className="menu__item" role="menuitem" onClick={() => choose(onPlain)}>
            <span className="menu__name">{t('timeline.csv')}</span>
            <span className="menu__blurb">{t('timeline.csv.plain.blurb')}</span>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => choose(onShown)}>
            <span className="menu__name">{t('timeline.csv.shown')}</span>
            <span className="menu__blurb">{t('timeline.csv.shown.blurb')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
