import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useT } from '../../i18n'

// docs/workbench.md §WB2.2 — a menu panel whose rows are names, with ONE
// description area at its foot: File and its Templates / Export submenus.
//
// - The area shows the description of the row the pointer is over, else of
//   the row that has focus; a row without a description shows none (never
//   the previous row's); no row, a hint. Pointing changes only what is drawn:
//   focus stays where it is, and the area is no live region, so moving the
//   pointer makes a screen reader say nothing.
// - Every description is laid out in the area at once, all but the current
//   one hidden, so the area is as tall as the longest from the start and does
//   not jump between rows; past its cap it scrolls, it never cuts.
// - Each row is described by its own description (`aria-describedby`), so a
//   screen reader reads a row's description when the row takes focus.
// - Touch: a press on a row that has an action (a Template, an export
//   format) selects it and shows its description with an explicit Open /
//   Export button, which runs it. A mouse click, Enter or Space runs the row
//   at once, as before.

type Entry = { text: string; action?: string }

type PanelCtx = {
  register: (id: string, entry: Entry, run: (() => void) | undefined) => void
  unregister: (id: string) => void
  /** a touch press on a row with an action: select it instead of running */
  intercept: (e: ReactMouseEvent, id: string) => boolean
}

const Ctx = createContext<PanelCtx | null>(null)

/** a row's description and, for a submenu row, the label of the button a
 *  touch press shows (`run` is what it does). Returns the id to put in the
 *  row's `aria-describedby`, the attribute that ties the row to it, and the
 *  click guard for the touch press. */
function useDescribedRow(text: string | undefined, action?: { label: string; run: () => void }) {
  const ctx = useContext(Ctx)
  const id = useId()
  const descId = text ? `${id}-desc` : undefined
  const run = useRef(action?.run)
  useLayoutEffect(() => {
    run.current = action?.run
  })
  const label = action?.label
  useLayoutEffect(() => {
    if (!ctx || !descId || !text) return
    ctx.register(descId, { text, action: label }, () => run.current?.())
    return () => ctx.unregister(descId)
  }, [ctx, descId, text, label])
  return {
    descId,
    rowProps: { 'data-desc': descId ?? '' },
    /** true when the click was a touch selection (the row must not run) */
    intercept: (e: ReactMouseEvent) => (ctx && descId ? ctx.intercept(e, descId) : false),
  }
}

/** One row of a described menu: its name on one line. `description` shows in
 *  the area; `action` (a submenu's row) labels the button a touch press shows;
 *  `disabledNote` turns the row off and says why in a short line under its
 *  name — a disabled row takes no focus, so that line is how the keyboard and
 *  a screen reader learn it (it describes the row; the name stays the name). */
export function DescribedRow({
  name,
  description,
  action,
  onSelect,
  disabledNote,
  attrs,
}: {
  name: string
  description?: string
  action?: string
  onSelect: () => void
  disabledNote?: string
  attrs?: Record<string, string>
}) {
  const nameId = useId()
  const noteId = useId()
  const { descId, rowProps, intercept } = useDescribedRow(description, action ? { label: action, run: onSelect } : undefined)
  const describedBy = [disabledNote ? noteId : null, descId].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className="menu__item"
      role="menuitem"
      {...rowProps}
      {...attrs}
      disabled={disabledNote != null}
      aria-labelledby={disabledNote ? nameId : undefined}
      aria-describedby={describedBy || undefined}
      onClick={(e) => {
        if (intercept(e)) return
        onSelect()
      }}
    >
      <span className="menu__name" id={nameId}>
        {name}
      </span>
      {disabledNote ? (
        <span className="dmenu__note" id={noteId}>
          {disabledNote}
        </span>
      ) : null}
    </button>
  )
}

/** which row the area describes: `undefined` none, `''` a row without a
 *  description, else that row's description id */
type Shown = string | undefined

const rowOf = (target: EventTarget | null, within: HTMLElement | null): HTMLElement | null => {
  const el = target instanceof Element ? target.closest<HTMLElement>('[role^="menuitem"]') : null
  return el && within?.contains(el) ? el : null
}

export function DescribedMenu({
  className,
  style,
  menuRef,
  panelRef,
  id,
  label,
  onRowFocus,
  children,
}: {
  className: string
  style?: CSSProperties
  /** the `role="menu"` element: the rows, and the keyboard's popup */
  menuRef: RefObject<HTMLDivElement | null>
  /** the whole panel (rows and area) */
  panelRef?: RefObject<HTMLDivElement | null>
  id?: string
  label: string
  /** a row took focus */
  onRowFocus?: (row: HTMLElement) => void
  children: ReactNode
}) {
  const t = useT()
  const [entries, setEntries] = useState<ReadonlyArray<readonly [string, Entry]>>([])
  const runs = useRef(new Map<string, () => void>())
  const [hovered, setHovered] = useState<Shown>(undefined)
  const [focused, setFocused] = useState<Shown>(undefined)
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const pointer = useRef('mouse')

  const register = useCallback((key: string, entry: Entry, run: (() => void) | undefined) => {
    if (run) runs.current.set(key, run)
    setEntries((list) => {
      const at = list.findIndex(([k]) => k === key)
      if (at >= 0 && list[at][1].text === entry.text && list[at][1].action === entry.action) return list
      const next = list.slice()
      if (at >= 0) next[at] = [key, entry]
      else next.push([key, entry])
      return next
    })
  }, [])
  const unregister = useCallback((key: string) => {
    runs.current.delete(key)
    setEntries((list) => list.filter(([k]) => k !== key))
  }, [])
  const entriesRef = useRef(entries)
  useLayoutEffect(() => {
    entriesRef.current = entries
  })
  const intercept = useCallback((e: ReactMouseEvent, key: string) => {
    // a click no pointer made (Enter, Space, a screen reader's activate) runs
    if (e.detail === 0 || (pointer.current !== 'touch' && pointer.current !== 'pen')) return false
    if (!entriesRef.current.find(([k]) => k === key)?.[1].action) return false
    e.preventDefault()
    setPicked(key)
    return true
  }, [])
  const ctx = useMemo(() => ({ register, unregister, intercept }), [register, unregister, intercept])

  const shown: Shown = picked ?? hovered ?? focused
  const pickedEntry = picked ? entries.find(([k]) => k === picked)?.[1] : undefined

  const onPointerDown = (e: ReactPointerEvent) => {
    pointer.current = e.pointerType
    // a touch press elsewhere in the rows drops the earlier selection
    if (picked && rowOf(e.target, menuRef.current)?.getAttribute('data-desc') !== picked) setPicked(undefined)
  }
  // a touch selection lasts while it is the current row: the mouse pointing
  // at, or focus moving to, another row ends it, so the area and its button
  // never speak for a row that is not the current one
  const leavePicked = (row: HTMLElement) => {
    if (picked && row.getAttribute('data-desc') !== picked) setPicked(undefined)
  }
  const onPointerOver = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const row = rowOf(e.target, menuRef.current)
    if (!row) return
    setHovered(row.getAttribute('data-desc') ?? '')
    leavePicked(row)
  }
  const onFocus = (e: ReactFocusEvent) => {
    const row = rowOf(e.target, menuRef.current)
    setFocused(row ? (row.getAttribute('data-desc') ?? '') : undefined)
    if (row) {
      leavePicked(row)
      onRowFocus?.(row)
    }
  }
  const onBlur = (e: ReactFocusEvent) => {
    if (!menuRef.current?.contains(e.relatedTarget as Node | null)) setFocused(undefined)
  }

  return (
    <div ref={panelRef} className={`menu__pop dmenu ${className}`} style={style}>
      <Ctx.Provider value={ctx}>
        <div
          ref={menuRef}
          className="dmenu__rows"
          id={id}
          role="menu"
          aria-label={label}
          onPointerDownCapture={onPointerDown}
          onPointerOver={onPointerOver}
          onPointerLeave={() => setHovered(undefined)}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          {children}
        </div>
      </Ctx.Provider>
      <div className="dmenu__area">
        <div className="dmenu__descs">
          <p className={`dmenu__desc dmenu__hint${shown === undefined ? ' is-shown' : ''}`}>{t('workbench.file.hint')}</p>
          {entries.map(([key, entry]) => (
            <p key={key} id={key} className={`dmenu__desc${shown === key ? ' is-shown' : ''}`}>
              {entry.text}
            </p>
          ))}
        </div>
        {picked && pickedEntry?.action ? (
          // touch only, and not a menu row: no keyboard stop (Enter on the row
          // itself runs it), so `tabIndex={-1}`
          <button type="button" className="btn btn--sm dmenu__act" tabIndex={-1} onClick={() => runs.current.get(picked)?.()}>
            {pickedEntry.action}
          </button>
        ) : null}
      </div>
    </div>
  )
}
