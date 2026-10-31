import { describe, expect, it } from 'vitest'
import { buildChangeProposalCsv } from './dataImportExportCsv'
import { buildRefreshCommit, diffRefresh, findImportForeignKeyDependents, parameterLabel, type RefreshResolution } from './dataImportRefresh'
import { validateRefreshSnapshot } from './dataImportRefreshValidate'
import { composeFullRowLabel, resolveForeignKeyLabelTerm } from './dataImportValidate'
import type { ImportColumn, ImportRow, ImportSourceTable } from './serialize'
import type { LoopNode } from './types'

// #423 item 7 (Lumi, 2026-10-31) — the control for the lookup indexes. Every
// repeated `find` must keep returning the FIRST match and every `filter` ALL
// matches in their original order, with duplicate keys and missing provenance
// included. Written and green on main BEFORE the indexes; the same file must
// stay green after them.

const col = (sourceColumnId: string, role: ImportColumn['role'], header: string, refTableId?: string): ImportColumn =>
  refTableId ? { sourceColumnId, role, header, refTableId } : { sourceColumnId, role, header }
const row = (sourceKey: string, parts: Partial<Omit<ImportRow, 'sourceKey'>> = {}): ImportRow => ({
  sourceKey,
  number: parts.number ?? {},
  label: parts.label ?? {},
  foreignKey: parts.foreignKey ?? {},
})
const param = (id: string, p: { t?: string; k?: string; c?: string; value?: number; label?: string; auto?: boolean }): LoopNode =>
  ({
    id,
    type: 'parameter',
    position: { x: 0, y: 0 },
    data: {
      kind: 'parameter',
      label: p.label ?? id,
      value: p.value ?? 0,
      ...(p.t !== undefined ? { sourceTableId: p.t } : {}),
      ...(p.k !== undefined ? { sourceKey: p.k } : {}),
      ...(p.c !== undefined ? { sourceColumnId: p.c } : {}),
      ...(p.auto !== undefined ? { labelAutoComposed: p.auto } : {}),
    },
  }) as LoopNode
const pool = (id: string): LoopNode => ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, initial: 0 } }) as LoopNode

const NO_RESOLUTION: RefreshResolution = {
  confirmedAdds: new Set(),
  missingRowChoices: new Map(),
  cellChoices: new Map(),
  locallyDeletedChoices: new Map(),
  fkRepointChoices: new Map(),
}

/** two tables share one id, and the first repeats a row key */
const ITEMS_A: ImportSourceTable = {
  sourceTableId: 't_items',
  label: 'First',
  columns: [col('c_key', 'key', 'item_key'), col('c_name', 'label', 'name'), col('c_w', 'number', 'weight')],
  rows: [row('k1', { label: { c_name: 'one' }, number: { c_w: 1 } }), row('k1', { label: { c_name: 'one again' }, number: { c_w: 9 } }), row('k2', { number: { c_w: 2 } })],
}
const ITEMS_B: ImportSourceTable = { ...ITEMS_A, label: 'Second', rows: [row('k1', { label: { c_name: 'other' } }), row('k3', { label: { c_name: 'three' } })] }

describe('find keeps the first match', () => {
  it('parameterLabel: the first table with the id, its first row with the key; null for a key or column it lacks', () => {
    const tables = [ITEMS_A, ITEMS_B]
    expect(parameterLabel(tables, 't_items', 'k1', 'c_w')).toBe('First · one · weight')
    expect(parameterLabel(tables, 't_items', 'k2', 'c_w')).toBe('First · k2 · weight') // no label text: the key
    expect(parameterLabel(tables, 't_items', 'k3', 'c_w')).toBeNull() // only the SECOND table has k3
    expect(parameterLabel(tables, 't_items', 'k1', 'c_nope')).toBeNull()
    expect(parameterLabel(tables, 't_none', 'k1', 'c_w')).toBeNull()
  })

  it('resolveForeignKeyLabelTerm / composeFullRowLabel: the first target table and row; a raw-key fallback otherwise', () => {
    const tables = [ITEMS_A, ITEMS_B]
    expect(resolveForeignKeyLabelTerm(tables, 't_items', 'k1')).toEqual({ term: 'one', usedFallback: false })
    expect(resolveForeignKeyLabelTerm(tables, 't_items', 'k2')).toEqual({ term: 'k2', usedFallback: true })
    expect(resolveForeignKeyLabelTerm(tables, 't_items', 'k3')).toEqual({ term: 'k3', usedFallback: true })
    expect(resolveForeignKeyLabelTerm(tables, 't_none', 'k1')).toEqual({ term: 'k1', usedFallback: true })
    const drops: ImportSourceTable = {
      sourceTableId: 't_drops',
      label: 'Drops',
      columns: [col('d_key', 'key', 'drop_key'), col('d_item', 'foreignKey', 'item', 't_items'), col('d_other', 'foreignKey', 'other', 't_none'), col('d_note', 'label', 'note')],
      rows: [row('d1', { foreignKey: { d_item: 'k1', d_other: 'x' }, label: { d_note: 'n' } })],
    }
    expect(composeFullRowLabel([...tables, drops], drops, drops.rows[0]!)).toEqual({ text: 'one · x · n', fallbackColumnIds: ['d_other'] })
  })

  it('validateRefreshSnapshot: an FK is checked against the first table with the target id', () => {
    const drops: ImportSourceTable = {
      sourceTableId: 't_drops',
      label: 'Drops',
      columns: [col('d_key', 'key', 'drop_key'), col('d_item', 'foreignKey', 'item', 't_items')],
      rows: [row('d1', { foreignKey: { d_item: 'k1' } })],
    }
    const tables = [ITEMS_A, ITEMS_B, drops]
    const header = ['drop_key', 'item']
    // k2 is in the first table: no orphan — only the batch-wide round-trip gate,
    // which a batch holding two tables with one id never passes
    const found = validateRefreshSnapshot(tables, 't_drops', [header, ['d1', 'k2']], 1, 0, [])
    expect(found.ok).toBe(false)
    if (!found.ok) expect(found.errors.map((e) => e.code)).toEqual(['round-trip-mismatch'])
    const orphan = validateRefreshSnapshot(tables, 't_drops', [header, ['d1', 'k3']], 1, 0, []) // k3 lives only in the second table
    expect(orphan.ok).toBe(false)
    if (!orphan.ok) expect(orphan.errors.map((e) => e.code)).toEqual(['orphan-foreign-key'])
  })

  it('buildRefreshCommit: a node looked up by id is the first node with that id', () => {
    const items: ImportSourceTable = { ...ITEMS_A, rows: [row('k1', { label: { c_name: 'one' }, number: { c_w: 1 } })] }
    const nodes = [param('p1', { t: 't_items', k: 'k1', c: 'c_w', value: 1, label: 'kept label' }), pool('p1')]
    const snap = validateRefreshSnapshot([items], 't_items', [['item_key', 'name', 'weight'], ['k1', 'one', '5']], 1, 0, [])
    if (!snap.ok) throw new Error('snapshot')
    const diff = diffRefresh([items], 't_items', nodes, snap.snapshot)
    if (!diff.ok) throw new Error('diff')
    const r = buildRefreshCommit([items], diff.plan, NO_RESOLUTION, { nodes, edges: [] }, 2, { x: 0, y: 0 }, [])
    if (!r.ok) throw new Error(r.reason)
    expect(r.updatedNodes.map((n) => [n.id, n.data.kind, (n.data as { value?: number }).value])).toEqual([['p1', 'parameter', 5]])
  })
})

describe('filter keeps every match in its original order', () => {
  it('findImportForeignKeyDependents: tables, then columns, then rows, in order', () => {
    const a: ImportSourceTable = {
      sourceTableId: 't_a',
      label: 'A',
      columns: [col('a_key', 'key', 'k'), col('a_f2', 'foreignKey', 'f2', 't_items'), col('a_f1', 'foreignKey', 'f1', 't_items')],
      rows: [row('a2', { foreignKey: { a_f1: 'k1', a_f2: 'k1' } }), row('a1', { foreignKey: { a_f1: 'k1' } }), row('a3', { foreignKey: { a_f2: 'k2' } })],
    }
    const b: ImportSourceTable = {
      sourceTableId: 't_b',
      label: 'B',
      columns: [col('b_key', 'key', 'k'), col('b_f', 'foreignKey', 'f', 't_items')],
      rows: [row('b1', { foreignKey: { b_f: 'k1' } })],
    }
    expect(findImportForeignKeyDependents([ITEMS_A, a, b], 't_items', 'k1')).toEqual([
      { dependentTableId: 't_a', dependentSourceKey: 'a2', sourceColumnId: 'a_f2' },
      { dependentTableId: 't_a', dependentSourceKey: 'a2', sourceColumnId: 'a_f1' },
      { dependentTableId: 't_a', dependentSourceKey: 'a1', sourceColumnId: 'a_f1' },
      { dependentTableId: 't_b', dependentSourceKey: 'b1', sourceColumnId: 'b_f' },
    ])
  })

  it('buildChangeProposalCsv: duplicate triples list every node in node order, groups in cell order; nodes without full provenance never match', () => {
    const items: ImportSourceTable = {
      sourceTableId: 't_items',
      label: 'Items',
      columns: [col('c_key', 'key', 'item_key'), col('c_w', 'number', 'weight'), col('c_v', 'number', 'volume')],
      rows: [row('k1', { number: { c_w: 1, c_v: 1 } }), row('k2', { number: { c_w: 2, c_v: 2 } })],
    }
    const nodes = [
      param('n_k2v_a', { t: 't_items', k: 'k2', c: 'c_v' }),
      param('n_k1w_a', { t: 't_items', k: 'k1', c: 'c_w' }),
      param('n_nokey', { t: 't_items', c: 'c_w' }),
      pool('n_k1w_a'),
      param('n_k1w_b', { t: 't_items', k: 'k1', c: 'c_w' }),
      param('n_k2v_b', { t: 't_items', k: 'k2', c: 'c_v' }),
      param('n_k1w_c', { t: 't_items', k: 'k1', c: 'c_w' }),
    ]
    const r = buildChangeProposalCsv([items], nodes)
    expect(r).toEqual({
      ok: false,
      duplicateTriples: [
        { sourceTableId: 't_items', sourceKey: 'k1', sourceColumnId: 'c_w', nodeIds: ['n_k1w_a', 'n_k1w_b', 'n_k1w_c'] },
        { sourceTableId: 't_items', sourceKey: 'k2', sourceColumnId: 'c_v', nodeIds: ['n_k2v_a', 'n_k2v_b'] },
      ],
    })
  })

  it('buildChangeProposalCsv: one node per triple — the changed cells in cell order; unchanged, unmatched and foreign nodes left out', () => {
    const items: ImportSourceTable = {
      sourceTableId: 't_items',
      label: 'Items',
      columns: [col('c_key', 'key', 'item_key'), col('c_w', 'number', 'weight'), col('c_v', 'number', 'volume')],
      rows: [row('k1', { number: { c_w: 1, c_v: 1 } }), row('k2', { number: { c_w: 2 } })],
    }
    const nodes = [
      param('n_k2w', { t: 't_items', k: 'k2', c: 'c_w', value: 20 }),
      param('n_other', { t: 't_other', k: 'k1', c: 'c_w', value: 99 }),
      param('n_k1v', { t: 't_items', k: 'k1', c: 'c_v', value: 1 }), // unchanged
      param('n_k1w', { t: 't_items', k: 'k1', c: 'c_w', value: 10 }),
    ]
    const r = buildChangeProposalCsv([items], nodes)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.csv.split('\r\n').filter(Boolean)).toEqual(["source_table,source_key,source_column,previous_value,new_value", "'Items,'k1,'weight,1,10", "'Items,'k2,'weight,2,20"])
  })

  it('diffRefresh: nodes without a key or column are not this table’s; a removed number column lists its nodes in node order; the duplicate guard lists every node', () => {
    const items: ImportSourceTable = {
      sourceTableId: 't_items',
      label: 'Items',
      columns: [col('c_key', 'key', 'item_key'), col('c_w', 'number', 'weight'), col('c_v', 'number', 'volume')],
      rows: [row('k1', { number: { c_w: 1, c_v: 1 } }), row('k2', { number: { c_w: 2, c_v: 2 } })],
    }
    const nodes = [
      param('v2', { t: 't_items', k: 'k2', c: 'c_v', value: 2 }),
      param('w1', { t: 't_items', k: 'k1', c: 'c_w', value: 1 }),
      param('nokey', { t: 't_items', c: 'c_v' }),
      param('v1', { t: 't_items', k: 'k1', c: 'c_v', value: 1 }),
      param('w2', { t: 't_items', k: 'k2', c: 'c_w', value: 7 }),
    ]
    // the volume column is gone from the new data
    const snap = validateRefreshSnapshot([items], 't_items', [['item_key', 'weight'], ['k1', '1'], ['k2', '3']], 1, 0, [
      { kind: 'column-removed', sourceColumnId: 'c_v' },
    ])
    if (!snap.ok) throw new Error(JSON.stringify(snap.errors))
    const d = diffRefresh([items], 't_items', nodes, snap.snapshot)
    if (!d.ok) throw new Error('diff')
    expect(d.plan.removedColumns).toEqual([{ role: 'number', sourceColumnId: 'c_v', nodeIds: ['v2', 'v1'] }])
    const cells = d.plan.rows.flatMap((r) => (r.kind === 'present' ? r.cells.map((c) => [r.sourceKey, c.kind, 'nodeId' in c ? c.nodeId : null]) : []))
    expect(cells).toEqual([
      ['k1', 'three-way', 'w1'],
      ['k2', 'three-way', 'w2'],
    ])

    const dup = diffRefresh([items], 't_items', [...nodes, param('w1b', { t: 't_items', k: 'k1', c: 'c_w' })], snap.snapshot)
    expect(dup).toEqual({ ok: false, duplicateTriples: [{ sourceTableId: 't_items', sourceKey: 'k1', sourceColumnId: 'c_w', nodeIds: ['w1', 'w1b'] }] })
  })

  it('buildRefreshCommit: a missing row unlinked or deleted acts on every node of that key, in node order', () => {
    const items: ImportSourceTable = {
      sourceTableId: 't_items',
      label: 'Items',
      columns: [col('c_key', 'key', 'item_key'), col('c_w', 'number', 'weight'), col('c_v', 'number', 'volume')],
      rows: [row('k1', { number: { c_w: 1, c_v: 1 } }), row('k2', { number: { c_w: 2, c_v: 2 } })],
    }
    const nodes = [
      param('k2v', { t: 't_items', k: 'k2', c: 'c_v', value: 2 }),
      param('k1w', { t: 't_items', k: 'k1', c: 'c_w', value: 1 }),
      param('k2w', { t: 't_items', k: 'k2', c: 'c_w', value: 2 }),
      param('k1v', { t: 't_items', k: 'k1', c: 'c_v', value: 1 }),
    ]
    const snap = validateRefreshSnapshot([items], 't_items', [['item_key', 'weight', 'volume'], ['k1', '1', '1']], 1, 0, []) // k2 is missing
    if (!snap.ok) throw new Error('snapshot')
    const d = diffRefresh([items], 't_items', nodes, snap.snapshot)
    if (!d.ok) throw new Error('diff')
    const unlink = buildRefreshCommit([items], d.plan, { ...NO_RESOLUTION, missingRowChoices: new Map([['k2', 'unlink']]) }, { nodes, edges: [] }, 2, { x: 0, y: 0 }, [])
    if (!unlink.ok) throw new Error(unlink.reason)
    expect(unlink.updatedNodes.map((n) => [n.id, 'sourceKey' in n.data])).toEqual([
      ['k2v', false],
      ['k2w', false],
    ])
    const del = buildRefreshCommit([items], d.plan, { ...NO_RESOLUTION, missingRowChoices: new Map([['k2', 'delete']]) }, { nodes, edges: [] }, 2, { x: 0, y: 0 }, [])
    if (!del.ok) throw new Error(del.reason)
    expect(del.removedNodeIds).toEqual(['k2v', 'k2w'])
  })
})
