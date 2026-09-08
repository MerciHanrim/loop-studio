// docs/localization.md §L4.5 — the per-locale template-label dictionaries are
// LAZY: each `<locale>.ts` is its own chunk, loaded via `ensureTemplateLabelDict`
// alongside that locale's UI catalog before `activeLocale` flips
// (src/i18n/store.ts). `openTemplate` (./index.ts) and the §TLO11 relabel
// (./relabel.ts) run synchronously and read `loadedTemplateLabelDict`, which the
// atomic-switch contract guarantees is populated for the active locale.
//
// This module deliberately imports nothing from `../store` — it sits below it
// in the graph so `store.ts` can depend on `ensureTemplateLabelDict` without a
// cycle.

import { BASE_LOCALE } from '../registry'

/** `templateId -> (nodeId -> localized label)` for one locale. */
export type TemplateLabelDict = Record<string, Record<string, string>>

/** Registered non-base locales that ship a dictionary chunk. English
 *  (`BASE_LOCALE`) never has one — it is the fallback. A new locale = one more
 *  entry here plus its `<locale>.ts` file (§TLO2). The value is a dynamic
 *  `import()` so the dict is its own lazily-loaded chunk. */
const DICT_LOADERS: Readonly<Record<string, () => Promise<TemplateLabelDict>>> = {
  ja: () => import('./ja').then((m) => m.ja),
  ko: () => import('./ko').then((m) => m.ko),
}

/** The loaded dictionaries, filled by `ensureTemplateLabelDict`. */
const DICTS: Record<string, TemplateLabelDict> = {}
const inFlight = new Map<string, Promise<void>>()

/** Load the `<loc>` template-label dictionary chunk if it is not already
 *  resident. Idempotent; resolves immediately for `BASE_LOCALE`, an
 *  already-loaded locale, or a locale with no dictionary; concurrent calls
 *  share one `import()`. */
export async function ensureTemplateLabelDict(loc: string): Promise<void> {
  if (loc === BASE_LOCALE || DICTS[loc]) return
  const loader = DICT_LOADERS[loc]
  if (!loader) return // no dictionary for this locale — it opens in English
  let p = inFlight.get(loc)
  if (!p) {
    p = loader().then(
      (dict) => {
        DICTS[loc] = dict
        inFlight.delete(loc)
      },
      (err) => {
        inFlight.delete(loc)
        throw err
      },
    )
    inFlight.set(loc, p)
  }
  return p
}

/** A resident dictionary, or `undefined` if `<loc>` has not been loaded. */
export function loadedTemplateLabelDict(loc: string): TemplateLabelDict | undefined {
  return DICTS[loc]
}

/** The locales that HAVE a dictionary loader (for checks / diagnostics).
 *  Whether a given one is resident is `ensureTemplateLabelDict`'s job. */
export const templateLabelDictLocales: readonly string[] = Object.keys(DICT_LOADERS)

/** Test seam — forget every loaded dictionary (and any in-flight load). */
export function __resetTemplateLabelDicts(): void {
  for (const k of Object.keys(DICTS)) delete DICTS[k]
  inFlight.clear()
}
