import { describe, expect, it } from 'vitest'
import { createTableDraft, setColumnRole, withValidGroupBy, type TableDraft } from './dataImportValidate'

// #423 (Lumi, 2026-10-31) — a group-by the columns no longer support is cleared.

function poolDraft(): TableDraft {
  let d: TableDraft = {
    ...createTableDraft(),
    columns: ['entry_key', 'item_key', 'banner_key', 'weight'].map((header) => ({ role: 'ignored' as const, header })),
  }
  d = setColumnRole(d, 0, 'key')
  d = setColumnRole(d, 1, 'foreignKey')
  d = setColumnRole(d, 2, 'foreignKey')
  d = setColumnRole(d, 3, 'number')
  return { ...d, groupByColumnIndex: 2 }
}

describe('withValidGroupBy', () => {
  it('keeps a group-by on a foreign key while two or more are left', () => {
    expect(withValidGroupBy(poolDraft()).groupByColumnIndex).toBe(2)
  })

  it('setColumnRole clears it when its column stops being a foreign key', () => {
    expect(setColumnRole(poolDraft(), 2, 'ignored').groupByColumnIndex).toBeUndefined()
  })

  it('setColumnRole clears it when fewer than two foreign keys are left, though its own column still is one', () => {
    expect(setColumnRole(poolDraft(), 1, 'number').groupByColumnIndex).toBeUndefined()
  })

  it('clears it when the column it names is gone', () => {
    const d = poolDraft()
    expect(withValidGroupBy({ ...d, columns: d.columns.slice(0, 2) }).groupByColumnIndex).toBeUndefined()
  })

  it('leaves a draft without a group-by as it is', () => {
    const d = { ...poolDraft(), groupByColumnIndex: undefined }
    expect(withValidGroupBy(d)).toBe(d)
  })
})
