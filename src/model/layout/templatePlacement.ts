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
//      with `FRAME_MARGIN` to spare on every side (snapped outward);
//   3. every connection Auto orthogonal (`route: "orthogonal"`, no waypoints) —
//      except a listed Manual exception (`manual`: edge id → bend points),
//      which is kept only where the router cannot resolve a case by placement.
//
// Pure and deterministic.

import type { LoopEdge, LoopEdgeData, LoopNode } from '../types'
import { GRID } from './grid'
import { replaceOnGrid, type FrameLike } from './replace'
import BOXES from './templateBoxes.json'

export type TemplateName = keyof typeof BOXES

/** the clearance kept between two nodes, flow px: two port stubs and a lane
 *  across, and a row of routes between two node rows */
export const TEMPLATE_GAP = { x: 48, y: 32 } as const
/** the margin a frame keeps around each node it holds (docs/example-coffee-roastery.md §CR17) */
export const FRAME_MARGIN = 24

type Doc<F extends FrameLike> = { nodes: LoopNode[]; edges: LoopEdge[]; frames?: F[] }

export function placeTemplate<F extends FrameLike>(name: TemplateName, doc: Doc<F>, manual: Record<string, { x: number; y: number }[]> = {}): Doc<F> {
  const boxes = BOXES[name] as Record<string, number[]>
  const size = (id: string): { w: number; h: number } => {
    const b = boxes[id]
    if (!b) throw new Error(`placeTemplate(${name}): no measured box for node ${id}`)
    return { w: b[0], h: b[1] }
  }
  const r = replaceOnGrid(doc.nodes, doc.edges, doc.frames ?? [], (n) => {
    const s = size(n.id)
    return { w: s.w + TEMPLATE_GAP.x, h: s.h + TEMPLATE_GAP.y }
  })
  const nodes = doc.nodes.map((n) => {
    const p = r.positions[n.id]
    return p ? { ...n, position: { x: p.x, y: p.y } } : n
  })

  // 2. a frame travels with the nodes it holds — those whose centre was inside
  //    it BEFORE the move (by their real size): it is rebuilt around where they
  //    now are, keeping its own padding on each side (at least `FRAME_MARGIN`),
  //    snapped outward. A frame that holds no node keeps the grid's rect.
  const bbox = (ids: string[], at: (id: string) => { x: number; y: number }) => {
    const xs = ids.map((id) => at(id).x)
    const ys = ids.map((id) => at(id).y)
    const x1s = ids.map((id) => at(id).x + size(id).w)
    const y1s = ids.map((id) => at(id).y + size(id).h)
    return { x: Math.min(...xs), y: Math.min(...ys), x1: Math.max(...x1s), y1: Math.max(...y1s) }
  }
  const origAt = new Map(doc.nodes.map((n) => [n.id, n.position]))
  const frames = doc.frames?.map((f) => {
    const members = doc.nodes
      .filter((n) => {
        const s = size(n.id)
        const cx = n.position.x + s.w / 2
        const cy = n.position.y + s.h / 2
        return cx >= f.rect.x && cx <= f.rect.x + f.rect.w && cy >= f.rect.y && cy <= f.rect.y + f.rect.h
      })
      .map((n) => n.id)
    if (members.length === 0) return { ...f, rect: r.frames[f.id] ?? f.rect }
    const b0 = bbox(members, (id) => origAt.get(id)!)
    const b1 = bbox(members, (id) => r.positions[id] ?? origAt.get(id)!)
    const pad = {
      l: Math.max(FRAME_MARGIN, b0.x - f.rect.x),
      t: Math.max(FRAME_MARGIN, b0.y - f.rect.y),
      r: Math.max(FRAME_MARGIN, f.rect.x + f.rect.w - b0.x1),
      b: Math.max(FRAME_MARGIN, f.rect.y + f.rect.h - b0.y1),
    }
    const x0 = Math.floor((b1.x - pad.l) / GRID) * GRID
    const y0 = Math.floor((b1.y - pad.t) / GRID) * GRID
    const x1 = Math.ceil((b1.x1 + pad.r) / GRID) * GRID
    const y1 = Math.ceil((b1.y1 + pad.b) / GRID) * GRID
    return { ...f, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }
  })

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
  return { ...doc, nodes, edges, ...(frames ? { frames } : {}) }
}
