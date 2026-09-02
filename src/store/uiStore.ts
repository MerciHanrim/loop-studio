import { create } from 'zustand'
import { useMcStore } from './mcStore'

// docs/mobile.md §MV5 / §MV-D11 / §MV-D14 — the one open overlay in the mobile
// View/Run layout. Exactly one of these is visible at a time; opening any of
// them closes whichever other one was open AND dismisses the Monte-Carlo dialog
// (which keeps its own `dialogOpen` in mcStore). The reverse — the MC dialog
// opening closes the sheet — is wired by an effect in the mobile chrome.
//
// The PWA update bar is deliberately NOT in this set (§MV8a): a pending update
// is orthogonal to viewing a diagram.

export type Overlay =
  | 'none'
  | 'more'
  | 'timeline'
  | 'share'
  | 'templates'
  | 'export'
  | 'help' // docs/guided-tour.md §GT7 — the mobile Help sub-sheet
  | 'inspector' // Slice 3

type UiState = {
  overlay: Overlay
  openOverlay: (o: Exclude<Overlay, 'none'>) => void
  closeOverlay: (only?: Overlay) => void
  toggleOverlay: (o: Exclude<Overlay, 'none'>) => void

  /**
   * Canvas EDIT lock (docs/mobile.md §MV3a shape, on desktop). Locked ⇒ nodes
   * don't move / connect, nothing deletes, the Inspector is read-only — but
   * selection, the read-only Inspector, pan / zoom, the minimap, the Timeline
   * and the simulation all still work. UI-only: never the GraphDoc, the
   * `loop-revision/*` digest, undo, or `simulationRev`. Seeded from
   * `recommendedRunConfig.canvasLocked` on document / template load; the toolbar
   * / Controls lock toggle flips it.
   */
  canvasLocked: boolean
  setCanvasLocked: (v: boolean) => void
  toggleCanvasLocked: () => void

  /**
   * docs/large-graph-readability.md §LGR2 — the selection-driven focus view.
   * A **global UI preference** (persisted like theme / locale, one
   * `localStorage` key — never per graph), default **off**. When on, selecting
   * a node dims everything outside its 1-hop drawn-edge focus set (§LGR2.2).
   * UI-only: never the GraphDoc, the `loop-revision/*` digest, undo, the
   * viewport, `SimState`, or node z-order (§LGR8).
   */
  focusMode: boolean
  setFocusMode: (v: boolean) => void
  toggleFocusMode: () => void
}

const FOCUS_MODE_KEY = 'loop-studio:focus-mode'

function readFocusMode(): boolean {
  try {
    return localStorage.getItem(FOCUS_MODE_KEY) === '1'
  } catch {
    return false
  }
}

function writeFocusMode(v: boolean): void {
  try {
    localStorage.setItem(FOCUS_MODE_KEY, v ? '1' : '0')
  } catch {
    /* storage unavailable — the toggle still works for the session */
  }
}

function dismissMcDialog(): void {
  if (useMcStore.getState().dialogOpen) useMcStore.getState().closeDialog()
}

export const useUiStore = create<UiState>((set, get) => ({
  overlay: 'none',
  openOverlay: (o) => {
    dismissMcDialog()
    set({ overlay: o })
  },
  // closeOverlay() clears whatever is open; closeOverlay('share') only clears if
  // 'share' is the one showing (so a stale close can't stomp a newer overlay).
  closeOverlay: (only) =>
    set((s) => (only == null || s.overlay === only ? { overlay: 'none' } : s)),
  toggleOverlay: (o) => {
    if (get().overlay === o) {
      set({ overlay: 'none' })
      return
    }
    dismissMcDialog()
    set({ overlay: o })
  },

  canvasLocked: false,
  setCanvasLocked: (v) => set((s) => (s.canvasLocked === v ? s : { canvasLocked: v })),
  toggleCanvasLocked: () => set((s) => ({ canvasLocked: !s.canvasLocked })),

  focusMode: readFocusMode(),
  setFocusMode: (v) =>
    set((s) => {
      if (s.focusMode === v) return s
      writeFocusMode(v)
      return { focusMode: v }
    }),
  toggleFocusMode: () =>
    set((s) => {
      const v = !s.focusMode
      writeFocusMode(v)
      return { focusMode: v }
    }),
}))

export const selectOverlay = (s: UiState): Overlay => s.overlay
