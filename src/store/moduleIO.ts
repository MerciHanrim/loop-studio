// docs/module-system.md §MS2 / §MS6 — the non-UI glue for module insert /
// extract. The React component (`ModuleMenu.tsx`) owns the menu, the dialogs,
// and the download; these helpers own the graph reads and the serialisation.

import { extractModule, type GraphDocLike } from '../model/moduleGraph'
import { deserialize, serialize } from '../model/serialize'
import { useFrameStore } from './frameStore'
import { useGraphStore } from './graphStore'

/** Ids of the nodes the user has marquee- / shift-selected on the canvas, or
 *  the single Inspector selection as a fallback. */
export function selectedNodeIds(): string[] {
  const g = useGraphStore.getState()
  const multi = g.nodes.filter((n) => n.selected).map((n) => n.id)
  if (multi.length > 0) return multi
  return g.selectedNodeId ? [g.selectedNodeId] : []
}

export type ReadModuleResult =
  | { ok: true; module: GraphDocLike; hadFrames: boolean; hadRunConfig: boolean }
  | { ok: false; reason: string }

/** Parse a picked Graph JSON file as a module (§MS1 — any valid graph is one).
 *  `hadFrames` / `hadRunConfig` drive the pre-apply notices (§MS3.7 / B2 / B3);
 *  neither is carried into the host. */
export function readModuleFile(text: string): ReadModuleResult {
  let d: ReturnType<typeof deserialize>
  try {
    d = deserialize(text)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'That file could not be read as a graph.' }
  }
  if (d.nodes.length === 0) return { ok: false, reason: 'That file has no nodes to insert.' }
  return {
    ok: true,
    module: { nodes: d.nodes, edges: d.edges, modelVersion: d.modelVersion },
    hadFrames: d.frames.length > 0,
    hadRunConfig: d.recommendedRunConfig != null,
  }
}

export type ExtractPlan =
  | { ok: true; text: string; filename: string; hadFrames: boolean; nodeCount: number }
  | { ok: false; reason: string }

/** Serialise the current canvas selection as a self-contained module Graph JSON
 *  (§MS2). No `recommendedRunConfig`, no `frames` (§MS2.2). A dangling `@ref`
 *  refuses (§MS2.4 / B1) — the reason names the offending references.
 *  `hadFrames` says the SOURCE graph has saved frames, so the caller can state
 *  they are excluded before the download (§MS4a-B3). */
export function planSelectionAsModule(ids: string[] = selectedNodeIds()): ExtractPlan {
  const g = useGraphStore.getState()
  const r = extractModule({ nodes: g.nodes, edges: g.edges, modelVersion: g.modelVersion }, ids)
  if (!r.ok) return { ok: false, reason: r.reason }
  return {
    ok: true,
    text: serialize(r.nodes, r.edges, undefined, undefined, undefined, r.modelVersion),
    filename: 'loop-studio-module.json',
    hadFrames: useFrameStore.getState().snapshot().length > 0,
    nodeCount: r.nodes.length,
  }
}
