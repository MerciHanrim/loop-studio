import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

// Regression, 2026-09-16: every toolbar menu closed itself on a bubble-phase
// `window` 'mousedown' listener. React Flow's own node-drag setup calls
// `event.stopImmediatePropagation()` on a node's `pointerdown`/`mousedown`
// (its own d3-drag-style click-vs-drag disambiguation, confirmed directly by
// instrumenting a real click) — so a click that lands on a canvas NODE (not
// the empty pane, which doesn't intercept it) never reached that listener,
// and the menu never closed. A capture-phase listener on `document` runs on
// the way DOWN to the node, before that node-level bubble-phase interception
// can happen, so it isn't affected by anything a descendant does later.
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
// capture-phase 'pointerdown' — needed for the node-click fix above — sees it
// regardless, and without a guard would dismiss the surface an instant after
// it opened, from the SAME physical gesture that opened it.
//
// A blanket "ignore pointerdown for N ms after open" guard was tried and
// rejected: 300ms fixed the double-click case but also swallowed genuinely
// separate, fast dismissal clicks in our own e2e suite (open menu → click a
// node), breaking 12 tests — Playwright's own actions are fast enough to
// land inside almost any fixed millisecond window that's wide enough to
// cover a native double-click gap.
//
// The actual, precise distinction: the second pointerdown of a rapid
// double-click arrives while the FIRST click's synchronous React commit +
// scheduled passive-effect (this hook's own `addEventListener` call) are
// still resolving — i.e. before the browser has painted the new surface even
// once. A deliberate, separate follow-up click — even an automated one —
// only ever lands after that surface is observably present, which requires
// at least one paint to have already happened (Playwright's own
// actionability wait for a *new* action re-checks the target's geometry
// across consecutive animation frames before acting, so it never lands
// inside a single unpainted frame). So: defer arming `pointerdown`
// specifically until two animation frames after `active` turns true —
// wheel/resize are never part of a double-click and stay armed immediately
// (gating them the same way broke the plain "open then wheel" case, since
// `dispatchEvent`-fired wheels have no actionability wait of their own).
// Two frames is enough margin to let the tail of the opening gesture finish
// arriving (confirmed empirically: the double-click's second pointerdown is
// ~2ms after the first, far under one frame) while still catching any real
// subsequent pointerdown, human or automated.
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
    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e)) onDismissRef.current()
    }
    const onWheel = (e: WheelEvent) => {
      if (!isInside(e)) onDismissRef.current()
    }
    const onResize = () => onDismissRef.current()

    // Only `pointerdown` is part of the double-click gesture this defers —
    // wheel/resize are never part of a native double-click and must arm
    // immediately (confirmed: gating them the same way broke the plain
    // "open then wheel" dismiss case, since a wheel dispatched right after
    // open has no comparable actionability wait to guarantee a frame has
    // passed).
    let attached = false
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        attached = true
        document.addEventListener('pointerdown', onPointerDown, true)
      })
    })
    document.addEventListener('wheel', onWheel, true)
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      if (attached) {
        document.removeEventListener('pointerdown', onPointerDown, true)
      }
      document.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('resize', onResize)
    }
  }, [active, ref])
}
