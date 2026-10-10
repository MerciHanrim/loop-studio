// docs/diagram-layout.md §DL2.9 / §DL5.3 (issue #344) — the clearance a
// re-placement keeps between nodes, and how a saved frame is rebuilt around the
// nodes it shows once they have moved. Shared by the bundled Templates
// (`placeTemplate`), the one-time conversion of an older document and Tidy to
// grid. Pure and deterministic.

import { GRID } from './grid'

/** the clearance kept between two nodes, flow px: two port stubs and a lane
 *  across, and a row of routes between two node rows */
export const LAYOUT_CLEARANCE = { x: 48, y: 32 } as const
/** the margin a frame keeps around each node it shows (docs/example-coffee-roastery.md §CR17) */
export const FRAME_MARGIN = 24

export type Rect = { x: number; y: number; w: number; h: number }
export type Box = { x: number; y: number; w: number; h: number }

const bbox = (boxes: Box[]) => ({
  x: Math.min(...boxes.map((b) => b.x)),
  y: Math.min(...boxes.map((b) => b.y)),
  x1: Math.max(...boxes.map((b) => b.x + b.w)),
  y1: Math.max(...boxes.map((b) => b.y + b.h)),
})

/** A frame rebuilt around `members` at their new place: on each side it keeps
 *  the padding it had around them before (`before`: each member's box as it
 *  was), at least `FRAME_MARGIN`, and covers each member's box as it is now
 *  (`after`); snapped outward to the grid. No member: `fallback`. */
export function rebuildFrameRect(rect: Rect, members: readonly string[], before: (id: string) => Box, after: (id: string) => Box, fallback: Rect): Rect {
  if (members.length === 0) return fallback
  const b0 = bbox(members.map(before))
  const b1 = bbox(members.map(after))
  const pad = {
    l: Math.max(FRAME_MARGIN, b0.x - rect.x),
    t: Math.max(FRAME_MARGIN, b0.y - rect.y),
    r: Math.max(FRAME_MARGIN, rect.x + rect.w - b0.x1),
    b: Math.max(FRAME_MARGIN, rect.y + rect.h - b0.y1),
  }
  const x0 = Math.floor((b1.x - pad.l) / GRID) * GRID
  const y0 = Math.floor((b1.y - pad.t) / GRID) * GRID
  const x1 = Math.ceil((b1.x1 + pad.r) / GRID) * GRID
  const y1 = Math.ceil((b1.y1 + pad.b) / GRID) * GRID
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** whether a box lies fully inside a rect */
export const fullyInside = (b: Box, r: Rect): boolean => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h
/** whether a box's centre lies inside a rect */
export const centreInside = (b: Box, r: Rect): boolean => {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
}
