import { create } from 'zustand'
import { setDataImportHistorySidecar } from './graphStore'
import { loadFromStorage, type ImportSourceTable } from '../model/serialize'

// docs/data-import.md (`loop-revision/8`, `SEMANTICS-R8.md`) — Phase 1A: the
// storage foundation only. This store holds the CURRENT saved data-import
// source records and mirrors `frameStore`'s undo-sidecar pattern exactly
// (`SEMANTICS-R5.md` §SF11 precedent) so a graph undo / redo, and every
// document load, restores them together with the graph — no separate history
// entry.
//
// Deliberately minimal: Phase 1A ships NO interactive UI that creates or
// edits these records, so there is no `addTable` / `renameTable` / etc. here
// yet, unlike `frameStore`'s rich mutation surface. Phase 1B (the actual
// CSV/TSV import) adds the one real mutation this needs — "commit an import"
// — as a single new atomic action once it exists; until then, `loadTables` /
// `snapshot` (load + serialize) are the whole surface, exercised today only
// by directly-constructed test fixtures and file load/save.

type DataImportStore = {
  tables: ImportSourceTable[]

  /** document load / undo sidecar (NO history of their own) — replace the
   *  whole set from a document's saved records (or `[]`). Mirrors
   *  `frameStore.loadFrames`. */
  loadTables: (saved: readonly ImportSourceTable[] | null) => void
  /** the wire-shaped snapshot for `serialize` / autosave / the undo sidecar. */
  snapshot: () => ImportSourceTable[]
}

export const useDataImportStore = create<DataImportStore>((set, get) => ({
  tables: [],

  loadTables: (saved) => {
    const list = Array.isArray(saved) ? saved : []
    set({ tables: list.map((t) => ({ ...t, columns: [...t.columns], rows: [...t.rows] })) })
  },

  snapshot: () => get().tables.map((t) => ({ ...t, columns: [...t.columns], rows: [...t.rows] })),
}))

/** True when at least one data-import source table exists. */
export const hasDataImports = (s: DataImportStore): boolean => s.tables.length > 0

// Register the saved-records undo sidecar: `graphStore` captures `snapshot()`
// into every history entry and calls `loadTables()` on an undo / redo (and on
// `loadDoc` / `loadGraph` / `newGraph`), mirroring `frameStore`'s own
// registration exactly.
setDataImportHistorySidecar({
  get: () => useDataImportStore.getState().snapshot(),
  set: (snap) => useDataImportStore.getState().loadTables(snap as ImportSourceTable[] | null),
})

// Cold boot — `graphStore` seeds nodes/edges from the autosave record before
// this module registers the sidecar; seed the saved data-import records from
// the same record here so a plain reload restores them, mirroring
// `frameStore`'s own boot seeding.
try {
  const booted = loadFromStorage()
  if (booted?.dataImports?.length) useDataImportStore.getState().loadTables(booted.dataImports)
} catch {
  /* no storage / bad record — start with no data-import records */
}
