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
  | 'filter' // docs/large-graph-readability.md §LGR9 — the mobile Filters sub-sheet
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

  /**
   * docs/large-graph-readability.md §LGR3.2 / §LGR3.4 — the transient-filter
   * panel's open/closed state. A **global UI preference** (its own
   * `localStorage` key, like `focusMode`), default **closed**. The filter
   * *selections* are separate ephemeral state (`filterStore`), never persisted.
   */
  filterPanelOpen: boolean
  setFilterPanelOpen: (v: boolean) => void
  toggleFilterPanel: () => void

  /**
   * docs/large-graph-readability.md §LGR6-cues / LGR-D7 — the opt-in Activity
   * overlay's ON/OFF. A **global UI preference** (its own `localStorage` key,
   * like `focusMode`), **default off**. The accumulated tint itself lives in
   * `simStore.activitySteps` and is never persisted (§LGR3.4).
   */
  activityOverlay: boolean
  setActivityOverlay: (v: boolean) => void
  toggleActivityOverlay: () => void

  /**
   * docs/module-system.md §MS5 — the Inputs / Summary panels' collapsed state
   * (desktop right column, above the Inspector). Two **global UI preferences**
   * (own `localStorage` keys, like `filterPanelOpen`), default **open**. The
   * panels themselves are pure reads of the live `parameter` / `register`
   * nodes — no persistence, no file, no digest (§MS5.3).
   */
  inputsPanelOpen: boolean
  toggleInputsPanel: () => void
  summaryPanelOpen: boolean
  toggleSummaryPanel: () => void

  /** SPIKE (docs/dense-graph-pan.md) — desktop Pan mode: a left-drag anywhere
   *  (nodes / edges / frames included) pans; edit gestures are suppressed.
   *  Session-only `uiStore` state — never persisted. */
  panMode: boolean
  togglePanMode: () => void
}

const FOCUS_MODE_KEY = 'loop-studio:focus-mode'
const FILTER_PANEL_KEY = 'loop-studio:filter-panel'
const ACTIVITY_OVERLAY_KEY = 'loop-studio:activity-overlay'
const INPUTS_PANEL_KEY = 'loop-studio:inputs-panel'
const SUMMARY_PANEL_KEY = 'loop-studio:summary-panel'

function readBoolKey(key: string, dflt = false): boolean {
  try {
    const v = localStorage.getItem(key)
    return v == null ? dflt : v === '1'
  } catch {
    return dflt
  }
}

function writeBoolKey(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    /* storage unavailable — the toggle still works for the session */
  }
}

const readFocusMode = (): boolean => readBoolKey(FOCUS_MODE_KEY)
const writeFocusMode = (v: boolean): void => writeBoolKey(FOCUS_MODE_KEY, v)

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

  filterPanelOpen: readBoolKey(FILTER_PANEL_KEY),
  setFilterPanelOpen: (v) =>
    set((s) => {
      if (s.filterPanelOpen === v) return s
      writeBoolKey(FILTER_PANEL_KEY, v)
      return { filterPanelOpen: v }
    }),
  toggleFilterPanel: () =>
    set((s) => {
      const v = !s.filterPanelOpen
      writeBoolKey(FILTER_PANEL_KEY, v)
      return { filterPanelOpen: v }
    }),

  activityOverlay: readBoolKey(ACTIVITY_OVERLAY_KEY),
  setActivityOverlay: (v) =>
    set((s) => {
      if (s.activityOverlay === v) return s
      writeBoolKey(ACTIVITY_OVERLAY_KEY, v)
      return { activityOverlay: v }
    }),
  toggleActivityOverlay: () =>
    set((s) => {
      const v = !s.activityOverlay
      writeBoolKey(ACTIVITY_OVERLAY_KEY, v)
      return { activityOverlay: v }
    }),

  inputsPanelOpen: readBoolKey(INPUTS_PANEL_KEY, true),
  toggleInputsPanel: () =>
    set((s) => {
      const v = !s.inputsPanelOpen
      writeBoolKey(INPUTS_PANEL_KEY, v)
      return { inputsPanelOpen: v }
    }),
  summaryPanelOpen: readBoolKey(SUMMARY_PANEL_KEY, true),
  toggleSummaryPanel: () =>
    set((s) => {
      const v = !s.summaryPanelOpen
      writeBoolKey(SUMMARY_PANEL_KEY, v)
      return { summaryPanelOpen: v }
    }),

  // SPIKE (docs/dense-graph-pan.md D5) — desktop Pan mode. Sticky within a
  // session but NOT persisted (no localStorage, nothing serialized); every
  // fresh load starts in edit mode.
  panMode: false,
  togglePanMode: () => set((s) => ({ panMode: !s.panMode })),
}))

export const selectOverlay = (s: UiState): Overlay => s.overlay
