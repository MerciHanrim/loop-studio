import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

// Regression, 2026-09-16: every toolbar menu closed itself on a bubble-phase
// `window` 'mousedown' listener. React Flow's own node-drag setup calls
// `event.stopImmediatePropagation()` on a node's `pointerdown`/`mousedown`
// (its own d3-drag-style click-vs-drag disambiguation, confirmed directly by
// instrumenting a real click) — so a click that lands on a canvas NODE (not
// the empty pane, which doesn't intercept it) never reached that listener,
// and the menu never closed. `click` itself is NOT intercepted this way —
// confirmed directly, a capture-phase `click` listener on `document` sees a
// node click regardless — so switching the dismiss listener from
// `mousedown` to `click` (capture phase, for deterministic ordering ahead of
// whatever the click's own target does) already fixes this on its own.
//
// One shared hook instead of eight near-identical per-component listeners
// (Hanrim's review) — every Tier-1 menu (Templates, Insert module, File,
// Data, Settings, Help, the ⋯ overflow) and Share's result panel call this
// the same way. Escape handling is deliberately NOT part of this hook: each
// caller's own Escape logic already has hard-won nested-menu-ordering fixes
// (see OverflowMenu.tsx / SettingsMenu.tsx) that this must not disturb.
//
// A DIFFERENT edge case the capture-phase switch surfaced
// (confirm-dialog.spec.ts "double-clicking Confirm runs the effect once"):
// a rapid double-click aimed at a button that itself opens this surface (e.g.
// Share's Confirm → panel) can have its SECOND click land on whatever is now
// underneath that button once the first click's transition unmounts it — the
// canvas pane, here. Confirmed directly: that second pointerdown's bubble-
// phase 'mousedown' is swallowed by React Flow's own double-click-to-zoom
// handling (so the OLD bubble-`mousedown` listener never saw it), but a
// capture-phase listener sees it regardless, and without a guard would
// dismiss the surface an instant after it opened, from the SAME physical
// gesture that opened it.
//
// Two timing-based guards were tried and rejected before landing on the fix
// below — both failed for the same underlying reason: nothing about MY code
// can know how far apart a real double-click's two clicks will land. A
// blanket "ignore for 300ms after open" fixed the double-click but broke 12
// tests where a genuinely separate, fast dismissal (open menu → click a
// node) also happens within 300ms. A later refinement — defer arming for
// two animation frames, reasoning that Playwright's own actionability waits
// take longer than that — fixed both of the above, but a review (Lumi,
// 2026-09-16) correctly pointed out the double-click side was never actually
// guaranteed: a real double-click, or the OS's own configured double-click
// interval, can be 100-250ms+ between clicks — many frames — so a slower
// (but still perfectly normal) double-click on Confirm would sail past a
// 2-frame guard and reproduce the exact bug. Confirmed directly: reproduced
// with two separately-dispatched clicks 150ms apart.
//
// The actual fix listens on `click`, not `pointerdown`/`mousedown`, and
// checks `event.detail` — the browser's OWN native click-count for the
// current gesture (2+ for the second click of a double/triple-click, reset
// to 1 by the OS the moment the click is too far away in time or space to
// count as a continuation). This is the correct authority for "is this the
// same physical gesture as the previous click" — it's computed by the OS's
// input layer from the actual elapsed time and cursor position, which is
// exactly the judgment call a fixed frame or millisecond count on our side
// can't make correctly. Confirmed directly, including the exact failure
// scenario: a real double-click 150ms apart, where the second click's
// target differs from the first (button unmounted, canvas pane revealed
// underneath) still reports `detail: 2` on that second click — detail
// tracks the GESTURE, not the target, so the DOM mutation in between doesn't
// break it. `click` (unlike `mousedown`) is also not intercepted by React
// Flow's own drag-vs-click disambiguation for a node click — confirmed
// directly — so this switch loses nothing from the original node-click fix.
// One behavioral note: `click` doesn't fire for a genuine drag gesture
// (mousedown + move + mouseup elsewhere), so starting to drag a node no
// longer dismisses an open menu the instant the drag begins the way a raw
// pointerdown did; nothing in this codebase's tests specifies that as
// required behavior.
export function useOutsideDismiss(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  // A ref, not a dependency, so callers don't need to memoize `onDismiss` —
  // the effect below only re-subscribes when `active` actually changes. Kept
  // current via its OWN effect (not a bare assignment during render) so this
  // hook has no render-phase side effect of its own.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    if (!active) return
    // `composedPath()`, not `ref.current.contains(event.target)`: the path
    // the event actually travelled, so a target that's been removed from the
    // DOM by the time this runs (or one reached through a future shadow-DOM /
    // portal boundary) is still found correctly.
    const isInside = (e: Event) => {
      const el = ref.current
      return !!el && e.composedPath().includes(el)
    }
    const onClick = (e: MouseEvent) => {
      // the trailing click(s) of a multi-click gesture on roughly the same
      // spot — not a new, separate interaction, regardless of where it
      // happens to land once a preceding click has changed the DOM
      if (e.detail >= 2) return
      if (!isInside(e)) onDismissRef.current()
    }
    const onWheel = (e: WheelEvent) => {
      if (!isInside(e)) onDismissRef.current()
    }
    const onResize = () => onDismissRef.current()

    document.addEventListener('click', onClick, true)
    document.addEventListener('wheel', onWheel, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('resize', onResize)
    }
  }, [active, ref])
}
