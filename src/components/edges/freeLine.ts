// issue #344 step 3 (docs/diagram-layout.md §DL4, docs/edge-routing.md §ER15) —
// the geometry of a connection that is not routed: Curved (React Flow's Bézier)
// and Straight. Pure. The route map samples it from its own port anchors to
// choose a label slot; `LoopEdge` samples it from React Flow's anchors to draw
// the label at that slot, so the label sits on the drawn line.

import { Position } from '@xyflow/react'
import type { Pt } from './orthogonalRoute'

/** React Flow's default Bézier curvature (`getBezierPath`) */
const CURVATURE = 0.25
/** segments a Bézier is sampled into */
export const BEZIER_SAMPLES = 24

/** React Flow's `calculateControlOffset` */
function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : CURVATURE * 25 * Math.sqrt(-distance)
}

/** React Flow's `getControlWithCurvature` */
function control(pos: Position, a: Pt, b: Pt): Pt {
  switch (pos) {
    case Position.Left: return { x: a.x - controlOffset(a.x - b.x), y: a.y }
    case Position.Right: return { x: a.x + controlOffset(b.x - a.x), y: a.y }
    case Position.Top: return { x: a.x, y: a.y - controlOffset(a.y - b.y) }
    default: return { x: a.x, y: a.y + controlOffset(b.y - a.y) }
  }
}

/** the line from `a` (leaving through `aPos`) to `b` (entering through `bPos`)
 *  as a polyline: two points for Straight, the sampled Bézier for Curved */
export function freeLinePoints(a: Pt, aPos: Position, b: Pt, bPos: Position, straight: boolean): Pt[] {
  if (straight) return [a, b]
  const c1 = control(aPos, a, b)
  const c2 = control(bPos, b, a)
  const out: Pt[] = []
  for (let i = 0; i <= BEZIER_SAMPLES; i++) {
    const t = i / BEZIER_SAMPLES
    const u = 1 - t
    out.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    })
  }
  return out
}

/** the point at fraction `f` of a polyline's length */
export function pointAlong(pts: Pt[], f: number): Pt {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (acc + seg >= total * f) {
      const r = seg > 0 ? (total * f - acc) / seg : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * r, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * r }
    }
    acc += seg
  }
  return pts[pts.length - 1]
}
