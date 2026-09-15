import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { LanguageSwitch } from '../LanguageSwitch'
import { ThemeToggle } from '../ThemeToggle'
import { useMenuOpenStore } from './menuOpenStore'

// docs/toolbar-responsive.md — the `Settings ▾` Tier-1 group: Theme,
// Language only — personal app-environment prefs, deliberately never a
// junk drawer for anything else. Modeled on `OverflowMenu.tsx`'s
// trigger+popover pattern. Deliberate exception (review condition 3):
// Theme/Language never call `closeAncestors` — cycling Theme or picking a
// Language is a plausible multi-click adjustment, and auto-closing this
// menu after each click would be actively annoying.

type Props = {
  buttonRef?: (el: HTMLButtonElement | null) => void
}

export type SettingsMenuHandle = { close: () => void }

export const SettingsMenu = forwardRef<SettingsMenuHandle, Props>(function SettingsMenu(
  { buttonRef },
  ref,
) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Theme's and Language's own submenus are mutually exclusive (Hanrim's
  // review, 2026-09-15) — Settings, their common parent, owns which one (if
  // any) is open, rather than each independently managing this.
  const [activeRow, setActiveRow] = useState<'theme' | 'language' | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    // Capture phase, same reasoning as `OverflowMenu`/`FileMenu` — Language
    // is its own nested dropdown (a real regression Lumi's review caught,
    // 2026-09-15: a bubble-phase Escape here fired in the SAME keydown as
    // Language's own Escape handler, closing both at once instead of one
    // level at a time). If it's open, let Escape close just that first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (wrapRef.current?.querySelector('[aria-expanded="true"], .menu__pop:not(.toolbar__settingsmenu-pop)'))
        return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useImperativeHandle(ref, () => ({ close: () => setOpen(false) }), [])

  // reset which submenu was active so reopening Settings starts fresh
  useEffect(() => {
    if (!open) setActiveRow(null)
  }, [open])

  // review, Hanrim 2026-09-15 — announce open/closed so the palette can
  // suppress its own hover tooltip while this menu (or Language's own
  // nested listbox, which can only be open while this is) is up
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('settings', open)
    return () => useMenuOpenStore.getState().setOpen('settings', false)
  }, [open])

  return (
    <div className="menu toolbar__settingsmenu" ref={wrapRef}>
      <button
        ref={(el) => {
          btnRef.current = el
          buttonRef?.(el)
        }}
        type="button"
        className="btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {t('toolbar.settings.button')}
      </button>
      {open ? (
        <div
          className="menu__pop toolbar__settingsmenu-pop"
          id={menuId}
          role="menu"
          aria-label={t('toolbar.settings.menuLabel')}
        >
          <ThemeToggle
            variant="row"
            open={activeRow === 'theme'}
            onOpenChange={(v) => setActiveRow(v ? 'theme' : null)}
          />
          <LanguageSwitch
            variant="row"
            open={activeRow === 'language'}
            onOpenChange={(v) => setActiveRow(v ? 'language' : null)}
          />
        </div>
      ) : null}
    </div>
  )
})
