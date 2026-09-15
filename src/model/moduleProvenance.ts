// docs/bundled-module-label-localization.md §MLS3 / §MLS3.2 — session-only
// tracking of "which host node came from which bundled module's own
// canonical node id, and what label THIS FEATURE itself last wrote there."
// Never part of `GraphDocLike`, never touched by `serialize()` /
// `deserialize()`, never persisted.
//
// §MLS3.2 (review round 2, 2026-09-15) — this is a HISTORY-AWARE sidecar,
// the same kind of thing as `graphStore.ts`'s `frameSidecar` /
// `dataImportSidecar`: the LIVE map is mutated by `registerModuleProvenance`
// (a bundled insert) and by the locale-switch relabel pass, but every
// `commit()` / `undo()` / `redo()` snapshots and restores it via
// `moduleProvenanceSnapshot()` / `restoreModuleProvenanceSnapshot()` exactly
// like the other two — so a document restored by Undo/Redo carries the
// module-tracking state IT had at that point in history, not whatever the
// live map happens to hold right now. `newGraph` / `loadGraph` / `loadDoc`
// set the LIVE map to empty for the new document (never wire-touching).

export type ModuleNodeProvenance = {
  /** `BUNDLED_MODULES[i].id` — which bundled block this instance came from. */
  moduleId: string
  /** the module's OWN pre-insert node id (`examples/module-*.json`), before
   *  `insertGraph` re-issued it to the fresh host id this is keyed on. */
  canonicalId: string
  /** the label THIS FEATURE itself last wrote at this node — set at insert
   *  time, updated on every successful locale-switch relabel. A node whose
   *  CURRENT label no longer matches this was changed by something else
   *  (almost always a user edit) — §MLS3.1's ONLY signal, and it detaches
   *  the node from management permanently, the instant it's next noticed. */
  lastAppliedLabel: string
}

/** Plain-data form for the history sidecar — an array of `[nodeId, record]`
 *  pairs (a `Map` doesn't survive `JSON`/structural-sharing assumptions
 *  elsewhere in the codebase as cleanly as the other sidecars' plain
 *  arrays/objects do). */
export type ModuleProvenanceSnapshot = ReadonlyArray<readonly [string, ModuleNodeProvenance]>

const EMPTY: ModuleProvenanceSnapshot = []

let live = new Map<string, ModuleNodeProvenance>()

/** Register the nodes `insertGraph` just inserted for a BUNDLED module.
 *  `label` is the ACTUAL label each node carries right after insert (the
 *  EN canonical, or the KO/JA overlay's entry — whatever `cloneModuleDoc`
 *  already applied before `insertGraph` ran), so `lastAppliedLabel` starts
 *  in sync with the real node. A no-op when `moduleId` is `undefined` (a
 *  file-inserted module never calls this — §MLS3 boundary 2/3). */
export function registerModuleProvenance(
  entries: readonly { freshId: string; canonicalId: string; label: string }[],
  moduleId: string | undefined,
): void {
  if (moduleId === undefined) return
  for (const e of entries) live.set(e.freshId, { moduleId, canonicalId: e.canonicalId, lastAppliedLabel: e.label })
}

/** `undefined` for any node this feature never inserted (a user-made node,
 *  a Template node, a file-imported module), OR one it inserted but has
 *  since detached (§MLS3.1). */
export function moduleProvenanceFor(nodeId: string): ModuleNodeProvenance | undefined {
  return live.get(nodeId)
}

/** Detach ONE node from the LIVE map, permanently — called by
 *  `graphStore.updateNodeData` the instant a real label edit is committed
 *  (§MLS3.1 revision 3: detachment is EAGER, at the edit itself, never
 *  deferred to the next locale switch — a lazy content-comparison alone
 *  can't tell "never edited" from "edited, then edited back to the exact
 *  same text," and the kickoff contract requires the former to keep
 *  translating and the latter to stay excluded forever). A no-op if the
 *  node has no provenance (a plain user node, already detached, or a
 *  Template node §TLO11 tracks separately). */
export function detachModuleProvenance(nodeId: string): void {
  live.delete(nodeId)
}

/** A snapshot of the LIVE map, for `commit()` to fold into a new history
 *  entry's sidecar. */
export function moduleProvenanceSnapshot(): ModuleProvenanceSnapshot {
  return live.size === 0 ? EMPTY : [...live.entries()]
}

/** Replace the LIVE map wholesale. Three callers: `newGraph` / `loadGraph` /
 *  `loadDoc` (an empty snapshot — §MLS4.2), `undo` / `redo` (a past/future
 *  entry's own captured snapshot, via `restoreSidecar`), and the
 *  locale-switch subscription (writing back its own possibly-changed
 *  result — a relabel and a detachment both mutate the snapshot, not just
 *  the node array). */
export function restoreModuleProvenanceSnapshot(snap: ModuleProvenanceSnapshot | null | undefined): void {
  live = snap && snap.length > 0 ? new Map(snap) : new Map()
}

/** `newGraph` / `loadGraph` / `loadDoc` — the new current document starts
 *  with no module tracking (§MLS4.2). Equivalent to
 *  `restoreModuleProvenanceSnapshot(null)`, kept as a named call for
 *  readability at the three call sites. */
export function clearModuleProvenance(): void {
  live = new Map()
}

/** Test seam — replace the live map directly. */
export function __setModuleProvenanceForTest(entries: ReadonlyMap<string, ModuleNodeProvenance>): void {
  live = new Map(entries)
}
