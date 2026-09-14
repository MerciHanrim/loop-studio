import { describe, expect, it } from 'vitest'
import { nextId } from './factory'
import { validateRefreshSnapshot, type ColumnPairing } from './dataImportRefreshValidate'
import { buildRefreshCommit, classifyCell, diffRefresh, findImportForeignKeyDependents, type RefreshResolution } from './dataImportRefresh'
import type { ImportColumn, ImportSourceTable, SavedFrame } from './serialize'
import type { LoopEdge, LoopNode } from './types'

// docs/data-import.md §DI11/§DI-D15..D21 -- Phase 2. `diffRefresh` is the
// pure row/cell classifier; `buildRefreshCommit` is the pure candidate
// builder consuming its branded `RefreshDiffPlan` plus the user's
// `RefreshResolution`. Mirrors `dataImportCommit.test.ts`'s own discipline of
// building fixtures through the real validator rather than hand-constructing
// branded types.

function col(sourceColumnId: string, role: ImportColumn['role'], header: string, refTableId?: string): ImportColumn {
  return refTableId ? { sourceColumnId, role, header, refTableId } : { sourceColumnId, role, header }
}

function itemsTable(overrides: Partial<ImportSourceTable> = {}): ImportSourceTable {
  return {
    sourceTableId: 'srctable_items',
    label: 'Items',
    columns: [col('col_key', 'key', 'item_key'), col('col_name', 'label', 'display_name'), col('col_weight', 'number', 'weight')],
    rows: [{ sourceKey: 'itm_a', number: { col_weight: 10 }, label: { col_name: 'Ember Blade' }, foreignKey: {} }],
    ...overrides,
  }
}

function poolTable(overrides: Partial<ImportSourceTable> = {}): ImportSourceTable {
  return {
    sourceTableId: 'srctable_pool',
    label: 'GachaPoolEntries',
    columns: [col('col_pkey', 'key', 'pool_entry_key'), col('col_item', 'foreignKey', 'item_key', 'srctable_items'), col('col_share', 'number', 'weight')],
    rows: [{ sourceKey: 'ppe_a', number: { col_share: 5 }, label: {}, foreignKey: { col_item: 'itm_a' } }],
    ...overrides,
  }
}

function snapshotFor(
  tables: readonly ImportSourceTable[],
  refreshingTableId: string,
  rows: string[][],
  pairings: ColumnPairing[] = [],
  header?: string[],
) {
  const table = tables.find((t) => t.sourceTableId === refreshingTableId)!
  const h = header ?? table.columns.map((c) => c.header)
  const r = validateRefreshSnapshot(tables, refreshingTableId, [h, ...rows], 1, 0, pairings)
  if (!r.ok) throw new Error(`fixture snapshot failed to validate: ${JSON.stringify(r.errors)}`)
  return r.snapshot
}

function paramNode(
  id: string,
  opts: { sourceTableId: string; sourceKey: string; sourceColumnId: string; value: number; labelAutoComposed?: boolean; label?: string },
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

const EMPTY_HOST: { nodes: LoopNode[]; edges: LoopEdge[] } = { nodes: [], edges: [] }
const NO_RESOLUTION: RefreshResolution = {
  confirmedAdds: new Set(),
  missingRowChoices: new Map(),
  cellChoices: new Map(),
  locallyDeletedChoices: new Map(),
  fkRepointChoices: new Map(),
}

describe('classifyCell -- the complete base/local/incoming three-way (§DI11)', () => {
  it.each([
    ['unchanged', 10, 10, 10, 'unchanged'],
    ['source-only changed', 10, 10, 25, 'source-only'],
    ['local-only changed', 10, 15, 10, 'local-only'],
    ['converged', 10, 25, 25, 'converged'],
    ['real conflict', 10, 15, 25, 'conflict'],
  ] as const)('%s', (_name, base, local, incoming, expected) => {
    expect(classifyCell(base, local, incoming)).toBe(expected)
  })
})

describe('findImportForeignKeyDependents', () => {
  it('finds a dependent row whose FK cell still points at the target key', () => {
    const deps = findImportForeignKeyDependents([itemsTable(), poolTable()], 'srctable_items', 'itm_a')
    expect(deps).toEqual([{ dependentTableId: 'srctable_pool', dependentSourceKey: 'ppe_a', sourceColumnId: 'col_item' }])
  })

  it('finds nothing when no other table references the key', () => {
    const deps = findImportForeignKeyDependents([itemsTable(), poolTable()], 'srctable_items', 'itm_nonexistent')
    expect(deps).toEqual([])
  })
})

describe('diffRefresh -- row existence (phase 1)', () => {
  it('a brand-new sourceKey is `added`', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '10'], ['itm_b', 'Iron Charm', '3']])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const added = r.plan.rows.find((row) => row.kind === 'added')
    expect(added).toMatchObject({ kind: 'added', sourceKey: 'itm_b' })
  })

  it('a stored row absent from the incoming snapshot is `missing`, with empty dependents when nothing references it', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.rows).toEqual([{ kind: 'missing', sourceKey: 'itm_a', dependents: [] }])
  })

  it('a missing row still FK-referenced by another table carries its dependents (§DI-D21)', () => {
    const items = itemsTable()
    const pool = poolTable()
    const snapshot = snapshotFor([items, pool], items.sourceTableId, [])
    const r = diffRefresh([items, pool], items.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.rows).toEqual([
      { kind: 'missing', sourceKey: 'itm_a', dependents: [{ dependentTableId: 'srctable_pool', dependentSourceKey: 'ppe_a', sourceColumnId: 'col_item' }] },
    ])
  })
})

describe('diffRefresh -- per-cell state (phase 2)', () => {
  it('a node carrying the triple runs the ordinary three-way', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const node = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const row = r.plan.rows.find((rw) => rw.kind === 'present')
    expect(row?.kind === 'present' && row.cells).toEqual([
      { kind: 'three-way', sourceColumnId: 'col_weight', nodeId: 'p1', state: 'source-only', base: 10, local: 10, incoming: 25 },
    ])
  })

  it('an existing column with no matching node but a stored base is `locally-deleted`', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot) // no host nodes at all
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const row = r.plan.rows.find((rw) => rw.kind === 'present')
    expect(row?.kind === 'present' && row.cells).toEqual([{ kind: 'locally-deleted', sourceColumnId: 'col_weight', base: 10, incoming: 25 }])
  })

  it('an existing column with no matching node AND no stored base is silently skipped (already-discarded)', () => {
    const t = itemsTable({ rows: [{ sourceKey: 'itm_a', number: {}, label: { col_name: 'Ember Blade' }, foreignKey: {} }] })
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const row = r.plan.rows.find((rw) => rw.kind === 'present')
    expect(row?.kind === 'present' && row.cells).toEqual([])
  })

  it('a brand-new column mapped this refresh is `added-cell`, never confused with locally-deleted', () => {
    const t = itemsTable()
    const newId = nextId('srccol')
    const pairing: ColumnPairing = { kind: 'new-column', sourceColumnId: newId, incomingColumnIndex: 3, role: 'number' }
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '10', '99']], [pairing], ['item_key', 'display_name', 'weight', 'rarity'])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const row = r.plan.rows.find((rw) => rw.kind === 'present')
    expect(row?.kind === 'present' && row.cells).toContainEqual({ kind: 'added-cell', sourceColumnId: newId, incoming: 99 })
  })

  it('a duplicate triple (2+ Parameters sharing one generating triple) refuses the whole refresh (§DI-D15)', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const n1 = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const n2 = paramNode('p2', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 12 })
    const r = diffRefresh([t], t.sourceTableId, [n1, n2], snapshot)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.duplicateTriples).toEqual([{ sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', nodeIds: ['p1', 'p2'] }])
  })

  it('a duplicate found on a `missing` row is still caught (not just present-row survivors)', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [])
    const n1 = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const n2 = paramNode('p2', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const r = diffRefresh([t], t.sourceTableId, [n1, n2], snapshot)
    expect(r.ok).toBe(false)
  })
})

describe('diffRefresh -- foreignKey changes and label-role constituent changes', () => {
  it('an FK value re-point is surfaced as an FkChange', () => {
    const items = itemsTable({ rows: [...itemsTable().rows, { sourceKey: 'itm_b', number: { col_weight: 3 }, label: { col_name: 'Iron Charm' }, foreignKey: {} }] })
    const pool = poolTable()
    const snapshot = snapshotFor([items, pool], pool.sourceTableId, [['ppe_a', 'itm_b', '5']])
    const r = diffRefresh([items, pool], pool.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const row = r.plan.rows.find((rw) => rw.kind === 'present')
    expect(row?.kind === 'present' && row.fkChanges).toEqual([{ sourceColumnId: 'col_item', base: 'itm_a', incoming: 'itm_b' }])
  })

  it('a label-role text change is surfaced as a LabelConstituentChange and produces cross-table impact', () => {
    const items = itemsTable()
    const pool = poolTable()
    const snapshot = snapshotFor([items, pool], items.sourceTableId, [['itm_a', 'Ember Blade Reforged', '10']])
    const r = diffRefresh([items, pool], items.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const row = r.plan.rows.find((rw) => rw.kind === 'present')
    expect(row?.kind === 'present' && row.labelConstituentChanges).toEqual([{ sourceColumnId: 'col_name', base: 'Ember Blade', incoming: 'Ember Blade Reforged' }])
    expect(r.plan.crossTableLabelImpact).toEqual([{ dependentTableId: 'srctable_pool', dependentSourceKey: 'ppe_a', sourceColumnId: 'col_item' }])
  })

  it('a foreignKey-role change on the refreshed table never produces cross-table impact (§DI10)', () => {
    const items = itemsTable({ rows: [...itemsTable().rows, { sourceKey: 'itm_b', number: { col_weight: 3 }, label: { col_name: 'Iron Charm' }, foreignKey: {} }] })
    const pool = poolTable()
    const snapshot = snapshotFor([items, pool], pool.sourceTableId, [['ppe_a', 'itm_b', '5']])
    const r = diffRefresh([items, pool], pool.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.crossTableLabelImpact).toEqual([])
  })
})

describe('diffRefresh -- removed-column outcomes, per role (§DI-D20)', () => {
  it('a removed number column bulk-collects every Parameter it generated', () => {
    const t = itemsTable()
    const node = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const removed: ColumnPairing = { kind: 'column-removed', sourceColumnId: 'col_weight' }
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade']], [removed], ['item_key', 'display_name'])
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.removedColumns).toEqual([{ role: 'number', sourceColumnId: 'col_weight', nodeIds: ['p1'] }])
  })

  it('a removed label column is reported with no node list (nothing to unlink)', () => {
    const t = itemsTable()
    const removed: ColumnPairing = { kind: 'column-removed', sourceColumnId: 'col_name' }
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', '10']], [removed], ['item_key', 'weight'])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.removedColumns).toEqual([{ role: 'label', sourceColumnId: 'col_name' }])
  })

  it('a removed foreignKey column is reported with no node list', () => {
    const pool = poolTable()
    const removed: ColumnPairing = { kind: 'column-removed', sourceColumnId: 'col_item' }
    const snapshot = snapshotFor([pool], pool.sourceTableId, [['ppe_a', '5']], [removed], ['pool_entry_key', 'weight'])
    const r = diffRefresh([pool], pool.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.removedColumns).toEqual([{ role: 'foreignKey', sourceColumnId: 'col_item' }])
  })
})

describe('buildRefreshCommit -- added rows', () => {
  it('a confirmed add materializes a new Parameter with a composed label', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '10'], ['itm_b', 'Iron Charm', '3']])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolution: RefreshResolution = { ...NO_RESOLUTION, confirmedAdds: new Set(['itm_b']) }
    const result = buildRefreshCommit([t], r.plan, resolution, EMPTY_HOST, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.createdNodes).toHaveLength(1)
    expect((result.createdNodes[0].data as { label: string }).label).toBe('Items · Iron Charm · weight')
    expect(result.updatedTables[0].rows.find((row) => row.sourceKey === 'itm_b')).toBeTruthy()
  })

  it('an unconfirmed add is excluded entirely -- no node, no stored row', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '10'], ['itm_b', 'Iron Charm', '3']])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const result = buildRefreshCommit([t], r.plan, NO_RESOLUTION, EMPTY_HOST, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.createdNodes).toHaveLength(0)
    expect(result.updatedTables[0].rows.find((row) => row.sourceKey === 'itm_b')).toBeUndefined()
  })
})

describe('buildRefreshCommit -- missing rows', () => {
  it('unlink strips the triple + labelAutoComposed but keeps the node, and drops the stored row', () => {
    const t = itemsTable()
    const node = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const snapshot = snapshotFor([t], t.sourceTableId, [])
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolution: RefreshResolution = { ...NO_RESOLUTION, missingRowChoices: new Map([['itm_a', 'unlink']]) }
    const result = buildRefreshCommit([t], r.plan, resolution, { nodes: [node], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.removedNodeIds).toEqual([])
    expect(result.updatedNodes).toHaveLength(1)
    const data = result.updatedNodes[0].data as Record<string, unknown>
    expect(data.sourceTableId).toBeUndefined()
    expect(data.labelAutoComposed).toBeUndefined()
    expect(result.updatedTables[0].rows).toEqual([])
  })

  it('delete removes the node when nothing references it', () => {
    const t = itemsTable()
    const node = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const snapshot = snapshotFor([t], t.sourceTableId, [])
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolution: RefreshResolution = { ...NO_RESOLUTION, missingRowChoices: new Map([['itm_a', 'delete']]) }
    const result = buildRefreshCommit([t], r.plan, resolution, { nodes: [node], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.removedNodeIds).toEqual(['p1'])
  })

  it('delete refuses when the node is still referenced by a Register expr, naming the reference', () => {
    const t = itemsTable()
    const node = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const register: LoopNode = { id: 'r1', type: 'register', position: { x: 0, y: 0 }, data: { kind: 'register', label: 'R', expr: '@p1 + 1' } } as LoopNode
    const snapshot = snapshotFor([t], t.sourceTableId, [])
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolution: RefreshResolution = { ...NO_RESOLUTION, missingRowChoices: new Map([['itm_a', 'delete']]) }
    const result = buildRefreshCommit([t], r.plan, resolution, { nodes: [node, register], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result).toMatchObject({ ok: false, reason: 'referenced-node', detail: { nodeId: 'p1', refs: [{ via: 'register', nodeId: 'r1' }] } })
  })

  it('a blocked missing row (still FK-referenced elsewhere) refuses unlink and delete alike (§DI-D21)', () => {
    const items = itemsTable()
    const pool = poolTable()
    const snapshot = snapshotFor([items, pool], items.sourceTableId, [])
    const r = diffRefresh([items, pool], items.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const unlinkAttempt = buildRefreshCommit([items, pool], r.plan, { ...NO_RESOLUTION, missingRowChoices: new Map([['itm_a', 'unlink']]) }, EMPTY_HOST, 2, { x: 0, y: 0 }, [])
    expect(unlinkAttempt).toMatchObject({ ok: false, reason: 'missing-row-dependency' })
    const deleteAttempt = buildRefreshCommit([items, pool], r.plan, { ...NO_RESOLUTION, missingRowChoices: new Map([['itm_a', 'delete']]) }, EMPTY_HOST, 2, { x: 0, y: 0 }, [])
    expect(deleteAttempt).toMatchObject({ ok: false, reason: 'missing-row-dependency' })
  })
})

describe('buildRefreshCommit -- the number three-way, base-movement rules', () => {
  it('source-only auto-applies incoming to the node, and base moves to incoming', () => {
    const t = itemsTable()
    const node = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const result = buildRefreshCommit([t], r.plan, NO_RESOLUTION, { nodes: [node], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.updatedNodes.find((n) => n.id === 'p1')!.data as { value: number }).value).toBe(25)
    expect(result.updatedTables[0].rows[0].number.col_weight).toBe(25)
  })

  it('local-only keeps the node untouched and leaves base unchanged', () => {
    const t = itemsTable()
    const node = paramNode('p1', {
      sourceTableId: t.sourceTableId,
      sourceKey: 'itm_a',
      sourceColumnId: 'col_weight',
      value: 15,
      label: 'Items · Ember Blade · weight',
    })
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '10']]) // incoming == base
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const result = buildRefreshCommit([t], r.plan, NO_RESOLUTION, { nodes: [node], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.updatedNodes.find((n) => n.id === 'p1')).toBeUndefined()
    expect(result.updatedTables[0].rows[0].number.col_weight).toBe(10)
  })

  it('an unresolved conflict defaults to keep-mine (node untouched) but still moves base to incoming', () => {
    const t = itemsTable()
    const node = paramNode('p1', {
      sourceTableId: t.sourceTableId,
      sourceKey: 'itm_a',
      sourceColumnId: 'col_weight',
      value: 15,
      label: 'Items · Ember Blade · weight',
    })
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const result = buildRefreshCommit([t], r.plan, NO_RESOLUTION, { nodes: [node], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.updatedNodes.find((n) => n.id === 'p1')).toBeUndefined()
    expect(result.updatedTables[0].rows[0].number.col_weight).toBe(25)
  })

  it('a resolved conflict with apply-incoming updates the node', () => {
    const t = itemsTable()
    const node = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 15 })
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolution: RefreshResolution = { ...NO_RESOLUTION, cellChoices: new Map([['itm_a:col_weight', 'apply-incoming']]) }
    const result = buildRefreshCommit([t], r.plan, resolution, { nodes: [node], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.updatedNodes.find((n) => n.id === 'p1')!.data as { value: number }).value).toBe(25)
  })
})

describe('buildRefreshCommit -- locally-deleted cells', () => {
  it('recreate materializes a fresh Parameter and moves base to incoming', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolution: RefreshResolution = { ...NO_RESOLUTION, locallyDeletedChoices: new Map([['itm_a:col_weight', 'recreate']]) }
    const result = buildRefreshCommit([t], r.plan, resolution, EMPTY_HOST, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.createdNodes).toHaveLength(1)
    expect((result.createdNodes[0].data as { value: number }).value).toBe(25)
    expect(result.updatedTables[0].rows[0].number.col_weight).toBe(25)
  })

  it('discard removes the base-projection entry, and a second refresh stays silent about it', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolution: RefreshResolution = { ...NO_RESOLUTION, locallyDeletedChoices: new Map([['itm_a:col_weight', 'discard']]) }
    const result = buildRefreshCommit([t], r.plan, resolution, EMPTY_HOST, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.createdNodes).toHaveLength(0)
    expect(result.updatedTables[0].rows[0].number.col_weight).toBeUndefined()

    // second refresh, same incoming value -- must be silently skipped (already-discarded), not re-asked
    const discardedTable = result.updatedTables[0]
    const snapshot2 = snapshotFor([discardedTable], discardedTable.sourceTableId, [['itm_a', 'Ember Blade', '25']])
    const r2 = diffRefresh([discardedTable], discardedTable.sourceTableId, [], snapshot2)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const row2 = r2.plan.rows.find((rw) => rw.kind === 'present')
    expect(row2?.kind === 'present' && row2.cells).toEqual([])
  })
})

describe('buildRefreshCommit -- removed-column bulk unlink and per-role recompose scope', () => {
  it('a removed number column bulk-unlinks its Parameters and drops the base, touching only this table', () => {
    const t = itemsTable()
    const node = paramNode('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10 })
    const removed: ColumnPairing = { kind: 'column-removed', sourceColumnId: 'col_weight' }
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade']], [removed], ['item_key', 'display_name'])
    const r = diffRefresh([t], t.sourceTableId, [node], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const result = buildRefreshCommit([t], r.plan, NO_RESOLUTION, { nodes: [node], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = result.updatedNodes.find((n) => n.id === 'p1')!.data as Record<string, unknown>
    expect(data.sourceColumnId).toBeUndefined()
    expect(result.updatedTables[0].rows[0].number).toEqual({})
  })

  it('a removed label column recomposes both this table and a dependent table (§DI-D20)', () => {
    const items = itemsTable()
    const pool = poolTable()
    const poolNode = paramNode('pp1', {
      sourceTableId: pool.sourceTableId,
      sourceKey: 'ppe_a',
      sourceColumnId: 'col_share',
      value: 5,
      label: 'GachaPoolEntries · Ember Blade · weight',
    })
    const itemsNode = paramNode('pi1', { sourceTableId: items.sourceTableId, sourceKey: 'itm_a', sourceColumnId: 'col_weight', value: 10, label: 'Items · Ember Blade · weight' })
    const removed: ColumnPairing = { kind: 'column-removed', sourceColumnId: 'col_name' }
    const snapshot = snapshotFor([items, pool], items.sourceTableId, [['itm_a', '10']], [removed], ['item_key', 'weight'])
    const r = diffRefresh([items, pool], items.sourceTableId, [poolNode, itemsNode], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const result = buildRefreshCommit([items, pool], r.plan, NO_RESOLUTION, { nodes: [poolNode, itemsNode], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ownLabel = (result.updatedNodes.find((n) => n.id === 'pi1')!.data as { label: string }).label
    const depLabel = (result.updatedNodes.find((n) => n.id === 'pp1')!.data as { label: string }).label
    expect(ownLabel).toBe('Items · itm_a · weight') // no label-role text left -- falls back to sourceKey
    expect(depLabel).toBe('GachaPoolEntries · itm_a · weight') // the dependent's FK term falls back too
  })

  it('a removed foreignKey column recomposes only this table, never a dependent', () => {
    const items = itemsTable({ rows: [...itemsTable().rows, { sourceKey: 'itm_b', number: { col_weight: 3 }, label: { col_name: 'Iron Charm' }, foreignKey: {} }] })
    const pool = poolTable()
    const poolNode = paramNode('pp1', { sourceTableId: pool.sourceTableId, sourceKey: 'ppe_a', sourceColumnId: 'col_share', value: 5, label: 'GachaPoolEntries · Ember Blade · weight' })
    const removed: ColumnPairing = { kind: 'column-removed', sourceColumnId: 'col_item' }
    const snapshot = snapshotFor([items, pool], pool.sourceTableId, [['ppe_a', '5']], [removed], ['pool_entry_key', 'weight'])
    const r = diffRefresh([items, pool], pool.sourceTableId, [poolNode], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const result = buildRefreshCommit([items, pool], r.plan, NO_RESOLUTION, { nodes: [poolNode], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(r.plan.crossTableLabelImpact).toEqual([]) // never touches a dependent -- there are none of this table's own here anyway
    const ownLabel = (result.updatedNodes.find((n) => n.id === 'pp1')!.data as { label: string }).label
    expect(ownLabel).toBe('GachaPoolEntries · ppe_a · weight') // its own FK term is gone -- falls back to its own sourceKey
    expect(result.updatedTables[0].rows[0].foreignKey).toEqual({})
  })
})

describe('buildRefreshCommit -- cross-table label recompose reads postRefreshTables, never the stale tables', () => {
  it('a changed label constituent propagates the NEW value into a dependent Parameter in the same commit', () => {
    const items = itemsTable()
    const pool = poolTable()
    const poolNode = paramNode('pp1', { sourceTableId: pool.sourceTableId, sourceKey: 'ppe_a', sourceColumnId: 'col_share', value: 5, label: 'GachaPoolEntries · Ember Blade · weight' })
    const snapshot = snapshotFor([items, pool], items.sourceTableId, [['itm_a', 'Ember Blade Reforged', '10']])
    const r = diffRefresh([items, pool], items.sourceTableId, [poolNode], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const result = buildRefreshCommit([items, pool], r.plan, NO_RESOLUTION, { nodes: [poolNode], edges: [] }, 2, { x: 0, y: 0 }, [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const depLabel = (result.updatedNodes.find((n) => n.id === 'pp1')!.data as { label: string }).label
    expect(depLabel).toBe('GachaPoolEntries · Ember Blade Reforged · weight')
  })
})

describe('buildRefreshCommit -- deterministic new-node placement (§DI-D12)', () => {
  it('never lands a new node inside an existing frame, even when the origin is centred over one', () => {
    const t = itemsTable()
    const snapshot = snapshotFor([t], t.sourceTableId, [['itm_a', 'Ember Blade', '10'], ['itm_b', 'Iron Charm', '3']])
    const r = diffRefresh([t], t.sourceTableId, [], snapshot)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const resolution: RefreshResolution = { ...NO_RESOLUTION, confirmedAdds: new Set(['itm_b']) }
    const frame: SavedFrame = { id: 'f1', label: 'Existing', rect: { x: -50, y: -50, w: 400, h: 300 } }
    const result = buildRefreshCommit([t], r.plan, resolution, EMPTY_HOST, 2, { x: 0, y: 0 }, [frame])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pos = result.createdNodes[0].position
    const overlapsFrame = pos.x < frame.rect.x + frame.rect.w && pos.x + 260 > frame.rect.x && pos.y < frame.rect.y + frame.rect.h && pos.y + 120 > frame.rect.y
    expect(overlapsFrame).toBe(false)
  })
})
