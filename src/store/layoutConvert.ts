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
import { canonicalBox } from '../components/nodes/canonicalBox'

export type ConvertibleDoc = { nodes: LoopNode[]; edges: LoopEdge[]; frames?: SavedFrame[] }

/** whether a document's layout predates the current rules */
export const isLegacyLayout = (layoutVersion: number | undefined): boolean => (layoutVersion ?? 0) < LAYOUT_VERSION

/** the document re-placed on the grid (positions, frames, waypoints); every
 *  other field untouched. Deterministic and idempotent. */
export function convertLayout<T extends ConvertibleDoc>(doc: T): T {
  const r = replaceOnGrid(doc.nodes, doc.edges, doc.frames ?? [], canonicalBox)
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
  const frames = doc.frames?.map((f) => (r.frames[f.id] ? { ...f, rect: r.frames[f.id] } : f))
  return { ...doc, nodes, edges, ...(doc.frames ? { frames } : {}) }
}
