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

import { TEMPLATES } from '../../model/templates'
import type { LoopNode } from '../../model/types'
import { BASE_LOCALE } from '../registry'
import { templateLabelDicts } from './index'

export type OfficialTemplateLabelIndex = {
  /** node id → every string that is an official label for that id in SOME
   *  shipped locale (the English canonical included). */
  known: ReadonlyMap<string, ReadonlySet<string>>
  /** locale code → (node id → that locale's official label for the id; the
   *  English canonical when the locale has no dictionary entry for it).
   *  `BASE_LOCALE` is always present. */
  byLocale: ReadonlyMap<string, ReadonlyMap<string, string>>
  /** node ids whose official target label is NOT identical across the templates
   *  that share the id — never switched (the CI drift check fails first). */
  ambiguous: ReadonlySet<string>
}

let cached: OfficialTemplateLabelIndex | null = null

function build(): OfficialTemplateLabelIndex {
  const known = new Map<string, Set<string>>()
  const byLocale = new Map<string, Map<string, string>>()
  const ambiguous = new Set<string>()

  const dictLocales = Object.keys(templateLabelDicts)
  for (const loc of [BASE_LOCALE, ...dictLocales]) {
    if (!byLocale.has(loc)) byLocale.set(loc, new Map())
  }

  const addKnown = (id: string, label: string) => {
    let s = known.get(id)
    if (!s) known.set(id, (s = new Set()))
    s.add(label)
  }
  const setTarget = (loc: string, id: string, label: string) => {
    const m = byLocale.get(loc)!
    const prev = m.get(id)
    if (prev !== undefined && prev !== label) ambiguous.add(id)
    else m.set(id, label)
  }

  for (const tpl of TEMPLATES) {
    const canonical = new Map<string, string>()
    for (const n of tpl.graph.nodes) canonical.set(n.id, n.data.label)

    for (const [id, enLabel] of canonical) {
      addKnown(id, enLabel)
      setTarget(BASE_LOCALE, id, enLabel)
    }
    for (const loc of dictLocales) {
      const dict = templateLabelDicts[loc][tpl.id]
      for (const [id, enLabel] of canonical) {
        const localized = dict?.[id]
        if (localized !== undefined) addKnown(id, localized)
        setTarget(loc, id, localized ?? enLabel)
      }
    }
  }

  return { known, byLocale, ambiguous }
}

/** The lazily-built, process-wide index. */
export function officialTemplateLabelIndex(): OfficialTemplateLabelIndex {
  return (cached ??= build())
}

/** Test seam — drop the cache so a stubbed `TEMPLATES` / dictionary is re-read. */
export function __rebuildOfficialTemplateLabelIndex(): void {
  cached = null
}

/**
 * Re-seed the OFFICIAL bundled-template labels in `nodes` for `targetLocale`
 * (§TLO11). Returns the SAME array reference when nothing changed, so a caller
 * can skip the write — a re-select or a same-locale boot is a no-op.
 */
export function relabelNodesForLocale(
  nodes: readonly LoopNode[],
  targetLocale: string,
): LoopNode[] {
  const { known, byLocale, ambiguous } = officialTemplateLabelIndex()
  const targets = byLocale.get(targetLocale) ?? byLocale.get(BASE_LOCALE)!

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
