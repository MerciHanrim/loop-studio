import { describe, expect, it } from 'vitest'
import { buildImportCommit, summarizeImportPlan, type PlacementChoice } from './dataImportCommit'
import {
  createTableDraft,
  formatCellValueForDisplay,
  previewDraftCounts,
  setColumnRole,
  validateDrafts,
  type DraftColumnRole,
  type TableDraft,
} from './dataImportValidate'
import type { LoopEdge, LoopNode } from './types'

// docs/data-import.md §DI17 — the in-tool guide shows counts (rows × Number
// columns → Parameters) on the input step, the placement step and the review
// step. Every one of those numbers must come from ONE pure computation that
// the commit itself consumes, never from a second multiplication in the UI.

function draftFrom(header: string[], dataRows: string[][], roles: DraftColumnRole[], label = 'T'): TableDraft {
  let d = createTableDraft()
  d.label = label
  d.parsedRows = [header, ...dataRows]
  d.headerRowIndex = 1
  d.columns = header.map((h) => ({ role: 'ignored' as const, header: h }))
  roles.forEach((r, i) => {
    d = setColumnRole(d, i, r)
  })
  return d
}
const linkFk = (d: TableDraft, columnIndex: number, target: TableDraft): TableDraft => {
  const columns = d.columns.slice()
  columns[columnIndex] = { ...columns[columnIndex], refDraftId: target.sourceTableId }
  return { ...d, columns }
}
const EMPTY_HOST: { nodes: LoopNode[]; edges: LoopEdge[] } = { nodes: [], edges: [] }
const NONE: PlacementChoice = { kind: 'none', origin: { x: 0, y: 0 } }

const EXAMPLE = draftFrom(
  ['item_id', 'item_name', 'price', 'drop_rate'],
  [
    ['sword', 'Steel Sword', '4900', '10'],
    ['potion', 'Health Potion', '300', '25'],
  ],
  ['key', 'label', 'number', 'number'],
  'Items',
)

describe('summarizeImportPlan -- the single source of every displayed count', () => {
  it('the quick-start example: 2 rows × 2 Number columns = 4 Parameters, and the commit creates exactly that many', () => {
    const v = validateDrafts([EXAMPLE])
    if (!v.ok) throw new Error('expected ok')
    const s = summarizeImportPlan(v.plan, 'none')
    expect(s.tables).toHaveLength(1)
    expect(s.tables[0]).toMatchObject({ label: 'Items', rows: 2, numberColumns: 2, parameters: 4, lookupOnly: false, frames: 0 })
    expect(s.totalParameters).toBe(4)
    expect(s.totalTables).toBe(1)
    expect(s.lookupOnlyTables).toBe(0)
    expect(s.framesToCreate).toBe(0)
    const built = buildImportCommit(v.plan, NONE, EMPTY_HOST, [], [])
    if (!built.ok) throw new Error('expected ok')
    expect(built.createdNodes).toHaveLength(s.totalParameters)
  })

  it('a lookup-only table counts as a table but creates 0 Parameters and 0 frames', () => {
    const items = draftFrom(['item_key', 'name'], [['a', 'A'], ['b', 'B']], ['key', 'label'], 'Items')
    let drops = draftFrom(['drop_key', 'item_ref', 'rate'], [['d1', 'a', '10'], ['d2', 'b', '20'], ['d3', 'a', '30']], ['key', 'foreignKey', 'number'], 'Drops')
    drops = linkFk(drops, 1, items)
    const v = validateDrafts([items, drops])
    if (!v.ok) throw new Error('expected ok')
    const s = summarizeImportPlan(v.plan, 'framePerTable')
    expect(s.tables.map((t) => [t.label, t.rows, t.numberColumns, t.parameters, t.lookupOnly, t.frames])).toEqual([
      ['Items', 2, 0, 0, true, 0],
      ['Drops', 3, 1, 3, false, 1],
    ])
    expect(s.totalParameters).toBe(3)
    expect(s.lookupOnlyTables).toBe(1)
    expect(s.framesToCreate).toBe(1)
    const built = buildImportCommit(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } }, EMPTY_HOST, [], [])
    if (!built.ok) throw new Error('expected ok')
    expect(built.createdNodes).toHaveLength(3)
    expect(built.createdFrames).toHaveLength(s.framesToCreate)
  })

  it('a group-by table under framePerTable counts one frame per distinct group value', () => {
    const banners = draftFrom(['banner_key', 'banner_name'], [['pp', 'Premium Pickup'], ['ps', 'Premium Standard']], ['key', 'label'], 'Banners')
    const items = draftFrom(['item_key', 'display_name'], [['i1', 'Blade'], ['i2', 'Charm']], ['key', 'label'], 'Items')
    let pool = draftFrom(
      ['pool_entry_key', 'item_key', 'banner_key', 'weight'],
      [
        ['e1', 'i1', 'pp', '10'],
        ['e2', 'i2', 'pp', '90'],
        ['e3', 'i1', 'ps', '5'],
      ],
      ['key', 'foreignKey', 'foreignKey', 'number'],
      'Pool',
    )
    pool = linkFk(pool, 1, items)
    pool = linkFk(pool, 2, banners)
    pool.groupByColumnIndex = 2
    const v = validateDrafts([items, banners, pool])
    if (!v.ok) throw new Error('expected ok')
    const s = summarizeImportPlan(v.plan, 'framePerTable')
    expect(s.tables.find((t) => t.label === 'Pool')?.frames).toBe(2)
    expect(s.framesToCreate).toBe(2)
    const built = buildImportCommit(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } }, EMPTY_HOST, [], [])
    if (!built.ok) throw new Error('expected ok')
    expect(built.createdFrames).toHaveLength(2)
    expect(built.createdNodes).toHaveLength(s.totalParameters)
  })

  it('placement kinds other than framePerTable create no frames', () => {
    const v = validateDrafts([EXAMPLE])
    if (!v.ok) throw new Error('expected ok')
    expect(summarizeImportPlan(v.plan, 'none').framesToCreate).toBe(0)
    expect(summarizeImportPlan(v.plan, 'existingFrame').framesToCreate).toBe(0)
  })
})

describe('previewDraftCounts -- the input-step status line agrees with the validated plan', () => {
  it('the example draft previews 2 rows, key item_id, 2 Number columns, 4 Parameters', () => {
    expect(previewDraftCounts(EXAMPLE)).toEqual({ rows: 2, keyHeader: 'item_id', keyCount: 1, numberColumns: 2, parameters: 4 })
  })
  it('no key yet -> keyHeader null; no Number columns -> 0 Parameters', () => {
    const d = draftFrom(['a', 'b'], [['1', '2']], ['ignored', 'ignored'])
    expect(previewDraftCounts(d)).toEqual({ rows: 1, keyHeader: null, keyCount: 0, numberColumns: 0, parameters: 0 })
  })
  it('respects header row and ignore-last-N-rows exactly like validation', () => {
    const d = draftFrom(['k', 'n'], [['a', '1'], ['b', '2'], ['Total', '3']], ['key', 'number'])
    d.ignoreLastNRows = 1
    const p = previewDraftCounts(d)
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    expect(p.parameters).toBe(summarizeImportPlan(v.plan).totalParameters)
    expect(p.rows).toBe(2)
  })
  it('an invalid header row / ignore count previews 0 rows rather than slicing garbage', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'])
    d.headerRowIndex = 1.5
    expect(previewDraftCounts(d).rows).toBe(0)
  })
})

describe('validateDrafts -- issue detail carries the header and the offending value for the guide', () => {
  it('invalid-number carries { header, value }; empty-number carries { header }', () => {
    const d = draftFrom(['k', 'price'], [['a', '4,900'], ['b', '']], ['key', 'number'])
    const v = validateDrafts([d])
    if (v.ok) throw new Error('expected errors')
    const bad = v.errors.find((e) => e.code === 'invalid-number')
    expect(bad?.detail).toMatchObject({ header: 'price', value: '4,900' })
    const empty = v.errors.find((e) => e.code === 'empty-number')
    expect(empty?.detail).toMatchObject({ header: 'price' })
  })
  it('duplicate-key carries { header, value }', () => {
    const d = draftFrom(['id', 'n'], [['x', '1'], ['x', '2']], ['key', 'number'])
    const v = validateDrafts([d])
    if (v.ok) throw new Error('expected errors')
    expect(v.errors.find((e) => e.code === 'duplicate-key')?.detail).toMatchObject({ header: 'id', value: 'x' })
  })
  it('the raw value in detail is NOT truncated or escaped -- display formatting is a separate step', () => {
    const long = 'x'.repeat(500)
    const d = draftFrom(['k', 'n'], [['a', long]], ['key', 'number'])
    const v = validateDrafts([d])
    if (v.ok) throw new Error('expected errors')
    expect(v.errors[0].detail?.value).toBe(long)
  })
})

describe('formatCellValueForDisplay -- what an error message may show of a user cell', () => {
  it('passes a short plain value through', () => {
    expect(formatCellValueForDisplay('4,900')).toBe('4,900')
  })
  it('truncates a long value with an ellipsis at 40 characters', () => {
    const out = formatCellValueForDisplay('a'.repeat(120))
    expect(out.length).toBe(41)
    expect(out.endsWith('…')).toBe(true)
  })
  it('makes newlines, tabs and other control characters visible instead of rendering them', () => {
    expect(formatCellValueForDisplay('a\nb\tcd')).toBe('a⏎b⇥c␇d')
  })
  it('truncation counts code points, not UTF-16 units', () => {
    const emoji = '😀'.repeat(50)
    const out = formatCellValueForDisplay(emoji)
    expect([...out].length).toBe(41)
  })
})
