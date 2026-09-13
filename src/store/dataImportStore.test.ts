import { beforeEach, describe, expect, it } from 'vitest'
import type { ImportSourceTable } from '../model/serialize'
import { hasDataImports, useDataImportStore } from './dataImportStore'

// docs/data-import.md (`loop-revision/8`) — the storage-foundation sidecar
// store. Phase 1A ships no interactive mutation UI, so the only surface to
// test is load / snapshot and the undo-sidecar's deep-copy guarantee.

const reset = () => useDataImportStore.getState().loadTables([])

const table = (): ImportSourceTable => ({
  sourceTableId: 'srctable_items',
  label: 'Items',
  columns: [{ sourceColumnId: 'srccol_w', role: 'number', header: 'weight' }],
  rows: [{ sourceKey: 'itm_a', number: { srccol_w: 10 }, label: {}, foreignKey: {} }],
})

describe('dataImportStore', () => {
  beforeEach(reset)

  it('loadTables / hasDataImports / snapshot round-trip', () => {
    expect(hasDataImports(useDataImportStore.getState())).toBe(false)
    useDataImportStore.getState().loadTables([table()])
    expect(hasDataImports(useDataImportStore.getState())).toBe(true)
    expect(useDataImportStore.getState().snapshot()).toEqual([table()])
  })

  it('loadTables(null) clears to []', () => {
    useDataImportStore.getState().loadTables([table()])
    useDataImportStore.getState().loadTables(null)
    expect(useDataImportStore.getState().tables).toEqual([])
  })

  // The regression this guards: a shallow `{...t, columns: [...t.columns],
  // rows: [...t.rows]}` still shares the COLUMN / ROW / value-map objects
  // themselves across every snapshot taken before a later in-place mutation
  // (Phase 1B's own future edit path) — corrupting every past undo-history
  // entry that captured one. `snapshot()` / `loadTables()` must deep-clone
  // down to each row's `number` / `label` / `foreignKey` map.
  describe('snapshot() / loadTables() are deep clones — mutating the source never moves a snapshot', () => {
    it('mutating the LIVE store after taking a snapshot does not change the snapshot', () => {
      useDataImportStore.getState().loadTables([table()])
      const snap = useDataImportStore.getState().snapshot()

      // mutate the live store's underlying objects in place (simulating a
      // future Phase 1B edit that writes through an existing reference)
      const live = useDataImportStore.getState().tables[0]
      live.rows[0].number.srccol_w = 999
      live.columns[0].header = 'CHANGED'

      expect(snap[0].rows[0].number.srccol_w).toBe(10)
      expect(snap[0].columns[0].header).toBe('weight')
    })

    it('mutating a snapshot after loadTables() does not change the live store', () => {
      const t = table()
      useDataImportStore.getState().loadTables([t])

      const snap = useDataImportStore.getState().snapshot()
      snap[0].rows[0].number.srccol_w = 999
      snap[0].columns[0].header = 'CHANGED'
      snap[0].rows[0].label.extra = 'x'

      expect(useDataImportStore.getState().tables[0].rows[0].number.srccol_w).toBe(10)
      expect(useDataImportStore.getState().tables[0].columns[0].header).toBe('weight')
      expect(useDataImportStore.getState().tables[0].rows[0].label).toEqual({})
    })

    it('mutating the ORIGINAL object passed to loadTables() after the call does not change the live store', () => {
      const t = table()
      useDataImportStore.getState().loadTables([t])
      t.rows[0].number.srccol_w = 999
      t.columns[0].header = 'CHANGED'

      expect(useDataImportStore.getState().tables[0].rows[0].number.srccol_w).toBe(10)
      expect(useDataImportStore.getState().tables[0].columns[0].header).toBe('weight')
    })

    it('two snapshots taken back-to-back share no mutable object references', () => {
      useDataImportStore.getState().loadTables([table()])
      const a = useDataImportStore.getState().snapshot()
      const b = useDataImportStore.getState().snapshot()
      expect(a).toEqual(b)
      expect(a[0]).not.toBe(b[0])
      expect(a[0].columns[0]).not.toBe(b[0].columns[0])
      expect(a[0].rows[0]).not.toBe(b[0].rows[0])
      expect(a[0].rows[0].number).not.toBe(b[0].rows[0].number)
    })
  })
})
