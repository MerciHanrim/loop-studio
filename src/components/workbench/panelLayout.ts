import { useSyncExternalStore } from 'react'
import { create } from 'zustand'

// The workbench's side panels at the window's width (Lumi, 2026-10-20;
// docs/workbench.md §WB1a). Three bands above the phone layout:
//
//   wide    ≥ 1280 px    the list and the properties both open; each folds
//   medium  900–1279 px  the list folded, the properties open
//   narrow  below 900 px both folded; each opens as an OVERLAY over the
//                        canvas, one at a time
//
// A user's open / fold is kept for the band it was made in: crossing into
// another band shows that band's defaults again (a choice made at 1440 px is
// no guide at 820 px). Selection never opens a panel — an open properties
// panel only shows the new selection — and neither the band nor a fold moves
// or zooms the canvas: the panes change size, the viewport stays.
// Screen state only, never stored.

export type Band = 'wide' | 'medium' | 'narrow'
export type Side = 'left' | 'right'

export const WIDE_MIN = 1280
export const MEDIUM_MIN = 900

const query = (q: string) => ({
  subscribe(onChange: () => void) {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mql = window.matchMedia(q)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  },
  get() {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches
  },
})
const wide = query(`(min-width: ${WIDE_MIN}px)`)
const medium = query(`(min-width: ${MEDIUM_MIN}px)`)

export function useBand(): Band {
  const w = useSyncExternalStore(wide.subscribe, wide.get, () => true)
  const m = useSyncExternalStore(medium.subscribe, medium.get, () => true)
  return w ? 'wide' : m ? 'medium' : 'narrow'
}

const DEFAULTS: Record<Band, Record<Side, boolean>> = {
  wide: { left: true, right: true },
  medium: { left: false, right: true },
  narrow: { left: false, right: false },
}

type Choice = { band: Band; open: boolean } | null
const usePanelChoice = create<{ left: Choice; right: Choice; set: (side: Side, c: Choice) => void }>((set) => ({
  left: null,
  right: null,
  set: (side, c) => set({ [side]: c } as { left: Choice } | { right: Choice }),
}))

const openOf = (c: Choice, band: Band, side: Side): boolean => (c && c.band === band ? c.open : DEFAULTS[band][side])

/** the panels' state at the current band, and the toggle a user presses */
export function useWorkbenchPanels(): { band: Band; overlay: boolean; leftOpen: boolean; rightOpen: boolean; toggle: (side: Side) => void; close: (side: Side) => void } {
  const band = useBand()
  const left = usePanelChoice((s) => s.left)
  const right = usePanelChoice((s) => s.right)
  const set = usePanelChoice((s) => s.set)
  const leftOpen = openOf(left, band, 'left')
  const rightOpen = openOf(right, band, 'right')
  const close = (side: Side) => set(side, { band, open: false })
  const toggle = (side: Side) => {
    const now = side === 'left' ? leftOpen : rightOpen
    set(side, { band, open: !now })
    // narrow: one overlay at a time
    if (band === 'narrow' && !now) set(side === 'left' ? 'right' : 'left', { band, open: false })
  }
  return { band, overlay: band === 'narrow', leftOpen, rightOpen, toggle, close }
}

/** the ids the status bar's toggles name (`aria-controls`) and the panels carry */
export const PANEL_ID: Record<Side, string> = { left: 'wb-panel-left', right: 'wb-panel-right' }
export const TOGGLE_ID: Record<Side, string> = { left: 'wb-toggle-left', right: 'wb-toggle-right' }

/** an overlay panel just opened from its toggle: the focus goes into it */
export function focusInto(side: Side): void {
  requestAnimationFrame(() => {
    const p = document.getElementById(PANEL_ID[side])
    const first = p?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ;(first ?? p)?.focus()
  })
}

/** Escape inside an overlay panel: it closes and the focus goes back to its toggle */
export function onOverlayKey(e: { key: string; preventDefault: () => void; stopPropagation: () => void; defaultPrevented: boolean }, side: Side, close: (side: Side) => void): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  e.preventDefault()
  e.stopPropagation()
  close(side)
  requestAnimationFrame(() => document.getElementById(TOGGLE_ID[side])?.focus())
}
