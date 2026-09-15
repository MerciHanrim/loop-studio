// docs/bundled-module-label-localization.md §MLS3.1 / §MLS4.3 — the ONLY
// post-insert label translation for a bundled module instance.
//
// Unlike Templates' §TLO11 (a static id table, safe because a Template's
// node ids never change), a module's provenance record tracks the label
// THIS FEATURE itself last wrote (`lastAppliedLabel`, §MLS3.2) — set at
// insert time, updated on every successful relabel. A node is switched iff
// its CURRENT label is still EXACTLY that recorded value: anything else
// means something other than this mechanism changed it since (almost always
// a user edit), and the node is detached from management PERMANENTLY, the
// instant that's noticed — never re-examined by string content again, and
// in particular never re-attached just because the user's own text happens
// to coincide with an official string in some other locale (review round 2,
// 2026-09-15 — the original "official in ANY shipped locale" content-match
// rule is retired; it produced exactly that false positive).

import type { ModuleNodeProvenance, ModuleProvenanceSnapshot } from '../model/moduleProvenance'
import { BUNDLED_MODULES } from '../model/modules'
import type { LoopNode } from '../model/types'
import { moduleLabelOverlay } from './moduleLabels'

/** `moduleId -> canonicalId -> EN canonical label`, straight from
 *  `BUNDLED_MODULES` (§MLS-D2 — the same source `cloneModuleDoc` reads for
 *  an EN insert; not a third copy of the English text). Built once. */
let baseLabelsCache: ReadonlyMap<string, ReadonlyMap<string, string>> | null = null
function baseLabels(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  if (baseLabelsCache) return baseLabelsCache
  const outer = new Map<string, Map<string, string>>()
  for (const mod of BUNDLED_MODULES) {
    const inner = new Map<string, string>()
    for (const n of mod.doc.nodes) inner.set(n.id, n.data.label)
    outer.set(mod.id, inner)
  }
  return (baseLabelsCache = outer)
}

/** the TARGET label for `(moduleId, canonicalId)` in `locale` — the
 *  overlay's entry, or the EN canonical when `locale` has none (English
 *  itself, or a module the overlay doesn't cover). `undefined` only for a
 *  stale/corrupt provenance pair that isn't real (never expected). */
function targetLabel(moduleId: string, canonicalId: string, locale: string): string | undefined {
  const overlay = moduleLabelOverlay(moduleId, locale)?.[canonicalId]
  if (overlay !== undefined) return overlay
  return baseLabels().get(moduleId)?.get(canonicalId)
}

/**
 * Re-seed the OFFICIAL bundled-module labels in `nodes` for `targetLocale`,
 * given `provenance` — the snapshot belonging to THIS specific node array
 * (the live doc's own snapshot for the live nodes; a past/future history
 * entry's OWN sidecar snapshot for that entry's nodes — never the live
 * singleton for a historical array, since a node detached live may still
 * have been managed at an earlier point in history, and vice versa).
 *
 * Returns the SAME `nodes` reference when no label changed, and the SAME
 * `provenance` reference when no entry was updated or detached — so a
 * caller can skip writing either back, and chain this after
 * `relabelNodesForLocale` (Templates) for free when neither pass applies.
 */
export function relabelModuleNodesForLocale(
  nodes: readonly LoopNode[],
  targetLocale: string,
  provenance: ModuleProvenanceSnapshot,
): { nodes: LoopNode[]; provenance: ModuleProvenanceSnapshot } {
  if (provenance.length === 0) return { nodes: nodes as LoopNode[], provenance }
  const provMap = new Map(provenance)
  let nodesChanged = false
  let provChanged = false
  const nextNodes = nodes.map((n) => {
    const prov = provMap.get(n.id)
    if (!prov) return n
    const cur = n.data.label
    if (cur !== prov.lastAppliedLabel) {
      // diverged since our last write -- detach permanently (§MLS3.1)
      provMap.delete(n.id)
      provChanged = true
      return n
    }
    const want = targetLabel(prov.moduleId, prov.canonicalId, targetLocale)
    if (want === undefined || want === cur) return n
    const next: ModuleNodeProvenance = { ...prov, lastAppliedLabel: want }
    provMap.set(n.id, next)
    provChanged = true
    nodesChanged = true
    return { ...n, data: { ...n.data, label: want } }
  })
  return {
    nodes: (nodesChanged ? nextNodes : nodes) as LoopNode[],
    provenance: provChanged ? [...provMap.entries()] : provenance,
  }
}

/** Test seam — drop the cache so a stubbed `BUNDLED_MODULES` is re-read. */
export function __rebuildModuleLabelSyncCache(): void {
  baseLabelsCache = null
}
