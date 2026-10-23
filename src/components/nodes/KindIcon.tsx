import type { NodeKind } from '../../model/types'
import { PARAMETER_BASELINE, SYMBOLS } from './symbol'

// A node kind's SMALL mark (2026-10-21): the canvas symbol's own outline
// (`SYMBOLS`, one definition), for the tool row's Add buttons and the left
// list's rows, so the three places draw one shape per kind — a Source a
// triangle pointing down, a Drain one pointing up, an End an octagon. Only the
// outline: the value, the name and the inner role mark belong to the canvas.
// The parameter keeps its baseline, the one static mark of its symbol.
//
// Drawn for 16 px: the stroke stays 1.3 px whatever the size (`vector-effect`
// in index.css), its corners mitred. Every kind shares its canvas symbol's base
// outline; only the small End adds an identifying square (below, approved by
// Lumi 2026-10-21), which an outline alone cannot give it at this size. The
// canvas End stays a plain octagon.

/** every symbol's box fits (the register, 68 wide, and the gate, 62, overflow
 *  the 56 cell): 3 units of room past the widest, on every side */
const VIEWBOX = '-9 -9 74 74'

/** the End at 16 px: the same octagon with its eight sides on pixel edges
 *  (flats inset 0.55 px), and a small filled square inside, 4 × 4 px — the
 *  small mark's own cue, not the canvas symbol's. Measured 2026-10-21 (scratch
 *  end-mark board, 1×, light and dark): every outline-only octagon at this size
 *  read as the Pool's circle, mitred, pixel-aligned or at 1 / 1.3 / 1.6 px; a
 *  bar inside read as minus (the old Drain mark) and a filled octagon as a dot.
 *  In the viewBox's units: px × 74 / 16 − 9 */
const END_16 = 'M16.44 2.56H39.56L53.44 16.44V39.56L39.56 53.44H16.44L2.56 39.56V16.44Z'
const END_16_STOP = 'M18.75 18.75H37.25V37.25H18.75Z'

export function KindIcon({ kind, className }: { kind: NodeKind; className?: string }) {
  const s = SYMBOLS[kind] ?? SYMBOLS.pool
  const b = PARAMETER_BASELINE
  return (
    <svg className={`kind-icon${className ? ` ${className}` : ''}`} viewBox={VIEWBOX} aria-hidden="true" focusable="false" data-kind={kind}>
      <path d={kind === 'end' ? END_16 : s.path} />
      {kind === 'end' ? <path className="kind-icon__fill" d={END_16_STOP} /> : null}
      {kind === 'parameter' ? <path d={`M${b.x1} ${b.y}H${b.x2}`} /> : null}
    </svg>
  )
}
