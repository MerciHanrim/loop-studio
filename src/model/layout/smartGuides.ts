// docs/diagram-layout.md §DL3.6 (issue #344, Lumi 2026-10-10) — smart guides:
// where a dragged node (or selection) will land, and what it lines up with.
//
// Pure and deterministic. The reference is the dragged geometry, never the
// pointer: the grabbed node's position (React Flow keeps the grab offset) and
// its port row, and for a selection its bounding box — so where a node was
// grabbed can never change where it lands. Per axis, the first of
//
//   1. the port row of another node (y only)
//   2. another node's centre, or its left / right (top / bottom) edge
//   3. the 16 px grid
//
// within `tol` (screen px over the zoom) wins; ties go to the smaller
// distance, then the node id. Alt = a free move: the guides are found the same
// way and drawn faint, and nothing is moved.
//
// Only the nodes near the dragged geometry are looked at (`BoxIndex`, grid
// buckets built once per drag), never every node per frame. Display and input
// only: no document field, digest or simulation result depends on it.

import { PORT_ROW, snapPortY, snapX } from './grid'

export type GBox = {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** the node has a resource port row (`PORT_ROW` below its top) */
  port: boolean
}

export type GuideKind = 'place' | 'port' | 'center' | 'edge'
export type Guide = {
  /** a vertical line at x = `at` (axis 'x') or a horizontal one at y = `at` */
  axis: 'x' | 'y'
  at: number
  /** the extent along the line */
  from: number
  to: number
  kind: GuideKind
  /** another node lies exactly on it (drawn darker); false: the placement
   *  line through the drop position, or a faint free-move hint */
  strong: boolean
}
export type SmartSnap = { dx: number; dy: number; guides: Guide[] }

/** the alignment pull, in SCREEN px (divided by the zoom for flow px) */
export const ALIGN_TOL_PX = 6
/** how far around the dragged geometry other nodes are considered, flow px */
export const GUIDE_REACH = 1200
const CELL = 256

/** grid buckets over the nodes that do not move during a gesture */
export class BoxIndex {
  private cells = new Map<string, GBox[]>()
  constructor(boxes: readonly GBox[]) {
    for (const b of boxes) {
      for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++)
        for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++) {
          const k = `${cx},${cy}`
          ;(this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(b)
        }
    }
  }
  /** every box meeting the rectangle, each once, in id order */
  query(x0: number, y0: number, x1: number, y1: number): GBox[] {
    const seen = new Map<string, GBox>()
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
        for (const b of this.cells.get(`${cx},${cy}`) ?? []) if (b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0) seen.set(b.id, b)
    return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
}

type Feature = { kind: Exclude<GuideKind, 'place'>; v: number; tag: string }
type Rect = { x: number; y: number; w: number; h: number }

const bboxOf = (bs: readonly GBox[]): Rect => {
  const x0 = Math.min(...bs.map((b) => b.x))
  const y0 = Math.min(...bs.map((b) => b.y))
  const x1 = Math.max(...bs.map((b) => b.x + b.w))
  const y1 = Math.max(...bs.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const yFeatures = (r: Rect, portY: number | null): Feature[] => [
  ...(portY != null ? [{ kind: 'port' as const, v: portY, tag: 'port' }] : []),
  { kind: 'center', v: r.y + r.h / 2, tag: 'cy' },
  { kind: 'edge', v: r.y, tag: 'top' },
  { kind: 'edge', v: r.y + r.h, tag: 'bottom' },
]
const xFeatures = (r: Rect): Feature[] => [
  { kind: 'center', v: r.x + r.w / 2, tag: 'cx' },
  { kind: 'edge', v: r.x, tag: 'left' },
  { kind: 'edge', v: r.x + r.w, tag: 'right' },
]
const PRI: Record<Feature['kind'], number> = { port: 0, center: 1, edge: 1 }

type Match = { pri: number; d: number; id: string; target: number; mine: Feature }

/** the best alignment on one axis within `tol`, or null */
function bestMatch(mine: Feature[], others: GBox[], axis: 'x' | 'y', tol: number): Match | null {
  let best: Match | null = null
  for (const o of others) {
    const theirs = axis === 'y' ? yFeatures(o, o.port ? o.y + PORT_ROW : null) : xFeatures(o)
    for (const m of mine) {
      for (const t of theirs) {
        if (t.tag !== m.tag) continue // port↔port, centre↔centre, top↔top …
        const d = t.v - m.v
        if (Math.abs(d) > tol) continue
        const cand: Match = { pri: PRI[m.kind], d, id: o.id, target: t.v, mine: m }
        if (!best || cand.pri < best.pri || (cand.pri === best.pri && (Math.abs(d) < Math.abs(best.d) || (Math.abs(d) === Math.abs(best.d) && o.id < best.id)))) best = cand
      }
    }
  }
  return best
}

/** the guides of one axis after the move: the placement line through the
 *  dragged geometry, and one line per feature of it (port row, centre, each
 *  edge) that now lies exactly on the same feature of other nodes, out to the
 *  farthest of them */
function axisGuides(axis: 'x' | 'y', r: Rect, place: number, mine: Feature[], others: GBox[], strong: boolean): Guide[] {
  const along0 = axis === 'y' ? r.x : r.y
  const along1 = axis === 'y' ? r.x + r.w : r.y + r.h
  const out: Guide[] = [{ axis, at: place, from: along0 - GUIDE_REACH, to: along1 + GUIDE_REACH, kind: 'place', strong: false }]
  for (const m of mine) {
    let lo = along0
    let hi = along1
    let any = false
    for (const o of others) {
      const theirs = axis === 'y' ? yFeatures(o, o.port ? o.y + PORT_ROW : null) : xFeatures(o)
      if (!theirs.some((t) => t.tag === m.tag && Math.abs(t.v - m.v) < 0.5)) continue
      any = true
      lo = Math.min(lo, axis === 'y' ? o.x : o.y)
      hi = Math.max(hi, axis === 'y' ? o.x + o.w : o.y + o.h)
    }
    if (any) out.push({ axis, at: m.v, from: lo, to: hi, kind: m.kind, strong })
  }
  return out
}

/** §DL3.6 — the correction for a pointer drag and its guides. `moving` are the
 *  dragged nodes at their proposed positions, `anchor` the grabbed one; `tol`
 *  is in flow px; `free` (Alt) finds the guides but moves nothing. */
export function smartSnap(moving: readonly GBox[], anchorId: string | null, index: BoxIndex, tol: number, free: boolean): SmartSnap {
  if (moving.length === 0) return { dx: 0, dy: 0, guides: [] }
  const anchor = moving.find((b) => b.id === anchorId) ?? moving[0]
  const r = moving.length === 1 ? anchor : bboxOf(moving)
  const portY = anchor.port ? anchor.y + PORT_ROW : null
  const ids = new Set(moving.map((b) => b.id))
  const others = index.query(r.x - GUIDE_REACH, r.y - GUIDE_REACH, r.x + r.w + GUIDE_REACH, r.y + r.h + GUIDE_REACH).filter((b) => !ids.has(b.id))
  const my = bestMatch(yFeatures(r, portY), others, 'y', tol)
  const mx = bestMatch(xFeatures(r), others, 'x', tol)
  const dy = free ? 0 : my ? my.d : snapPortY(anchor.y) - anchor.y
  const dx = free ? 0 : mx ? mx.d : snapX(anchor.x) - anchor.x
  const moved: Rect = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
  const yPlace = (portY ?? r.y) + dy
  const xPlace = (mx ? mx.mine.v : anchor.x) + dx
  // free: the guides of the alignment that WOULD apply (drawn faint)
  const shown: Rect = free ? { x: r.x + (mx ? mx.d : 0), y: r.y + (my ? my.d : 0), w: r.w, h: r.h } : moved
  const shownPort = portY != null ? portY + (free ? (my ? my.d : 0) : dy) : null
  const guides = [
    ...axisGuides('y', shown, yPlace, yFeatures(shown, shownPort), others, !free),
    ...axisGuides('x', shown, xPlace, xFeatures(shown), others, !free),
  ]
  return { dx, dy, guides }
}

/** §DL3.6 — after a keyboard move: the row and column the node now sits on,
 *  and every other node exactly aligned with it. Nothing is moved. */
export function settledGuides(moving: readonly GBox[], anchorId: string | null, index: BoxIndex): Guide[] {
  return smartSnap(moving, anchorId, index, 0.5, true).guides.map((g) => (g.kind === 'place' ? g : { ...g, strong: true }))
}

