import { describe, expect, it } from 'vitest'
import { SOURCE_KEY_MAX_BYTES } from './model'
import {
  composeFullRowLabel,
  createTableDraft,
  setColumnRole,
  validateDrafts,
  type DraftColumnRole,
  type TableDraft,
} from './dataImportValidate'

// docs/data-import.md -- Phase 1B. `validateDrafts` is the ONLY producer of
// a `ValidatedImportPlan` -- `buildImportCommit` accepts nothing else. This
// file exercises the full validation contract: key/number/FK rules, the
// group-by requirement, label composition + its raw-key fallback, storage
// limits, and the round-trip-losslessness gate.

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

describe('validateDrafts -- happy path', () => {
  it('a single well-formed table produces a plan carrying the draft-minted ids unchanged', () => {
    const d = draftFrom(['item_key', 'weight'], [['itm_a', '10']], ['key', 'number'])
    const r = validateDrafts([d])
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.plan.tables).toHaveLength(1)
    const t = r.plan.tables[0]
    expect(t.sourceTableId).toBe(d.sourceTableId) // identical -- never re-minted
    expect(t.columns[0].sourceColumnId).toBe(d.columns[0].sourceColumnId)
    expect(t.columns[1].sourceColumnId).toBe(d.columns[1].sourceColumnId)
    expect(t.rows).toEqual([{ sourceKey: 'itm_a', number: { [d.columns[1].sourceColumnId!]: 10 }, label: {}, foreignKey: {} }])
    expect(r.warnings).toEqual([])
  })
})

describe('validateDrafts -- key rules (§DI6)', () => {
  it('no key-role column is a blocking error', () => {
    const d = draftFrom(['a'], [['1']], ['number'])
    const r = validateDrafts([d])
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.some((e) => e.code === 'missing-key-column')).toBe(true)
  })

  it('two key-role columns is a blocking error', () => {
    const d = draftFrom(['a', 'b'], [['1', '2']], ['key', 'key'])
    const r = validateDrafts([d])
    expect(!r.ok && r.errors.some((e) => e.code === 'multiple-key-columns')).toBe(true)
  })

  it('an empty key cell is a blocking error', () => {
    const d = draftFrom(['k'], [['  ']], ['key'])
    const r = validateDrafts([d])
    expect(!r.ok && r.errors.some((e) => e.code === 'empty-key')).toBe(true)
  })

  it('a duplicate key (after trim+NFC, case-sensitive) is a blocking error', () => {
    const d = draftFrom(['k'], [['itm_a'], ['itm_a']], ['key'])
    const r = validateDrafts([d])
    expect(!r.ok && r.errors.some((e) => e.code === 'duplicate-key')).toBe(true)
  })

  it('case-sensitive: "Itm_A" and "itm_a" are DIFFERENT keys', () => {
    const d = draftFrom(['k'], [['Itm_A'], ['itm_a']], ['key'])
    const r = validateDrafts([d])
    expect(r.ok).toBe(true)
  })

  it('a key at exactly SOURCE_KEY_MAX_BYTES survives; one byte over is rejected', () => {
    const ok = 'k'.repeat(SOURCE_KEY_MAX_BYTES)
    const tooLong = 'k'.repeat(SOURCE_KEY_MAX_BYTES + 1)
    expect(validateDrafts([draftFrom(['k'], [[ok]], ['key'])]).ok).toBe(true)
    const r = validateDrafts([draftFrom(['k'], [[tooLong]], ['key'])])
    expect(!r.ok && r.errors.some((e) => e.code === 'key-too-long')).toBe(true)
  })

  it('a control character in the key is a blocking error', () => {
    const d = draftFrom(['k'], [['ab']], ['key'])
    const r = validateDrafts([d])
    expect(!r.ok && r.errors.some((e) => e.code === 'key-control-char')).toBe(true)
  })
})

describe('validateDrafts -- ragged rows (moved from the parser)', () => {
  it('a row with a different cell count than the header is a blocking error, not silently coerced', () => {
    const d = draftFrom(['k', 'n'], [['a', '1', 'extra']], ['key', 'number'])
    const r = validateDrafts([d])
    expect(!r.ok && r.errors.some((e) => e.code === 'ragged-row')).toBe(true)
  })
})

describe('validateDrafts -- number rule (§DI7)', () => {
  const numberDraft = (cell: string) => draftFrom(['k', 'n'], [['a', cell]], ['key', 'number'])

  it('an empty numeric cell is an error, never coerced to 0', () => {
    const r = validateDrafts([numberDraft('   ')])
    expect(!r.ok && r.errors.some((e) => e.code === 'empty-number')).toBe(true)
  })

  it.each(['0x10', 'Infinity', 'NaN', '1,234'])('rejects %s', (bad) => {
    const r = validateDrafts([numberDraft(bad)])
    expect(!r.ok && r.errors.some((e) => e.code === 'invalid-number')).toBe(true)
  })

  it.each([
    ['+1', 1],
    ['-1', -1],
    ['.5', 0.5],
    ['1.', 1],
    ['1e3', 1000],
    ['1.5e-2', 0.015],
  ])('accepts %s as %d', (good, expected) => {
    const r = validateDrafts([numberDraft(good)])
    expect(r.ok).toBe(true)
    if (r.ok) {
      const t = r.plan.tables[0]
      const colId = t.columns.find((c) => c.role === 'number')!.sourceColumnId
      expect(t.rows[0].number[colId]).toBe(expected)
    }
  })
})

describe('validateDrafts -- foreign keys (§DI8) and group-by (§DI-D11)', () => {
  it('an FK value with no matching target row is a BLOCKING orphan error', () => {
    const items = draftFrom(['item_key', 'name'], [['itm_a', 'Ember Blade']], ['key', 'label'])
    const pool = draftFrom(['pe_key', 'item_key'], [['pe1', 'itm_NOPE']], ['key', 'foreignKey'])
    const linked = linkFk(pool, 1, items)
    const r = validateDrafts([items, linked])
    expect(!r.ok && r.errors.some((e) => e.code === 'orphan-foreign-key')).toBe(true)
    expect(!r.ok && r.warnings.some((w) => w.code === 'label-fallback')).toBe(false) // orphan is NOT the fallback path
  })

  it('an FK column with no target table picked is a blocking error', () => {
    const pool = draftFrom(['pe_key', 'item_key'], [['pe1', 'itm_a']], ['key', 'foreignKey'])
    const r = validateDrafts([pool]) // never linked via refDraftId
    expect(!r.ok && r.errors.some((e) => e.code === 'missing-fk-target')).toBe(true)
  })

  it('an empty FK cell is allowed (no relation), not an orphan', () => {
    const items = draftFrom(['item_key', 'name'], [['itm_a', 'Ember Blade']], ['key', 'label'])
    const pool = draftFrom(['pe_key', 'item_key'], [['pe1', '']], ['key', 'foreignKey'])
    const linked = linkFk(pool, 1, items)
    const r = validateDrafts([items, linked])
    expect(r.ok).toBe(true)
  })

  it('2+ foreignKey columns without a group-by pick is a blocking error', () => {
    const items = draftFrom(['item_key'], [['itm_a']], ['key'])
    const banners = draftFrom(['banner_key'], [['ban_a']], ['key'])
    let pool = draftFrom(
      ['pe_key', 'item_key', 'banner_key'],
      [['pe1', 'itm_a', 'ban_a']],
      ['key', 'foreignKey', 'foreignKey'],
    )
    pool = linkFk(pool, 1, items)
    pool = linkFk(pool, 2, banners)
    const r = validateDrafts([items, banners, pool])
    expect(!r.ok && r.errors.some((e) => e.code === 'missing-group-by')).toBe(true)
  })

  it('2+ foreignKey columns WITH a group-by pick validates clean', () => {
    const items = draftFrom(['item_key'], [['itm_a']], ['key'])
    const banners = draftFrom(['banner_key'], [['ban_a']], ['key'])
    let pool = draftFrom(
      ['pe_key', 'item_key', 'banner_key'],
      [['pe1', 'itm_a', 'ban_a']],
      ['key', 'foreignKey', 'foreignKey'],
    )
    pool = linkFk(pool, 1, items)
    pool = linkFk(pool, 2, banners)
    pool.groupByColumnIndex = 2
    const r = validateDrafts([items, banners, pool])
    expect(r.ok).toBe(true)
  })

  it('review round 2 -- an FK column whose refDraftId names no table in the batch is a blocking error, even with every cell empty', () => {
    const pool = draftFrom(['pe_key', 'item_key'], [['pe1', '']], ['key', 'foreignKey'])
    const columns = pool.columns.slice()
    columns[1] = { ...columns[1], refDraftId: 'srctable_does_not_exist' }
    const dangling = { ...pool, columns }
    const r = validateDrafts([dangling])
    expect(!r.ok && r.errors.some((e) => e.code === 'invalid-fk-target')).toBe(true)
  })

  it('review round 2 -- a group-by pick that is out of range is a blocking error', () => {
    const items = draftFrom(['item_key'], [['itm_a']], ['key'])
    const banners = draftFrom(['banner_key'], [['ban_a']], ['key'])
    let pool = draftFrom(
      ['pe_key', 'item_key', 'banner_key'],
      [['pe1', 'itm_a', 'ban_a']],
      ['key', 'foreignKey', 'foreignKey'],
    )
    pool = linkFk(pool, 1, items)
    pool = linkFk(pool, 2, banners)
    pool.groupByColumnIndex = 99 // out of range
    const r = validateDrafts([items, banners, pool])
    expect(!r.ok && r.errors.some((e) => e.code === 'invalid-group-by')).toBe(true)
  })

  it('review round 2 -- a group-by pick that names a non-foreignKey column is a blocking error', () => {
    const items = draftFrom(['item_key'], [['itm_a']], ['key'])
    const banners = draftFrom(['banner_key'], [['ban_a']], ['key'])
    let pool = draftFrom(
      ['pe_key', 'item_key', 'banner_key'],
      [['pe1', 'itm_a', 'ban_a']],
      ['key', 'foreignKey', 'foreignKey'],
    )
    pool = linkFk(pool, 1, items)
    pool = linkFk(pool, 2, banners)
    pool.groupByColumnIndex = 0 // the key column, not a foreignKey column
    const r = validateDrafts([items, banners, pool])
    expect(!r.ok && r.errors.some((e) => e.code === 'invalid-group-by')).toBe(true)
  })
})

describe('validateDrafts -- id completeness and batch-wide uniqueness (review round 2)', () => {
  it('a storage-role column with no minted sourceColumnId is a blocking error, not a silent drop', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'])
    const columns = d.columns.slice()
    columns[1] = { ...columns[1], sourceColumnId: undefined }
    const broken = { ...d, columns }
    const r = validateDrafts([broken])
    expect(!r.ok && r.errors.some((e) => e.code === 'missing-source-column-id' && e.columnIndex === 1)).toBe(true)
  })

  it('two drafts sharing the same sourceTableId is a blocking error, caught before the per-table round-trip gate', () => {
    const a = draftFrom(['k'], [['a']], ['key'], 'A')
    const b = draftFrom(['k'], [['b']], ['key'], 'B')
    const clashing = { ...b, sourceTableId: a.sourceTableId }
    const r = validateDrafts([a, clashing])
    expect(!r.ok && r.errors.some((e) => e.code === 'duplicate-source-table-id')).toBe(true)
  })
})

describe('validateDrafts -- label composition + fallback (§DI10, resolved ambiguity)', () => {
  it('a table with two label-role columns joins both, in column order, with " · "', () => {
    const d = draftFrom(['k', 'first', 'last'], [['a', 'Jane', 'Doe']], ['key', 'label', 'label'])
    const r = validateDrafts([d])
    expect(r.ok).toBe(true)
    if (r.ok) {
      const t = r.plan.tables[0]
      const { text } = composeFullRowLabel(r.plan.tables, t, t.rows[0])
      expect(text).toBe('Jane · Doe')
    }
  })

  it('the corrected worked example: GachaPoolEntries · Ember Blade · Premium Pickup · weight', () => {
    const items = draftFrom(['item_key', 'display_name'], [['itm_blade_ssr', 'Ember Blade']], ['key', 'label'])
    const banners = draftFrom(['banner_key', 'banner_name'], [['premium_pickup', 'Premium Pickup']], ['key', 'label'])
    let pool = draftFrom(
      ['pool_entry_key', 'item_key', 'banner_key', 'weight'],
      [['ppe_pickup_blade_ssr', 'itm_blade_ssr', 'premium_pickup', '10']],
      ['key', 'foreignKey', 'foreignKey', 'number'],
      'GachaPoolEntries',
    )
    pool = linkFk(pool, 1, items)
    pool = linkFk(pool, 2, banners)
    pool.groupByColumnIndex = 2
    const r = validateDrafts([items, banners, pool])
    expect(r.ok).toBe(true)
    if (r.ok) {
      const t = r.plan.tables.find((x) => x.label === 'GachaPoolEntries')!
      const { text } = composeFullRowLabel(r.plan.tables, t, t.rows[0])
      expect(`${t.label} · ${text} · weight`).toBe('GachaPoolEntries · Ember Blade · Premium Pickup · weight')
    }
  })

  it('the corrected PackageItems example: PackageItems · Starter Pack · Iron Blade · quantity', () => {
    const items = draftFrom(['item_key', 'display_name'], [['itm_blade_sr', 'Iron Blade']], ['key', 'label'])
    const packages = draftFrom(['package_key', 'package_name'], [['pkg_starter', 'Starter Pack']], ['key', 'label'])
    let pkgItems = draftFrom(
      ['package_item_key', 'package_key', 'item_key', 'quantity'],
      [['pkgitem_starter_blade_sr', 'pkg_starter', 'itm_blade_sr', '1']],
      ['key', 'foreignKey', 'foreignKey', 'number'],
      'PackageItems',
    )
    pkgItems = linkFk(pkgItems, 1, packages)
    pkgItems = linkFk(pkgItems, 2, items)
    pkgItems.groupByColumnIndex = 1
    const r = validateDrafts([items, packages, pkgItems])
    expect(r.ok).toBe(true)
    if (r.ok) {
      const t = r.plan.tables.find((x) => x.label === 'PackageItems')!
      const { text } = composeFullRowLabel(r.plan.tables, t, t.rows[0])
      expect(`${t.label} · ${text} · quantity`).toBe('PackageItems · Starter Pack · Iron Blade · quantity')
    }
  })

  it('falls back to the raw FK key + a non-blocking warning ONLY when the target has no label value -- never for a genuine orphan', () => {
    const targetNoLabel = draftFrom(['k'], [['tgt1']], ['key']) // no label column at all
    let ref = draftFrom(['k', 'fk'], [['r1', 'tgt1']], ['key', 'foreignKey'])
    ref = linkFk(ref, 1, targetNoLabel)
    const r = validateDrafts([targetNoLabel, ref])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.warnings.some((w) => w.code === 'label-fallback')).toBe(true)
      const t = r.plan.tables.find((x) => x === r.plan.tables[1])!
      const { text, fallbackColumnIds } = composeFullRowLabel(r.plan.tables, t, t.rows[0])
      expect(text).toBe('tgt1') // the raw key, since the target has no label
      expect(fallbackColumnIds).toHaveLength(1)
    }
  })
})

describe('validateDrafts -- storage limits (checked before the builder ever runs)', () => {
  it('a table label longer than DI_LABEL_MAX is a blocking error', () => {
    const d = draftFrom(['k'], [['a']], ['key'], 'x'.repeat(201))
    const r = validateDrafts([d])
    expect(!r.ok && r.errors.some((e) => e.code === 'label-too-long')).toBe(true)
  })
})

describe('validateDrafts -- round-trip-losslessness gate (internal test, plan cannot be hand-built)', () => {
  it('two columns sharing the same sourceColumnId would be silently collapsed by readDataImports -- refused instead', () => {
    const d = draftFrom(['k', 'n1', 'n2'], [['a', '1', '2']], ['key', 'number', 'number'])
    // force a collision the normal setColumnRole minting never produces
    d.columns[2] = { ...d.columns[2], sourceColumnId: d.columns[1].sourceColumnId }
    const r = validateDrafts([d])
    expect(!r.ok && r.errors.some((e) => e.code === 'round-trip-mismatch')).toBe(true)
  })
})
