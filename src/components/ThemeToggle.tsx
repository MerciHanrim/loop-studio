import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useT, type MessageKey } from '../i18n'
import { useMenuKeyboard, useMenuTrigger } from '../ui/useMenuKeyboard'
import { useSideFlyoutPosition } from './toolbar/useAnchoredPosition'
import { useOutsideDismiss } from './toolbar/useOutsideDismiss'
import { storagePort } from '../storage/storagePort'
import { applyTheme, readStoredTheme, THEME_KEY, THEME_MODES, type ThemeMode } from '../theme/theme'
import { Icon } from '../ui/icons'

// issue #302 - the key, the reader and the applier live in src/theme/theme.ts,
// shared with the start-up in src/main.tsx. This component only chooses.
type Mode = ThemeMode
const KEY = THEME_KEY
const MODES = THEME_MODES
const apply = applyTheme

const LABEL_KEY: Record<Mode, MessageKey> = {
  system: 'theme.auto',
  light: 'theme.light',
  dark: 'theme.dark',
}
// plain text, no glyph — the row/submenu presentation (Hanrim's review,
// 2026-09-15) matches Language's own checkmark-only option style
const OPTION_KEY: Record<Mode, MessageKey> = {
  system: 'theme.option.system',
  light: 'theme.option.light',
  dark: 'theme.option.dark',
}

/** `pill` (default) — a bare cycle-on-click value button; the caller
 *  supplies its own label (mobile's `.sheet__row` text, e.g.). `row` — a
 *  full-width Settings-menu row that opens a small submenu (System / Light
 *  / Dark, current one checked), the same "current value + `›`" grammar as
 *  Language's own row (Hanrim's visual review, 2026-09-15 — a plain
 *  cycle-on-click row didn't read as clickable at all, unlike Language's
 *  `›`-marked one). `open`/`onOpenChange` are controlled when supplied
 *  (`SettingsMenu.tsx` uses this so Theme's and Language's submenus are
 *  mutually exclusive); otherwise the component manages its own state. */
export function ThemeToggle({
  variant = 'pill',
  open: controlledOpen,
  onOpenChange,
}: {
  variant?: 'pill' | 'row'
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const t = useT()
  const [mode, setMode] = useState<Mode>(readStoredTheme)
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const flyoutPos = useSideFlyoutPosition(btnRef, panelRef, variant === 'row' && open)

  useEffect(() => {
    apply(mode)
    try {
      storagePort.setItem(KEY, mode)
    } catch {
      /* storage unavailable — ignore */
    }
  }, [mode])

  const cycle = () =>
    setMode((m) => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system'))

  useOutsideDismiss(variant === 'row' && open, wrapRef, () => setOpen(false))

  // the menu keyboard contract (issue #307), from the shared hook: opened from
  // the keyboard, focus goes to the first option (the hook waits for the
  // flyout to be positioned and visible); opened with the pointer it stays on
  // the row. Escape closes this submenu alone and returns to the row, before
  // Settings sees the key. The options are radio items: one is checked.
  const close = useCallback(() => setOpen(false), [setOpen])
  const { entry, triggerProps } = useMenuTrigger(open, setOpen)
  useMenuKeyboard(variant === 'row' && open, panelRef, btnRef, close, entry)

  const choose = (m: Mode) => {
    setMode(m)
    setOpen(false)
    btnRef.current?.focus()
  }

  if (variant === 'row') {
    return (
      <div className="menu theme-menu" ref={wrapRef}>
        <button
          ref={btnRef}
          type="button"
          className="settings-row"
          aria-haspopup="menu"
          aria-expanded={open}
          // only while the menu exists (issue #307): an id that names nothing
          // while closed stopped Narrator reading "expanded" once it opened
          aria-controls={open ? menuId : undefined}
          {...triggerProps}
        >
          <span className="settings-row__label">{t('theme.rowLabel')}</span>
          <span className="settings-row__value">
            {t(OPTION_KEY[mode])}
            <span aria-hidden="true"> ›</span>
          </span>
        </button>
        {open ? (
          <div
            ref={panelRef}
            className="menu__pop lang-menu__pop theme-menu__pop"
            id={menuId}
            role="menu"
            aria-label={t('theme.menuLabel')}
            style={
              flyoutPos
                ? { position: 'fixed', top: flyoutPos.top, left: flyoutPos.left, right: 'auto', visibility: 'visible' }
                : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }
            }
          >
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                className="menu__item lang-menu__item"
                role="menuitemradio"
                aria-checked={m === mode}
                onClick={() => choose(m)}
              >
                <span className="menu__name">
                  {m === mode ? <Icon name="check" className="icon--check" /> : null}
                  {t(OPTION_KEY[m])}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <button type="button" className="btn" onClick={cycle} title={t('theme.title')}>
      <Icon name={mode === 'system' ? 'auto' : mode === 'light' ? 'sun' : 'moon'} className="icon--lead" />
      {t(LABEL_KEY[mode])}
    </button>
  )
}
