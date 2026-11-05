import { useMemo } from 'react'
import { create } from 'zustand'
import { NO_VIEW_UNITS, poolViews, type PoolViews, type ViewUnits } from '../model/viewUnits'
import { useGraphStore } from './graphStore'

// SEMANTICS-M4.md §M4-8 — the Timeline's view unit, one per kind. Session state
// and nothing else: this store is not read by the file, the Workspace file, the
// undo history, the autosave or the engine, and it imports nothing that writes
// them. A whole-graph swap drops it, the same way `filterStore` drops a filter.

type ViewUnitsState = {
  views: ViewUnits
  /** `''` is the base unit, which is simply no entry */
  setViewUnit: (kind: string, unit: string) => void
  /** §M4-9 — the Kinds panel's outflow reading, the same kind of state. `''` IS
   *  an entry here: no entry means the kind still starts from `time.display` */
  outflowViews: ViewUnits
  setOutflowView: (kind: string, reading: string) => void
}

export const useViewUnitsStore = create<ViewUnitsState>((set) => ({
  views: NO_VIEW_UNITS,
  setViewUnit: (kind, unit) =>
    set((s) => {
      const views = { ...s.views }
      if (unit === '') delete views[kind]
      else views[kind] = unit
      return { views }
    }),
  outflowViews: NO_VIEW_UNITS,
  setOutflowView: (kind, reading) => set((s) => ({ outflowViews: { ...s.outflowViews, [kind]: reading } })),
}))

let lastLoadRev = useGraphStore.getState().loadRev
useGraphStore.subscribe((g) => {
  if (g.loadRev === lastLoadRev) return
  lastLoadRev = g.loadRev
  useViewUnitsStore.setState({ views: NO_VIEW_UNITS, outflowViews: NO_VIEW_UNITS })
})

/** how every Pool of the document reads on the Timeline right now */
export function usePoolViews(): PoolViews {
  const nodes = useGraphStore((s) => s.nodes)
  const kinds = useGraphStore((s) => s.kinds)
  const views = useViewUnitsStore((s) => s.views)
  return useMemo(() => poolViews(nodes, kinds, views), [nodes, kinds, views])
}
