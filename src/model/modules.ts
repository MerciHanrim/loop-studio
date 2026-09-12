// docs/module-system.md §MS6 / §MS9 step 5 — the bundled "Building blocks".
//
// Each is a plain Graph JSON in `examples/` (no `module` metadata — §MS1), read
// here into a `GraphDocLike` the same way `templates.ts` reads its Templates.
// The menu NAME / BLURB are chrome, keyed by the stable `id` (see
// `src/components/moduleKeys.ts`). The seeded node labels are authored in
// English; `cloneModuleDoc`'s optional `labelOverlay` lets a KO/JA insert
// relabel them at clone time (docs/bundled-module-label-localization.md) —
// this file stays free of any `i18n` import, so the caller (a component)
// looks up the overlay and passes it in as plain data.

import bufferedStepDoc from '../../examples/module-buffered-step.json'
import rewardSplitDoc from '../../examples/module-reward-split.json'
import type { GraphDocLike } from './moduleGraph'
import { modelVersionForSchema, normalizeGraph } from './serialize'
import type { LoopEdge, LoopNode } from './types'

export type BundledModule = {
  /** stable id — the `MODULE_KEY` lookup and the menu list key. */
  id: string
  /** ~8–15 nodes, self-contained, generalised (no domain names). */
  doc: GraphDocLike
}

function load(raw: unknown): GraphDocLike {
  const o = raw as { schema?: unknown; nodes: LoopNode[]; edges: LoopEdge[] }
  const g = normalizeGraph({ nodes: o.nodes, edges: o.edges })
  return { nodes: g.nodes, edges: g.edges, modelVersion: modelVersionForSchema(o.schema) ?? 1 }
}

export const BUNDLED_MODULES: readonly BundledModule[] = [
  { id: 'buffered-step', doc: load(bufferedStepDoc) },
  { id: 'reward-split', doc: load(rewardSplitDoc) },
]

/** A fresh structural clone of a bundled module's doc — the caller merges it
 *  into the open graph via `insertModule`, which re-issues every id, so the
 *  canonical `BUNDLED_MODULES[i].doc` is never handed to the store directly.
 *
 *  `labelOverlay`, when given, is a `nodeId -> label` map (the module's own
 *  CANONICAL ids, before `insertModule` re-issues them) applied to the clone —
 *  a node with no entry keeps its authored English label. Only `data.label`
 *  is ever touched. */
export function cloneModuleDoc(m: BundledModule, labelOverlay?: Record<string, string>): GraphDocLike {
  const doc = JSON.parse(JSON.stringify(m.doc)) as GraphDocLike
  if (labelOverlay) {
    for (const n of doc.nodes) {
      const label = labelOverlay[n.id]
      if (label != null) (n.data as { label?: string }).label = label
    }
  }
  return doc
}
