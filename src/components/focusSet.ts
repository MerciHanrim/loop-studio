import { useMemo } from 'react'
import { useGraphStore } from '../store/graphStore'
import { useUiStore } from '../store/uiStore'
import type { LoopEdge } from '../model/types'

// docs/large-graph-readability.md §LGR2.2 — the focus set for a selected node is
// the node itself + every node one DRAWN-EDGE hop away (either direction) + the
// joining edges. Fixed at **1 hop** for v1 (LGR-D2). No expression `depends-on`
// traversal — the walk is over the drawn edge graph only, so this stays a pure
// view-state function with no expression parsing (LGR-D3).

export type FocusSet = {
  /** node ids that render at full strength (the anchor + its 1-hop neighbours) */
  readonly nodes: ReadonlySet<string>
  /** edge ids that render at full strength (incident to the anchor) */
  readonly edges: ReadonlySet<string>
} | null

/** Pure. `null` when there is no anchor (⇒ nothing is de-emphasised). */
export function computeFocusSet(
  anchorId: string | null,
  edges: readonly Pick<LoopEdge, 'id' | 'source' | 'target'>[],
): FocusSet {
  if (!anchorId) return null
  const nodes = new Set<string>([anchorId])
  const edgeIds = new Set<string>()
  for (const e of edges) {
    if (e.source === anchorId) {
      nodes.add(e.target)
      edgeIds.add(e.id)
    } else if (e.target === anchorId) {
      nodes.add(e.source)
      edgeIds.add(e.id)
    }
  }
  return { nodes, edges: edgeIds }
}

/**
 * The live focus set: `null` unless Focus mode is on AND a node is selected.
 * Recomputes only when the toggle, the selection, or the edge list changes —
 * never on pan / zoom / hover / a sim step (LGR-INV-7).
 */
export function useFocusSet(): FocusSet {
  const focusMode = useUiStore((s) => s.focusMode)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const edges = useGraphStore((s) => s.edges)
  return useMemo(
    () => (focusMode ? computeFocusSet(selectedNodeId, edges) : null),
    [focusMode, selectedNodeId, edges],
  )
}
