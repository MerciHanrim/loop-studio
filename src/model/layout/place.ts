// docs/diagram-layout.md §DL2 / §DL3 (issue #344) — the nearest free grid spot.
//
// Grid positions are tried in rings of growing distance from the wanted one,
// each ring in a fixed order (distance, then y, then x), so the answer is
// deterministic. `fits(p)` decides whether a candidate is free (no overlap, the
// caller's order rules); the wanted position itself is tried first.

import { GRID } from './grid'

export type Box = { x: number; y: number; w: number; h: number }

export const boxesOverlap = (a: Box, b: Box, clearance = 0): boolean =>
  a.x < b.x + b.w + clearance && b.x < a.x + a.w + clearance && a.y < b.y + b.h + clearance && b.y < a.y + a.h + clearance

const ringCache = new Map<number, [number, number][]>()
function ring(r: number): [number, number][] {
  let cells = ringCache.get(r)
  if (!cells) {
    cells = []
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r) cells.push([i, j])
    cells.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || a[1] - b[1] || a[0] - b[0])
    ringCache.set(r, cells)
  }
  return cells
}

/** the nearest grid offset of `want` for which `fits` holds, within `maxRing`
 *  grid steps; null when none does */
export function nearestFree(
  want: { x: number; y: number },
  fits: (p: { x: number; y: number }) => boolean,
  maxRing = 64,
): { x: number; y: number } | null {
  for (let r = 0; r <= maxRing; r++) {
    for (const [i, j] of ring(r)) {
      const p = { x: want.x + i * GRID, y: want.y + j * GRID }
      if (fits(p)) return p
    }
  }
  return null
}
