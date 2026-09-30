import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { DEFAULT_SERIES_CAP } from '../model/timelineSeries'
import { useAnchoredPosition } from './toolbar/useAnchoredPosition'
import { useOutsideDismiss } from './toolbar/useOutsideDismiss'

// docs/timeline-series-contract.md §6 — the chart series SELECTOR. It replaces
// the inline `+N more` legend expansion: a selection control whose items
// change project state (the stored `recommendedRunConfig.timelineSeries`),
// and it must read as one — a dialog with one checkbox per series, not a row
// of bare chips.
//
// Portaled to `document.body` and positioned `fixed` from the trigger's rect,
// the same way the frame properties popover is: the Timeline panel is a fixed
// 200px box and on mobile a scrolling sheet, so a panel rendered inside it
// would either change the chart's height (§6: it never may) or be clipped.
// `useAnchoredPosition` flips ABOVE the trigger when there is no room below,
// which at the bottom of the window is the usual case.

export type SeriesItem = {
  id: string
  label: string
  color: string
  isRegister: boolean
}

export function TimelineSeriesPopover({
  id,
  anchorRef,
  items,
  drawnIds,
  onToggle,
  onShowAll,
  onResetAuto,
  onClose,
}: {
  /** the element id the trigger's `aria-controls` names */
  id: string
  /** the `계열 n/total` trigger — the anchor, and where focus returns on Escape */
  anchorRef: RefObject<HTMLElement | null>
  /** every eligible series, DOCUMENT order (contract §3, "Order") */
  items: SeriesItem[]
  /** the resolved drawn set — what the checkboxes reflect */
  drawnIds: readonly string[]
  /** flip one series; `false` means the store REFUSED it (§6.2, last series) */
  onToggle: (seriesId: string) => boolean
  /** `모두 표시` — stores `'all'` (future series included) */
  onShowAll: () => void
  /** `자동 선택으로 재설정` — removes the field */
  onResetAuto: () => void
  /** `focusAnchor` is false when the close came from a click elsewhere:
   *  pulling focus back to the trigger would steal it from what was clicked */
  onClose: (opts: { focusAnchor: boolean }) => void
}) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const showAllHintId = useId()
  const resetHintId = useId()
  const pos = useAnchoredPosition(anchorRef, panelRef, true, 'end')
  const drawn = new Set(drawnIds)
  // the §6.2 refusal — shown until the next accepted change
  const [refused, setRefused] = useState(false)

  // focus moves INTO the popover on open (§6) — once, and only after the
  // placement has been measured: until `pos` exists the panel is
  // `visibility: hidden`, and `focus()` on a hidden element is a no-op.
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current || !pos) return
    focused.current = true
    const first = panelRef.current?.querySelector<HTMLElement>('input[type="checkbox"]')
    ;(first ?? panelRef.current)?.focus()
  }, [pos])

  // an outside mousedown closes; a click inside does not; the trigger counts
  // as inside so it can toggle the popover rather than being dismissed on the
  // way down and reopened by its own click
  useOutsideDismiss(true, panelRef, () => onClose({ focusAnchor: false }), { alsoInside: anchorRef })

  const flip = (seriesId: string) => {
    const ok = onToggle(seriesId)
    setRefused(!ok)
  }

  const panel = (
    <div
      ref={panelRef}
      id={id}
      className="tl-series"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose({ focusAnchor: true })
        }
      }}
      onBlur={(e) => {
        // focus left the popover entirely (Tab out, or a click on something
        // focusable elsewhere) — close without pulling focus back
        const next = e.relatedTarget as Node | null
        if (e.currentTarget.contains(next)) return
        if (next && anchorRef.current?.contains(next)) return
        onClose({ focusAnchor: false })
      }}
    >
      <h2 id={titleId} className="tl-series__title">
        {t('timeline.series.title')}
      </h2>

      <ul className="tl-series__list">
        {items.map((s) => (
          <li key={s.id}>
            <label className={`tl-series__item${s.isRegister ? ' tl-series__item--register' : ''}`}>
              <input
                type="checkbox"
                className="tl-series__check"
                checked={drawn.has(s.id)}
                onChange={() => flip(s.id)}
              />
              <span className="timeline__mark" style={{ background: s.color }} aria-hidden="true" />
              <span className="tl-series__label" dir="auto">
                {s.label}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {/* §6.2 — the last eligible series cannot be unchecked. Visible text, so
          a sighted reader sees why the box sprang back; `role="status"` so an
          assistive reader hears it without leaving the checkbox. */}
      <p className="tl-series__note" role="status">
        {refused ? t('timeline.series.minOne') : ''}
      </p>

      <div className="tl-series__actions">
        <button
          type="button"
          className="btn tl-series__action"
          aria-describedby={showAllHintId}
          onClick={() => {
            setRefused(false)
            onShowAll()
          }}
        >
          {t('timeline.series.showAll')}
        </button>
        {/* §6.1 — the future-inclusive meaning is said in words, right under the
            button, and bound as its accessible description */}
        <p id={showAllHintId} className="tl-series__hint">
          {t('timeline.series.showAllHint')}
        </p>
        <button
          type="button"
          className="btn tl-series__action"
          aria-describedby={resetHintId}
          onClick={() => {
            setRefused(false)
            onResetAuto()
          }}
        >
          {t('timeline.series.resetAuto')}
        </button>
        <p id={resetHintId} className="tl-series__hint">
          {t('timeline.series.resetAutoHint', { cap: DEFAULT_SERIES_CAP })}
        </p>
      </div>
    </div>
  )

  // `document.body`, deliberately: outside the Timeline panel's fixed height
  // and outside the mobile sheet's own scroll box.
  return createPortal(panel, document.body)
}
