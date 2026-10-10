// issue #337 (v0.21.4) — where the head and the rows of a Pool, a Source, a
// Drain, a Converter and a Gate go, and how wide the node is, so that every
// painted element keeps clear of the drawn outline.
//
// The outlines of these kinds are width-parametric (./silhouette
// `FIXED_DEPTH_KINDS`): their left side never depends on the width and their
// right side keeps its distance from the right edge, so the fit is a direct
// computation, not a search. The contract:
//   1. every painted element — the kind chip, each title line, each row — keeps
//      at least `ROW_CLEAR` (8) px inside the outline at its own height, at
//      both ends (#332's clearance);
//   2. the head (chip + title) moves in as one, by the least that holds its
//      every element;
//   3. a row starts where the title text starts (the chip plus its gap, after
//      the head moved in), or further in only where the outline needs it: #332's
//      rule for the Pool's value and capacity rows, the same for the Source /
//      Drain / Converter mode row;
//   4. the Gate's lines stay centred;
//   5. the node is as wide as its content needs and no wider, up to 260 px; a
//      row that would need more is cut short (its ellipsis) where the room ends.
//
// The width it returns is the node's width (`NodeFrame` sets it): it is built
// only from widths that do not depend on the node's current width (each row's
// whole text, the title on one line up to its own max width), so a node whose
// content grows grows with it — a title squeezed by an earlier, narrower fit
// is never read as wrapping for want of room. Below 260 px a title wraps only
// at its own max width, as before, so the height never changes for a row.
//
// Pure: it reads only what `NodeFrame` measures (in CSS px within the box, the
// head and the rows at their place BEFORE this fit moves them) and the outline.

import type { NodeKind } from '../../model/types'
import { fillSpanAt } from './silhouette'
import { NODE_MAX_W, ROW_CLEAR } from './rowFit'

/** an element's extent in CSS px within the box: a text line's glyphs (its
 *  top / bottom the line BOX), or the chip */
export type Extent = { left: number; right: number; top: number; bottom: number }

export type OutlineRow = { key: 'value' | 'sub'; top: number; bottom: number; width: number; left: number }

export type OutlineGeometry = {
  kind: NodeKind
  /** the box height (the outline's viewBox height) */
  height: number
  /** the node's width as measured (only the Gate's centring reads it) */
  width: number
  /** the body's start / end padding */
  stackStart: number
  padEnd: number
  /** the CSS minimum width of the kind */
  minWidth: number
  chip: Extent | null
  /** each title line's glyphs, top to bottom */
  titleLines: Extent[]
  /** the title box's start (the chip plus its gap) */
  titleBoxStart: number
  /** the title's width on one line, and its own max width */
  titleOneLine: number
  titleMax: number
  /** each row's whole text width (even while its ellipsis cuts it) and, for the
   *  Gate, its measured place */
  rows: OutlineRow[]
}

export type OutlineFit = {
  /** the node's width */
  width: number
  /** how far the head moves in from its place (never for the Gate) */
  headShift: number
  /** each row's start, in CSS px from the stack's start (its `margin-left`) */
  start: Partial<Record<OutlineRow['key'], number>>
  /** a row's max width where the room ends before the row does */
  maxWidth: Partial<Record<OutlineRow['key'], number>>
}

// Layout units (1/64 px), as ./rowFit: a clearance is rounded up, a room down.
const UNIT = 64
const EPS = 1e-6
const up = (v: number) => Math.ceil(v * UNIT - EPS) / UNIT
const down = (v: number) => Math.floor(v * UNIT + EPS) / UNIT

/** where an element is sampled: its top + 1, bottom − 1 and three points
 *  between (#332's e2e reads top + 1, middle, bottom − 1) */
const samples = (top: number, bottom: number): number[] => {
  const a = top + 1
  const b = Math.max(a, bottom - 1)
  return [0, 1, 2, 3, 4].map((k) => a + ((b - a) * k) / 4)
}

export function fitOutline(g: OutlineGeometry): OutlineFit {
  const { kind, height } = g
  // the outline's left edge at y, and how far its right edge sits in from the
  // node's right edge: both the same at every width
  const REF = 1000
  const sides = (y: number): [number, number] | null => {
    const s = fillSpanAt(kind, height, y, REF)
    return s && [s[0], REF - s[1]]
  }
  const leftNeed = (e: { top: number; bottom: number }) => Math.max(...samples(e.top, e.bottom).map((y) => (sides(y)?.[0] ?? 0) + ROW_CLEAR))
  const rightIn = (e: { top: number; bottom: number }) => Math.max(...samples(e.top, e.bottom).map((y) => (sides(y)?.[1] ?? 0) + ROW_CLEAR))
  const head: Extent[] = [...(g.chip ? [g.chip] : []), ...g.titleLines]
  // the title box as the content asks for it: one line, up to its max width
  const titleWidth = Math.min(g.titleOneLine, g.titleMax)

  if (kind === 'gate') {
    // every line is centred in the box: its centre's offset from the box
    // centre is the same at any width, so each side sets a minimum width
    const headWidth = g.titleBoxStart - (g.chip?.left ?? g.titleBoxStart) + titleWidth
    let need = Math.max(g.minWidth, headWidth + 2 * g.padEnd)
    const lines = [...head, ...g.rows.map((r) => ({ left: r.left, right: r.left + r.width, top: r.top, bottom: r.bottom }))]
    for (const e of lines) {
      const c = (e.left + e.right) / 2 - g.width / 2
      const half = (e.right - e.left) / 2
      need = Math.max(need, 2 * (leftNeed(e) + half - c), 2 * (c + half + rightIn(e)), 2 * (half + Math.abs(c)) + 2 * g.padEnd)
    }
    const width = Math.min(up(need), NODE_MAX_W)
    const maxWidth: OutlineFit['maxWidth'] = {}
    for (const r of g.rows) {
      const c = r.left + r.width / 2 - g.width / 2
      const room = 2 * Math.min(width / 2 - leftNeed(r) - Math.abs(c), width / 2 - rightIn(r) - Math.abs(c))
      if (room < r.width - 0.01) maxWidth[r.key] = Math.max(0, down(room))
    }
    return { width, headShift: 0, start: {}, maxWidth }
  }

  // 2. the head moves in as far as its most constrained element needs
  const headShift = up(Math.max(0, ...head.map((e) => leftNeed(e) - e.left)))
  let need = Math.max(g.minWidth, g.titleBoxStart + headShift + titleWidth + g.padEnd)
  for (const e of head) need = Math.max(need, e.right + headShift + rightIn(e))
  // 3. the rows start at the title, or further in where the outline needs it
  const titleAt = g.titleBoxStart + headShift
  const starts = g.rows.map((r) => up(Math.max(titleAt, leftNeed(r))))
  g.rows.forEach((r, i) => {
    need = Math.max(need, starts[i] + r.width + rightIn(r), starts[i] + r.width + g.padEnd)
  })
  // 5. never wider than the maximum
  const width = Math.min(up(need), NODE_MAX_W)
  const start: OutlineFit['start'] = {}
  const maxWidth: OutlineFit['maxWidth'] = {}
  // whole layout units, never a decimal rounding: layout snaps a length to
  // 1/64 px DOWN, so 187.0156 (for 187 + 1/64) lays out at 187
  g.rows.forEach((r, i) => {
    start[r.key] = up(starts[i] - g.stackStart)
    const room = Math.min(width - rightIn(r), width - g.padEnd) - starts[i]
    if (room < r.width - 0.01) maxWidth[r.key] = Math.max(0, down(room))
  })
  return { width, headShift, start, maxWidth }
}
