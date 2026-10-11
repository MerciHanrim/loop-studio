// Node structure, first implementation — the body's WIDTH under rule W1
// (scratch/share/connection-editing-2/17-implementation-rules.md §4.1; the
// study's NS11 and the sweep's measuring condition).
//
// The width is RESERVED from the document's display format, never from the
// current value, so a running number never moves a node or its ports:
//   Pool      — the wider of the capacity and a six-digit count, then
//               ` / capacity` when a capacity is set, and a sign;
//   Parameter — the AUTHORED value's digits and the unit (an edit of the
//               authored value is a format edit and recomputes; a run never
//               changes an authored value);
//   Register  — six digits and the unit;
//   the picture slot (28 px) when a picture is set — no picture exists in a
//   document yet, so the slot is 0 here;
//   plus the kind's inset: the NARROWEST fill span over the content's height
//   (`outlineReach` of the canonical box: how far the outline's sides reach in
//   anywhere over the stack's height, plus the row clearance);
//   floor 88 px, cap 260 px.
// Text widths use the same upper-bound advances as the canonical box, so the
// result is the same in every language, browser and platform (the name is
// outside the body, so the language never enters it).
// Overflow is NOT handled by this width: a formatted value wider than the
// reservation keeps its format and precision and is elided with a visible
// mark, with the whole value reachable from the Inspector (§4.1); see
// `nodes.tsx`.

import type { LoopNode, NodeKind } from '../../model/types'
import { BASE_NODE_H, fillSpanAt, isFixedDepth, VESSEL_INSET_Y, VESSEL_MIN_PAD_Y } from './silhouette'
import { textWidthBound } from './canonicalBox'
import { ROW_CLEAR } from './rowFit'

export const W1_FLOOR = 88
export const W1_CAP = 260
/** the value row's type (`.nodef__value`): mono, 18 px */
const VALUE_PX = 18
/** the unit's type (`.nodef__unit`): sans, 12 px */
const UNIT_PX = 12
/** the six-digit count a runtime number is reserved for */
const SIX_DIGITS = '999999'
/** the body's inline padding per kind, as `.nodef__body` sets it (canonicalBox PAD) */
const PAD: Record<NodeKind, [number, number]> = {
  pool: [12, 12],
  source: [12, 22],
  drain: [22, 12],
  gate: [26, 26],
  converter: [12, 12],
  end: [12, 24],
  parameter: [15, 15],
  register: [15, 15],
}

/** an authored number as the node shows it (`nodes.tsx` `fmt`); anything that
 *  is not a finite number reserves six digits */
const fmtAuthored = (n: unknown): string =>
  typeof n === 'number' && Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : SIX_DIGITS

/** what the width functions need of a node: its kind and its data as stored */
export type WidthInput = { type: LoopNode['type'] | string | undefined; data: unknown }

/** the reservation text(s) of a node's value row: [mono text, unit text] */
export function reservationOf(node: WidthInput): { mono: string; unit: string } {
  const d = node.data as unknown as Record<string, unknown>
  switch (node.type as NodeKind) {
    case 'pool': {
      // INTENDED CHANGE from NS11's W1 text ("the wider of the capacity and a
      // six-digit count"): a capped Pool's count is bounded by its capacity in
      // the engine, so the row reserves `capacity / capacity` — the study's own
      // pool-cap case ("0 / 10" in 98 px) and what keeps the small body small.
      // Guards: an authored initial value WIDER than the capacity (the document
      // may hold one; the engine clamps at run time but the rest value is shown
      // as authored) reserves its own digits instead; a capacity that is not a
      // finite number counts as none (six digits). Recorded 2026-10-12 after
      // Lumi's review.
      const capN = typeof d.capacity === 'number' && Number.isFinite(d.capacity) ? d.capacity : null
      if (capN == null) return { mono: SIX_DIGITS, unit: '' }
      const cap = String(capN)
      const initial = fmtAuthored(d.initial)
      const count = initial.length > cap.length ? initial : cap
      return { mono: `${count} / ${cap}`, unit: '' }
    }
    case 'parameter':
      return { mono: `-${fmtAuthored(d.value)}`, unit: typeof d.unit === 'string' ? d.unit : '' }
    case 'register':
      return { mono: `-${SIX_DIGITS}`, unit: typeof d.unit === 'string' ? d.unit : '' }
    default:
      return { mono: '', unit: '' }
  }
}

/** the narrowest inner span of the kind's outline over the value row's height
 *  band at the compact height, as [left inset, right inset] incl. the row
 *  clearance — the "narrowest fill span over the content's height" */
function insetOf(kind: NodeKind): [number, number] {
  const h = BASE_NODE_H
  const REF = 1000
  const band = (VESSEL_INSET_Y[kind] ?? 16) / 2 + VESSEL_MIN_PAD_Y
  let l = 0
  let r = 0
  for (let y = band; y <= h - band + 1e-9; y += 1) {
    const s = fillSpanAt(kind, h, y, REF)
    if (!s) continue
    l = Math.max(l, s[0])
    r = Math.max(r, REF - s[1])
  }
  const [pl, pr] = PAD[kind] ?? [12, 12]
  // a 120-wide-viewBox kind stretches its inset with the width; its PAD already
  // holds the drawn depth, so the padding is the inset there
  return isFixedDepth(kind) ? [Math.max(pl, l + ROW_CLEAR), Math.max(pr, r + ROW_CLEAR)] : [pl, pr]
}

/** W1: the body width of a node from its document data alone, in CSS px */
export function reservedWidth(node: WidthInput): number {
  const kind = node.type as NodeKind
  const { mono, unit } = reservationOf(node)
  const text = mono ? textWidthBound(mono, VALUE_PX) + (unit ? textWidthBound(` ${unit}`, UNIT_PX) : 0) : 0
  const [l, r] = insetOf(kind)
  return Math.min(W1_CAP, Math.max(W1_FLOOR, Math.ceil(text + l + r)))
}
