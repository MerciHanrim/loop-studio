// issue #330 PR 2 (v0.23.0), docs/simulation-playback-ordering.md §PBO3 — where
// a Converter's conversion mark sits. The Converter is a waisted shape whose
// title and mode text fill it, and no one fixed spot is free in every node and
// language (measured over every bundled Template in all 18 languages: a fixed
// spot after the mode text missed 20 of 450). So each node gets its own spot:
// the free square nearest the end of the mode text, at least
// `CONV_MARK_INSET` px inside the drawn outline (inside the keyboard-focus
// ring) and `CONV_MARK_GAP` px clear of every text box. Pure geometry: the
// caller measures the text once per content / language / font / size change,
// never per frame (nodes.tsx).

import { silhouetteSegments } from './silhouette'

/** the mark's side, CSS px */
export const CONV_MARK = 10
/** least distance from the mark to the drawn outline, CSS px (the focus ring
 *  ends 6 px in, `NODE_RINGS.focus.to`) */
export const CONV_MARK_INSET = 6
/** least gap between the mark and any text box, CSS px */
export const CONV_MARK_GAP = 1
/** where the search starts: this far after the end of the mode text */
export const CONV_MARK_AFTER = 3

/** a box in CSS px from the node box's top-left */
export type Box = { left: number; top: number; right: number; bottom: number }
export type Spot = { x: number; y: number }

type Seg = readonly [readonly [number, number], readonly [number, number]]

/** distance from point (px, py) to the segment a–b */
function distToSeg(px: number, py: number, s: Seg): number {
  const [[ax, ay], [bx, by]] = s
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** even-odd point-in-polygon over the closed outline */
function inside(px: number, py: number, segs: readonly Seg[]): boolean {
  let n = 0
  for (const [[ax, ay], [bx, by]] of segs) {
    if (ay > py !== by > py && px < ax + ((py - ay) / (by - ay)) * (bx - ax)) n++
  }
  return n % 2 === 1
}

/** the outline of a Converter `w` × `h` CSS px, in CSS px (the SVG is drawn
 *  with `preserveAspectRatio="none"`, so x scales by `w / 120`) */
export function converterOutline(w: number, h: number): Seg[] {
  const k = w / 120
  return silhouetteSegments('converter', h).map(([a, b]) => [[a[0] * k, a[1]], [b[0] * k, b[1]]] as const)
}

/** is the `CONV_MARK` square at (x, y) inside the outline by `CONV_MARK_INSET`?
 *  Its boundary is sampled every 0.5 px; a square whose boundary keeps that
 *  distance from every segment crosses none of them, so its centre decides
 *  inside or outside. */
export function markFits(x: number, y: number, segs: readonly Seg[]): boolean {
  const S = CONV_MARK
  if (!inside(x + S / 2, y + S / 2, segs)) return false
  for (let i = 0; i <= 2 * S; i++) {
    const t = i / 2
    for (const [px, py] of [[x + t, y], [x + t, y + S], [x, y + t], [x + S, y + t]] as const) {
      for (const s of segs) if (distToSeg(px, py, s) < CONV_MARK_INSET) return false
    }
  }
  return true
}

const clearOf = (x: number, y: number, text: readonly Box[]): boolean =>
  text.every(
    (b) =>
      x + CONV_MARK <= b.left - CONV_MARK_GAP ||
      x >= b.right + CONV_MARK_GAP ||
      y + CONV_MARK <= b.top - CONV_MARK_GAP ||
      y >= b.bottom + CONV_MARK_GAP,
  )

/** The mark's top-left for a Converter `w` × `h`, given its text boxes and the
 *  mode text's box (`mode`, null when there is none): the free spot nearest
 *  `CONV_MARK_AFTER` px after the mode text's end, centred on its row, on a
 *  0.5 px grid (ties: higher, then nearer the start). `null` when no spot fits. */
export function convMarkSpot(w: number, h: number, text: readonly Box[], mode: Box | null): Spot | null {
  const segs = converterOutline(w, h)
  const S = CONV_MARK
  const tx = mode ? mode.right + CONV_MARK_AFTER : w / 2 - S / 2
  const ty = mode ? (mode.top + mode.bottom) / 2 - S / 2 : h / 2 - S / 2
  const cands: [number, number, number][] = []
  for (let y = 0; y <= h - S; y += 0.5) {
    for (let x = 0; x <= w - S; x += 0.5) cands.push([Math.hypot(x - tx, y - ty), x, y])
  }
  cands.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1])
  for (const [, x, y] of cands) {
    if (clearOf(x, y, text) && markFits(x, y, segs)) return { x, y }
  }
  return null
}
