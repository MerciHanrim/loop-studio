import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

// Regression, 2026-09-16: every toolbar menu closed itself on a bubble-phase
// `window` 'mousedown' listener. React Flow's own node-drag setup calls
// `event.stopImmediatePropagation()` on a node's `pointerdown`/`mousedown`
// (its own d3-drag-style click-vs-drag disambiguation, confirmed directly by
// instrumenting a real click) — so a click that lands on a canvas NODE (not
// the empty pane, which doesn't intercept it) never reached that BUBBLE-
// phase listener, and the menu never closed. A CAPTURE-phase `mousedown`
// listener on `document` runs on the way down to the node, before that
// interception happens — confirmed directly, it sees a node's mousedown
// regardless.
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
// canvas pane, here. Without a guard, the capture-phase listener would
// dismiss the surface an instant after it opened, from the SAME physical
// gesture that opened it.
//
// Three approaches were tried and rejected before landing on the fix below:
// (1) a blanket "ignore for 300ms after open" guard fixed the double-click
// but broke 12 tests where a genuinely separate, fast dismissal (open menu
// → click a node) also happens within 300ms; (2) deferring arming for two
// animation frames (reasoning Playwright's own actionability waits take
// longer than that) fixed both of the above, but a review (Lumi, 2026-09-16)
// correctly pointed out the double-click side was never actually
// guaranteed — a real double-click, or the OS's own configured double-click
// interval, can be 100-250ms+ apart, many frames past a 2-frame guard;
// confirmed directly, reproduced with two clicks 150ms apart; (3) switching
// the listener to `click` instead of `mousedown`/`pointerdown` (still gated
// by `event.detail`, below) fixed THAT, but broke something the original bug
// report explicitly named — a canvas PAN drag (mousedown, move, mouseup
// elsewhere) never fires a `click` event at all, so panning the canvas no
// longer closed an open menu (another review catch, Lumi/Hanrim,
// 2026-09-16, confirmed directly by reproducing it).
//
// The actual fix: listen on `mousedown` (capture phase, so it isn't affected
// by the same-bug interception above) and check `event.detail` — the
// browser's OWN native click-count for the current gesture (2+ for the
// second mousedown of a double/triple-click, reset to 1 by the OS the
// moment it's too far away in time or space to count as a continuation).
// This is the correct authority for "is this the trailing mousedown of the
// SAME physical click gesture" — computed by the OS's input layer from
// actual elapsed time and cursor position, which is exactly the judgment
// call a fixed frame or millisecond count on our side can't make correctly,
// and unlike `click`, `mousedown` fires immediately at the START of a
// gesture — including a pan-drag's very first mousedown — not only for a
// stationary down+up. Confirmed directly, using an explicit `clickCount` via
// CDP (`Input.dispatchMouseEvent`) rather than Playwright's `.dblclick()`,
// so timing is under real, independent control rather than however fast
// Playwright's own dblclick happens to be: (a) `mousedown.detail` is `2` on
// the second mousedown of a real double-click 150ms apart, even though its
// target differs from the first (button unmounted, canvas pane revealed
// underneath) — detail tracks the GESTURE, not the target; (b) a plain
// mousedown on a canvas NODE reports `detail: 1` and is NOT intercepted the
// way bubble-phase mousedown is; (c) a pan-drag's initiating mousedown on
// the empty pane also reports `detail: 1` and fires immediately, so panning
// dismisses the menu the instant it starts, same as before this whole
// investigation began.
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
    const onMouseDown = (e: MouseEvent) => {
      // the trailing mousedown(s) of a multi-click gesture on roughly the
      // same spot — not a new, separate interaction, regardless of where it
      // happens to land once a preceding click has changed the DOM
      if (e.detail >= 2) return
      if (!isInside(e)) onDismissRef.current()
    }
    const onWheel = (e: WheelEvent) => {
      if (!isInside(e)) onDismissRef.current()
    }
    const onResize = () => onDismissRef.current()

    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('wheel', onWheel, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('resize', onResize)
    }
  }, [active, ref])
}
