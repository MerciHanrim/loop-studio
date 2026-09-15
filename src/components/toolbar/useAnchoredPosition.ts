import { useLayoutEffect, useState, type RefObject } from 'react'

export type AnchoredPos = { top: number; left: number }

const GAP = 6
const MARGIN = 8

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

      let left = anchor.right - panel.width
      left = Math.min(left, window.innerWidth - MARGIN - panel.width)
      left = Math.max(left, MARGIN)

      let top = anchor.bottom + GAP
      const fitsBelow = top + panel.height <= window.innerHeight - MARGIN
      if (!fitsBelow) {
        const above = anchor.top - GAP - panel.height
        top =
          above >= MARGIN
            ? above
            : Math.max(MARGIN, Math.min(top, window.innerHeight - MARGIN - panel.height))
      }
      setPos({ top, left })
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [open, anchorRef, panelRef])

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
