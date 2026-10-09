// docs/mmo-multilingual-layout.md §MML1b — height-parametric vessel silhouettes.
//
// The node body grows past the base height once its content needs it (a title
// wrapped to two lines, a capacity row). A `preserveAspectRatio="none"` SVG
// would then distort every shape, so each kind gets its own path function: the
// top and bottom cap regions keep their pixel offsets, corner radii / notch /
// endbar are fixed, and only the straight middle stretches.
//
// docs/flow-colour-and-compact-nodes.md FC-7 (issue #325, PR 3) — compact
// nodes: the base height is 56 (it was 64). 56 is a FLOOR, not a forced
// height: the box is measured from its content (`nodes.tsx`), so a one-line
// Pool settles at 58 and anything taller grows as before. At every height of 64
// and above each function returns the path it always did (at exactly 64, the
// historic hard-coded silhouette, byte for byte; asserted by
// `silhouette.test.ts`). Below 64 the End's and the Register's rounded caps
// meet at mid-height instead of inserting a straight run, so no path ever
// draws a reversed segment.
//
// The SVG viewBox is `0 0 120 h`; the x geometry (width 120) never changes.

import type { NodeKind } from '../../model/types'

/** The smallest box height (the compact floor, FC-7). */
export const BASE_NODE_H = 56

/** The height every silhouette was first drawn at; from here up the End and the
 *  Register insert a straight run between their caps. */
const CAP_RUN_H = 64

/** docs/flow-colour-and-compact-nodes.md FC-4.1 — the rings' distance from the
 *  silhouette, in screen px (every stroke is non-scaling, so these hold at any
 *  node size, height and zoom). From the inside out: focus, the flow-colour
 *  band, the structure line on the silhouette, selection, invalid. Each ring
 *  is cut out of a wider stroke by a mask (`nodes.tsx`), so they never overlap
 *  and nothing is painted in the gaps between them (an edge reaching a port
 *  stays visible). */
export const NODE_RINGS = {
  /** the flow-colour band: 0 … 3 px inside, clipped to the silhouette */
  band: 3,
  /** keyboard focus, dashed, inside the band */
  focus: { from: 4.5, to: 6 },
  /** selection, solid, outside the structure line */
  selection: { from: 2.5, to: 4.5 },
  /** invalid, dashed, outermost */
  invalid: { from: 6.5, to: 8.5 },
} as const

/** issue #330 PR 2 — the Pool arrival pulse fills the silhouette from this
 *  many screen px inside: clear of the band and the focus ring (`focus.to`)
 *  by 1 px. Its forced-colours line is drawn from here to 2 px further in. */
export const POOL_PULSE_INSET = 7

/** the user-space rectangle every ring mask covers (`RingMasks.tsx`), in
 *  viewBox units — vertical units are px, horizontal ones at least ~1 px; its
 *  height follows the node's */
export type MaskBox = { x: number; y: number; width: number; height: number }
export const maskBox = (boxH: number): MaskBox => ({ x: -200, y: -200, width: 520, height: boxH + 400 })

/** How many px the drawn vessel path leaves EMPTY at the top + bottom of its
 *  `0 0 120 H` viewBox — the `y` where the top cap's straight run begins and
 *  `H − y` where the bottom cap's begins, summed (independent of `H`, since
 *  `silhouettePath` keeps the cap offsets fixed and only stretches the middle).
 *  The body's content must be laid out to `H − VESSEL_INSET_Y[kind]`, not the
 *  full box, or a stack taller than that inner height spills past the outline
 *  (worst for `parameter` / `register`: a 40px vessel inside the 64px box). */
export const VESSEL_INSET_Y: Record<NodeKind, number> = {
  pool: 12, // path y 6 … H−6
  source: 16, // y 8 … H−8
  drain: 16, // y 8 … H−8
  gate: 6, // diamond apexes y 3 … H−3
  converter: 16, // y 8 … H−8
  end: 16, // y 8 … H−8
  parameter: 24, // tag body y 12 … H−12
  register: 24, // capsule y 12 … H−12
}

/** Minimum clear gap (px) the design keeps between the rendered content's
 *  top / bottom edge and the vessel outline. Pinned so the `content ⊂ vessel`
 *  e2e can assert it. */
export const VESSEL_MIN_PAD_Y = 4

/** Per-kind ceiling on the rendered height. `gate` / `converter` carry an
 *  identity centre form (diamond / waisted hourglass); past this the middle
 *  angle gets too steep and the shape stops reading, so the box stops growing
 *  and the rare over-tall body is allowed to sit a hair proud of the vessel. */
export const MAX_NODE_H: Record<NodeKind, number> = {
  pool: 132,
  source: 132,
  drain: 132,
  gate: 92,
  converter: 96,
  end: 120,
  parameter: 120,
  register: 120,
}

const n = (v: number) => Math.round(v * 100) / 100

/** The vessel outline for `kind` at body height `h` (viewBox `0 0 120 h`),
 *  clamped to the kind's range [`BASE_NODE_H`, `MAX_NODE_H`].
 *
 *  `parameter` / `register` were RE-CUT (docs/node-shell-content-in-vessel.md
 *  "curved corner" follow-up): the old capsule / tag inset its left+right edges
 *  ~14 px into the viewBox, but the rendered content is laid out to the CSS box
 *  (`.nodef__body` padding), which maps to a viewBox x that SHRINKS toward the
 *  rim as the node widens — so on a 180–260 px node the chip / title / value
 *  corners fell OUTSIDE the drawn fill even though inside the bounding box. Both
 *  shapes keep their identity but pull their top / bottom EDGES nearly full
 *  width so the content-facing run is flat: `register` is a flattened lozenge
 *  (edges `x14…110`, elliptical ends bulging to `x6` / `x118` at mid-height);
 *  `parameter` is a flatter tag (body `x8…112` r6) still carrying its left tab
 *  (`x1…8 × mid±8`, the historic notch height). Together with a width-scaled
 *  `padding-inline` on the two bodies this keeps every content corner ≥ 2 CSS
 *  px inside the fill at all widths / locales (measured ≥ 3.75 register /
 *  ≥ 2.75 parameter). The top+bottom cap offsets are `y12 … H−12`
 *  (`VESSEL_INSET_Y` 24). (A true stadium / semicircular-ended capsule cannot
 *  contain the content: it pinches in hard exactly where the chip / title
 *  corner sits, 4 px below the top edge.) */
export function silhouettePath(kind: NodeKind, h = BASE_NODE_H): string {
  const H = Math.max(BASE_NODE_H, Math.min(h, MAX_NODE_H[kind]))
  const mid = n(H / 2)
  switch (kind) {
    case 'pool':
      // top edge y6, shoulders y13; bottom edge y H-6, shoulders y H-12
      return `M32 6 H88 Q95 6 96 13 L112 ${n(H - 12)} Q113 ${n(H - 6)} 107 ${n(H - 6)} H13 Q7 ${n(H - 6)} 8 ${n(H - 12)} L24 13 Q25 6 32 6 Z`
    case 'source':
      return `M14 8 Q8 8 8 14 V${n(H - 14)} Q8 ${n(H - 8)} 14 ${n(H - 8)} H84 L114 ${mid} L84 8 Z`
    case 'drain':
      return `M6 ${mid} L34 8 H104 Q112 8 112 15 V${n(H - 15)} Q112 ${n(H - 8)} 104 ${n(H - 8)} H34 Z`
    case 'gate':
      return `M60 3 L117 ${mid} L60 ${n(H - 3)} L3 ${mid} Z`
    case 'converter':
      return `M14 8 H106 Q112 8 112 14 L82 ${mid} L112 ${n(H - 14)} Q112 ${n(H - 8)} 106 ${n(H - 8)} H14 Q8 ${n(H - 8)} 8 ${n(H - 14)} L38 ${mid} L8 14 Q8 8 14 8 Z`
    case 'end':
      // the rounded caps meet at mid-height up to 64; above it a straight V
      // keeps the cap radius fixed
      return H <= CAP_RUN_H
        ? `M28 8 H92 Q112 8 112 ${mid} Q112 ${n(H - 8)} 92 ${n(H - 8)} H28 Q8 ${n(H - 8)} 8 ${mid} Q8 8 28 8 Z`
        : `M28 8 H92 Q112 8 112 32 V${n(H - 32)} Q112 ${n(H - 8)} 92 ${n(H - 8)} H28 Q8 ${n(H - 8)} 8 ${n(H - 32)} V32 Q8 8 28 8 Z`
    case 'parameter':
      // body `x8…112` r6; left tab `x1…8` × `mid ± 8` (historic notch height),
      // centred on the left edge's vertical middle
      return `M14 12 H106 Q112 12 112 18 V${n(H - 18)} Q112 ${n(H - 12)} 106 ${n(H - 12)} H14 Q8 ${n(H - 12)} 8 ${n(H - 18)} V${n(mid + 8)} H1 V${n(mid - 8)} H8 V18 Q8 12 14 12 Z`
    case 'register':
      // flattened lozenge: edges `x14…110`, elliptical ends bulging to x6 / x118
      // at mid-height; up to 64 the ends meet at mid-height, above it a straight
      // V grows the middle
      return H <= CAP_RUN_H
        ? `M14 12 H110 Q118 12 118 ${mid} Q118 ${n(H - 12)} 110 ${n(H - 12)} H14 Q6 ${n(H - 12)} 6 ${mid} Q6 12 14 12 Z`
        : `M14 12 H110 Q118 12 118 32 V${n(H - 32)} Q118 ${n(H - 12)} 110 ${n(H - 12)} H14 Q6 ${n(H - 12)} 6 ${n(H - 32)} V32 Q6 12 14 12 Z`
  }
}

/** issue #332 — where the drawn vessel's FILL is along a horizontal line at
 *  `y` (CSS px from the box top, = viewBox y), as `[left, right]` in viewBox x
 *  units (0 … 120; multiply by `width / 120` for CSS px, the SVG is
 *  `preserveAspectRatio="none"`). `null` when `y` misses the shape. Computed
 *  from `silhouettePath` itself (its `M H V L Q Z` commands, the quadratic
 *  corners flattened), so it cannot drift from what is drawn. The Parameter's
 *  left tab (`x1 … 8`) is left out: it is a port-side marker, not room for text,
 *  so the body's edge `x8` is the edge text must keep clear of. */
export function fillSpanAt(kind: NodeKind, h: number, y: number): [number, number] | null {
  const H = Math.max(BASE_NODE_H, Math.min(h, MAX_NODE_H[kind]))
  const key = `${kind}|${H}`
  let segs = segmentCache.get(key)
  if (!segs) segmentCache.set(key, (segs = pathSegments(silhouettePath(kind, H))))
  const xs: number[] = []
  for (const [a, b] of segs) {
    if ((a[1] <= y && b[1] >= y) || (b[1] <= y && a[1] >= y)) {
      if (a[1] === b[1]) xs.push(a[0], b[0])
      else xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
    }
  }
  if (xs.length < 2) return null
  const left = kind === 'parameter' ? Math.max(8, Math.min(...xs)) : Math.min(...xs)
  return [left, Math.max(...xs)]
}

/** issue #344, docs/diagram-layout.md §DL1 — how far in from the box's left
 *  (`in`) or right (`out`) edge the drawn outline is on the port row, as a
 *  FRACTION of the node's width (the outline stretches with the width only),
 *  for a node `h` tall: the resource port is drawn there, ON the outline (a
 *  Pool's slanted side, a Drain's notch tip, a Converter's waist), while the
 *  routing lane stays on the row. `rowY` is the port row (`PORT_ROW`, passed
 *  in so this module keeps no layout import). 0 when the row misses the shape. */
export function portInsetFraction(kind: NodeKind, h: number, side: 'in' | 'out', rowY: number): number {
  const span = fillSpanAt(kind, h, rowY)
  if (!span) return 0
  return (side === 'in' ? span[0] : 120 - span[1]) / 120
}

type Pt = [number, number]
/** each (kind, height)'s flattened path, parsed once: a row fit samples it
 *  about fifteen times per node */
const segmentCache = new Map<string, [Pt, Pt][]>()

/** issue #330 PR 2 — the drawn outline of `kind` at height `h` as straight
 *  segments in viewBox units (x 0 … 120, y = CSS px), quadratics flattened;
 *  the same parse `fillSpanAt` reads, cached per (kind, height) */
export function silhouetteSegments(kind: NodeKind, h: number): readonly (readonly [Pt, Pt])[] {
  const H = Math.max(BASE_NODE_H, Math.min(h, MAX_NODE_H[kind]))
  const key = `${kind}|${H}`
  let segs = segmentCache.get(key)
  if (!segs) segmentCache.set(key, (segs = pathSegments(silhouettePath(kind, H))))
  return segs
}
/** The straight segments of one of this module's paths, quadratics flattened. */
function pathSegments(d: string): [Pt, Pt][] {
  const tok = d.match(/[MHVLQZ]|-?\d+(?:\.\d+)?/g) ?? []
  const segs: [Pt, Pt][] = []
  let i = 0
  let cur: Pt = [0, 0]
  let start: Pt = [0, 0]
  const num = () => Number(tok[i++])
  while (i < tok.length) {
    const c = tok[i++]
    if (c === 'M') { cur = [num(), num()]; start = cur }
    else if (c === 'H') { const p: Pt = [num(), cur[1]]; segs.push([cur, p]); cur = p }
    else if (c === 'V') { const p: Pt = [cur[0], num()]; segs.push([cur, p]); cur = p }
    else if (c === 'L') { const p: Pt = [num(), num()]; segs.push([cur, p]); cur = p }
    else if (c === 'Q') {
      const q: Pt = [num(), num()]
      const p: Pt = [num(), num()]
      let prev = cur
      for (let k = 1; k <= 16; k++) {
        const t = k / 16
        const pt: Pt = [
          (1 - t) * (1 - t) * cur[0] + 2 * (1 - t) * t * q[0] + t * t * p[0],
          (1 - t) * (1 - t) * cur[1] + 2 * (1 - t) * t * q[1] + t * t * p[1],
        ]
        segs.push([prev, pt])
        prev = pt
      }
      cur = p
    } else if (c === 'Z') { segs.push([cur, start]); cur = start }
  }
  return segs
}

/** Clamp a content height to this kind's silhouette range: never below the base
 *  height, never above the per-kind ceiling. The caller decides *whether* to
 *  grow at all (only when the title has actually wrapped). */
export function clampNodeHeight(kind: NodeKind, measured: number): number {
  return Math.max(BASE_NODE_H, Math.min(Math.round(measured), MAX_NODE_H[kind]))
}
