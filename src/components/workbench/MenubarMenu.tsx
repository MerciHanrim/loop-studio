import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMenuKeyboard, useMenuTrigger } from '../../ui/useMenuKeyboard'
import { useMenuOpenStore } from '../toolbar/menuOpenStore'
import { useOutsideDismiss } from '../toolbar/useOutsideDismiss'
import { Icon } from '../../ui/icons'

// The workbench (2026-10, step 5) — one menu of the menu bar (Edit, View,
// Insert, Run). The same parts every product menu uses: the shared keyboard
// contract (issue #307, ../../ui/useMenuKeyboard), outside dismissal, and the
// open state announced so the palette's tooltip yields (../toolbar/menuOpenStore).
// Its entries are data: an action, a check item (`role="menuitemcheckbox"`,
// its state in `aria-checked`), a heading or a separator.

export type MenuEntry =
  /** `note`: a second line under the name, for a state the row is in (Suggest
   *  frames after the graph changed) — a tooltip alone is no path for touch
   *  or keyboard readers */
  | { kind: 'item'; key: string; label: string; onSelect: () => void; disabled?: boolean; hint?: string; note?: string }
  | { kind: 'check'; key: string; label: string; checked: boolean; onToggle: () => void; disabled?: boolean }
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'sep'; key: string }
  | { kind: 'node'; key: string; node: ReactNode }

export function MenubarMenu({
  id,
  label,
  entries,
  buttonRef,
}: {
  /** the menuOpenStore key and the menu's `data-menu` hook */
  id: string
  label: string
  entries: MenuEntry[]
  buttonRef?: (el: HTMLButtonElement | null) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  useOutsideDismiss(open, wrapRef, () => setOpen(false))
  const close = useCallback(() => setOpen(false), [])
  const { entry, triggerProps } = useMenuTrigger(open, setOpen)
  useMenuKeyboard(open, popRef, btnRef, close, entry)
  useEffect(() => {
    useMenuOpenStore.getState().setOpen(id, open)
    return () => useMenuOpenStore.getState().setOpen(id, false)
  }, [id, open])

  return (
    <div className="menu wb-menu" ref={wrapRef} data-menu={id}>
      <button
        ref={(el) => {
          btnRef.current = el
          buttonRef?.(el)
        }}
        type="button"
        className="wb-mb"
        aria-haspopup="true"
        aria-expanded={open}
        {...triggerProps}
      >
        {label}
      </button>
      {open && (
        <div className="menu__pop wb-menu__pop" role="menu" aria-label={label} ref={popRef}>
          {entries.map((e) => {
            if (e.kind === 'sep') return <div key={e.key} className="menu__divider" role="separator" />
            if (e.kind === 'heading')
              return (
                <div key={e.key} className="wb-menu__heading" role="presentation">
                  {e.label}
                </div>
              )
            if (e.kind === 'node') return <div key={e.key}>{e.node}</div>
            if (e.kind === 'check')
              return (
                <button
                  key={e.key}
                  type="button"
                  className="menu__item wb-menu__check"
                  role="menuitemcheckbox"
                  aria-checked={e.checked}
                  disabled={e.disabled}
                  onClick={() => {
                    setOpen(false)
                    e.onToggle()
                  }}
                >
                  <span className="wb-menu__mark" aria-hidden="true">
                    {e.checked ? <Icon name="check" /> : null}
                  </span>
                  <span className="menu__name">{e.label}</span>
                </button>
              )
            return (
              <button
                key={e.key}
                type="button"
                className="menu__item"
                role="menuitem"
                data-row={e.key}
                disabled={e.disabled}
                title={e.hint}
                onClick={() => {
                  setOpen(false)
                  e.onSelect()
                }}
              >
                <span className="menu__name">{e.label}</span>
                {e.note ? <span className="menu__blurb">{e.note}</span> : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
