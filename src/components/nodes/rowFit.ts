// issue #332 — where a Pool's, a Parameter's and a Register's value and detail
// rows start, and how wide the node must be, so that no row crosses the drawn
// vessel.
//
// The contract (Option C plus minimal widening, for those three kinds only):
//   1. a value row and a detail row start where the title text starts (after
//      the kind chip and its gap), along the stack's PHYSICAL start: the canvas
//      is physically left-to-right in every language (docs/localization.md
//      §L9.2), and a row whose own text resolves to RTL (`dir="auto"` on an
//      Arabic unit) must still start on the chip's side;
//   2. every row's glyphs stay at least `ROW_CLEAR` px inside the silhouette at
//      the row's own height, both ends (the 6 px focus ring plus 2);
//   3. a node keeps the width it had before this fix when that already
//      satisfies both; otherwise only that node widens, by the minimum, up to
//      the 260 px maximum — and only for a row that is then whole: a row too
//      long even for the widest node is cut where it is;
//   4. a widening never makes the title's clearance worse: the vessel scales
//      with the width (`preserveAspectRatio="none"`), so on the Pool's slanted
//      side every px of width moves the outline toward the title. A title
//      that had 8 px or more keeps at least `max(8, its clearance − 0.5)`
//      (`TITLE_SLACK`, the measurement's own tolerance); one that had less
//      keeps every px of it. Nor does it
//      change the node's height: a title that wraps for want of room (not at
//      its own max width) would unwrap as the node widens, so it keeps its
//      width;
//   5. where the room ends (the maximum, or the width the title allows) a row
//      is cut short (its ellipsis) before it would cross, and the node keeps
//      the width it settled on.
//
// Pure: it reads only the measurements `NodeFrame` takes when the content or
// the size changes (never per frame) and the silhouette geometry, so it can be
// unit-tested.

import type { NodeKind } from '../../model/types'
import { fillSpanAt, NODE_RINGS } from './silhouette'

/** how many row-fit measurements `NodeFrame` has taken (a dev-bridge counter,
 *  so the e2e can assert none is taken per animation frame) */
let measures = 0
export const rowFitMeasured = (): void => {
  measures++
}
export const rowFitMeasureCount = (): number => measures

/** px between a row's glyphs and the silhouette: the inner focus ring's far
 *  edge (`NODE_RINGS.focus.to`, 6) plus 2. */
export const ROW_CLEAR = NODE_RINGS.focus.to + 2

/** px a title that had `ROW_CLEAR` or more may lose to a widening (rule 4) */
export const TITLE_SLACK = 0.5

/** the node's CSS width range (`.nodef` min-width / max-width in index.css) */
export const NODE_MIN_W = 118
export const NODE_MAX_W = 260

/** the `margin-inline` rim the Parameter / Register head carries (index.css:
 *  `clamp(0px, calc(11.6667% - 11.5px), 17px)` of the stack, which is the box
 *  width minus the body's 15 + 15 px padding). 0 for every other kind. */
export const headRim = (kind: NodeKind, width: number): number =>
  kind === 'parameter' || kind === 'register'
    ? Math.max(0, Math.min(0.116667 * (width - 30) - 11.5, 17))
    : 0

/** the inline margins a row carried before #332, as they count in the node's
 *  intrinsic width (a % margin counts as 0 there): the Register value's 1 px,
 *  the Parameter value's `max(4px, 8% − 13px)`. The before width is rebuilt
 *  from them, so a node whose rows already fit keeps its size. */
const shippedMargins = (kind: NodeKind, key: MeasuredRow['key']): number =>
  key !== 'value' ? 0 : kind === 'register' ? 2 : kind === 'parameter' ? 8 : 0

/** the margin a row still carries at its END (the left one is the fit's own) */
const endMargin = (kind: NodeKind, key: MeasuredRow['key']): number =>
  key !== 'value' ? 0 : kind === 'register' ? 1 : kind === 'parameter' ? 4 : 0

/** One row as `NodeFrame` measured it: its vertical extent and its whole
 *  text's width (even while an ellipsis cuts it short), in CSS px within the
 *  node box. */
export type MeasuredRow = { key: 'value' | 'sub'; top: number; bottom: number; width: number }

/** The node's geometry around its rows, in CSS px within the box at its
 *  current `width`. */
export type FrameGeometry = {
  /** the node's box height (the silhouette's viewBox height) */
  height: number
  /** the node's current CSS width */
  width: number
  /** the stack's start, from the box's left edge (the body's start padding) */
  stackStart: number
  /** the body's end padding */
  padEnd: number
  /** the title text's start, from the box's left edge */
  titleStart: number
  /** the title text's width on one line (its max-content width) */
  titleWidth: number
  /** the title's vertical extent */
  titleTop: number
  titleBottom: number
  /** does the title run to more than one line, and its own max width */
  titleWrapped: boolean
  titleMax: number
}

export type RowFit = {
  /** the width the fit is for: the node's width once it is applied */
  width: number
  /** each row's start, in CSS px from the stack's start (its `margin-left`) */
  start: Partial<Record<MeasuredRow['key'], number>>
  /** the node's minimum width, or null when its own content sets it */
  minWidth: number | null
  /** a row's max width where the room ends before the row does */
  maxWidth: Partial<Record<MeasuredRow['key'], number>>
}

// Layout units (1/64 px). A row aligned to the title takes the title's own
// start, to the nearest unit, so it shares the title's sub-pixel phase; a
// clearance is only ever rounded up, and a room down. Never a coarser step: a
// half-px ceil turned a title start measured at 29.00001 into 29.5 on one
// machine and 29 on another (CI), moving the row's glyphs by half a pixel.
const UNIT = 64
const EPS = 1e-6
const nearest = (v: number) => Math.round(v * UNIT) / UNIT
const up = (v: number) => Math.ceil(v * UNIT - EPS) / UNIT
const down = (v: number) => Math.floor(v * UNIT + EPS) / UNIT
const clampW = (w: number) => Math.max(NODE_MIN_W, Math.min(w, NODE_MAX_W))

/** the extreme fill edges across `[top, bottom]`, in viewBox x */
function edgesOver(kind: NodeKind, height: number, top: number, bottom: number): [number, number] {
  let l = -Infinity
  let r = Infinity
  for (let k = 0; k <= 4; k++) {
    const s = fillSpanAt(kind, height, top + ((bottom - top) * k) / 4)
    if (!s) continue
    l = Math.max(l, s[0])
    r = Math.min(r, s[1])
  }
  return [l, r]
}

export function fitRows(kind: NodeKind, g: FrameGeometry, rows: MeasuredRow[]): RowFit {
  const { height, width, stackStart, padEnd, titleStart } = g
  // the title text (and with it every aligned row) moves with the Parameter /
  // Register rim as the width changes
  const titleAt = (w: number) => titleStart + headRim(kind, w) - headRim(kind, width)
  const titleEdge = edgesOver(kind, height, g.titleTop, g.titleBottom)[0]
  const titleClear = (w: number) => titleAt(w) - (titleEdge * w) / 120
  const rowEdges = rows.map((r) => edgesOver(kind, height, r.top, r.bottom))
  const startAt = (i: number, w: number) => Math.max(nearest(titleAt(w)), up((rowEdges[i][0] * w) / 120 + ROW_CLEAR))
  // a row's room at width `w`: inside the outline by `ROW_CLEAR`, and inside
  // the box's end padding (a row that reached into it would widen the node)
  const roomAt = (i: number, w: number) =>
    Math.min((rowEdges[i][1] * w) / 120 - ROW_CLEAR, w - padEnd - endMargin(kind, rows[i].key)) - startAt(i, w)

  // the width before this fix: the head, or a row at its old place
  // (a title counts at its one-line width, up to its own max width)
  const head = titleAt(0) - stackStart - headRim(kind, 0) + Math.min(g.titleWidth, g.titleMax)
  const before = clampW(
    stackStart + Math.max(head, ...rows.map((r) => r.width + shippedMargins(kind, r.key))) + padEnd,
  )
  // rule 4: the widest the title allows
  const was = titleClear(before)
  const floor = was >= ROW_CLEAR ? Math.max(ROW_CLEAR, was - TITLE_SLACK) : was
  let cap = NODE_MAX_W
  while (cap > before && titleClear(cap) < floor - 0.01) cap -= 0.5
  cap = Math.max(cap, before)
  // …and the title's line count: a title that wraps although one line would
  // fit its max width wraps for want of room, and unwraps where the room the
  // node gives it reaches its one-line width
  const chipGap = titleStart - headRim(kind, width) - stackStart
  const titleRoom = (w: number) => w - stackStart - padEnd - 2 * headRim(kind, w) - chipGap
  if (g.titleWrapped && g.titleWidth <= g.titleMax + 0.5) {
    while (cap > before && titleRoom(cap) >= g.titleWidth - 0.01) cap -= 0.5
    cap = Math.max(cap, before)
  }
  // rule 3: the narrowest width that holds every row whole — every row that
  // the widest allowed node can hold whole: one that would still be cut short
  // there gains nothing whole from a wider node, so it is cut where it is
  const whole = (i: number, w: number) => rows[i].width <= roomAt(i, w) + 0.01
  const widening = rows.map((_, i) => i).filter((i) => whole(i, cap))
  const fits = (w: number) => widening.every((i) => whole(i, w))
  let need = NODE_MIN_W
  while (need < cap && !fits(need)) need += 0.5
  const used = Math.max(before, Math.min(need, cap))

  const start: RowFit['start'] = {}
  const maxWidth: RowFit['maxWidth'] = {}
  rows.forEach((r, i) => {
    start[r.key] = +(startAt(i, used) - stackStart).toFixed(4)
    const room = roomAt(i, used)
    if (room < r.width - 0.01) maxWidth[r.key] = Math.max(0, down(room))
  })
  // a row cut short no longer holds the node at its width, so the width is
  // held explicitly then too
  const cut = Object.keys(maxWidth).length > 0
  return { width: +used.toFixed(4), start, minWidth: used > before + 0.01 || cut ? +used.toFixed(4) : null, maxWidth }
}
