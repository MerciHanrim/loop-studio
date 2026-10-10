// docs/diagram-layout.md §DL2.8 (issue #344) — the autosave record's one-time
// layout conversion, run by the boot module (`src/main.tsx`) after the storage
// session is open and BEFORE `startApp` evaluates the stores, which read the
// record as they are created (the graph store its nodes, the frame store its
// frames). Converting the record in place keeps the two consistent and puts the
// conversion before any history exists. Imports no store.

import { loadFromStorage, saveToStorage } from '../model/serialize'
import { isLegacyLayout, migrateDocument } from './layoutConvert'

/** convert a legacy autosave record once; a current one (or none) is untouched,
 *  and so is one that carries a Project header — a revision's layout is never
 *  re-placed automatically (§DL2.8), only by Tidy to grid. */
export function convertAutosaveLayout(): void {
  const stored = loadFromStorage()
  if (!stored || !isLegacyLayout(stored.layoutVersion) || stored.project != null) return
  const c = migrateDocument({ nodes: stored.nodes, edges: stored.edges, frames: stored.frames })
  saveToStorage(c.nodes, c.edges, stored.project, stored.recommendedRunConfig?.timelineSeries, stored.modelVersion, c.frames, stored.dataImports)
}
