// Node structure — the frame's chrome yields to a node's OUTSIDE name.
//
// Under the new node structure (uiStore.nodeStructure === 'outside') a node's
// name sits outside its body, and a frame drawn around bodies can have a name
// lying on or across its border. The frame's interactive chrome is drawn ABOVE
// the nodes (a ViewportPortal), so its parts took the pointer away from such a
// name (measured 2026-10-12, share 20-frame-and-busy-name.md):
//   • the four transparent EDGE STRIPS (12 px, centred on the border; they
//     SELECT and MOVE the frame — resizing is the corner handle's job),
//   • the TITLE CHIP, which sits above the top-left corner — exactly where a
//     top-face name of the top-left member goes, and
//   • the RESIZE HANDLE at the bottom-right corner (shown on a selected frame),
//     where a name across that corner would lie.
// Lumi's rules (same day): the name and the body–name bridge answer the
// pointer before the strips; the frame can still be selected and moved from
// the border parts no name covers, and still resized; title and name must BOTH
// stay readable — the chip MOVES when it would overlap, and so does the
// handle; nothing is re-placed automatically. Membership (the body rectangle)
// is not touched by any of this.
//
// Two blocker lists, on purpose (Lumi): the strips are cut by names and
// bridges only — a body may lie under a strip as it does today; the chip and
// the handle are placed clear of names, bridges AND bodies, because a place
// over a body is not a free place. When neither row offers room the piece
// stays at its home and the result says so (`placed: false`): that is a
// collision left standing, recorded, not a guarantee.
//
// Status (Lumi, 2026-10-12): the first implementation's OPERATION is verified
// in the small graph; this is not the frame's final design. Two things stay on
// the list for the next real-use review: a selected frame's dashed ring still
// runs across a name that crosses the border (a visual overlap, not a hit
// problem), and a handle moved to the middle of a border still resizes the
// bottom-right corner — verified, but not what a first-time user expects, so
// the moved handle is NOT the final interaction.
//
// Pure geometry, flow px; the renderer (FrameLayer) feeds it the boxes the
// route map publishes and draws what comes back.

import type { FrameRect } from '../../store/frameStore'

export type Box = { x: number; y: number; w: number; h: number }
export type Side = 'top' | 'right' | 'bottom' | 'left'
export type Span = { start: number; len: number }

/** the strip's thickness (index.css `.lgr-frame__edge-hit`: 12 px, 6 px to
 *  either side of the border) */
export const STRIP = 12
/** the resize handle (index.css `.lgr-frame__resize`): 12 × 12, centred on the
 *  bottom-right corner */
export const HANDLE = 12

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** one side's strip as a box */
export function stripRect(r: FrameRect, side: Side): Box {
  const half = STRIP / 2
  switch (side) {
    case 'top': return { x: r.x, y: r.y - half, w: r.w, h: STRIP }
    case 'bottom': return { x: r.x, y: r.y + r.h - half, w: r.w, h: STRIP }
    case 'left': return { x: r.x - half, y: r.y, w: STRIP, h: r.h }
    default: return { x: r.x + r.w - half, y: r.y, w: STRIP, h: r.h }
  }
}

/** the parts of one side's strip that no blocker covers, as spans along the
 *  border (x for top / bottom, y for left / right), relative to the frame's
 *  origin. No blockers → the whole border, one span: today's strip exactly. */
export function freeSpans(r: FrameRect, side: Side, blockers: readonly Box[]): Span[] {
  const strip = stripRect(r, side)
  const horizontal = side === 'top' || side === 'bottom'
  const length = horizontal ? r.w : r.h
  const origin = horizontal ? r.x : r.y
  const cuts: Array<[number, number]> = []
  for (const b of blockers) {
    if (!overlaps(strip, b)) continue
    const a0 = (horizontal ? b.x : b.y) - origin
    const a1 = a0 + (horizontal ? b.w : b.h)
    cuts.push([Math.max(0, a0), Math.min(length, a1)])
  }
  cuts.sort((p, q) => p[0] - q[0])
  const out: Span[] = []
  let at = 0
  for (const [c0, c1] of cuts) {
    if (c0 > at) out.push({ start: at, len: c0 - at })
    at = Math.max(at, c1)
  }
  if (at < length) out.push({ start: at, len: length - at })
  return out
}

export type ChipPlace = { x: number; inside: boolean; placed: boolean }

/** where the title chip goes: its home (outside, above the top-left corner)
 *  unless a blocker overlaps it there; then it slides RIGHT along the top
 *  border to the first clear place that still fits; failing that, the same
 *  search just INSIDE the top border; failing both, home with `placed: false`
 *  (a collision left standing — the chip is never hidden). `x` is the offset
 *  from the frame's left edge. */
export function placeChip(r: FrameRect, chip: { w: number; h: number }, blockers: readonly Box[], gap = 4): ChipPlace {
  const tryRow = (inside: boolean): number | null => {
    const y = inside ? r.y : r.y - chip.h
    let x = 0
    for (let guard = 0; guard < 64; guard++) {
      if (x + chip.w > r.w) return null
      const here: Box = { x: r.x + x, y, w: chip.w, h: chip.h }
      let next = x
      for (const b of blockers) if (overlaps(here, b)) next = Math.max(next, b.x + b.w - r.x + gap)
      if (next === x) return x
      x = next
    }
    return null
  }
  const outside = tryRow(false)
  if (outside !== null) return { x: outside, inside: false, placed: true }
  const inside = tryRow(true)
  if (inside !== null) return { x: inside, inside: true, placed: true }
  return { x: 0, inside: false, placed: false }
}

export type HandlePlace = { dx: number; dy: number; placed: boolean }

/** where the resize handle goes: its home (centred on the bottom-right corner)
 *  unless a blocker overlaps it there; then it slides LEFT along the bottom
 *  border to the first clear place (dx < 0); failing that, UP along the right
 *  border (dy < 0); failing both, home with `placed: false`. The gesture it
 *  starts is delta-based (FrameLayer), so a moved handle still resizes the
 *  same corner. */
export function placeHandle(r: FrameRect, blockers: readonly Box[], gap = 4): HandlePlace {
  const home: Box = { x: r.x + r.w - HANDLE / 2, y: r.y + r.h - HANDLE / 2, w: HANDLE, h: HANDLE }
  const clear = (b: Box) => !blockers.some((o) => overlaps(b, o))
  if (clear(home)) return { dx: 0, dy: 0, placed: true }
  // along the bottom border, leftwards
  let dx = 0
  for (let guard = 0; guard < 64; guard++) {
    let next = dx
    const here = { ...home, x: home.x + dx }
    for (const b of blockers) if (overlaps(here, b)) next = Math.min(next, b.x - HANDLE - gap - home.x)
    if (next === dx) return { dx, dy: 0, placed: true }
    dx = next
    if (home.x + dx < r.x) break // left the border
  }
  // along the right border, upwards
  let dy = 0
  for (let guard = 0; guard < 64; guard++) {
    let next = dy
    const here = { ...home, y: home.y + dy }
    for (const b of blockers) if (overlaps(here, b)) next = Math.min(next, b.y - HANDLE - gap - home.y)
    if (next === dy) return { dx: 0, dy, placed: true }
    dy = next
    if (home.y + dy < r.y) break
  }
  return { dx: 0, dy: 0, placed: false }
}
