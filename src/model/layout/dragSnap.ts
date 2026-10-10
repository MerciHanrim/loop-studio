// docs/diagram-layout.md §DL3 (issue #344) — snapping a pointer drag.
//
// React Flow's own `snapToGrid` stays off: it snaps every dragged node on its
// own, which would change a selection's relative positions, and it knows
// nothing of the port row. Instead the canvas tells this module which node the
// user grabbed, which nodes move, the zoom and whether Alt is held, and the
// graph store moves every dragged node by the ONE correction the smart guides
// choose (§DL3.6: another node's port row, then its centre or edges, then the
// 16 px grid — for the grabbed node, or the selection's bounding box). Alt held
// = a free move for that drag (the guides are shown faint, nothing is pulled;
// releasing it mid-drag snaps again). Outside a pointer drag (an arrow-key
// move) the correction is the grid's, and the guides are only shown. No React,
// no store: plain module state the canvas writes and `graphStore.onNodesChange`
// reads.

import type { NodeChange } from '@xyflow/react'
import type { LoopNode } from '../types'
import { snapNodePosition } from './grid'
import { ALIGN_TOL_PX, BoxIndex, type GBox, type Guide, settledGuides, smartSnap } from './smartGuides'

let anchorId: string | null = null
let free = false
/** a pointer drag is under way (begin … end) */
let active = false
let index: BoxIndex | null = null
let tol = ALIGN_TOL_PX

/** the nodes with no resource port row */
const NO_PORT = new Set(['parameter', 'register'])
/** a node's box for the guides: its rendered size (the default before React
 *  Flow measures it) */
export function guideBox(n: LoopNode, at = n.position): GBox {
  return {
    id: n.id,
    x: at.x,
    y: at.y,
    w: n.measured?.width ?? n.width ?? 130,
    h: n.measured?.height ?? n.height ?? 56,
    port: !NO_PORT.has(String(n.type)),
  }
}

export const dragSnap = {
  /** a pointer drag starts: the grabbed node (null = the first moved one),
   *  the ids that move, every node of the graph, the zoom and Alt. The other
   *  nodes are indexed once, here. */
  begin(id: string | null, alt: boolean, moving?: readonly string[], nodes?: readonly LoopNode[], zoom = 1): void {
    anchorId = id
    free = alt
    active = true
    tol = ALIGN_TOL_PX / (zoom > 0 ? zoom : 1)
    const ids = new Set(moving ?? (id ? [id] : []))
    index = nodes ? new BoxIndex(nodes.filter((n) => !ids.has(n.id) && !n.hidden).map((n) => guideBox(n))) : null
  },
  /** every pointer move reports Alt again */
  update(alt: boolean): void {
    free = alt
  },
  end(): void {
    anchorId = null
    free = false
    active = false
    index = null
  },
  get free(): boolean {
    return free
  },
  get active(): boolean {
    return active
  },
}

/** §DL3.6 — after an arrow-key move (the canvas moves the nodes itself): the
 *  row and column the moved nodes now sit on, and every node aligned with them */
export function keyMoveGuides(nodes: readonly LoopNode[], movedIds: readonly string[], anchorId: string | null): Guide[] {
  const ids = new Set(movedIds)
  const moving = nodes.filter((n) => ids.has(n.id)).map((n) => guideBox(n))
  const idx = new BoxIndex(nodes.filter((n) => !ids.has(n.id) && !n.hidden).map((n) => guideBox(n)))
  return settledGuides(moving, anchorId, idx)
}

type PositionChange = Extract<NodeChange<LoopNode>, { type: 'position' }>

export type SnappedDrag = {
  changes: NodeChange<LoopNode>[]
  /** the guides to show now; null = leave them as they are */
  guides: Guide[] | null
  faint: boolean
}

/** the drag's position changes moved by the one correction; `nodes` are the
 *  graph's current nodes (their sizes). An arrow-key move (no pointer drag)
 *  lands on the grid and reports the row and column it now sits on. */
export function snapDrag(changes: NodeChange<LoopNode>[], nodes: readonly LoopNode[]): SnappedDrag {
  const moves = changes.filter((c): c is PositionChange => c.type === 'position' && c.position != null)
  if (moves.length === 0) return { changes, guides: null, faint: false }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const shift = (dx: number, dy: number) =>
    dx === 0 && dy === 0
      ? changes
      : changes.map((c) => (c.type === 'position' && c.position != null ? { ...c, position: { x: c.position.x + dx, y: c.position.y + dy } } : c))
  const boxes = moves.flatMap((c) => {
    const n = byId.get(c.id)
    return n ? [guideBox(n, c.position!)] : []
  })

  if (active && index) {
    const r = smartSnap(boxes, anchorId, index, tol, free)
    return { changes: shift(r.dx, r.dy), guides: r.guides, faint: free }
  }

  // no pointer drag: the grid only (an arrow-key move, §DL3.4), then the
  // guides of where it now sits
  const anchor = moves.find((c) => c.id === anchorId) ?? moves[0]
  const p = anchor.position!
  const s = snapNodePosition(p)
  const out = shift(s.x - p.x, s.y - p.y)
  const ids = new Set(moves.map((c) => c.id))
  const settled = boxes.map((b) => ({ ...b, x: b.x + s.x - p.x, y: b.y + s.y - p.y }))
  const idx = new BoxIndex(nodes.filter((n) => !ids.has(n.id) && !n.hidden).map((n) => guideBox(n)))
  return { changes: out, guides: settledGuides(settled, anchor.id, idx), faint: false }
}

