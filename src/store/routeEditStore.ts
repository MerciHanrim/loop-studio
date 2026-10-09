// issue #344 step 3 (docs/diagram-layout.md §DL4, docs/edge-routing.md §ER16) —
// the route-editing session state: whether "Add bend" is armed for a
// connection, which bend point has the keyboard, and the last notice of the
// armed tool. UI state only: nothing here reaches a document, the history or a
// simulation.

import { create } from 'zustand'

/** the notice the armed tool shows when Enter finds no segment for a bend */
export type RouteEditNotice = 'canvas.route.noBendRoom'

type RouteEditState = {
  /** the connection "Add bend" is armed for: the next click on its line (or
   *  Enter) inserts one bend point */
  addBendFor: string | null
  /** the bend point that has the focus ring and the arrow keys */
  bend: { edgeId: string; index: number } | null
  /** shown under the Add bend hint until the tool is armed or disarmed again */
  notice: RouteEditNotice | null
  armAddBend: (edgeId: string | null) => void
  selectBend: (bend: { edgeId: string; index: number } | null) => void
  setNotice: (notice: RouteEditNotice | null) => void
  /** all cleared (a selection change, the lock, another document) */
  clear: () => void
}

export const useRouteEditStore = create<RouteEditState>((set, get) => ({
  addBendFor: null,
  bend: null,
  notice: null,
  armAddBend: (edgeId) => {
    if (get().addBendFor !== edgeId || get().notice !== null) set({ addBendFor: edgeId, notice: null })
  },
  selectBend: (bend) => {
    const cur = get().bend
    if (cur?.edgeId === bend?.edgeId && cur?.index === bend?.index) return
    set({ bend })
  },
  setNotice: (notice) => {
    if (get().notice !== notice) set({ notice })
  },
  clear: () => {
    if (get().addBendFor !== null || get().bend !== null || get().notice !== null) set({ addBendFor: null, bend: null, notice: null })
  },
}))
