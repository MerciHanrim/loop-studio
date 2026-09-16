import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useT, type MessageKey } from '../i18n'
import { useSideFlyoutPosition } from './toolbar/useAnchoredPosition'
import { useOutsideDismiss } from './toolbar/useOutsideDismiss'

type Mode = 'system' | 'light' | 'dark'
const KEY = 'loop-studio:theme'
const MODES: Mode[] = ['system', 'light', 'dark']

function apply(mode: Mode) {
  const el = document.documentElement
  if (mode === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', mode)
}

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
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const v = localStorage.getItem(KEY)
      return v === 'light' || v === 'dark' ? v : 'system'
    } catch {
      return 'system'
    }
  })
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()
  const flyoutPos = useSideFlyoutPosition(btnRef, panelRef, variant === 'row' && open)

  useEffect(() => {
    apply(mode)
    try {
      localStorage.setItem(KEY, mode)
    } catch {
      /* storage unavailable — ignore */
    }
  }, [mode])

  const cycle = () =>
    setMode((m) => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system'))

  useOutsideDismiss(variant === 'row' && open, wrapRef, () => setOpen(false))

  useEffect(() => {
    if (variant !== 'row' || !open) return
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      btnRef.current?.focus()
    }
    window.addEventListener('keydown', onKey as (e: globalThis.KeyboardEvent) => void)
    return () => {
      window.removeEventListener('keydown', onKey as (e: globalThis.KeyboardEvent) => void)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, open])

  useEffect(() => {
    if (variant !== 'row' || !open || !flyoutPos) return
    itemRefs.current[MODES.indexOf(mode)]?.focus()
    // depends on whether a position has landed, not the position object
    // itself (a new `{top,left}` on every resize-triggered recompute would
    // otherwise steal focus back to the current-mode item on every resize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, open, Boolean(flyoutPos)])

  const choose = (m: Mode) => {
    setMode(m)
    setOpen(false)
    btnRef.current?.focus()
  }

  const onItemKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = itemRefs.current.findIndex((el) => el === document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      itemRefs.current[(idx + 1 + MODES.length) % MODES.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      itemRefs.current[(idx - 1 + MODES.length) % MODES.length]?.focus()
    }
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
          aria-controls={menuId}
          onClick={() => setOpen(!open)}
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
            {MODES.map((m, i) => (
              <button
                key={m}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                className="menu__item lang-menu__item"
                role="menuitem"
                aria-selected={m === mode}
                onClick={() => choose(m)}
                onKeyDown={onItemKeyDown}
              >
                <span className="menu__name">
                  {m === mode ? '✓ ' : ''}
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
      {t(LABEL_KEY[mode])}
    </button>
  )
}
