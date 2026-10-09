// docs/diagram-layout.md §DL3 (issue #344) — snapping a pointer drag.
//
// React Flow's own `snapToGrid` stays off: it snaps every dragged node on its
// own, which would change a selection's relative positions, and it knows
// nothing of the port row. Instead the canvas tells this module which node the
// user grabbed and whether Alt is held, and the graph store moves every
// dragged node by the ONE correction that puts the grabbed node's left edge
// and port row on the grid. Alt held = a free move for that drag (releasing it
// mid-drag snaps again). No React, no store: plain module state the canvas
// writes and `graphStore.onNodesChange` reads.

import type { NodeChange } from '@xyflow/react'
import type { LoopNode } from '../types'
import { snapNodePosition } from './grid'

let anchorId: string | null = null
let free = false

export const dragSnap = {
  /** a drag starts: the grabbed node (null = the first moved one) and Alt */
  begin(id: string | null, alt: boolean): void {
    anchorId = id
    free = alt
  },
  /** every pointer move reports Alt again */
  update(alt: boolean): void {
    free = alt
  },
  end(): void {
    anchorId = null
    free = false
  },
  get free(): boolean {
    return free
  },
}

/** the drag's position changes moved by the grabbed node's grid correction;
 *  unchanged when free-moving or when no change carries a position */
export function snapDragChanges(changes: NodeChange<LoopNode>[]): NodeChange<LoopNode>[] {
  if (free) return changes
  const moves = changes.filter((c): c is Extract<NodeChange<LoopNode>, { type: 'position' }> => c.type === 'position' && c.position != null)
  if (moves.length === 0) return changes
  const anchor = moves.find((c) => c.id === anchorId) ?? moves[0]
  const p = anchor.position!
  const s = snapNodePosition(p)
  const dx = s.x - p.x
  const dy = s.y - p.y
  if (dx === 0 && dy === 0) return changes
  return changes.map((c) =>
    c.type === 'position' && c.position != null ? { ...c, position: { x: c.position.x + dx, y: c.position.y + dy } } : c,
  )
}
