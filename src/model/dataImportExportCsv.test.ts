import { describe, expect, it } from 'vitest'
import { buildChangeProposalCsv } from './dataImportExportCsv'
import type { ImportColumn, ImportSourceTable } from './serialize'
import type { LoopNode } from './types'

// docs/data-import.md §DI12.2/§DI12.3 -- Phase 2. The change-proposal CSV is
// a new from-scratch writer: BOM/CRLF/RFC4180-quoting/unconditional leading
// `'` guard, changed-rows-only (§DI-D1), and a duplicate-triple cell blocks
// the WHOLE export rather than silently shortening it (mirrors `diffRefresh`'s
// own §DI-D15 guard).

function col(sourceColumnId: string, role: ImportColumn['role'], header: string): ImportColumn {
  return { sourceColumnId, role, header }
}

function table(overrides: Partial<ImportSourceTable> = {}): ImportSourceTable {
  return {
    sourceTableId: 'srctable_pool',
    label: 'GachaPoolEntries',
    columns: [col('col_key', 'key', 'pool_entry_key'), col('col_weight', 'number', 'weight')],
    rows: [{ sourceKey: 'ppe_pickup_blade_ssr', number: { col_weight: 10 }, label: {}, foreignKey: {} }],
    ...overrides,
  }
}

function param(id: string, opts: { sourceTableId: string; sourceKey: string; sourceColumnId: string; value: number }): LoopNode {
  return {
    id,
    type: 'parameter',
    position: { x: 0, y: 0 },
    data: { kind: 'parameter', label: id, value: opts.value, sourceTableId: opts.sourceTableId, sourceKey: opts.sourceKey, sourceColumnId: opts.sourceColumnId, labelAutoComposed: true },
  } as LoopNode
}

describe('buildChangeProposalCsv', () => {
  it('lists only a changed cell, with the BOM, CRLF, and unconditional leading-quote guard', () => {
    const t = table()
    const node = param('p1', { sourceTableId: t.sourceTableId, sourceKey: 'ppe_pickup_blade_ssr', sourceColumnId: 'col_weight', value: 25 })
    const r = buildChangeProposalCsv([t], [node])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.csv.charCodeAt(0)).toBe(0xfeff)
    expect(r.csv.includes('\r\n')).toBe(true)
    expect(r.csv.includes('\n\n')).toBe(false) // never a bare LF-LF from double-joining
    const lines = r.csv.slice(1).split('\r\n').filter(Boolean)
    expect(lines).toEqual(['source_table,source_key,source_column,previous_value,new_value', "'GachaPoolEntries,'ppe_pickup_blade_ssr,'weight,10,25"])
  })

  it('excludes an unchanged cell', () => {
    const t = table()
    const node = param('p1', { sourceTableId: t.sourceTableId, sourceKey: 'ppe_pickup_blade_ssr', sourceColumnId: 'col_weight', value: 10 })
    const r = buildChangeProposalCsv([t], [node])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.csv.slice(1).split('\r\n').filter(Boolean)).toHaveLength(1) // header only
  })

  it('excludes a locally-deleted (zero-Parameter) cell, not an error', () => {
    const t = table()
    const r = buildChangeProposalCsv([t], [])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.csv.slice(1).split('\r\n').filter(Boolean)).toHaveLength(1)
  })

  it('quotes a text field containing a comma, a quote, and a newline (RFC 4180, never the naive space-replace)', () => {
    const t = table({ rows: [{ sourceKey: 'itm, "weird"\nkey', number: { col_weight: 10 }, label: {}, foreignKey: {} }] })
    const node = param('p1', { sourceTableId: t.sourceTableId, sourceKey: 'itm, "weird"\nkey', sourceColumnId: 'col_weight', value: 20 })
    const r = buildChangeProposalCsv([t], [node])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.csv).toContain('"\'itm, ""weird""\nkey"')
  })

  it('applies the leading-quote guard even to a value that already starts with a quote (exactly one, not conditionally skipped)', () => {
    const t = table({ label: "'AlreadyQuoted" })
    const node = param('p1', { sourceTableId: t.sourceTableId, sourceKey: 'ppe_pickup_blade_ssr', sourceColumnId: 'col_weight', value: 20 })
    const r = buildChangeProposalCsv([t], [node])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.csv).toContain("''AlreadyQuoted,") // guard `'` + the value's own leading `'` = two apostrophes, exactly one of which is the guard
  })

  it('numeric columns carry no guard or quoting', () => {
    const t = table()
    const node = param('p1', { sourceTableId: t.sourceTableId, sourceKey: 'ppe_pickup_blade_ssr', sourceColumnId: 'col_weight', value: 25 })
    const r = buildChangeProposalCsv([t], [node])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.csv).toContain(',10,25')
  })

  it('a duplicate-triple cell blocks the WHOLE export, not just that row', () => {
    const t = table({
      columns: [col('col_key', 'key', 'pool_entry_key'), col('col_weight', 'number', 'weight'), col('col_share', 'number', 'share')],
      rows: [{ sourceKey: 'ppe_a', number: { col_weight: 10, col_share: 3 }, label: {}, foreignKey: {} }],
    })
    const dup1 = param('p1', { sourceTableId: t.sourceTableId, sourceKey: 'ppe_a', sourceColumnId: 'col_weight', value: 10 })
    const dup2 = param('p2', { sourceTableId: t.sourceTableId, sourceKey: 'ppe_a', sourceColumnId: 'col_weight', value: 12 })
    const fine = param('p3', { sourceTableId: t.sourceTableId, sourceKey: 'ppe_a', sourceColumnId: 'col_share', value: 5 })
    const r = buildChangeProposalCsv([t], [dup1, dup2, fine])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.duplicateTriples).toEqual([{ sourceTableId: t.sourceTableId, sourceKey: 'ppe_a', sourceColumnId: 'col_weight', nodeIds: ['p1', 'p2'] }])
  })
})
