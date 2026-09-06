import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  LANGUAGE_SEARCH_THRESHOLD,
  enabledLocales,
  matchesLanguageQuery,
  useI18n,
  useT,
} from '../i18n'

// docs/localization.md §L5 — the language control is AUTO-GENERATED from the
// registry: `enabledLocales()` in registry order, each row showing the endonym
// (`nativeName`) plus its name in the active UI language (`displayNameKey`), the
// active one checked. Adding a locale needs NO change here.
//
// A trigger button + an absolutely-positioned popover `listbox`, so it changes
// neither the Toolbar height nor any Canvas geometry. The desktop toolbar and
// the mobile More sheet mount this SAME component. A search box appears once
// there are `LANGUAGE_SEARCH_THRESHOLD`+ enabled locales; below that the list is
// short enough to scan. Selecting starts the atomic activation (§L4.5); a failed
// load leaves the current selection (`aria-selected` follows `activeLocale`).

export function LanguageSwitch() {
  const t = useT()
  const active = useI18n((s) => s.activeLocale)
  const requested = useI18n((s) => s.requestedLocale)
  const loading = useI18n((s) => s.loading)
  const setLocale = useI18n((s) => s.setLocale)

  const locales = enabledLocales()
  const showSearch = locales.length >= LANGUAGE_SEARCH_THRESHOLD

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [focusIdx, setFocusIdx] = useState(0)

  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (code: string) => `${baseId}-opt-${code}`

  const displayName = (l: (typeof locales)[number]) => t(l.displayNameKey)

  const filtered = useMemo(
    () =>
      query.trim() === ''
        ? locales
        : locales.filter((l) => matchesLanguageQuery(l, displayName(l), query)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locales, query, active],
  )

  const activeIdxIn = (list: readonly (typeof locales)[number][]) =>
    Math.max(0, list.findIndex((l) => l.code === active))
  const current = locales[activeIdxIn(locales)] ?? locales[0]
  const activeDescId = filtered[focusIdx] ? optionId(filtered[focusIdx].code) : undefined

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // put real focus where keystrokes should land, and keep the active option in view
  useEffect(() => {
    if (!open) return
    ;(showSearch ? searchRef.current : listRef.current)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showSearch])
  useEffect(() => {
    if (open) optionRefs.current[focusIdx]?.scrollIntoView({ block: 'nearest' })
  }, [open, focusIdx])

  function openMenu() {
    setQuery('')
    setFocusIdx(activeIdxIn(locales))
    setOpen(true)
  }
  function close(returnFocus = true) {
    setOpen(false)
    setQuery('')
    if (returnFocus) btnRef.current?.focus()
  }
  function choose(idx: number) {
    const l = filtered[idx]
    if (!l) return
    setLocale(l.code)
    close(true)
  }

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
    }
  }

  const onListKey = (e: KeyboardEvent) => {
    const n = filtered.length
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        if (showSearch && query !== '') setQuery('')
        else close(true)
        break
      case 'Tab':
        close(false) // let focus move on naturally
        break
      case 'ArrowDown':
        e.preventDefault()
        if (n) setFocusIdx((i) => (i + 1) % n)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (n) setFocusIdx((i) => (i - 1 + n) % n)
        break
      case 'Home':
        e.preventDefault()
        setFocusIdx(0)
        break
      case 'End':
        e.preventDefault()
        setFocusIdx(Math.max(0, n - 1))
        break
      case 'Enter':
        e.preventDefault()
        choose(focusIdx)
        break
      case ' ':
        if (!showSearch) {
          e.preventDefault()
          choose(focusIdx)
        }
        break
    }
  }

  return (
    <div className="menu lang-menu" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn lang-switch"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t('lang.title')}
        title={t('lang.title')}
        data-locale={current.code}
        data-loading={loading || undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span lang={current.code}>{current.nativeName}</span>
        <span aria-hidden="true"> ▾</span>
      </button>

      {open ? (
        <div className="menu__pop lang-menu__pop" onKeyDown={onListKey}>
          {showSearch ? (
            <input
              ref={searchRef}
              type="text"
              className="lang-menu__search"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeDescId}
              aria-label={t('lang.search')}
              placeholder={t('lang.search')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setFocusIdx(0)
              }}
            />
          ) : null}

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t('lang.menuLabel')}
            aria-activedescendant={showSearch ? undefined : activeDescId}
            tabIndex={showSearch ? -1 : 0}
            className="lang-menu__list"
          >
            {filtered.length === 0 ? (
              <div className="lang-menu__empty">{t('lang.noResults')}</div>
            ) : (
              filtered.map((l, i) => {
                const isActive = l.code === active
                const isLoading = loading && l.code === requested
                return (
                  <div
                    key={l.code}
                    ref={(el) => {
                      optionRefs.current[i] = el
                    }}
                    id={optionId(l.code)}
                    role="option"
                    aria-selected={isActive}
                    data-locale={l.code}
                    data-active={i === focusIdx || undefined}
                    className="menu__item lang-menu__item"
                    onClick={() => choose(i)}
                  >
                    <span className="menu__name" lang={l.code}>
                      {isActive ? '✓ ' : ''}
                      {l.nativeName}
                      {isLoading ? ` · ${t('lang.loading')}` : ''}
                    </span>
                    <span className="menu__blurb">{displayName(l)}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
