import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useFilterStore } from '../../store/filterStore'
import { useGraphStore } from '../../store/graphStore'
import { useUiStore } from '../../store/uiStore'
import { LanguageSwitch } from '../LanguageSwitch'
import { ThemeToggle } from '../ThemeToggle'
import { useMenuOpenStore } from '../toolbar/menuOpenStore'
import { useOutsideDismiss } from '../toolbar/useOutsideDismiss'
import { useFitAll } from '../useFitAll'
import { Icon } from '../../ui/icons'

// The workbench (2026-10, step 5) — the menu bar's VIEW: how the canvas is
// shown, never what the document holds. Theme and Language (Settings' two
// rows, which open their own lists), then the view toggles that lived on the
// canvas's control rail — Focus, Filters, Activity overlay — and Reset view
// (the minimap's row went with the minimap, v0.30.0). A DISCLOSURE like
// Settings was (issue #307): its content is controls reached with Tab, two of
// which open their own popups; Escape closes the innermost level first.

export function ViewMenu({ buttonRef }: { buttonRef?: (el: HTMLButtonElement | null) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [activeRow, setActiveRow] = useState<'theme' | 'language' | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const focusMode = useUiStore((s) => s.focusMode)
  const toggleFocusMode = useUiStore((s) => s.toggleFocusMode)
  const filterOpen = useUiStore((s) => s.filterPanelOpen)
  const toggleFilterPanel = useUiStore((s) => s.toggleFilterPanel)
  const activity = useUiStore((s) => s.activityOverlay)
  const toggleActivity = useUiStore((s) => s.toggleActivityOverlay)
  const setSelection = useGraphStore((s) => s.setSelection)
  const fitAll = useFitAll(() => document.querySelector<HTMLElement>('.canvas'))

  useOutsideDismiss(open, wrapRef, () => setOpen(false))
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // a row's own list is open: it closes first (Settings' rule)
      if (wrapRef.current?.querySelector('.wb-viewmenu__pop [aria-expanded="true"], .wb-viewmenu__pop .menu__pop:not(.wb-viewmenu__pop)')) return
      setOpen(false)
      btnRef.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])
  useEffect(() => {
    if (!open) setActiveRow(null)
  }, [open])
  useEffect(() => {
    useMenuOpenStore.getState().setOpen('view', open)
    return () => useMenuOpenStore.getState().setOpen('view', false)
  }, [open])

  const toggle = (on: boolean, label: string, onClick: () => void, hook: string) => (
    <button type="button" className="menu__item wb-viewmenu__toggle" aria-pressed={on} data-view-row={hook} onClick={onClick}>
      <span className="wb-menu__mark" aria-hidden="true">
        {on ? <Icon name="check" /> : null}
      </span>
      <span className="menu__name">{label}</span>
    </button>
  )

  return (
    <div className="menu wb-viewmenu" ref={wrapRef}>
      <button
        ref={(el) => {
          btnRef.current = el
          buttonRef?.(el)
        }}
        type="button"
        className="wb-mb"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {t('workbench.menu.view')}
      </button>
      {open ? (
        <div className="menu__pop wb-viewmenu__pop" id={panelId} role="group" aria-label={t('workbench.menu.view')}>
          <ThemeToggle variant="row" open={activeRow === 'theme'} onOpenChange={(v) => setActiveRow(v ? 'theme' : null)} />
          <LanguageSwitch variant="row" open={activeRow === 'language'} onOpenChange={(v) => setActiveRow(v ? 'language' : null)} />
          <div className="menu__divider" role="separator" />
          {toggle(focusMode, t('workbench.view.focus'), toggleFocusMode, 'focus')}
          {toggle(filterOpen, t('workbench.view.filter'), toggleFilterPanel, 'filter')}
          {toggle(activity, t('workbench.view.activity'), toggleActivity, 'activity')}
          <div className="menu__divider" role="separator" />
          <button
            type="button"
            className="menu__item"
            data-view-row="reset"
            onClick={() => {
              setOpen(false)
              // Reset view: the exploration lens off and the whole diagram in
              // view (the canvas rail's Reset view, docs/large-graph-readability.md §LGR3.4)
              useFilterStore.getState().clear()
              setSelection(null, null)
              void fitAll()
            }}
          >
            <span className="wb-menu__mark" aria-hidden="true" />
            <span className="menu__name" title={t('canvas.resetView')}>{t('workbench.view.reset')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
