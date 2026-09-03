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
