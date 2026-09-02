// docs/template-label-overlay.md — the shared fresh-open Template label overlay.
//
// When a bundled Template is opened FROM THE MENU, `openTemplate` returns a
// FULL structural deep clone of its `{ nodes, edges }` payload plus a fresh
// `recommendedRunConfig`, with the current locale's `nodeId -> label` overlay
// applied (label only). The canonical `TEMPLATES[i]` object — every node,
// `position`, `data`, edge, edge `data`, `route`/`waypoints`, and every
// `recommendedRunConfig` array — is never touched, so a re-open in any locale
// order always starts from the pristine English canonical (§TLO3 / TLO6-INV-7).
//
// Not applied on Import / Share / Workspace / autosave-restore, and never
// re-applied to an already-open document (§TLO4). Translated scope is node
// `data.label` ONLY — not id / expression / `resourceType` / `unit` / edge
// data / position / `recommendedRunConfig` (§TLO-D4).

import type { ModelSemanticsVersion, RecommendedRunConfig } from '../../model/serialize'
import type { Template } from '../../model/templates'
import type { LoopEdge, LoopNode } from '../../model/types'
import { BASE_LOCALE } from '../registry'
import { useI18n } from '../store'
import { ko } from './ko'

/** Deep clone of a plain-JSON payload — the whole Template graph and its
 *  `recommendedRunConfig` are pure data (numbers, strings, booleans, arrays,
 *  nested objects; no `Date` / `Map` / `Set` / cycles). Matches the existing
 *  house idiom (`cloneEl` in `src/model/revision.ts`) and keeps the browser
 *  floor where it already is — no `structuredClone` (Safari 15.4+) dependency
 *  introduced by this feature (§TLO3). */
const cloneJSON = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** `templateId -> (nodeId -> localized label)` for one locale. */
export type TemplateLabelDict = Record<string, Record<string, string>>

/** Registered non-base locales that have a dictionary. English (`BASE_LOCALE`)
 *  never has one — it is the fallback. A new locale = one more entry here plus
 *  its `<locale>.ts` file (§TLO2). */
const DICTS: Readonly<Record<string, TemplateLabelDict>> = { ko }

/** Templates that intentionally ship with NO dictionary for a locale — they
 *  open in English in every locale. `check:template-labels` treats a missing
 *  dictionary as an error UNLESS the template id is listed here (§TLO2.1). */
export const EN_FALLBACK_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  ko: ['equilibrium', 'deadlock'],
}

/** Read-only view for the CI drift check (`scripts/check-template-labels.mjs`). */
export const templateLabelDicts: Readonly<Record<string, TemplateLabelDict>> = DICTS

export type OpenedTemplate = {
  graph: { nodes: LoopNode[]; edges: LoopEdge[] }
  recommendedRunConfig?: RecommendedRunConfig
  /** loop-model/2 — the model-semantics version to load this Template as
   *  (from the Template's `modelVersion`, i.e. its file's `schema`). v1 unless
   *  the Template is authored at `loop-studio/graph/2`. */
  modelVersion: ModelSemanticsVersion
}

/**
 * Prepare a bundled Template for a fresh menu open. `locale` defaults to the
 * live `activeLocale`; pass it explicitly from tests.
 */
export function openTemplate(
  tpl: Template,
  locale: string = useI18n.getState().activeLocale,
): OpenedTemplate {
  // Full deep clone of the whole payload — nothing shared with TEMPLATES[i].
  const graph = cloneJSON(tpl.graph) as { nodes: LoopNode[]; edges: LoopEdge[] }

  const dict = locale === BASE_LOCALE ? undefined : DICTS[locale]?.[tpl.id]
  if (dict) {
    for (const n of graph.nodes) {
      const label = dict[n.id]
      if (label != null) (n.data as { label?: string }).label = label
    }
  }

  return {
    graph,
    recommendedRunConfig: tpl.recommendedRunConfig
      ? cloneJSON(tpl.recommendedRunConfig)
      : undefined,
    modelVersion: tpl.modelVersion ?? 1,
  }
}
