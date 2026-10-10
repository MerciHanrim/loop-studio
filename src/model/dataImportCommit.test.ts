import { describe, expect, it } from 'vitest'
import { buildImportCommit, CELL_LABEL_SEP, cellLabel, cellLabelParts, shiftUntilClear, summarizeImportPlan, type PlacementChoice, type Rect } from './dataImportCommit'
import { createTableDraft, setColumnRole, validateDrafts, type DraftColumnRole, type TableDraft } from './dataImportValidate'
import { canonicalContent, digestOfCanonical } from './revision'
import { deserialize, serialize, type ImportSourceTable, type SavedFrame } from './serialize'
import type { LoopEdge, LoopNode } from './types'
import { nodeOnGrid } from './layout/grid'

// docs/data-import.md -- Phase 1B. `buildImportCommit` is the pure
// candidate builder: label composition (the resolved join rule), the three
// placement destinations, the pre-commit collision gate, and the
// loop-revision/8 provenance round-trip.

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
const NONE = (x = 0, y = 0): PlacementChoice => ({ kind: 'none', origin: { x, y } })

describe('buildImportCommit -- label composition matches the corrected worked examples', () => {
  it('GachaPoolEntries · Ember Blade · Premium Pickup · weight', () => {
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
    const v = validateDrafts([items, banners, pool])
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const built = buildImportCommit(v.plan, NONE(), EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.createdNodes).toHaveLength(1)
    expect((built.createdNodes[0].data as { label: string }).label).toBe(
      'GachaPoolEntries · Ember Blade · Premium Pickup · weight',
    )
  })

  it('PackageItems · Starter Pack · Iron Blade · quantity', () => {
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
    const v = validateDrafts([items, packages, pkgItems])
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const built = buildImportCommit(v.plan, NONE(), EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect((built.createdNodes[0].data as { label: string }).label).toBe('PackageItems · Starter Pack · Iron Blade · quantity')
  })

  it('a table with two label-role columns joins both', () => {
    const d = draftFrom(['k', 'first', 'last', 'n'], [['a', 'Jane', 'Doe', '5']], ['key', 'label', 'label', 'number'], 'People')
    const v = validateDrafts([d])
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const built = buildImportCommit(v.plan, NONE(), EMPTY_HOST, [], [])
    expect(built.ok && (built.createdNodes[0].data as { label: string }).label).toBe('People · Jane · Doe · n')
  })
})

describe('buildImportCommit -- provenance round-trips through serialize (loop-revision/8)', () => {
  it('a committed Parameter\'s triple + the stored table survive a full save/load cycle', () => {
    const d = draftFrom(['item_key', 'weight'], [['itm_a', '10']], ['key', 'number'], 'Items')
    const v = validateDrafts([d])
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const built = buildImportCommit(v.plan, NONE(), EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const file = serialize([], [], undefined, undefined, undefined, 1, undefined, undefined)
    void file
    const nodes = built.createdNodes
    const roundTripFile = serialize(nodes, [], undefined, undefined, undefined, 1, undefined, built.tables)
    const back = deserialize(roundTripFile)
    expect((back.nodes[0].data as { sourceTableId?: string }).sourceTableId).toBe(d.sourceTableId)
    expect((back.nodes[0].data as { sourceKey?: string }).sourceKey).toBe('itm_a')
    expect(back.dataImports).toEqual(built.tables)

    const before = digestOfCanonical(canonicalContent({ nodes, edges: [], dataImports: built.tables }))
    const after = digestOfCanonical(canonicalContent({ nodes: back.nodes, edges: back.edges, dataImports: back.dataImports }))
    expect(after).toBe(before)
  })
})

describe('buildImportCommit -- placement', () => {
  it('"none": every generated node is grid-placed from the given origin', () => {
    const d = draftFrom(['k', 'n'], [['a', '1'], ['b', '2'], ['c', '3']], ['key', 'number'])
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    const built = buildImportCommit(v.plan, NONE(100, 200), EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.createdFrames).toEqual([])
    // issue #344 §DL3 — on the 16 px grid (left edge 96, port row 196 + 28 = 224)
    expect(built.createdNodes[0].position).toEqual({ x: 96, y: 196 })
    for (const n of built.createdNodes) expect(nodeOnGrid(n.position)).toBe(true)
  })

  it('"framePerTable": a lookup-only table (zero number columns) gets NO frame', () => {
    const lookup = draftFrom(['k', 'name'], [['a', 'Alpha']], ['key', 'label'], 'Lookup')
    const v = validateDrafts([lookup])
    if (!v.ok) throw new Error('expected ok')
    const built = buildImportCommit(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } }, EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.createdNodes).toEqual([])
    expect(built.createdFrames).toEqual([])
  })

  it('"framePerTable": a table WITH rows gets exactly one frame enclosing its nodes', () => {
    const d = draftFrom(['k', 'n'], [['a', '1'], ['b', '2']], ['key', 'number'], 'Widgets')
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    const built = buildImportCommit(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } }, EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.createdFrames).toHaveLength(1)
    const frame = built.createdFrames[0]
    for (const n of built.createdNodes) {
      expect(n.position.x).toBeGreaterThanOrEqual(frame.rect.x)
      expect(n.position.y).toBeGreaterThanOrEqual(frame.rect.y)
      expect(n.position.x).toBeLessThanOrEqual(frame.rect.x + frame.rect.w)
      expect(n.position.y).toBeLessThanOrEqual(frame.rect.y + frame.rect.h)
    }
  })

  it('"framePerTable": a group-by table gets one frame per distinct group value', () => {
    const items = draftFrom(['item_key'], [['i1'], ['i2']], ['key'])
    const banners = draftFrom(['banner_key'], [['b1'], ['b2']], ['key'])
    let pool = draftFrom(
      ['pe_key', 'item_key', 'banner_key', 'weight'],
      [
        ['pe1', 'i1', 'b1', '1'],
        ['pe2', 'i2', 'b2', '2'],
      ],
      ['key', 'foreignKey', 'foreignKey', 'number'],
      'Pool',
    )
    pool = linkFk(pool, 1, items)
    pool = linkFk(pool, 2, banners)
    pool.groupByColumnIndex = 2
    const v = validateDrafts([items, banners, pool])
    if (!v.ok) throw new Error('expected ok')
    const built = buildImportCommit(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } }, EMPTY_HOST, [], [])
    expect(built.ok && built.createdFrames).toHaveLength(2)
  })

  it('"existingFrame": places within it when there is room', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'])
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    const frame: SavedFrame = { id: 'frame_x', label: 'F', rect: { x: 0, y: 0, w: 400, h: 300 } }
    const built = buildImportCommit(v.plan, { kind: 'existingFrame', frameId: 'frame_x' }, EMPTY_HOST, [frame], [])
    expect(built.ok).toBe(true)
    expect(built.ok && built.createdFrames).toEqual([])
  })

  it('"existingFrame": refuses the WHOLE commit when there is not enough room -- no partial mutation', () => {
    const d = draftFrom(['k', 'n'], Array.from({ length: 50 }, (_, i) => [`k${i}`, '1']), ['key', 'number'])
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    const tinyFrame: SavedFrame = { id: 'frame_tiny', label: 'F', rect: { x: 0, y: 0, w: 50, h: 50 } }
    const built = buildImportCommit(v.plan, { kind: 'existingFrame', frameId: 'frame_tiny' }, EMPTY_HOST, [tinyFrame], [])
    expect(built.ok).toBe(false)
  })

  it('"existingFrame": refuses when the frame is already occupied by an existing node', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'])
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    const frame: SavedFrame = { id: 'frame_full', label: 'F', rect: { x: 0, y: 0, w: 200, h: 100 } }
    const occupied = { nodes: [{ id: 'n1', type: 'pool', position: { x: 24, y: 24 }, data: {} } as unknown as LoopNode], edges: [] }
    const built = buildImportCommit(v.plan, { kind: 'existingFrame', frameId: 'frame_full' }, occupied, [frame], [])
    expect(built.ok).toBe(false)
  })

  it('"existingFrame": the top row is occupied but the frame is tall enough -- the scan finds a lower free row, not just top-left', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'])
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    // narrow (single column) but TALL frame -- multiple candidate ROWS exist
    // (wide/tall enough for 2 real 260x120px Parameter rows + the grid gap)
    const frame: SavedFrame = { id: 'frame_tall', label: 'F', rect: { x: 0, y: 0, w: 340, h: 340 } }
    // occupies exactly the first candidate cell (24,24); the second
    // candidate row (24, 168) is free
    const occupied = {
      nodes: [
        {
          id: 'n1',
          type: 'pool',
          position: { x: 24, y: 24 },
          data: { kind: 'pool', label: 'n1', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
        } as unknown as LoopNode,
      ],
      edges: [] as LoopEdge[],
    }
    const built = buildImportCommit(v.plan, { kind: 'existingFrame', frameId: 'frame_tall' }, occupied, [frame], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.createdNodes[0].position).not.toEqual({ x: 24, y: 24 })
    // still strictly inside the frame, all four edges
    const p = built.createdNodes[0].position
    expect(p.x).toBeGreaterThanOrEqual(frame.rect.x)
    expect(p.y).toBeGreaterThanOrEqual(frame.rect.y)
    expect(p.x + 150).toBeLessThanOrEqual(frame.rect.x + frame.rect.w)
    expect(p.y + 40).toBeLessThanOrEqual(frame.rect.y + frame.rect.h)
  })

  it('"framePerTable": a group-by frame\'s title uses the RESOLVED FK label, never the raw key', () => {
    const banners = draftFrom(['banner_key', 'banner_name'], [['premium_pickup', 'Premium Pickup']], ['key', 'label'])
    const items = draftFrom(['item_key'], [['itm_a']], ['key'])
    let pool = draftFrom(
      ['pe_key', 'item_key', 'banner_key', 'weight'],
      [['pe1', 'itm_a', 'premium_pickup', '10']],
      ['key', 'foreignKey', 'foreignKey', 'number'],
      'GachaPoolEntries',
    )
    pool = linkFk(pool, 1, items)
    pool = linkFk(pool, 2, banners)
    pool.groupByColumnIndex = 2
    const v = validateDrafts([banners, items, pool])
    if (!v.ok) throw new Error('expected ok')
    const built = buildImportCommit(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } }, EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.createdFrames).toHaveLength(1)
    expect(built.createdFrames[0].label).toBe('GachaPoolEntries (Premium Pickup)')
    expect(built.createdFrames[0].label).not.toContain('premium_pickup')
  })
})

describe('shiftUntilClear', () => {
  it('returns the original rect unchanged when nothing overlaps', () => {
    const rect: Rect = { x: 0, y: 0, w: 100, h: 50 }
    expect(shiftUntilClear(rect, [])).toEqual(rect)
  })

  it('steps right past a single blocking obstacle', () => {
    const rect: Rect = { x: 0, y: 0, w: 100, h: 50 }
    const blocker: Rect = { x: 0, y: 0, w: 100, h: 50 }
    const cleared = shiftUntilClear(rect, [blocker])
    expect(cleared).not.toBeNull()
    expect(cleared).not.toEqual(rect)
  })

  it('wraps to exactly ONE row-band down, not 20 (review round 3 fix)', () => {
    const rect: Rect = { x: 0, y: 0, w: 100, h: 50 }
    // block every rightward step of row-band 0 (the original row) so the
    // scan is forced to wrap at guard=20 -- the very first wrap.
    const obstacles: Rect[] = []
    for (let step = 0; step <= 20; step++) {
      obstacles.push({ x: step * (rect.w + 40), y: 0, w: rect.w, h: rect.h })
    }
    const cleared = shiftUntilClear(rect, obstacles)
    expect(cleared).not.toBeNull()
    // one row-band down from the ORIGINAL rect: y0 + 1*(h + GRID_GAP_Y=24)
    expect(cleared!.y).toBe(rect.y + (rect.h + 24))
    expect(cleared!.x).toBe(rect.x)
  })

  it('returns null (never a still-overlapping rect) once the guard budget is exhausted', () => {
    const rect: Rect = { x: 0, y: 0, w: 100, h: 50 }
    // cover every position the deterministic scan could possibly try: 20
    // rightward steps per row-band, enough row-bands to exceed the 200-step
    // guard -- a dense wall the scan can never get past.
    const obstacles: Rect[] = []
    for (let band = 0; band <= 11; band++) {
      for (let step = 0; step <= 20; step++) {
        obstacles.push({ x: step * (rect.w + 40), y: band * (rect.h + 24), w: rect.w, h: rect.h })
      }
    }
    expect(shiftUntilClear(rect, obstacles)).toBeNull()
  })
})

describe('buildImportCommit -- pre-commit collision gate', () => {
  it('refuses when a new sourceTableId collides with an existing dataImports table', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'])
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    const existing: ImportSourceTable = { sourceTableId: d.sourceTableId, label: 'old', columns: [], rows: [] }
    const built = buildImportCommit(v.plan, NONE(), EMPTY_HOST, [], [existing])
    expect(built.ok).toBe(false)
  })
})

describe('buildImportCommit -- long KO/JA labels stay within the computed frame bounds', () => {
  it('a long Korean label does not push its node outside the frame rect', () => {
    const d = draftFrom(
      ['k', 'name', 'n'],
      [['a', '프로젝트 일일 운영 마진 예측치와 매우 긴 설명 텍스트', '1']],
      ['key', 'label', 'number'],
      '프로젝트',
    )
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    const built = buildImportCommit(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } }, EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const frame = built.createdFrames[0]
    const n = built.createdNodes[0]
    const NODE_W = 150
    const NODE_H = 40
    // all four edges -- not just the top-left corner, which alone can't
    // catch a node whose RIGHT or BOTTOM edge escapes the frame.
    expect(n.position.x).toBeGreaterThanOrEqual(frame.rect.x)
    expect(n.position.y).toBeGreaterThanOrEqual(frame.rect.y)
    expect(n.position.x + NODE_W).toBeLessThanOrEqual(frame.rect.x + frame.rect.w)
    expect(n.position.y + NODE_H).toBeLessThanOrEqual(frame.rect.y + frame.rect.h)
  })
})

describe('buildImportCommit -- validateResultGraph gate', () => {
  it('a well-formed batch passes validateResultGraph and produces valid nodes', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'])
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    const built = buildImportCommit(v.plan, NONE(), EMPTY_HOST, [], [])
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.createdNodes[0].data).toMatchObject({ kind: 'parameter', value: 1 })
    }
  })
})

// docs/localization.md §L9.3 -- a cell label has TWO forms and they must agree.
//
// The renderer needs the three parts separately: joined, one `dir="auto"` picks a
// single paragraph direction from the first strong character of the whole string
// and reorders whichever fragment disagrees with it. A created parameter NODE needs
// the joined string, because a node label is a string and not markup.
//
// The §L9.3 note said to return the parts INSTEAD of the joined string. That would
// have broken the node-label caller, so the joined form is DERIVED from the parts --
// and this is the test that keeps the derivation honest, because two independent
// implementations of the same join is exactly how the panel and the stored label
// come to disagree.
describe('cellLabel -- the joined form is the parts, joined', () => {
  const setup = () => {
    const items = draftFrom(['item_key', 'display_name', 'weight'], [['itm_blade', 'Ember Blade', '7']], ['key', 'label', 'number'], 'Items')
    const v = validateDrafts([items])
    if (!v.ok) throw new Error('expected ok')
    // the plan's cells come from the summary, the same producer the wizard reads
    const cell = summarizeImportPlan(v.plan).cells[0]
    return { tables: v.plan.tables, cell }
  }

  it('the parts are the three independent user strings', () => {
    const { tables, cell } = setup()
    const p = cellLabelParts(tables, cell)
    expect(p.table).toBe('Items')
    expect(p.header).toBe('weight')
    expect(p.row.length).toBeGreaterThan(0)
    // three DISTINCT fields, not one string split by a separator
    expect(p.table).not.toContain(CELL_LABEL_SEP)
    expect(p.header).not.toContain(CELL_LABEL_SEP)
  })

  it('the joined label equals the parts joined by the shared separator', () => {
    const { tables, cell } = setup()
    const p = cellLabelParts(tables, cell)
    expect(cellLabel(tables, cell)).toBe([p.table, p.row, p.header].join(CELL_LABEL_SEP))
  })

  it('the separator is a single shared constant, so the renderer cannot use a different one', () => {
    const { tables, cell } = setup()
    const joined = cellLabel(tables, cell)
    const p = cellLabelParts(tables, cell)
    // exactly two separators, one between each adjacent pair
    expect(joined.split(CELL_LABEL_SEP).length).toBe(3)
    expect(joined.startsWith(p.table)).toBe(true)
    expect(joined.endsWith(p.header)).toBe(true)
  })
})
