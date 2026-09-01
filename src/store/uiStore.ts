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
}))

export const selectOverlay = (s: UiState): Overlay => s.overlay
