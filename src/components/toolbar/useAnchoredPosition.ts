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
