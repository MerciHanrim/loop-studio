import type { NodeKind, PortFace } from '../../model/types'

// The workbench redesign (2026-10), step 4 — SYMBOL nodes. Each kind is one
// small line-geometry symbol, the value (if any) inside, the name outside
// (share notes 86–87: the approved forms, `shapes2.js`; sizes from the
// workbench mock-up `workbench-free3.js`).
//
// THE CELL. Every kind occupies the same 56 × 56 cell at the node's stored
// position, and its symbol is centred on the cell's centre (28, 28). That
// centre is the old port row (`PORT_ROW` = 28 = half of the old 56 px body),
// so a document's stored positions keep their resource ports on the same row
// and no node is moved (docs/diagram-layout.md §DL1.2 / §DL1.4). A symbol a
// little larger than the cell (the gate's diamond, 62; the register, 68 wide)
// overflows it by a few px; the router is given the symbol's own box.
//
// THE ENDS. A connection ends ON the symbol's outline: each face's anchor is
// the outline point straight out from the centre on that side.
//
// Approved: pool (circle), gate (diamond), converter (flat hexagon),
// parameter (square with a baseline under the value), register (wide readout);
// and, confirmed on the product screen (Lumi, 2026-10-20), source (a triangle
// pointing down), drain (a triangle pointing up — the mock-up had no drain)
// and end (an octagon). The small marks of the tool row and the left list are
// these outlines (KindIcon.tsx).

/** the cell every symbol is centred in; its centre is the old port row */
export const CELL = 56
export const CENTRE = CELL / 2

/** the outside label (the aux line over the name) stands this far from the
 *  symbol's box on its face — past every ring (selection 4.5, invalid 8.5, the
 *  fired ticks 9–11). The node sets it as `--label-gap` (nodes.tsx), so the CSS
 *  placement (nodeStructure.css `.nodef__label--*`) and a reader of the geometry
 *  (frames/autoFrameShown.ts) use the one value. */
export const LABEL_GAP = 12
/** the label's type box, as nodeStructure.css sets it (`.nodef__label`
 *  max-width; `.nodef__name` / `.nodef__aux` line heights) — checked against
 *  the stylesheet by symbol.test.ts */
export const LABEL_MAX_W = 136
export const NAME_LINE_H = 17
export const AUX_LINE_H = 15

type Pt = { x: number; y: number }
type Symbol = {
  /** half width and half height of the symbol's bounding box */
  hw: number
  hh: number
  /** the outline, in cell coordinates (centre at CENTRE, CENTRE) */
  path: string
  /** where a connection on each face meets the outline, relative to the centre */
  face: Record<PortFace, Pt>
}

const c = CENTRE
const r2 = (v: number) => Math.round(v * 100) / 100

/** a triangle with its flat side at `flatY` and its point at `tipY` (relative
 *  to the centre), half-width `hb` at the flat side */
function triangle(flatY: number, tipY: number, hb: number): Symbol {
  // the outline's half-width at the centre's height (y = 0)
  const half = r2((hb * (tipY - 0)) / (tipY - flatY))
  const top = Math.min(flatY, tipY)
  const bottom = Math.max(flatY, tipY)
  return {
    hw: hb,
    hh: Math.max(-top, bottom),
    path: `M${c - hb} ${c + flatY}H${c + hb}L${c} ${c + tipY}Z`,
    face: { left: { x: -half, y: 0 }, right: { x: half, y: 0 }, top: { x: 0, y: top }, bottom: { x: 0, y: bottom } },
  }
}

const box = (hw: number, hh: number, rx: number): Pick<Symbol, 'hw' | 'hh' | 'path' | 'face'> => ({
  hw,
  hh,
  path:
    `M${c - hw + rx} ${c - hh}H${c + hw - rx}Q${c + hw} ${c - hh} ${c + hw} ${c - hh + rx}` +
    `V${c + hh - rx}Q${c + hw} ${c + hh} ${c + hw - rx} ${c + hh}H${c - hw + rx}` +
    `Q${c - hw} ${c + hh} ${c - hw} ${c + hh - rx}V${c - hh + rx}Q${c - hw} ${c - hh} ${c - hw + rx} ${c - hh}Z`,
  face: { left: { x: -hw, y: 0 }, right: { x: hw, y: 0 }, top: { x: 0, y: -hh }, bottom: { x: 0, y: hh } },
})

const OCT = 11.6 // the octagon's half side, the mock-up's
export const SYMBOLS: Record<NodeKind, Symbol> = {
  // a circle of radius 28
  pool: {
    hw: 28,
    hh: 28,
    path: `M${c - 28} ${c}A28 28 0 1 0 ${c + 28} ${c}A28 28 0 1 0 ${c - 28} ${c}Z`,
    face: { left: { x: -28, y: 0 }, right: { x: 28, y: 0 }, top: { x: 0, y: -28 }, bottom: { x: 0, y: 28 } },
  },
  // a diamond, 31 from the centre to each point
  gate: {
    hw: 31,
    hh: 31,
    path: `M${c} ${c - 31}L${c + 31} ${c}L${c} ${c + 31}L${c - 31} ${c}Z`,
    face: { left: { x: -31, y: 0 }, right: { x: 31, y: 0 }, top: { x: 0, y: -31 }, bottom: { x: 0, y: 31 } },
  },
  // a flat hexagon: points 30 to the sides, flat top and bottom 16 wide, 22 high
  converter: {
    hw: 30,
    hh: 22,
    path: `M${c - 30} ${c}L${c - 16} ${c - 22}H${c + 16}L${c + 30} ${c}L${c + 16} ${c + 22}H${c - 16}Z`,
    face: { left: { x: -30, y: 0 }, right: { x: 30, y: 0 }, top: { x: 0, y: -22 }, bottom: { x: 0, y: 22 } },
  },
  // a 52 square with a baseline under the value (`PARAMETER_BASELINE`)
  parameter: box(26, 26, 5),
  // a 68 × 44 readout; the value reads `= …`
  register: box(34, 22, 4),
  // a triangle pointing down, flat at −22, point at +26
  source: triangle(-22, 26, 28),
  // a triangle pointing up (the source's mirror), point at −26
  drain: triangle(22, -26, 28),
  // an octagon, 28 from the centre to each flat side
  end: {
    hw: 28,
    hh: 28,
    path:
      `M${c - OCT} ${c - 28}H${c + OCT}L${c + 28} ${c - OCT}V${c + OCT}L${c + OCT} ${c + 28}` +
      `H${c - OCT}L${c - 28} ${c + OCT}V${c - OCT}Z`,
    face: { left: { x: -28, y: 0 }, right: { x: 28, y: 0 }, top: { x: 0, y: -28 }, bottom: { x: 0, y: 28 } },
  },
}

/** the parameter's static mark: a baseline under the value, as on an entry field */
export const PARAMETER_BASELINE = { x1: c - 13, x2: c + 13, y: c + 12 } as const

/** a face's anchor in CELL coordinates (from the cell's top-left): the
 *  outline point straight out from the centre, for every port on that face.
 *  A resource and a state port on one face are therefore one point; the
 *  handles of the connection kind chosen in the tool row are on top there —
 *  its output at rest, its input while a connection is drawn
 *  (nodeStructure.css, `nodef--kind-*` / `nodef--connecting`) — so any face
 *  starts and takes a connection of the chosen kind, and the kind never
 *  depends on which handle took the press (src/model/connectKind.ts).
 *  Lanes of 10 and 14 px were tried and dropped: on a 56 px symbol the
 *  neighbouring port then lies inside a grip's 24 px target and vertical ends
 *  lose their grips (copies kept with the QA material). */
export function symbolAnchor(kind: NodeKind, face: PortFace, _port: 'in' | 'out' | 'state' = 'state'): Pt {
  const f = (SYMBOLS[kind] ?? SYMBOLS.pool).face[face]
  return { x: CENTRE + f.x, y: CENTRE + f.y }
}

/** the symbol's bounding box in CELL coordinates — what the router keeps lines
 *  out of (it can overflow the cell by a few px) */
export function symbolBox(kind: NodeKind): { x: number; y: number; w: number; h: number } {
  const s = SYMBOLS[kind] ?? SYMBOLS.pool
  return { x: CENTRE - s.hw, y: CENTRE - s.hh, w: 2 * s.hw, h: 2 * s.hh }
}

/** the width a value may take inside its symbol, px: the outline's inner span
 *  at the value row less 5 px each side (the stroke and the flow-colour band) —
 *  a circle's chord at ±7 px from the centre, the square's and the readout's
 *  inner widths */
export const VALUE_ROOM: Partial<Record<NodeKind, number>> = { pool: 44, parameter: 42, register: 58 }
/** the value's type size: the workbench's 16 px (15 in a readout). A value
 *  wider than its symbol is ELIDED there, never shrunk (the standing overflow
 *  rule, Lumi 2026-10-12: no precision and no size change for space), and
 *  written in full on the line beside the symbol (nodes.tsx), so it is never
 *  only cut short (Lumi 2026-10-19) */
export const VALUE_SIZE = { pool: 16, parameter: 16, register: 15 } as const

/** whether a value of one-line width `widthAt(size)` fits `kind`'s symbol at
 *  the value size */
export function symbolValueFits(kind: NodeKind, widthAt: (size: number) => number): boolean {
  const size = kind === 'register' ? VALUE_SIZE.register : kind === 'parameter' ? VALUE_SIZE.parameter : VALUE_SIZE.pool
  return widthAt(size) <= (VALUE_ROOM[kind] ?? 44)
}
