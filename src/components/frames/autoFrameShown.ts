import type { LoopEdge, LoopNode, NodeKind, PortFace } from '../../model/types'
import type { FrameRect } from '../../store/frameStore'
import { faceOf, nameFaceFor } from '../../model/ports'
import { AUX_LINE_H, CELL, CENTRE, LABEL_GAP, LABEL_MAX_W, NAME_LINE_H, SYMBOLS } from '../nodes/symbol'

// docs/large-graph-readability-auto-frames.md §AF8 — the SHOWN rect of a
// suggested frame, under the node structure whose names stand outside the
// body. The algorithm's rect (R0, `autoFrames.ts`) is untouched: it alone
// decides the candidates, the drops, the grouping, the order and the labels.
// R0 wraps a canonical 150 × 40 box per node, which no longer holds a symbol's
// outside name; the shown rect grows R0 to its members' displayed extent where
// that is safe. A partial fix (2026-10-22): what it cannot hold is reported.
//
// Deterministic, like R0: it reads a node's kind, position, its connected
// faces and whether its data has a capacity / unit — never the DOM, a measured
// size or any label text. So the name is taken as ONE line at the label's full
// width (`LABEL_MAX_W`); a longer name, and the value line a number too wide for
// its symbol adds at run time, are not held (a recorded limit).
//
// Safe = a side grows only while it reaches no non-member's body or label any
// more than R0 does, newly takes no non-member node fully inside (a frame drag
// would carry it, frameMoveGesture.ts) and newly takes no saved manual frame
// fully inside (it would ride along), and runs no border newly through a
// member's own name. Every combination of the sides that want to grow is
// checked as a whole; the largest safe one is kept.

export type Box = FrameRect
export type Side = 'top' | 'right' | 'bottom' | 'left'
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']

/** room around a member's displayed extent */
export const SHOWN_PAD = 4

const kindOf = (n: LoopNode): NodeKind => ((n.data as { kind?: string } | undefined)?.kind ?? n.type) as NodeKind
const symbolOf = (n: LoopNode) => SYMBOLS[kindOf(n)] ?? SYMBOLS.pool

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
const contains = (o: Box, i: Box): boolean => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h
/** a border line of `r` runs through the inside of `b` */
function crosses(r: Box, b: Box): boolean {
  const inY = b.y < r.y + r.h && r.y < b.y + b.h
  const inX = b.x < r.x + r.w && r.x < b.x + b.w
  const thru = (v: number, lo: number, hi: number) => lo < v && v < hi
  return (inY && (thru(r.x, b.x, b.x + b.w) || thru(r.x + r.w, b.x, b.x + b.w))) || (inX && (thru(r.y, b.y, b.y + b.h) || thru(r.y + r.h, b.y, b.y + b.h)))
}
const area = (b: Box): number => b.w * b.h

/** the node's cell: what React Flow measures for a symbol node, so what a
 *  frame drag tests for "fully inside" */
export const cellBoxOf = (n: LoopNode): Box => ({ x: n.position.x, y: n.position.y, w: CELL, h: CELL })

/** the body: the cell and the symbol (a gate or register overflows the cell) */
export function bodyBoxOf(n: LoopNode): Box {
  const s = symbolOf(n)
  return union(cellBoxOf(n), { x: n.position.x + CENTRE - s.hw, y: n.position.y + CENTRE - s.hh, w: 2 * s.hw, h: 2 * s.hh })
}

/** whether the node's label has an aux line from its data (a pool's capacity,
 *  a parameter's or register's unit) — nodes.tsx's `aux` */
export function hasAuxLine(n: LoopNode): boolean {
  const d = (n.data ?? {}) as { capacity?: unknown; unit?: unknown }
  const k = kindOf(n)
  if (k === 'pool') return d.capacity != null
  if (k === 'parameter' || k === 'register') return typeof d.unit === 'string' && d.unit.length > 0
  return false
}

/** the faces each node's connections use (nodes.tsx's `usedFacesKey`) */
export function usedFacesOf(edges: readonly LoopEdge[]): Map<string, Set<PortFace>> {
  const out = new Map<string, Set<PortFace>>()
  const add = (id: string, f: PortFace) => {
    let s = out.get(id)
    if (!s) out.set(id, (s = new Set()))
    s.add(f)
  }
  for (const e of edges) {
    add(e.source, faceOf(e, 'source'))
    add(e.target, faceOf(e, 'target'))
  }
  return out
}

/** the label's box on its face, at the label gap from the symbol, one name
 *  line (+ the aux line) at the label's full width — the CSS placement of
 *  `.nodef__label--<face>` (nodeStructure.css) with the text taken as its
 *  largest one-line extent */
export function labelBoxOf(n: LoopNode, used: ReadonlySet<PortFace> | undefined): Box {
  const s = symbolOf(n)
  const face = nameFaceFor(used ?? new Set())
  const w = LABEL_MAX_W
  const h = NAME_LINE_H + (hasAuxLine(n) ? AUX_LINE_H : 0)
  const cx = n.position.x + CENTRE
  const cy = n.position.y + CENTRE
  switch (face) {
    case 'top':
      return { x: cx - w / 2, y: cy + s.face.top.y - LABEL_GAP - h, w, h }
    case 'left':
      return { x: cx - s.hw - LABEL_GAP - w, y: cy - h / 2, w, h }
    case 'right':
      return { x: cx + s.hw + LABEL_GAP, y: cy - h / 2, w, h }
    default:
      return { x: cx - w / 2, y: cy + s.face.bottom.y + LABEL_GAP, w, h }
  }
}

export type Shown = {
  /** the rect to draw, select, move, resize and promote from */
  rect: FrameRect
  /** sides the members' extent wanted beyond R0 that stayed at R0 for safety */
  held: Side[]
}

const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d })
/** R0 with the chosen sides moved out to `target`'s, on whole flow px (outward) */
function withSides(r0: Box, target: Box, sides: readonly Side[]): Box {
  let x0 = r0.x
  let y0 = r0.y
  let x1 = r0.x + r0.w
  let y1 = r0.y + r0.h
  if (sides.includes('left')) x0 = Math.min(x0, Math.floor(target.x))
  if (sides.includes('top')) y0 = Math.min(y0, Math.floor(target.y))
  if (sides.includes('right')) x1 = Math.max(x1, Math.ceil(target.x + target.w))
  if (sides.includes('bottom')) y1 = Math.max(y1, Math.ceil(target.y + target.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * The shown rect of one suggested frame. `r0` and `members` come from
 * `suggestFrames`; `nodes` / `edges` are the graph; `manualFrames` the saved
 * frames. Integer coordinates, like R0.
 */
export function shownRect(
  r0: FrameRect,
  members: readonly string[],
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
  manualFrames: readonly { rect: FrameRect }[],
): Shown {
  const used = usedFacesOf(edges)
  const inSet = new Set(members)
  let target: Box = r0
  const memberNames: Box[] = []
  for (const n of nodes) {
    if (!inSet.has(n.id) || n.hidden) continue
    const name = labelBoxOf(n, used.get(n.id))
    memberNames.push(name)
    target = union(target, grow(union(bodyBoxOf(n), name), SHOWN_PAD))
  }
  const wanted = SIDES.filter((s) => area(withSides(r0, target, [s])) > area(r0))
  if (wanted.length === 0) return { rect: r0, held: [] }

  const blockers: Box[] = []
  const carried: Box[] = []
  for (const n of nodes) {
    if (inSet.has(n.id) || n.hidden) continue
    blockers.push(bodyBoxOf(n), labelBoxOf(n, used.get(n.id)))
    carried.push(cellBoxOf(n))
  }
  for (const f of manualFrames) carried.push(f.rect)
  // and no border newly runs through a member's own name: a held side's
  // border, carried further by the side across, would (2026-10-22)
  const safe = (c: Box): boolean =>
    blockers.every((b) => overlap(c, b) <= overlap(r0, b) + 1e-6) &&
    carried.every((b) => !contains(c, b) || contains(r0, b)) &&
    memberNames.every((b) => !crosses(c, b) || crosses(r0, b))

  // every combination of the wanted sides (at most 15), the largest safe one
  // kept (fixed order on a tie) — not only those safe alone: a side can be
  // safe only together with the one across (alone, the border it leaves would
  // run through a member's name)
  let best: { sides: Side[]; rect: Box } = { sides: [], rect: r0 }
  for (let mask = 1; mask < 1 << wanted.length; mask++) {
    const sides = wanted.filter((_, i) => mask & (1 << i))
    const rect = withSides(r0, target, sides)
    if (safe(rect) && area(rect) > area(best.rect)) best = { sides, rect }
  }
  return { rect: best.rect, held: wanted.filter((s) => !best.sides.includes(s)) }
}
