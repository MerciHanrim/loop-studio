// docs/localization.md §L3.4a — the numbering rule for an auto-generated node
// name. Pure and locale-agnostic: it works on the base string that the caller
// already resolved for the current UI language, and on the DISPLAY names
// currently in the graph. No hidden counter, no persisted state, no "is this
// auto-generated" flag — the check is exactly what the user sees.
//
//   uniqueNodeLabel('저장소', ['저장소'])            -> '저장소 2'
//   uniqueNodeLabel('저장소', ['저장소', '저장소 2']) -> '저장소 3'
//   uniqueNodeLabel('저장소', ['Pool'])              -> '저장소'   (other language: independent)
//   uniqueNodeLabel('저장소', ['저장소 2'])           -> '저장소'   (base itself is free)
//
// Deleting '저장소 2' frees it, so the next create reuses it. A node the user
// hand-named '저장소 2' is just another taken display name — a fresh auto node
// skips past it to the next free number.

/** The smallest un-taken name in the series `base`, `base 2`, `base 3`, … */
export function uniqueNodeLabel(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}
