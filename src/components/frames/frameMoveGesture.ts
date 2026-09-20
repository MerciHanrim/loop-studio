import type { LoopEdge, LoopNode } from '../../model/types'
import type { Frame, FrameRect } from '../../store/frameStore'
import { nodeRect, rectContains } from './frameGeom'

// docs/large-graph-readability.md §LGR6.5 / LGR-D9 (2026-09-20) — a frame drag
// CARRIES its contents. Pure geometry, no store access, no React:
//
//   • membership is DERIVED at the moment the drag starts and never stored —
//     the wire shape stays `{ id, label, rect, color? }` (SEMANTICS-R5.md
//     R5-D3). "Inside" = the node's measured box is FULLY inside the frame
//     rect, the same rule as the creation guard (`frameIsCreatable`); a node
//     straddling the border is not carried (D1);
//   • a MANUAL frame fully inside the dragged rect rides along, and so do its
//     nodes (they are inside the outer rect too) (D2); a frame that merely
//     overlaps does not, and a node inside two frames follows whichever one
//     is dragged (D3);
//   • the manual `waypoints` of an edge whose BOTH endpoints are carried
//     translate by the same Δ; an edge with one end outside is left to the
//     router (D7);
//   • `frameOnly` (Alt held at pointer-down, frozen for the gesture) carries
//     nothing — the dragged rect alone moves (D5);
//   • the caller applies `origin + absolute Δ` on every move, never an
//     accumulated delta, so a paused / jittery drag cannot drift.

export type Pt = { x: number; y: number }

export type MoveTargets = {
  /** manual frames fully inside the rect, never the dragged frame itself; deduped, input order */
  frameIds: string[]
  /** nodes whose measured box is fully inside the rect; deduped, input order */
  nodeIds: string[]
  /** edges with manual waypoints whose source AND target are both in `nodeIds` */
  edgeIds: string[]
}

export function moveTargets(
  rect: FrameRect,
  selfId: string,
  frames: readonly Frame[],
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
): MoveTargets {
  const nodeSet = new Set<string>()
  for (const n of nodes) {
    if (nodeSet.has(n.id)) continue
    if (rectContains(rect, nodeRect(n as never))) nodeSet.add(n.id)
  }
  const frameSet = new Set<string>()
  for (const f of frames) {
    if (f.id === selfId || frameSet.has(f.id)) continue
    if (rectContains(rect, f.rect)) frameSet.add(f.id)
  }
  const edgeIds: string[] = []
  const seenEdge = new Set<string>()
  for (const e of edges) {
    if (seenEdge.has(e.id)) continue
    seenEdge.add(e.id)
    const wp = e.data?.waypoints
    if (!wp || wp.length === 0) continue
    if (nodeSet.has(e.source) && nodeSet.has(e.target)) edgeIds.push(e.id)
  }
  return { frameIds: [...frameSet], nodeIds: [...nodeSet], edgeIds }
}

/** the immutable pre-gesture geometry of everything the drag will move */
export type MoveOrigin = {
  frameId: string
  isAuto: boolean
  frameOnly: boolean
  /** the pointer's flow position at pointer-down */
  anchor: Pt
  /** the dragged frame's own rect at pointer-down */
  rect: FrameRect
  /** every MANUAL rect the drag moves (the dragged frame itself when manual, plus nested frames) */
  frameRects: Record<string, FrameRect>
  nodePositions: Record<string, Pt>
  edgeWaypoints: Record<string, Pt[]>
}

export function captureMoveOrigin(args: {
  frameId: string
  rect: FrameRect
  isAuto: boolean
  frameOnly: boolean
  anchor: Pt
  frames: readonly Frame[]
  nodes: readonly LoopNode[]
  edges: readonly LoopEdge[]
}): MoveOrigin {
  const { frameId, rect, isAuto, frameOnly, anchor, frames, nodes, edges } = args
  const frameRects: Record<string, FrameRect> = {}
  const nodePositions: Record<string, Pt> = {}
  const edgeWaypoints: Record<string, Pt[]> = {}
  if (!isAuto) frameRects[frameId] = { ...rect }
  if (!frameOnly) {
    const t = moveTargets(rect, frameId, frames, nodes, edges)
    for (const id of t.frameIds) {
      const f = frames.find((x) => x.id === id)
      if (f) frameRects[id] = { ...f.rect }
    }
    for (const id of t.nodeIds) {
      const n = nodes.find((x) => x.id === id)
      if (n) nodePositions[id] = { x: n.position.x, y: n.position.y }
    }
    for (const id of t.edgeIds) {
      const e = edges.find((x) => x.id === id)
      const wp = e?.data?.waypoints
      if (wp) edgeWaypoints[id] = wp.map((q) => ({ x: q.x, y: q.y }))
    }
  }
  return { frameId, isAuto, frameOnly, anchor: { ...anchor }, rect: { ...rect }, frameRects, nodePositions, edgeWaypoints }
}

export type MoveResult = {
  /** the dragged frame's rect at this Δ (for an auto frame's draft) */
  rect: FrameRect
  frameRects: Record<string, FrameRect>
  nodePositions: Record<string, Pt>
  edgeWaypoints: Record<string, Pt[]>
}

/** origin + absolute Δ — never accumulates; Δ = 0 reproduces the origin exactly */
export function applyMoveDelta(origin: MoveOrigin, dx: number, dy: number): MoveResult {
  const frameRects: Record<string, FrameRect> = {}
  for (const [id, r] of Object.entries(origin.frameRects)) frameRects[id] = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
  const nodePositions: Record<string, Pt> = {}
  for (const [id, p] of Object.entries(origin.nodePositions)) nodePositions[id] = { x: p.x + dx, y: p.y + dy }
  const edgeWaypoints: Record<string, Pt[]> = {}
  for (const [id, wps] of Object.entries(origin.edgeWaypoints)) edgeWaypoints[id] = wps.map((q) => ({ x: q.x + dx, y: q.y + dy }))
  return {
    rect: { x: origin.rect.x + dx, y: origin.rect.y + dy, w: origin.rect.w, h: origin.rect.h },
    frameRects,
    nodePositions,
    edgeWaypoints,
  }
}
