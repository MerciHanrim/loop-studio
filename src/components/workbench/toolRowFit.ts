import { useLayoutEffect, type RefObject } from 'react'

// The workbench tool row (2026-10, step 5) at a width it cannot fill in full:
// it gives up words, never buttons. Each step hides more of the row's visible
// text and keeps every control, its accessible name and its tooltip
// (./workbench.css, `.wb-toolrow[data-fit]`):
//   1 — Add: the eight kinds as their symbols, the "Add" caption hidden
//   2 — also the "Connect" caption and the Edit lock's word
//   3 — also the connection kinds' words (their line samples remain)
// The step is the FIRST that fits, measured on the row itself: the words'
// widths depend on the language, so no fixed breakpoint can know them. Past
// step 3 the row scrolls, as it always could.
export const TOOL_ROW_FIT_STEPS = 3

/** every in-flow child inside the row's box — measured on the boxes, not
 *  with `scrollWidth`, which does not count an overflow on the START side,
 *  where a right-to-left row spills */
export function fitsRow(row: HTMLElement): boolean {
  const r = row.getBoundingClientRect()
  for (const el of row.children) {
    const c = el as HTMLElement
    if (c.offsetParent === null) continue // display: none
    if (getComputedStyle(c).position === 'absolute') continue // out of flow
    const b = c.getBoundingClientRect()
    if (b.width === 0) continue
    if (b.left < r.left - 0.5 || b.right > r.right + 0.5) return false
  }
  return true
}

export function fitToolRow(row: HTMLElement): number {
  for (let step = 0; step <= TOOL_ROW_FIT_STEPS; step++) {
    if (step === 0) delete row.dataset.fit
    else row.dataset.fit = String(step)
    if (fitsRow(row)) return step
  }
  return TOOL_ROW_FIT_STEPS
}

/** re-fit when the row's width changes, the language changes (`key`), and
 *  once the web fonts have loaded */
export function useToolRowFit(ref: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    fitToolRow(row)
    let width = row.clientWidth
    const ro = new ResizeObserver(() => {
      if (row.clientWidth === width) return
      width = row.clientWidth
      fitToolRow(row)
    })
    ro.observe(row)
    let live = true
    void document.fonts?.ready.then(() => {
      if (live) fitToolRow(row)
    })
    return () => {
      live = false
      ro.disconnect()
    }
  }, [ref, key])
}
