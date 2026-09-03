import { useMemo } from 'react'
import { useSimStore } from '../../store/simStore'
import { useUiStore } from '../../store/uiStore'
import { activityOpacityById } from './frameGeom'

// docs/large-graph-readability.md §LGR6-cues — the opt-in Activity overlay.
// Returns id → tint opacity for nodes AND edges, or an EMPTY map when the
// overlay toggle is off (so the Canvas memo does no per-element work). The
// history (`simStore.activitySteps`) is emptied on sim Reset and graph reload,
// held on pause / end — this hook just reads it.

const EMPTY = new Map<string, number>()

export function useActivityTint(): Map<string, number> {
  const on = useUiStore((s) => s.activityOverlay)
  const steps = useSimStore((s) => s.activitySteps)
  return useMemo(() => {
    if (!on || steps.length === 0) return EMPTY
    return activityOpacityById(steps.map((ids) => new Set(ids)))
  }, [on, steps])
}

// One element's tint opacity (0 when the overlay is off or it was not
// `effective` in the window). `LoopEdge` and `NodeFrame` read this themselves
// rather than take a Canvas-applied class / style:
//   • React Flow v12 hands an EDGE object's `style` to the edge component, not
//     to `.react-flow__edge`, and `LoopEdge` renders its own `<BaseEdge>` — so
//     `--lgr-activity` must be set on the path from inside `LoopEdge`.
//   • a `.react-flow__node` wrapper is auto-width (fills the pane), so a
//     rectangular `::after` on it overflows the visible silhouette — the node
//     tint has to be an SVG `<path>` on the node's shape, drawn by `NodeFrame`.
export function useEdgeActivityOpacity(id: string): number {
  return useActivityTint().get(id) ?? 0
}

export function useNodeActivityOpacity(id: string): number {
  return useActivityTint().get(id) ?? 0
}
