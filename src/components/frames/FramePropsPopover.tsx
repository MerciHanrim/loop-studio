import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { FRAME_COLORS, type FrameColor } from '../../store/frameStore'
import { useT, type MessageKey } from '../../i18n'
import { useAnchoredPosition } from '../toolbar/useAnchoredPosition'
import { useOutsideDismiss } from '../toolbar/useOutsideDismiss'

// docs/large-graph-readability-frame-colour.md §FC10 — a frame's PROPERTIES
// popover: its name and its accent, together, reached from its TITLE.
//
// WHY THIS EXISTS (2026-09-25). The accent picker used to be a swatch row
// rendered inside the frame's own chrome, pinned to `top: 100%` — the frame's
// BOTTOM edge, in canvas coordinates. That binds the control to the frame's
// GEOMETRY instead of to the interaction that opens it, and on a frame taller
// than the viewport it puts the only colour control off screen: the shipped
// gacha Template's `Premium Pickup` is 1000 units tall, so reading its title
// and recolouring it could not be done from the same place. Every other frame
// edit is already reached from the title; this one now is too.
//
// TWO THINGS MAKE THAT WORK, AND BOTH ARE LOAD-BEARING:
//
//   • it is PORTALED to `document.body` and positioned `fixed` from the
//     title's measured screen rect — NOT rendered inside `<ViewportPortal>`.
//     A panel inside the canvas transform would be scaled by the zoom and
//     could be pushed off screen by the very geometry that caused the defect;
//   • `Canvas.tsx` freezes pan and zoom while it is open (`uiStore.frameProps`).
//     The placement is measured once, so a pan or a zoom underneath would
//     slide the panel off its own anchor — and §FC10's contract is that opening
//     it and recolouring from it move NOTHING: not the frame, not a node, not
//     an edge, not the viewport.
//
// Placement re-uses the toolbar's shared `computeBelowAnchorPos` clamp/flip
// math (below the anchor, flipped above when there is no room, clamped inside
// the viewport on both axes), left-aligned because a frame's title chip sits
// at its top-LEFT corner.
//
// SCOPE (LGR-D12 / D6, 2026-09-20 — unchanged): this popover is desktop-and-
// unlocked-canvas only. On mobile, and on a locked canvas, a saved frame stays
// view + select only, so `FrameLayer` never renders it there at all.

/** §FC4 — accessible names for the swatch buttons (colour is never the sole tell) */
const COLOR_KEY: Record<'neutral' | FrameColor, MessageKey> = {
  neutral: 'canvas.frame.color.neutral',
  slate: 'canvas.frame.color.slate',
  sage: 'canvas.frame.color.sage',
  gold: 'canvas.frame.color.gold',
  violet: 'canvas.frame.color.violet',
  rose: 'canvas.frame.color.rose',
}

export function FramePropsPopover({
  anchorRef,
  name,
  label,
  color,
  onCommitName,
  onPickColor,
  onClose,
}: {
  /** the frame's title chip — the anchor, and where focus returns on close */
  anchorRef: RefObject<HTMLElement | null>
  /** the RAW stored label: empty ⇒ the frame is showing its locale default */
  name: string
  /** what the title currently READS — the fallback the name field starts from */
  label: string
  color: FrameColor | null
  /** commit a rename. Empty ⇒ back to the locale default. */
  onCommitName: (v: string) => void
  onPickColor: (c: FrameColor | null) => void
  /** `focusAnchor` is false when the close came from a click elsewhere: pulling
   *  focus back to the title would then steal it from whatever was just
   *  clicked. */
  onClose: (opts: { focusAnchor: boolean }) => void
}) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(name || label)
  const pos = useAnchoredPosition(anchorRef, panelRef, true, 'start')

  // the draft is committed by every exit EXCEPT Escape, so the latest value has
  // to be readable from the dismiss callbacks without re-subscribing them
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  })

  // Focus lands ONCE, and only after the placement has been measured: until
  // `pos` exists the panel is `visibility: hidden`, and `focus()` on a hidden
  // element is a no-op — MEASURED (2026-09-25), the name field was left
  // unfocused and Escape went to the document instead of closing the popover.
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current || !pos) return
    focused.current = true
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [pos])

  /**
   * Close on a TASK of its own, never inside the dispatch of the event that
   * asked for it.
   *
   * MEASURED (2026-09-25). The gesture that dismisses this popover is a
   * mousedown on the canvas, and closing from inside that dispatch let the SAME
   * gesture pan the canvas: `<ReactFlow panOnDrag>` had already been false for
   * that render, but React Flow keeps it in a MUTABLE pan-zoom object refreshed
   * from an effect, so flushing the closing state update mid-dispatch re-armed
   * it before the event reached the pane.
   *
   * `setTimeout`, NOT `queueMicrotask`: a microtask checkpoint runs BETWEEN two
   * listeners for the same event, so a microtask is still "inside" the
   * dispatch. That is not a theory — with `queueMicrotask` a single wheel notch
   * still zoomed the canvas 1 → 0.717 with the popover on screen; a task cannot.
   */
  /**
   * Once a close is under way this panel is spent: a later dismissal can no
   * longer commit anything.
   *
   * MEASURED (2026-09-25), and it is the deferral above that makes it
   * necessary. Closing focuses the title chip again, and that focus move leaves
   * a panel React has not unmounted yet, so the panel's own `onBlur` — the
   * commit path — fires from the CANCEL. On a suggested frame that is not a
   * silent rename but a **promotion**: `commitLabel` adopts it as a manual
   * frame (§AF5 R5), which §AF5 R6 says an Escape must never do. It reproduced
   * as `Escape → the frame is renamed to the abandoned draft`, and under load
   * as a suggested frame disappearing from the auto set.
   */
  const closingRef = useRef(false)

  const closeSoon = (focusAnchor: boolean) => {
    if (closingRef.current) return
    closingRef.current = true
    setTimeout(() => onClose({ focusAnchor }), 0)
  }

  const commitAndClose = (focusAnchor: boolean) => {
    if (closingRef.current) return
    onCommitName(draftRef.current.trim())
    closeSoon(focusAnchor)
  }

  // a mousedown anywhere else, a wheel anywhere else, or a window resize. The
  // title chip counts as INSIDE so it can toggle the popover itself rather
  // than being dismissed on the way down and reopened by its own click.
  // A wheel does NOT dismiss: while this is open the canvas is frozen, so a
  // wheel over it already does nothing and there is nothing to drift from.
  useOutsideDismiss(true, panelRef, () => commitAndClose(false), {
    alsoInside: anchorRef,
    keepOnWheel: true,
  })

  const panel = (
    <div
      ref={panelRef}
      className="lgr-frame-props"
      role="dialog"
      aria-label={t('canvas.frame.props.title', { label })}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // measured before it is shown, so it never flashes at a corner — the
        // same "null until the first measurement" contract the toolbar
        // surfaces use.
        visibility: pos ? 'visible' : 'hidden',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          closeSoon(true) // CANCEL — the name is not committed
        }
      }}
      onBlur={(e) => {
        // focus left the panel entirely (Tab out, or a click on something
        // focusable elsewhere). Treated exactly like the old inline input's
        // own blur: commit.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        commitAndClose(false)
      }}
    >
      <label className="lgr-frame-props__field">
        <span className="lgr-frame-props__caption">{t('canvas.frame.props.name')}</span>
        <input
          ref={inputRef}
          className="lgr-frame-props__name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitAndClose(true)
            }
          }}
        />
      </label>

      <div className="lgr-frame-props__colors" role="group" aria-label={t('canvas.frame.colorRow')}>
        {([null, ...FRAME_COLORS] as (FrameColor | null)[]).map((c) => {
          const active = color === c
          return (
            <button
              key={c ?? 'neutral'}
              type="button"
              className={`lgr-frame__swatch${active ? ' is-active' : ''}`}
              data-color={c ?? undefined}
              aria-label={t(COLOR_KEY[c ?? 'neutral'])}
              aria-pressed={active}
              onClick={() => onPickColor(c)}
            />
          )
        })}
      </div>
    </div>
  )

  // `document.body`, deliberately: outside `.react-flow`'s transform AND
  // outside every canvas stacking context.
  return createPortal(panel, document.body)
}
