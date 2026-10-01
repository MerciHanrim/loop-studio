import type { TimelineSeries } from './serialize'

// docs/timeline-series-contract.md §3 / §4 — the VIEW-level resolution of the
// stored Timeline series choice. `readTimelineSeries` (serialize.ts) owns the
// shape on disk; this owns what is DRAWN. Pure: same inputs, same output,
// never throws, never touches a store.

/** `auto` draws at most this many series (contract §4) */
export const DEFAULT_SERIES_CAP = 8

/**
 * The ids to draw, in DOCUMENT order (`allIds` order — every Pool, then every
 * Register, each in graph-node order). Storage order is sorted; display order
 * is not, and both stay (contract §3, "Order").
 *
 *  - `'auto'`           → the first `DEFAULT_SERIES_CAP` ids
 *  - `'all'`            → every id — a series added later IS included
 *  - `string[]`         → the stored ids that still exist, in document order;
 *                         an id that no longer exists is dropped silently
 *  - a list that names nothing here (or an empty one) falls back to `auto`
 *    rather than draw an empty chart
 *  - with no eligible series at all the result is empty, for every state —
 *    that is the §6.2 zero-series case, not a failure
 */
export function resolveTimelineSeries(sel: TimelineSeries, allIds: readonly string[]): string[] {
  if (sel === 'all') return allIds.slice()
  if (Array.isArray(sel)) {
    const want = new Set(sel)
    const kept = allIds.filter((id) => want.has(id))
    if (kept.length > 0) return kept
  }
  return allIds.slice(0, DEFAULT_SERIES_CAP)
}
