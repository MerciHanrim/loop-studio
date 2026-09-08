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

/** `templateId -> (id -> localized string)`. Used for both the node-label map
 *  and the frame-title map. */
export type TemplateLabelMap = Record<string, Record<string, string>>
/** back-compat alias — the node-label map shape. */
export type TemplateLabelDict = TemplateLabelMap

/** One locale's full template overlay: node labels + frame titles. Each
 *  `<locale>.ts` keeps FLAT exports (`ko` = nodes, `koFrames` = frames) so the
 *  source-text checks stay simple; this consumer shape is composed here. */
export type TemplateOverlay = {
  nodes: TemplateLabelMap
  frames: TemplateLabelMap
}

/** Registered non-base locales that ship a dictionary chunk. English
 *  (`BASE_LOCALE`) never has one — it is the fallback. A new locale = one more
 *  entry here plus its `<locale>.ts` file (§TLO2). The value is a dynamic
 *  `import()` so the dict is its own lazily-loaded chunk; the ONE `import()`
 *  yields both maps, so the atomic catalog+dict load contract is unchanged. */
const DICT_LOADERS: Readonly<Record<string, () => Promise<TemplateOverlay>>> = {
  ja: () => import('./ja').then((m) => ({ nodes: m.ja, frames: m.jaFrames ?? {} })),
  ko: () => import('./ko').then((m) => ({ nodes: m.ko, frames: m.koFrames ?? {} })),
}

/** The loaded overlays, filled by `ensureTemplateLabelDict`. */
const DICTS: Record<string, TemplateOverlay> = {}
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

/** A resident locale's full overlay (`{ nodes, frames }`), or `undefined` if
 *  `<loc>` has not been loaded. */
export function loadedTemplateOverlay(loc: string): TemplateOverlay | undefined {
  return DICTS[loc]
}

/** A resident locale's NODE-label map, or `undefined` if not loaded. */
export function loadedTemplateLabelDict(loc: string): TemplateLabelMap | undefined {
  return DICTS[loc]?.nodes
}

/** A resident locale's FRAME-title map, or `undefined` if not loaded. */
export function loadedTemplateFrameLabelDict(loc: string): TemplateLabelMap | undefined {
  return DICTS[loc]?.frames
}

/** The locales that HAVE a dictionary loader (for checks / diagnostics).
 *  Whether a given one is resident is `ensureTemplateLabelDict`'s job. */
export const templateLabelDictLocales: readonly string[] = Object.keys(DICT_LOADERS)

/** Test seam — forget every loaded dictionary (and any in-flight load). */
export function __resetTemplateLabelDicts(): void {
  for (const k of Object.keys(DICTS)) delete DICTS[k]
  inFlight.clear()
}
