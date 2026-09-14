import { beforeEach, describe, expect, it } from 'vitest'
import { diffRefresh, type RefreshResolution } from '../model/dataImportRefresh'
import { validateRefreshSnapshot } from '../model/dataImportRefreshValidate'
import type { ImportColumn, ImportRow, ImportSourceTable } from '../model/serialize'
import type { LoopNode } from '../model/types'
import { useDataImportStore } from './dataImportStore'
import { useGraphStore } from './graphStore'

// docs/data-import.md §DI11/§DI16 Phase 2 -- `graphStore.commitRefresh` /
// `renameDataImportTable`: each must be ONE atomic history entry (mirrors
// `dataImportCommit.test.ts`'s own precedent for `commitDataImport`), and
// `updateNodeData` must carry a label edit + its `labelAutoComposed: false`
// flip as one atomic change (§DI-D19 item 1) -- the guarantee Inspector.tsx's
// own single `set({...})` call relies on. Inspector's actual JSX wiring is
// exercised by e2e (`data-import-refresh.spec.ts`), not here -- this project
// has no component-render unit tests for any UI file.

const g = () => useGraphStore.getState()

function col(sourceColumnId: string, role: ImportColumn['role'], header: string): ImportColumn {
  return { sourceColumnId, role, header }
}

function itemsTable(
  rows: ImportRow[] = [{ sourceKey: 'itm_a', number: { col_weight: 10 }, label: { col_name: 'Ember Blade' }, foreignKey: {} }],
): ImportSourceTable {
  return {
    sourceTableId: 'srctable_items',
    label: 'Items',
    columns: [col('col_key', 'key', 'item_key'), col('col_name', 'label', 'display_name'), col('col_weight', 'number', 'weight')],
    rows,
  }
}

function param(
  id: string,
  opts: { sourceTableId: string; sourceKey: string; sourceColumnId: string; value: number; label?: string; labelAutoComposed?: boolean },
): LoopNode {
  return {
    id,
    type: 'parameter',
    position: { x: 0, y: 0 },
    data: {
      kind: 'parameter',
      label: opts.label ?? id,
      value: opts.value,
      sourceTableId: opts.sourceTableId,
      sourceKey: opts.sourceKey,
      sourceColumnId: opts.sourceColumnId,
      labelAutoComposed: opts.labelAutoComposed ?? true,
    },
  } as LoopNode
}

beforeEach(() => {
  g().newGraph()
})

describe('graphStore.commitRefresh -- one atomic transaction', () => {
  it('one Undo reverts the updated node value, the new node, and the table rows together; Redo restores them', () => {
    const t = itemsTable()
    useDataImportStore.getState().loadTables([t])
    const p1 = param('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    useGraphStore.setState({ nodes: [p1] })

    const header = ['item_key', 'display_name', 'weight']
    const snap = validateRefreshSnapshot([t], t.sourceTableId, [header, ['itm_a', 'Ember Blade', '25'], ['itm_b', 'Iron Charm', '3']], 1, 0, [])
    expect(snap.ok).toBe(true)
    if (!snap.ok) return
    const diff = diffRefresh([t], t.sourceTableId, g().nodes, snap.snapshot)
    expect(diff.ok).toBe(true)
    if (!diff.ok) return

    const pastBefore = g().past.length
    const resolution: RefreshResolution = {
      confirmedAdds: new Set(['itm_b']),
      missingRowChoices: new Map(),
      cellChoices: new Map(),
      locallyDeletedChoices: new Map(),
      fkRepointChoices: new Map(),
    }
    const result = g().commitRefresh(diff.plan, resolution, { x: 0, y: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(g().past.length).toBe(pastBefore + 1) // ONE entry, not three
    expect(g().nodes).toHaveLength(2)
    expect((g().nodes.find((n) => n.id === 'p1')!.data as { value: number }).value).toBe(25)
    const tableAfter = useDataImportStore.getState().tables[0]
    expect(tableAfter.rows).toHaveLength(2)
    expect(tableAfter.rows.find((r) => r.sourceKey === 'itm_a')!.number.col_weight).toBe(25)

    g().undo()
    expect(g().nodes).toHaveLength(1)
    expect((g().nodes[0].data as { value: number }).value).toBe(10)
    expect(useDataImportStore.getState().tables[0].rows).toHaveLength(1)

    g().redo()
    expect(g().nodes).toHaveLength(2)
    expect((g().nodes.find((n) => n.id === 'p1')!.data as { value: number }).value).toBe(25)
    expect(useDataImportStore.getState().tables[0].rows).toHaveLength(2)
  })

  it('refreshing the MIDDLE table of several preserves the array order -- it is replaced in place, never moved to the end', () => {
    const a: ImportSourceTable = {
      sourceTableId: 'srctable_a',
      label: 'A',
      columns: [col('a_key', 'key', 'a_key')],
      rows: [{ sourceKey: 'x', number: {}, label: {}, foreignKey: {} }],
    }
    const b = itemsTable()
    const c: ImportSourceTable = {
      sourceTableId: 'srctable_c',
      label: 'C',
      columns: [col('c_key', 'key', 'c_key')],
      rows: [{ sourceKey: 'y', number: {}, label: {}, foreignKey: {} }],
    }
    useDataImportStore.getState().loadTables([a, b, c])
    const p1 = param('p1', { sourceTableId: b.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    useGraphStore.setState({ nodes: [p1] })

    const header = ['item_key', 'display_name', 'weight']
    const snap = validateRefreshSnapshot([a, b, c], b.sourceTableId, [header, ['itm_a', 'Ember Blade', '25']], 1, 0, [])
    expect(snap.ok).toBe(true)
    if (!snap.ok) return
    const diff = diffRefresh([a, b, c], b.sourceTableId, g().nodes, snap.snapshot)
    expect(diff.ok).toBe(true)
    if (!diff.ok) return

    const resolution: RefreshResolution = {
      confirmedAdds: new Set(),
      missingRowChoices: new Map(),
      cellChoices: new Map(),
      locallyDeletedChoices: new Map(),
      fkRepointChoices: new Map(),
    }
    const result = g().commitRefresh(diff.plan, resolution, { x: 0, y: 0 })
    expect(result.ok).toBe(true)

    const idsAfter = useDataImportStore.getState().tables.map((t) => t.sourceTableId)
    expect(idsAfter).toEqual(['srctable_a', b.sourceTableId, 'srctable_c']) // order preserved -- B stays in the middle
    expect(useDataImportStore.getState().tables[1].rows.find((r) => r.sourceKey === 'itm_a')!.number.col_weight).toBe(25)

    g().undo()
    expect(useDataImportStore.getState().tables.map((t) => t.sourceTableId)).toEqual(['srctable_a', b.sourceTableId, 'srctable_c'])
    expect(useDataImportStore.getState().tables[1].rows.find((r) => r.sourceKey === 'itm_a')!.number.col_weight).toBe(10)

    g().redo()
    expect(useDataImportStore.getState().tables.map((t) => t.sourceTableId)).toEqual(['srctable_a', b.sourceTableId, 'srctable_c'])
    expect(useDataImportStore.getState().tables[1].rows.find((r) => r.sourceKey === 'itm_a')!.number.col_weight).toBe(25)
  })
})

describe('graphStore.renameDataImportTable', () => {
  it('refuses an empty or over-length name without mutating anything', () => {
    const t = itemsTable()
    useDataImportStore.getState().loadTables([t])
    const pastBefore = g().past.length

    expect(g().renameDataImportTable(t.sourceTableId, '   ')).toEqual({ ok: false, reason: 'empty-table-name' })
    expect(g().renameDataImportTable(t.sourceTableId, 'x'.repeat(201))).toEqual({ ok: false, reason: 'label-too-long' })

    expect(g().past.length).toBe(pastBefore)
    expect(useDataImportStore.getState().tables[0].label).toBe('Items')
  })

  it('recomposes every labelAutoComposed Parameter across multiple rows as ONE atomic Undo entry, and never touches an already hand-detached one', () => {
    const t = itemsTable([
      { sourceKey: 'itm_a', number: { col_weight: 10 }, label: { col_name: 'Ember Blade' }, foreignKey: {} },
      { sourceKey: 'itm_b', number: { col_weight: 3 }, label: { col_name: 'Iron Charm' }, foreignKey: {} },
      { sourceKey: 'itm_c', number: { col_weight: 7 }, label: { col_name: 'Iron Ring' }, foreignKey: {} },
    ])
    useDataImportStore.getState().loadTables([t])
    const pA = param('pa', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10, label: 'Items · Ember Blade · weight' })
    const pB = param('pb', { sourceTableId: t.sourceTableId, sourceKey: 'itm_b', sourceColumnId: 'col_weight', value: 3, label: 'Items · Iron Charm · weight' })
    const pDetached = param('pd', {
      sourceTableId: t.sourceTableId,
      sourceKey: 'itm_c',
      sourceColumnId: 'col_weight',
      value: 7,
      label: 'My Custom Ring Name',
      labelAutoComposed: false,
    })
    useGraphStore.setState({ nodes: [pA, pB, pDetached] })

    const pastBefore = g().past.length
    expect(g().renameDataImportTable(t.sourceTableId, 'Loot Items')).toEqual({ ok: true })
    expect(g().past.length).toBe(pastBefore + 1) // ONE entry for the whole cascade, not one per Parameter

    const dataOf = (id: string) => g().nodes.find((n) => n.id === id)!.data as { label: string; labelAutoComposed?: boolean }
    expect(dataOf('pa').label).toBe('Loot Items · Ember Blade · weight')
    expect(dataOf('pb').label).toBe('Loot Items · Iron Charm · weight')
    expect(dataOf('pd').label).toBe('My Custom Ring Name') // hand-detached -- a table rename never recomposes it
    expect(useDataImportStore.getState().tables[0].label).toBe('Loot Items')

    g().undo()
    expect(dataOf('pa').label).toBe('Items · Ember Blade · weight')
    expect(dataOf('pb').label).toBe('Items · Iron Charm · weight')
    expect(dataOf('pd').label).toBe('My Custom Ring Name')
    expect(useDataImportStore.getState().tables[0].label).toBe('Items')
  })

  it('a table with ZERO auto-composed Parameters (a pure-lookup table) still commits, persists, and can be Undone/Redone', () => {
    // a pure-lookup table (no `number`-role column) generates no Parameters
    // at all -- `updatedNodes` is empty, but the rename itself is still a
    // real change to the stored binding that must land in history.
    const t: ImportSourceTable = {
      sourceTableId: 'srctable_banners',
      label: 'Banners',
      columns: [col('col_key', 'key', 'banner_key'), col('col_name', 'label', 'banner_name')],
      rows: [{ sourceKey: 'premium_pickup', number: {}, label: { col_name: 'Premium Pickup' }, foreignKey: {} }],
    }
    useDataImportStore.getState().loadTables([t])
    useGraphStore.setState({ nodes: [] })

    const pastBefore = g().past.length
    expect(g().renameDataImportTable(t.sourceTableId, 'Banner Sets')).toEqual({ ok: true })
    expect(g().past.length).toBe(pastBefore + 1) // ONE entry, even with zero nodes to touch
    expect(useDataImportStore.getState().tables[0].label).toBe('Banner Sets')

    g().undo()
    expect(useDataImportStore.getState().tables[0].label).toBe('Banners')
    g().redo()
    expect(useDataImportStore.getState().tables[0].label).toBe('Banner Sets')
  })

  it('a table whose every Parameter is already hand-detached still commits the rename atomically', () => {
    const t = itemsTable()
    useDataImportStore.getState().loadTables([t])
    const detached = param('pd', {
      sourceTableId: t.sourceTableId,
      sourceKey: 'itm_a',
      sourceColumnId: 'col_weight',
      value: 10,
      label: 'Custom Name',
      labelAutoComposed: false,
    })
    useGraphStore.setState({ nodes: [detached] })

    const pastBefore = g().past.length
    expect(g().renameDataImportTable(t.sourceTableId, 'Loot')).toEqual({ ok: true })
    expect(g().past.length).toBe(pastBefore + 1) // ONE entry, even though no node needed updating
    expect((g().nodes[0].data as { label: string }).label).toBe('Custom Name') // untouched
    expect(useDataImportStore.getState().tables[0].label).toBe('Loot')

    g().undo()
    expect(useDataImportStore.getState().tables[0].label).toBe('Items')
  })
})

describe('updateNodeData -- label edit + labelAutoComposed:false flip is one atomic Undo entry (§DI-D19 item 1)', () => {
  it('Undo restores both the old label text AND labelAutoComposed:true together', () => {
    const t = itemsTable()
    useDataImportStore.getState().loadTables([t])
    const p1 = param('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10, label: 'Items · Ember Blade · weight' })
    useGraphStore.setState({ nodes: [p1] })

    const pastBefore = g().past.length
    // mirrors Inspector.tsx's own label <input onChange> -- ONE updateNodeData
    // call carrying both fields in the same patch object.
    g().updateNodeData('p1', { label: 'My Custom Name', labelAutoComposed: false })
    expect(g().past.length).toBe(pastBefore + 1)

    const after = g().nodes[0].data as { label: string; labelAutoComposed?: boolean }
    expect(after.label).toBe('My Custom Name')
    expect(after.labelAutoComposed).toBe(false)

    g().undo()
    const restored = g().nodes[0].data as { label: string; labelAutoComposed?: boolean }
    expect(restored.label).toBe('Items · Ember Blade · weight')
    expect(restored.labelAutoComposed).toBe(true)
  })
})
