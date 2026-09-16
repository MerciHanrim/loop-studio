import { useLayoutEffect, useState, type RefObject } from 'react'

export type AnchoredPos = { top: number; left: number }

const GAP = 6
const MARGIN = 8

/** Shared placement math: below `anchor`, aligned to its left edge (`'start'`)
 *  or right edge (`'end'`); horizontally clamped inside the viewport; flipped
 *  above the anchor (or vertically clamped) when there isn't room below. Used
 *  by both hooks below so the two call sites (a stable anchor ref vs. a
 *  chip that changes on every hover) share one clamp/flip contract. */
export function computeBelowAnchorPos(
  anchor: DOMRect,
  panel: DOMRect,
  align: 'start' | 'end',
): AnchoredPos {
  let left = align === 'end' ? anchor.right - panel.width : anchor.left
  left = Math.min(left, window.innerWidth - MARGIN - panel.width)
  left = Math.max(left, MARGIN)

  let top = anchor.bottom + GAP
  const fitsBelow = top + panel.height <= window.innerHeight - MARGIN
  if (!fitsBelow) {
    const above = anchor.top - GAP - panel.height
    top =
      above >= MARGIN ? above : Math.max(MARGIN, Math.min(top, window.innerHeight - MARGIN - panel.height))
  }
  return { top, left }
}

/** Positions a `position: fixed` panel relative to `anchorRef` — default
 *  below the anchor, right-aligned to it; horizontally clamped inside the
 *  viewport; flipped above the anchor (or vertically clamped) when there
 *  isn't room below. Recomputed on open and on `window resize` while open.
 *  Returns `null` until the first measurement lands, so the caller can keep
 *  the panel invisible for that one frame instead of flashing at a corner. */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
): AnchoredPos | null {
  const [pos, setPos] = useState<AnchoredPos | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const recompute = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!anchor || !panel) return
      setPos(computeBelowAnchorPos(anchor, panel, 'end'))
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [open, anchorRef, panelRef])

  return pos
}

/** Same below-anchor placement, but for an anchor that itself changes
 *  identity (the palette's currently-hovered/focused chip) rather than one
 *  stable ref. Takes the whole `chipRefs` map plus which key is active,
 *  and looks up `chipRefs.current[activeKey]` INSIDE the effect (not during
 *  render — reading a ref's `.current` while rendering is unsafe per React's
 *  own rules, since render can run without committing). `activeKey` is the
 *  dependency that triggers recompute, so switching from one chip's tooltip
 *  straight to another's (no `null` in between) repositions correctly.
 *  Left-aligned to the chip (`'start'`) to match the palette's reading
 *  order. Used with a portaled panel (`createPortal` to `document.body`)
 *  specifically so the panel is never a DOM descendant of
 *  `.toolbar__palette` — that container needs `overflow-x: auto` for its
 *  own 721-819px horizontal-scroll contract, which (per the CSS spec)
 *  computes `overflow-y` to `auto` too, clipping any absolutely-positioned
 *  descendant that pops out below it regardless of its own
 *  `display`/`visibility` (confirmed: Playwright's `toBeVisible()` doesn't
 *  catch this, since it only checks the element's own computed style, not
 *  ancestor clipping — `toBeInViewport()` does).
 *
 *  Review follow-up (2026-09-16, Lumi): that same horizontal-scroll
 *  contract means the active chip's on-screen position can also change
 *  WITHOUT `activeKey` or the window changing at all — scrolling
 *  `.toolbar__palette` itself (wheel, a scrollbar drag, or keyboard) while
 *  its tooltip is showing. `document.addEventListener('scroll', ..., true)`
 *  (capture phase) catches this: the native `scroll` event doesn't bubble,
 *  but it DOES propagate through the capture phase on its way down to
 *  whichever element actually scrolled, so a single capture-phase listener
 *  on `document` sees a scroll on `.toolbar__palette` (or any other
 *  scrollable ancestor/descendant) the same way it would see one on
 *  `window` — and unlike listening for `wheel` specifically, this also
 *  covers a scrollbar drag or a keyboard-driven scroll, neither of which
 *  dispatches a `wheel` event at all. */
export function usePaletteTipPosition<K extends string>(
  activeKey: K | null,
  chipRefs: RefObject<Partial<Record<K, HTMLElement>>>,
  panelRef: RefObject<HTMLElement | null>,
): AnchoredPos | null {
  const [pos, setPos] = useState<AnchoredPos | null>(null)

  useLayoutEffect(() => {
    if (!activeKey) {
      setPos(null)
      return
    }
    const recompute = () => {
      const anchorEl = chipRefs.current[activeKey]
      const panel = panelRef.current?.getBoundingClientRect()
      if (!anchorEl || !panel) return
      setPos(computeBelowAnchorPos(anchorEl.getBoundingClientRect(), panel, 'start'))
    }
    recompute()
    window.addEventListener('resize', recompute)
    document.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      document.removeEventListener('scroll', recompute, true)
    }
  }, [activeKey, chipRefs, panelRef])

  return pos
}

/** Positions a `position: fixed` panel as a SIDE flyout next to `anchorRef` —
 *  default to its LEFT (Settings' own Theme/Language rows sit toward the
 *  right end of the toolbar, so opening further right risks running off
 *  screen while the left usually has room), flipped to the right when there
 *  isn't room on the left; vertically aligned to the anchor's own top, then
 *  clamped inside the viewport. Used for Theme's and Language's row-variant
 *  submenus (Hanrim's review, 2026-09-15) so neither one visually covers the
 *  other's row — a below-the-row floating popover, the earlier approach,
 *  always overlapped whichever row came next since Settings' popover is a
 *  tight, gapless stack of just those two rows. Same recompute-on-resize and
 *  "null until first measurement" contract as `useAnchoredPosition`. */
export function useSideFlyoutPosition(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
): AnchoredPos | null {
  const [pos, setPos] = useState<AnchoredPos | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const recompute = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!anchor || !panel) return

      let left = anchor.left - GAP - panel.width
      const fitsLeft = left >= MARGIN
      if (!fitsLeft) {
        const right = anchor.right + GAP
        left =
          right + panel.width <= window.innerWidth - MARGIN
            ? right
            : Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - panel.width))
      }

      const top = Math.max(MARGIN, Math.min(anchor.top, window.innerHeight - MARGIN - panel.height))
      setPos({ top, left })
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [open, anchorRef, panelRef])

  return pos
}
