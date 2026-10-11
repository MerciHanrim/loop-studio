// docs/diagram-layout.md §DL5 (issue #344 step 4) — how a bundled Template is
// placed. Every Template's source (its builder, its generator script, or for the
// two small ones the file itself) goes through this ONE function, so the
// shipped file is always reproducible from its source:
//
//   1. `replaceOnGrid` (§DL2: order-keeping, space is inserted, no left/right or
//      above/below order between two nodes is ever reversed), with each node
//      sized by its WIDEST real box over the 18 languages (`templateBoxes.json`,
//      measured on the running app) plus a clearance (`TEMPLATE_GAP`) — room
//      for the 16 px port stubs on both sides and a fan's branch after them, so
//      no language puts a node over another's port;
//   2. every saved frame grown to hold each node whose centre is inside it,
//      with `FRAME_MARGIN` to spare on every side (snapped outward); two frames
//      that stood apart keep `FRAME_GAP` between them (space inserted, order
//      kept);
//   3. every connection Auto orthogonal (`route: "orthogonal"`, no waypoints) —
//      except a listed Manual exception (`manual`: edge id → bend points),
//      which is kept only where the router cannot resolve a case by placement.
//
// Pure and deterministic.

import type { LoopEdge, LoopEdgeData, LoopNode } from '../types'
import { GRID } from './grid'
import { centreInside, FRAME_MARGIN, LAYOUT_CLEARANCE, rebuildFrameRect } from './frameRebuild'
import { replaceOnGrid, type FrameLike } from './replace'
import BOXES from './templateBoxes.json'

export type TemplateName = keyof typeof BOXES

/** the clearance kept between two nodes (the same as every re-placement's, §DL2.9) */
export const TEMPLATE_GAP = LAYOUT_CLEARANCE
export { FRAME_MARGIN }
/** the space kept between two frames that stood apart: room for a frame's title
 *  between it and its neighbour (two frames' margins alone would make them touch) */
export const FRAME_GAP = 32

type Doc<F extends FrameLike> = { nodes: LoopNode[]; edges: LoopEdge[]; frames?: F[] }

/** the clearance between two nodes' boxes, per Template. `TEMPLATE_GAP` (48 ×
 *  32, §DL5.2) was measured for today's node, whose box is the body alone.
 *  Under the NODE STRUCTURE a node's box is its body AND its outside name (up
 *  to 150 px wide, two or three lines tall, `templateBoxes.json` measured that
 *  way), so the same clearance pushes a hand-placed diagram apart by a name's
 *  width per column and a name's height per row — the Coffee trial of
 *  2026-10-12 grew back to today's extent. A Template placed by hand under the
 *  node structure declares its own clearance here (TRIAL value for Coffee: 0 —
 *  the measured boxes still drive the overlap separation, the frame rebuild
 *  and the 18-language sweep; decided with Lumi, share 23-coffee-replace.md). */
export const TEMPLATE_GAPS: Partial<Record<TemplateName, { x: number; y: number }>> = {
  'coffee-roastery': { x: 0, y: 0 },
}
export const gapFor = (name: TemplateName): { x: number; y: number } => TEMPLATE_GAPS[name] ?? TEMPLATE_GAP

/** a measured box entry: `[w, h]` for today's node (the body, anchored at the
 *  node position), or `[w, h, dx, dy, bw, bh]` under the node structure — the
 *  box is the body AND the outside name, `dx` / `dy` (≤ 0) its origin relative
 *  to the node position when the name sits above or left, `bw` / `bh` the body
 *  alone (what membership uses). */
export type MeasuredBox = { w: number; h: number; dx: number; dy: number; bw: number; bh: number }
export const readBox = (b: readonly number[]): MeasuredBox => ({ w: b[0]!, h: b[1]!, dx: b[2] ?? 0, dy: b[3] ?? 0, bw: b[4] ?? b[0]!, bh: b[5] ?? b[1]! })

export function placeTemplate<F extends FrameLike>(name: TemplateName, doc: Doc<F>, manual: Record<string, { x: number; y: number }[]> = {}): Doc<F> {
  return placeWithBoxes(name, BOXES[name] as Record<string, number[]>, gapFor(name), doc, manual)
}

/** `placeTemplate` with the boxes and the clearance given — the same function,
 *  so a test can feed boxes with a name above or left of the body */
export function placeWithBoxes<F extends FrameLike>(name: string, boxes: Record<string, readonly number[]>, gap: { x: number; y: number }, doc: Doc<F>, manual: Record<string, { x: number; y: number }[]> = {}): Doc<F> {
  const size = (id: string): MeasuredBox => {
    const b = boxes[id]
    if (!b) throw new Error(`placeTemplate(${name}): no measured box for node ${id}`)
    return readBox(b)
  }
  const r = replaceOnGrid(doc.nodes, doc.edges, doc.frames ?? [], (n) => {
    const s = size(n.id)
    return { w: s.w + gap.x, h: s.h + gap.y, dx: s.dx, dy: s.dy, bw: s.bw, bh: s.bh }
  })
  // 2. a frame travels with the nodes it holds — those whose BODY centre was
  //    inside it BEFORE the move (a name never decides membership): it is
  //    rebuilt around where their whole boxes (body ∪ name) now are, keeping
  //    its own padding on each side (at least `FRAME_MARGIN`), snapped outward
  //    (`rebuildFrameRect`). A frame that holds no node keeps the grid's rect.
  const origAt = new Map(doc.nodes.map((n) => [n.id, n.position]))
  const at = new Map(doc.nodes.map((n) => [n.id, r.positions[n.id] ?? n.position]))
  /** the whole box (body ∪ name) at `where`, its origin offset by dx / dy */
  const boxAt = (where: Map<string, { x: number; y: number }>) => (id: string) => { const p = where.get(id)!; const s = size(id); return { x: p.x + s.dx, y: p.y + s.dy, w: s.w, h: s.h } }
  /** the body alone at `where`, anchored at the position */
  const bodyAt = (where: Map<string, { x: number; y: number }>) => (id: string) => { const p = where.get(id)!; const s = size(id); return { x: p.x, y: p.y, w: s.bw, h: s.bh } }
  const build = () => doc.frames?.map((f) => {
    const members = doc.nodes.filter((n) => centreInside(bodyAt(origAt)(n.id), f.rect)).map((n) => n.id)
    return { ...f, rect: rebuildFrameRect(f.rect, members, boxAt(origAt), boxAt(at), r.frames[f.id] ?? f.rect) }
  })

  // 2b. two frames that stood apart keep `FRAME_GAP` between them (the lower or
  //     right one's title sits in that gap): space is INSERTED as in §DL2 —
  //     every node whose centre lies beyond the nearer frame's far edge moves
  //     by the same grid step, so no order between two nodes is reversed and
  //     no clearance shrinks
  const apart = (a: FrameLike['rect'], b: FrameLike['rect']) => ({
    x: Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)),
    y: Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)),
  })
  const sortedFrames = [...(doc.frames ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  let frames = build()
  for (let iter = 0; frames && iter < sortedFrames.length * sortedFrames.length; iter++) {
    const rect = new Map(frames.map((f) => [f.id, f.rect]))
    let shift: { axis: 'x' | 'y'; t: number; d: number } | null = null
    for (let i = 0; i < sortedFrames.length && !shift; i++)
      for (let j = i + 1; j < sortedFrames.length && !shift; j++) {
        const g0 = apart(sortedFrames[i]!.rect, sortedFrames[j]!.rect)
        if (g0.x < 0 && g0.y < 0) continue // they overlapped before: not this rule's case
        const axis = g0.x >= g0.y ? 'x' : 'y'
        const A = rect.get(sortedFrames[i]!.id)!, B = rect.get(sortedFrames[j]!.id)!
        const gap = apart(A, B)[axis]
        if (gap >= FRAME_GAP) continue
        const [near] = axis === 'x' ? (A.x <= B.x ? [A, B] : [B, A]) : A.y <= B.y ? [A, B] : [B, A]
        shift = { axis, t: axis === 'x' ? near.x + near.w : near.y + near.h, d: Math.ceil((FRAME_GAP - gap) / GRID) * GRID }
      }
    if (!shift) break
    for (const n of doc.nodes) {
      const p = at.get(n.id)!
      // the BODY's centre decides which side of the gap a node is on
      const c = shift.axis === 'x' ? p.x + size(n.id).bw / 2 : p.y + size(n.id).bh / 2
      if (c > shift.t) at.set(n.id, shift.axis === 'x' ? { x: p.x + shift.d, y: p.y } : { x: p.x, y: p.y + shift.d })
    }
    frames = build()
  }
  const placed = doc.nodes.map((n) => ({ ...n, position: { ...at.get(n.id)! } }))

  // 3. Auto orthogonal, or a listed Manual exception
  const edges = doc.edges.map((e) => {
    if (!e.data) return e
    const { route: _r, waypoints: _w, accent, ...rest } = e.data as LoopEdgeData & { accent?: unknown }
    const wps = manual[e.id]
    return {
      ...e,
      data: { ...rest, route: 'orthogonal', ...(wps ? { waypoints: wps.map((p) => ({ x: p.x, y: p.y })) } : {}), ...(accent !== undefined ? { accent } : {}) } as LoopEdgeData,
    }
  })
  return { ...doc, nodes: placed, edges, ...(frames ? { frames } : {}) }
}
