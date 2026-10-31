import { create } from 'zustand'
import { setDataImportHistorySidecar } from './graphStore'
import { loadFromStorage, type ImportSourceTable } from '../model/serialize'

// docs/data-import.md (`loop-revision/8`, `SEMANTICS-R8.md`) — the CURRENT
// saved data-import source records. It mirrors `frameStore`'s undo-sidecar
// pattern exactly (`SEMANTICS-R5.md` §SF11 precedent) so a graph undo / redo,
// and every document load, restores them together with the graph — no
// separate history entry.
//
// Deliberately minimal: `loadTables` / `snapshot` (load + serialize) are the
// whole surface, and it has no mutation of its own. The import wizard and the
// refresh wizard (src/components/dataImport/) change the records only through
// the graph store's atomic actions — `commitDataImport`, `commitRefresh` and
// `renameDataImportTable` — which take one history entry each and write the
// new set through the sidecar below, so a batch and its records always move
// together (#423: this header used to say no UI wrote them yet).

type DataImportStore = {
  tables: ImportSourceTable[]

  /** document load / undo sidecar (NO history of their own) — replace the
   *  whole set from a document's saved records (or `[]`). Mirrors
   *  `frameStore.loadFrames`. */
  loadTables: (saved: readonly ImportSourceTable[] | null) => void
  /** the wire-shaped snapshot for `serialize` / autosave / the undo sidecar. */
  snapshot: () => ImportSourceTable[]
}

/** Deep-clone one table — columns AND rows, including each row's three value
 *  maps (`number` / `label` / `foreignKey`). A shallow `{...t, columns:
 *  [...t.columns], rows: [...t.rows]}` still shares the column / row / map
 *  OBJECTS themselves: a later in-place mutation of one (Phase 1B's own
 *  future edit path) would silently change every past `snapshot()` already
 *  captured into an undo-history entry, corrupting Undo. */
const cloneTable = (t: ImportSourceTable): ImportSourceTable => ({
  sourceTableId: t.sourceTableId,
  label: t.label,
  columns: t.columns.map((c) => ({ ...c })),
  rows: t.rows.map((r) => ({
    sourceKey: r.sourceKey,
    number: { ...r.number },
    label: { ...r.label },
    foreignKey: { ...r.foreignKey },
  })),
})

export const useDataImportStore = create<DataImportStore>((set, get) => ({
  tables: [],

  loadTables: (saved) => {
    const list = Array.isArray(saved) ? saved : []
    set({ tables: list.map(cloneTable) })
  },

  snapshot: () => get().tables.map(cloneTable),
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
