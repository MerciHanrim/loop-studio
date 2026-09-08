// docs/template-label-overlay.md §TLO11 — the ONLY post-open label translation.
//
// `openTemplate` seeds a bundled Template's node `label`s once, at menu open
// (§TLO3). §TLO11 adds one narrow, deliberate exception to "a language switch
// never re-translates an open document": when the UI language changes, the
// OFFICIAL bundled-template node labels — and only those — follow the new
// language, in the live graph and in every undo/redo snapshot.
//
// "Official" is decided by an exact string match, with no per-document state:
// a node is switched iff
//   1. its `id` is a known bundled-template node id, AND
//   2. its current `label` is EXACTLY (`===`) one of that id's official labels
//      in some shipped locale (the English canonical included).
// A user rename, a `Foo 2` de-dup suffix, or a user-made node is never one of
// those strings, so it is left untouched. The precise contract is "preserve a
// user label that is not one of the official labels" — a rename that happens to
// land exactly on another locale's official string is, by that rule, switched.
//
// docs/localization.md §L4.5 — per-locale template-label dicts are lazy, so the
// "is this string official in SOME locale" classification (`known`) comes from
// the build-time seed `known.generated.ts` (always complete). The TARGET string
// for the language being switched TO is read from that language's dictionary,
// which `src/i18n/store.ts` guarantees is resident before `activeLocale` flips.

import { TEMPLATES } from '../../model/templates'
import type { LoopNode } from '../../model/types'
import { BASE_LOCALE, isRegistered } from '../registry'
import { loadedTemplateLabelDict, templateLabelDictLocales } from './dicts'
import { AMBIGUOUS_NODE_IDS, KNOWN_OFFICIAL_LABELS } from './known.generated'

export type OfficialTemplateLabelIndex = {
  /** node id → every string that is an official label for that id in SOME
   *  shipped locale (the English canonical included). From the build-time seed
   *  — complete regardless of which locale chunks have loaded. */
  known: ReadonlyMap<string, ReadonlySet<string>>
  /** locale code → (node id → that locale's official label for the id; the
   *  English canonical when the locale has no dictionary entry for it).
   *  `BASE_LOCALE` is always present; a non-base locale's map exists only once
   *  its dictionary chunk has been loaded. */
  byLocale: ReadonlyMap<string, ReadonlyMap<string, string>>
  /** node ids whose official target label is NOT identical across the templates
   *  that share the id — never switched (the CI drift check fails first). */
  ambiguous: ReadonlySet<string>
}

/** EN canonical `id -> label`, straight from the TEMPLATES graphs. Built once. */
let enTargets: ReadonlyMap<string, string> | null = null
function baseTargets(): ReadonlyMap<string, string> {
  if (enTargets) return enTargets
  const m = new Map<string, string>()
  for (const tpl of TEMPLATES) for (const n of tpl.graph.nodes) m.set(n.id, n.data.label)
  return (enTargets = m)
}

let knownIndex: ReadonlyMap<string, ReadonlySet<string>> | null = null
function knownMap(): ReadonlyMap<string, ReadonlySet<string>> {
  if (knownIndex) return knownIndex
  const m = new Map<string, ReadonlySet<string>>()
  for (const [id, labels] of Object.entries(KNOWN_OFFICIAL_LABELS)) m.set(id, new Set(labels))
  return (knownIndex = m)
}

/** cache: locale → its resolved `id -> official label` target map */
const localeTargets = new Map<string, ReadonlyMap<string, string>>()

/** Build (once, cached) the `id -> official label` map for `locale`.
 *  `undefined` for a non-base locale whose dictionary is not resident. */
function targetsFor(locale: string): ReadonlyMap<string, string> | undefined {
  if (locale === BASE_LOCALE) return baseTargets()
  const hit = localeTargets.get(locale)
  if (hit) return hit
  const dict = loadedTemplateLabelDict(locale)
  if (!dict) return undefined
  const m = new Map<string, string>()
  for (const tpl of TEMPLATES) {
    const perTpl = dict[tpl.id]
    for (const n of tpl.graph.nodes) m.set(n.id, perTpl?.[n.id] ?? n.data.label)
  }
  localeTargets.set(locale, m)
  return m
}

/** The lazily-built, process-wide index. `known` / `ambiguous` are static;
 *  `byLocale` carries `BASE_LOCALE` plus every non-base locale whose dictionary
 *  is currently resident. */
export function officialTemplateLabelIndex(): OfficialTemplateLabelIndex {
  const byLocale = new Map<string, ReadonlyMap<string, string>>()
  byLocale.set(BASE_LOCALE, baseTargets())
  for (const loc of templateLabelDictLocales) {
    const t = targetsFor(loc) // builds + caches it if the dict is resident
    if (t) byLocale.set(loc, t)
  }
  return {
    known: knownMap(),
    byLocale,
    ambiguous: new Set(AMBIGUOUS_NODE_IDS),
  }
}

/** Test seam — drop the caches so a stubbed `TEMPLATES` / dictionary / a
 *  freshly-loaded locale is re-read. */
export function __rebuildOfficialTemplateLabelIndex(): void {
  enTargets = null
  knownIndex = null
  localeTargets.clear()
}

/**
 * Re-seed the OFFICIAL bundled-template labels in `nodes` for `targetLocale`
 * (§TLO11). Returns the SAME array reference when nothing changed, so a caller
 * can skip the write — a re-select or a same-locale boot is a no-op.
 *
 * If `targetLocale` is a REGISTERED locale whose dictionary is not resident,
 * that is an invariant violation (`src/i18n/store.ts` loads it before the
 * switch): the nodes are left untouched (no half-English rewrite) and an error
 * is logged. An UNREGISTERED code falls back to the English canonical.
 */
export function relabelNodesForLocale(
  nodes: readonly LoopNode[],
  targetLocale: string,
): LoopNode[] {
  const known = knownMap()
  let targets = targetsFor(targetLocale)
  if (!targets) {
    if (isRegistered(targetLocale)) {
      // registered-but-not-loaded → do NOT rewrite to English (a visible
      // half-switch). The store loads the dict before flipping `activeLocale`,
      // so reaching here is an invariant violation.
      console.error(
        `[i18n] relabelNodesForLocale("${targetLocale}"): dictionary not resident — ` +
          `nodes left unchanged. The locale switch should have loaded it first.`,
      )
      return nodes as LoopNode[]
    }
    // unregistered code (defensive / tests) → the English canonical
    targets = baseTargets()
  }
  const ambiguous = new Set(AMBIGUOUS_NODE_IDS)

  let changed = false
  const next = nodes.map((n) => {
    const cur = n.data.label
    if (ambiguous.has(n.id)) return n
    const official = known.get(n.id)
    if (!official || !official.has(cur)) return n // not one of the official strings
    const want = targets.get(n.id)
    if (want === undefined || want === cur) return n
    changed = true
    return { ...n, data: { ...n.data, label: want } }
  })
  return changed ? (next as LoopNode[]) : (nodes as LoopNode[])
}
