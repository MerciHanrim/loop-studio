import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { LOCALES, useI18n, useT } from '../i18n'

// docs/localization.md §L5 — the language control is AUTO-GENERATED from the
// registry: it lists every registered locale's `nativeName`, in registry order,
// marks the active one, and needs NO code change when a locale is added.
//
// It is a trigger button + an overlay menu (a `menu` / single-select
// `menuitemradio` pattern). The menu is an absolutely-positioned popover, so it
// changes neither the Toolbar height nor any Canvas geometry. Selecting starts
// the atomic activation (§L4.5); a failed load leaves the current selection
// (`aria-checked` follows `activeLocale`).

export function LanguageSwitch() {
  const t = useT()
  const active = useI18n((s) => s.activeLocale)
  const requested = useI18n((s) => s.requestedLocale)
  const loading = useI18n((s) => s.loading)
  const setLocale = useI18n((s) => s.setLocale)

  const [open, setOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  const activeIdx = Math.max(
    0,
    LOCALES.findIndex((l) => l.code === active),
  )
  const current = LOCALES[activeIdx] ?? LOCALES[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) itemRefs.current[focusIdx]?.focus()
  }, [open, focusIdx])

  const openMenu = () => {
    setFocusIdx(activeIdx) // start on the active item
    setOpen(true)
  }
  const close = (returnFocus = true) => {
    setOpen(false)
    if (returnFocus) btnRef.current?.focus()
  }

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
    }
  }

  const onMenuKey = (e: KeyboardEvent) => {
    const n = LOCALES.length
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        setFocusIdx((i) => (i + 1) % n)
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusIdx((i) => (i - 1 + n) % n)
        break
      case 'Home':
        e.preventDefault()
        setFocusIdx(0)
        break
      case 'End':
        e.preventDefault()
        setFocusIdx(n - 1)
        break
      case 'Tab':
        close(false)
        break
    }
  }

  return (
    <div className="menu lang-menu" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn lang-switch"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('lang.title')}
        title={t('lang.title')}
        data-locale={current.code}
        data-loading={loading || undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span lang={current.code}>{current.nativeName}</span>
        <span aria-hidden="true"> ▾</span>
      </button>

      {open ? (
        <div
          className="menu__pop lang-menu__pop"
          id={menuId}
          role="menu"
          aria-label={t('lang.menuLabel')}
          onKeyDown={onMenuKey}
        >
          {LOCALES.map((l, i) => {
            const isActive = l.code === active
            const isLoading = loading && l.code === requested
            return (
              <button
                key={l.code}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                className="menu__item lang-menu__item"
                role="menuitemradio"
                aria-checked={isActive}
                data-locale={l.code}
                tabIndex={i === focusIdx ? 0 : -1}
                onClick={() => {
                  setLocale(l.code)
                  close()
                }}
              >
                <span className="menu__name" lang={l.code}>
                  {isActive ? '✓ ' : ''}
                  {l.nativeName}
                  {isLoading ? ` · ${t('lang.loading')}` : ''}
                </span>
                {l.englishName !== l.nativeName ? (
                  <span className="menu__blurb">{l.englishName}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
