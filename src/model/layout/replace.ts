// docs/diagram-layout.md §DL2 (issue #344) — re-placing a graph on the grid.
//
// Pure and deterministic: the result depends only on the document (positions,
// connections, frames, waypoints) and the canonical size of each node, which
// the caller passes in (`canonicalBox`, never a DOM or font measurement), so it
// is the same in every language, browser and platform. Ties break by node id.
// Running it on its own result changes nothing (idempotent).
//
//   1. every node: left edge and port row to the nearest grid line
//   2. rows: two RELATED nodes (a flow connects them, or they share a direct
//      flow neighbour) whose port rows were less than 16 px apart share one
//      row; two UNRELATED neighbours whose rows were 8–16 px apart never do
//      (the lower one takes the next grid row)
//   3. overlaps: space is INSERTED — an overlapping pair is separated along
//      the axis its centres are further apart on, by moving every node on the
//      far side (by original centre) by the same grid step, until nothing
//      overlaps; no left/right or above/below order between any two nodes is
//      ever reversed (a row move in step 2 is made only when it reverses none)
//   4. frames: snapped outward, and grown to keep every node they held
//   5. waypoints: snapped; one that lands inside a node is dropped

import type { LoopEdge, LoopNode } from '../types'
import { GRID, PORT_ROW, snapNodePosition, snapPoint, snapRectOutward } from './grid'
import { boxesOverlap, type Box } from './place'

export type FrameLike = { id: string; rect: { x: number; y: number; w: number; h: number } }
export type SizeOf = (node: LoopNode) => { w: number; h: number }

export type ReplaceResult = {
  positions: Record<string, { x: number; y: number }>
  frames: Record<string, { x: number; y: number; w: number; h: number }>
  /** edge id → its waypoints after the move ([] = every waypoint dropped) */
  waypoints: Record<string, { x: number; y: number }[]>
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const isResource = (e: LoopEdge): boolean => !(e.sourceHandle ?? '').startsWith('state') && !(e.targetHandle ?? '').startsWith('state')

export function replaceOnGrid(nodes: readonly LoopNode[], edges: readonly LoopEdge[], frames: readonly FrameLike[], sizeOf: SizeOf): ReplaceResult {
  const sorted = [...nodes].sort(byId)
  const size = new Map(sorted.map((n) => [n.id, sizeOf(n)]))
  const orig = new Map(sorted.map((n) => [n.id, { x: n.position.x, y: n.position.y }]))
  const pos = new Map(sorted.map((n) => [n.id, snapNodePosition(n.position)]))
  const box = (id: string, p = pos.get(id)!): Box => ({ x: p.x, y: p.y, w: size.get(id)!.w, h: size.get(id)!.h })
  const row = (p: { y: number }): number => p.y + PORT_ROW

  // 2. related pairs: a resource connection between them, or a shared direct
  //    flow neighbour (the same source, or the same target)
  const related = new Set<string>()
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const flows = edges.filter(isResource).filter((e) => e.source !== e.target && pos.has(e.source) && pos.has(e.target))
  for (const e of flows) related.add(key(e.source, e.target))
  const outs = new Map<string, string[]>(), ins = new Map<string, string[]>()
  for (const e of flows) {
    ;(outs.get(e.source) ?? outs.set(e.source, []).get(e.source)!).push(e.target)
    ;(ins.get(e.target) ?? ins.set(e.target, []).get(e.target)!).push(e.source)
  }
  for (const group of [...outs.values(), ...ins.values()]) {
    const g = [...new Set(group)].sort()
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) related.add(key(g[i], g[j]))
  }
  const near = (a: string, b: string): boolean => {
    const A = box(a), B = box(b)
    return A.x < B.x + B.w + 4 * GRID && B.x < A.x + A.w + 4 * GRID // within four grid steps sideways
  }
  const ids = sorted.map((n) => n.id)
  const centre = (id: string, p: { x: number; y: number }) => ({ x: p.x + size.get(id)!.w / 2, y: p.y + size.get(id)!.h / 2 })
  const oc = new Map(ids.map((id) => [id, centre(id, orig.get(id)!)]))
  /** a row move of `id` to `target` reverses no above/below order (centres
   *  >= 8 px apart before) with any other node */
  const keepsRows = (id: string, target: { x: number; y: number }): boolean => {
    const c = centre(id, target)
    return ids.every((j) => {
      if (j === id) return true
      const dy = oc.get(id)!.y - oc.get(j)!.y
      if (Math.abs(dy) < 8) return true
      const ny = c.y - centre(j, pos.get(j)!).y
      return ny === 0 || Math.sign(ny) === Math.sign(dy)
    })
  }
  const free = (id: string, target: { x: number; y: number }): boolean => !ids.some((j) => j !== id && boxesOverlap(box(id, target), box(j)))
  // related pairs first (sorted), so a merge is decided before a split
  for (const pair of [...related].sort()) {
    const [a, b] = pair.split('|')
    const d0 = Math.abs(row(orig.get(a)!) - row(orig.get(b)!))
    if (d0 < 0.5 || d0 >= GRID) continue
    const ra = row(pos.get(a)!), rb = row(pos.get(b)!)
    if (ra === rb) continue
    // the lower-sorted id keeps its row; the other joins it if that is free
    // and reverses no other order
    const target = { x: pos.get(b)!.x, y: ra - PORT_ROW }
    if (free(b, target) && keepsRows(b, target)) pos.set(b, target)
  }
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j]
    if (related.has(key(a, b)) || !near(a, b)) continue
    const d0 = row(orig.get(b)!) - row(orig.get(a)!)
    if (Math.abs(d0) < GRID / 2 || Math.abs(d0) >= GRID) continue
    if (row(pos.get(a)!) !== row(pos.get(b)!)) continue
    const lower = d0 > 0 ? b : a
    const target = { x: pos.get(lower)!.x, y: pos.get(lower)!.y + GRID }
    if (free(lower, target) && keepsRows(lower, target)) pos.set(lower, target)
  }

  // 3. overlaps, by INSERTING SPACE: the first overlapping pair (in a fixed
  //    order) is separated along the axis its centres are further apart on,
  //    by moving EVERY node on the far side of it (by original centre) by the
  //    same grid-rounded distance. A set defined by the original centres only
  //    ever moves away from the rest, so no left/right or above/below order
  //    between any two nodes is reversed. Repeats until nothing overlaps.
  const CELL = 128
  const ceilGrid = (v: number): number => Math.ceil(v / GRID) * GRID
  const firstOverlap = (): [string, string] | null => {
    const cells = new Map<string, string[]>()
    for (const id of ids) {
      const b = box(id)
      for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++)
        for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++) (cells.get(`${cx},${cy}`) ?? cells.set(`${cx},${cy}`, []).get(`${cx},${cy}`)!).push(id)
    }
    let best: [string, string] | null = null
    for (const list of cells.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [p, q] = list[i] < list[j] ? [list[i], list[j]] : [list[j], list[i]]
      if (!boxesOverlap(box(p), box(q))) continue
      if (!best || p < best[0] || (p === best[0] && q < best[1])) best = [p, q]
    }
    return best
  }
  for (let iter = 0, pair = firstOverlap(); pair && iter < ids.length * 8; iter++, pair = firstOverlap()) {
    const [p, q] = pair
    const dx = oc.get(q)!.x - oc.get(p)!.x
    const dy = oc.get(q)!.y - oc.get(p)!.y
    const horizontal = Math.abs(dx) >= Math.abs(dy)
    // `near` is the one staying, `far` the one the space opens in front of
    const ahead = horizontal ? dx > 0 || (dx === 0 && q > p) : dy > 0 || (dy === 0 && q > p)
    const [stay, far] = ahead ? [p, q] : [q, p]
    const t = horizontal ? oc.get(far)!.x : oc.get(far)!.y
    const inFar = (id: string): boolean => {
      const v = horizontal ? oc.get(id)!.x : oc.get(id)!.y
      return v > t || (v === t && id >= far)
    }
    const S = box(stay), F = box(far)
    const d = ceilGrid(horizontal ? S.x + S.w - F.x : S.y + S.h - F.y)
    if (d <= 0) break // cannot happen for an overlap; never loop on it
    for (const id of ids) if (inFar(id)) {
      const cur = pos.get(id)!
      pos.set(id, horizontal ? { x: cur.x + d, y: cur.y } : { x: cur.x, y: cur.y + d })
    }
  }

  // 4. frames: outward to the grid, grown to keep the nodes they held
  const outFrames: ReplaceResult['frames'] = {}
  for (const f of [...frames].sort(byId)) {
    const held = ids.filter((id) => {
      const b = box(id, orig.get(id)!)
      return b.x >= f.rect.x && b.y >= f.rect.y && b.x + b.w <= f.rect.x + f.rect.w && b.y + b.h <= f.rect.y + f.rect.h
    })
    let x0 = f.rect.x, y0 = f.rect.y, x1 = f.rect.x + f.rect.w, y1 = f.rect.y + f.rect.h
    for (const id of held) {
      const b = box(id)
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
    }
    outFrames[f.id] = snapRectOutward({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }

  // 5. waypoints
  const outWps: ReplaceResult['waypoints'] = {}
  for (const e of [...edges].sort(byId)) {
    const wps = (e.data as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints
    if (!Array.isArray(wps) || wps.length === 0) continue
    outWps[e.id] = wps.map(snapPoint).filter((p) => !ids.some((id) => {
      const b = box(id)
      return p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h
    }))
  }

  return { positions: Object.fromEntries(ids.map((id) => [id, pos.get(id)!])), frames: outFrames, waypoints: outWps }
}
