// docs/diagram-layout.md §DL1 (issue #344) — the layout grid and the port row.
//
// The canvas grid is 16 px in flow coordinates (the dots the canvas already
// draws). A node's resource ports (`in` / `out`) sit on a fixed row 28 px below
// its top, whatever its height, text or language, so a stored position alone
// keeps a connection straight in every language; a taller node grows downward.
// "On the grid" means the node's left edge and its port row are multiples of
// 16, so the stored `y` of a node on the grid is `16k − 28`.

/** the grid step, flow px */
export const GRID = 16

/** the resource port row, flow px below a node's top (half the 56 px floor, so
 *  a one-line node draws its ports where it always did) */
export const PORT_ROW = 28

const round = (v: number): number => {
  const r = Math.round(v / GRID) * GRID
  return r === 0 ? 0 : r // never -0
}

/** the nearest grid x for a node's left edge */
export const snapX = (x: number): number => round(x)

/** the stored `y` whose port row (`y + PORT_ROW`) is the nearest grid line */
export const snapPortY = (y: number): number => round(y + PORT_ROW) - PORT_ROW

/** a node position moved to the grid: left edge and port row snapped */
export const snapNodePosition = (p: { x: number; y: number }): { x: number; y: number } => ({
  x: snapX(p.x),
  y: snapPortY(p.y),
})

/** the nearest grid point (a frame's corner, a waypoint) */
export const snapPoint = (p: { x: number; y: number }): { x: number; y: number } => ({ x: round(p.x), y: round(p.y) })

/** a rect grown outward to the grid (left / top down, right / bottom up), so
 *  everything it contained stays inside (a frame) */
export const snapRectOutward = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } => {
  const x0 = Math.floor(r.x / GRID) * GRID
  const y0 = Math.floor(r.y / GRID) * GRID
  const x1 = Math.ceil((r.x + r.w) / GRID) * GRID
  const y1 = Math.ceil((r.y + r.h) / GRID) * GRID
  return { x: x0 === 0 ? 0 : x0, y: y0 === 0 ? 0 : y0, w: x1 - x0, h: y1 - y0 }
}

const on = (v: number): boolean => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-9

/** whether a node position is on the grid (left edge and port row) */
export const nodeOnGrid = (p: { x: number; y: number }): boolean => on(p.x) && on(p.y + PORT_ROW)
