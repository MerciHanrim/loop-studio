// Shareable URL - the two steps every kind of share link ends with
// (SEMANTICS-U.md SS U5.4 / U5.5; SEMANTICS-P.md SS P6 reuses them unchanged):
// the replace confirmation, then exactly one load.
//
// Kept apart from `shareLink.ts` so the plain (`g1`) and the protected (`p1`)
// paths call the same code and neither imports the other.

import { type deserialize, LAYOUT_VERSION } from '../model/serialize'
import { t } from '../i18n'
import { useGraphStore } from './graphStore'
import { isLegacyLayout, migrateDocument } from './layoutConvert'
import { useMcStore } from './mcStore'
import { useSimStore } from './simStore'

export type SharedGraph = ReturnType<typeof deserialize>

/**
 * SS U5.2, after `deserialize` - the last step of a load that can still fail,
 * done BEFORE the replace confirmation and before any store changes. An older
 * layout is re-placed here (issue #344), with the call `loadDoc` would make,
 * so a document the layout code cannot read - #420: a node entry with no
 * `data` passes `deserialize`, and the re-placement reads `data.label` - throws
 * while the current document, the run and the MC state are still untouched.
 * The result carries the current layout version, so `loadDoc` does not re-place
 * it again. A current-layout document comes back as it is.
 */
export function prepareSharedGraph(parsed: SharedGraph): SharedGraph {
  if (!isLegacyLayout(parsed.layoutVersion)) return parsed
  const c = migrateDocument({ nodes: parsed.nodes, edges: parsed.edges, frames: [...parsed.frames] })
  return { ...parsed, nodes: c.nodes, edges: c.edges, frames: c.frames ?? parsed.frames, layoutVersion: LAYOUT_VERSION }
}

/** the replace-confirm text, in the active UI language (`share.replacePrompt`) */
export const replacePrompt = (): string => t('share.replacePrompt')

/**
 * SS U5.4 - may the shared document replace the current one? The untouched
 * first-boot sample is replaced without asking; anything else asks once.
 * `confirm` defaults to `window.confirm`.
 */
export function replaceConfirmed(confirm?: (message: string) => boolean): boolean {
  if (useGraphStore.getState().pristineSample) return true
  const ask = confirm ?? (typeof window !== 'undefined' ? window.confirm : () => true)
  return ask(replacePrompt())
}

/** SS U5.5 - stop any run, then exactly one `loadDoc`. `parsed` has been
 *  through `prepareSharedGraph`; a throw from here on is a document that
 *  cannot be opened after the run was stopped (the caller reports it). */
export function applySharedGraph(parsed: SharedGraph): void {
  useSimStore.getState().pause() // first point that run state changes
  // The link is a whole GraphDoc (the Share encoder is `exportJSON`, which
  // carries the saved `frames` + `dataImports`), so it REPLACES those too:
  // `[]` when the link has none. Passing nothing here would mean "keep the
  // current document's" (`loadDoc`'s revision-Apply posture), which carried
  // the PREVIOUS document's frames and data-import records into the shared
  // graph — and into its next Export / digest — while dropping the link's own.
  // #334 — another document: empty history, the link's own lock
  useGraphStore.getState().loadDoc(
    { nodes: parsed.nodes, edges: parsed.edges },
    {
      mode: 'document-boundary',
      canvasLocked: parsed.recommendedRunConfig?.canvasLocked === true,
      layoutVersion: parsed.layoutVersion, // issue #344 — a legacy layout is re-placed once
      modelVersion: parsed.modelVersion,
      frames: parsed.frames,
      dataImports: parsed.dataImports,
    },
  ) // the ONE bump
  useMcStore.getState().applyRecommended(parsed.recommendedRunConfig)
}
