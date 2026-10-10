// docs/diagram-layout.md §DL2.8 (issue #344) — the one-time layout conversion.
//
// A document whose `layoutVersion` is older than `LAYOUT_VERSION` is re-placed
// on the grid ONCE, when it is opened, before its history starts: never an
// undo entry. The result follows only from the document and the canonical node
// boxes (`canonicalBox`), so it is the same in every language and on every
// platform. The next save writes the current `layoutVersion`, so it never runs
// again for that document; Templates and bundled modules are never converted
// (their sources are re-placed by hand). No store is imported here: the boot
// module runs this on the autosave record before any store reads it.

import type { LoopEdge, LoopEdgeData, LoopNode } from '../model/types'
import { LAYOUT_VERSION, type SavedFrame } from '../model/serialize'
import { replaceOnGrid } from '../model/layout/replace'
import { centreInside, fullyInside, LAYOUT_CLEARANCE, rebuildFrameRect } from '../model/layout/frameRebuild'
import { canonicalBox, type CanonicalBox, legacyCanonicalBoxBeforeOutlineContainment } from '../components/nodes/canonicalBox'

export type ConvertibleDoc = { nodes: LoopNode[]; edges: LoopEdge[]; frames?: SavedFrame[] }
type BoxOf = (node: LoopNode) => CanonicalBox

/** whether a document's layout predates the current rules */
export const isLegacyLayout = (layoutVersion: number | undefined): boolean => (layoutVersion ?? 0) < LAYOUT_VERSION

const framesOf = (doc: ConvertibleDoc, inFrame: (b: { x: number; y: number; w: number; h: number }, r: SavedFrame['rect']) => boolean, boxOf: BoxOf): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const f of doc.frames ?? []) out[f.id] = doc.nodes.filter((n) => inFrame({ ...n.position, ...boxOf(n) }, f.rect)).map((n) => n.id).sort()
  return out
}

/** which nodes each saved frame HELD as the document was drawn when it was
 *  saved: fully inside, by the boxes of that time
 *  (`legacyCanonicalBoxBeforeOutlineContainment`), decided BEFORE any node's
 *  size or place changes — so a node #337 draws wider never falls out of its
 *  frame, and a node that only reached into a frame is never taken in. */
export const heldBeforeConversion = (doc: ConvertibleDoc, boxOf: BoxOf = legacyCanonicalBoxBeforeOutlineContainment): Record<string, string[]> =>
  framesOf(doc, fullyInside, boxOf)

/** which nodes each saved frame SHOWS: their centre inside it, by the same
 *  boxes. It never decides membership; the rebuilt frame only covers them, so
 *  no frame edge runs through a node that sat in it (§DL2.9) */
export const coveredBeforeConversion = (doc: ConvertibleDoc, boxOf: BoxOf = legacyCanonicalBoxBeforeOutlineContainment): Record<string, string[]> =>
  framesOf(doc, centreInside, boxOf)

/** the document re-placed on the grid (positions, frames, waypoints); every
 *  other field untouched. Deterministic and idempotent. Every node keeps the
 *  Templates' clearance (`LAYOUT_CLEARANCE`, 48 x 32) from the next; each saved
 *  frame is rebuilt around the nodes it held and the nodes it showed, at their
 *  new place and current size, keeping its padding on each side (at least
 *  24 px). `boxBefore` is each node's box as the document was drawn before
 *  (the one-time conversion: the frozen pre-#337 box; Tidy to grid: the
 *  current one). */
export function convertLayout<T extends ConvertibleDoc>(doc: T, boxBefore: BoxOf = canonicalBox): T {
  const r = replaceOnGrid(doc.nodes, doc.edges, doc.frames ?? [], canonicalBox, { gap: LAYOUT_CLEARANCE })
  const held = heldBeforeConversion(doc, boxBefore)
  const covered = coveredBeforeConversion(doc, boxBefore)
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const before = (id: string) => ({ ...byId.get(id)!.position, ...boxBefore(byId.get(id)!) })
  const after = (id: string) => ({ ...(r.positions[id] ?? byId.get(id)!.position), ...canonicalBox(byId.get(id)!) })
  const nodes = doc.nodes.map((n) => {
    const p = r.positions[n.id]
    return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: { x: p.x, y: p.y } } : n
  })
  const edges = doc.edges.map((e) => {
    const wps = r.waypoints[e.id]
    if (!wps || !e.data) return e
    if (wps.length === 0) {
      // §ER5.1 — the writer never emits `waypoints: []`
      const { waypoints: _drop, ...rest } = e.data as LoopEdgeData & { waypoints?: unknown }
      return { ...e, data: rest as LoopEdgeData }
    }
    return { ...e, data: { ...e.data, waypoints: wps } as LoopEdgeData }
  })
  const frames = doc.frames?.map((f) => {
    const members = [...new Set([...(held[f.id] ?? []), ...(covered[f.id] ?? [])])].sort()
    const rect = rebuildFrameRect(f.rect, members, before, after, r.frames[f.id] ?? f.rect)
    const same = rect.x === f.rect.x && rect.y === f.rect.y && rect.w === f.rect.w && rect.h === f.rect.h
    return same ? f : { ...f, rect }
  })
  return { ...doc, nodes, edges, ...(doc.frames ? { frames } : {}) }
}

/** docs/edge-routing.md §ER14.1 — the migration of an ordinary pre-grid
 *  document: its layout re-placed (`convertLayout`) and every connection that
 *  has no `route` (a Bézier) given `route: "orthogonal"` explicitly, so it is
 *  drawn by the router from now on. An absent `route` keeps meaning Bézier
 *  everywhere else — a revision or proposal is never migrated, and Tidy to grid
 *  re-places positions only. A connection already `orthogonal` keeps its
 *  waypoints (Manual) or has none (Auto). */
export function migrateDocument<T extends ConvertibleDoc>(doc: T): T {
  // the frames' nodes as the document was drawn when it was saved (Tidy to
  // grid, on a document already drawn by the current rules, reads the current
  // boxes)
  const placed = convertLayout(doc, legacyCanonicalBoxBeforeOutlineContainment)
  const edges = placed.edges.map((e) =>
    e.data && (e.data as { route?: unknown }).route === undefined
      ? { ...e, data: { ...e.data, route: 'orthogonal' } as LoopEdgeData }
      : e,
  )
  return { ...placed, edges }
}
