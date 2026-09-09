// docs/mmo-multilingual-layout.md §MML1b — height-parametric vessel silhouettes.
//
// The node body can grow past the historic 64px once a title wraps to two
// lines. A `preserveAspectRatio="none"` SVG would then distort every shape, so
// each of the seven kinds gets its own path function: the top and bottom cap
// regions keep their pixel offsets, corner radii / notch / endbar are fixed,
// and only the straight middle stretches. At `h = 64` every function returns a
// path pixel-identical to the previous hard-coded silhouette (asserted by
// `silhouette.test.ts`).
//
// The SVG viewBox is `0 0 120 h`; the x geometry (width 120) never changes.

import type { NodeKind } from '../../model/types'

/** The design height every silhouette was drawn at. */
export const BASE_NODE_H = 64

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

/** The exact historic paths, returned verbatim at the base height so every
 *  non-grown node (equilibrium / deadlock, short user labels, most of Coffee)
 *  is byte-identical to before this change — no visual-snapshot churn.
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
 *  ≥ 2.75 parameter). The top+bottom cap offsets are
 *  UNCHANGED (`y12 … H−12`, `VESSEL_INSET_Y` still 24) — #167's height growth is
 *  untouched. (A true stadium / semicircular-ended capsule cannot contain the
 *  content: it pinches in hard exactly where the chip / title corner sits,
 *  4 px below the top edge.) */
const BASE: Record<NodeKind, string> = {
  pool: 'M32 6 H88 Q95 6 96 13 L112 52 Q113 58 107 58 H13 Q7 58 8 52 L24 13 Q25 6 32 6 Z',
  source: 'M14 8 Q8 8 8 14 V50 Q8 56 14 56 H84 L114 32 L84 8 Z',
  drain: 'M6 32 L34 8 H104 Q112 8 112 15 V49 Q112 56 104 56 H34 Z',
  gate: 'M60 3 L117 32 L60 61 L3 32 Z',
  converter:
    'M14 8 H106 Q112 8 112 14 L82 32 L112 50 Q112 56 106 56 H14 Q8 56 8 50 L38 32 L8 14 Q8 8 14 8 Z',
  end: 'M28 8 H92 Q112 8 112 32 Q112 56 92 56 H28 Q8 56 8 32 Q8 8 28 8 Z',
  parameter: 'M14 12 H106 Q112 12 112 18 V46 Q112 52 106 52 H14 Q8 52 8 46 V40 H1 V24 H8 V18 Q8 12 14 12 Z',
  register: 'M14 12 H110 Q118 12 118 32 Q118 52 110 52 H14 Q6 52 6 32 Q6 12 14 12 Z',
}

/** The vessel outline for `kind` at body height `h` (viewBox `0 0 120 h`). */
export function silhouettePath(kind: NodeKind, h = BASE_NODE_H): string {
  const H = Math.max(BASE_NODE_H, Math.min(h, MAX_NODE_H[kind]))
  if (H <= BASE_NODE_H) return BASE[kind]
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
      // fixed cap radius (Q through x112/y-cap); a straight V is inserted for growth
      return `M28 8 H92 Q112 8 112 32 V${n(H - 32)} Q112 ${n(H - 8)} 92 ${n(H - 8)} H28 Q8 ${n(H - 8)} 8 ${n(H - 32)} V32 Q8 8 28 8 Z`
    case 'parameter':
      // body `x8…112` r6; left tab `x1…8` × `mid ± 8` (historic notch height),
      // centred on the left edge's vertical middle
      return `M14 12 H106 Q112 12 112 18 V${n(H - 18)} Q112 ${n(H - 12)} 106 ${n(H - 12)} H14 Q8 ${n(H - 12)} 8 ${n(H - 18)} V${n(mid + 8)} H1 V${n(mid - 8)} H8 V18 Q8 12 14 12 Z`
    case 'register':
      // flattened lozenge: edges `x14…110`, elliptical ends bulging to x6 / x118
      // at mid-height; a straight V grows the middle (identical structure to the
      // historic capsule, just wider + flatter-topped)
      return `M14 12 H110 Q118 12 118 32 V${n(H - 32)} Q118 ${n(H - 12)} 110 ${n(H - 12)} H14 Q6 ${n(H - 12)} 6 ${n(H - 32)} V32 Q6 12 14 12 Z`
  }
}

/** Clamp a content height to this kind's silhouette range: never below the base
 *  height, never above the per-kind ceiling. The caller decides *whether* to
 *  grow at all (only when the title has actually wrapped). */
export function clampNodeHeight(kind: NodeKind, measured: number): number {
  return Math.max(BASE_NODE_H, Math.min(Math.round(measured), MAX_NODE_H[kind]))
}
