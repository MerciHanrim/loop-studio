import { beforeEach, describe, expect, it } from 'vitest'
import { createTableDraft, setColumnRole, validateDrafts, type DraftColumnRole, type TableDraft } from '../model/dataImportValidate'
import { useDataImportStore } from './dataImportStore'
import { useFrameStore } from './frameStore'
import { useGraphStore } from './graphStore'

// docs/data-import.md §DI16 Phase 1B -- `graphStore.commitDataImport`: ONE
// atomic history entry across nodes, frames, and the `dataImports` sidecar
// (mirrors `insertModule`'s own §MS3.5 discipline).

const g = () => useGraphStore.getState()

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

beforeEach(() => {
  g().newGraph()
})

describe('commitDataImport -- one atomic transaction', () => {
  it('adds ONE history entry covering nodes, the new frame, and the new dataImports table', () => {
    const pastBefore = g().past.length
    const tablesBefore = useDataImportStore.getState().tables.length
    const framesBefore = useFrameStore.getState().frames.length

    const d = draftFrom(['k', 'n'], [['a', '1'], ['b', '2']], ['key', 'number'], 'Widgets')
    const v = validateDrafts([d])
    expect(v.ok).toBe(true)
    if (!v.ok) return

    const r = g().commitDataImport(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(g().past.length).toBe(pastBefore + 1) // ONE entry, not three
    expect(g().nodes).toHaveLength(2)
    expect(useDataImportStore.getState().tables).toHaveLength(tablesBefore + 1)
    expect(useFrameStore.getState().frames).toHaveLength(framesBefore + 1)
  })

  it('one undo removes the nodes, the frame, AND the dataImports record together; redo restores all three', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'], 'Widgets')
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')

    const nodesBefore = g().nodes.length
    const r = g().commitDataImport(v.plan, { kind: 'framePerTable', origin: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    expect(g().nodes.length).toBe(nodesBefore + 1)
    expect(useDataImportStore.getState().tables).toHaveLength(1)
    expect(useFrameStore.getState().frames).toHaveLength(1)

    g().undo()
    expect(g().nodes.length).toBe(nodesBefore)
    expect(useDataImportStore.getState().tables).toHaveLength(0)
    expect(useFrameStore.getState().frames).toHaveLength(0)

    g().redo()
    expect(g().nodes.length).toBe(nodesBefore + 1)
    expect(useDataImportStore.getState().tables).toHaveLength(1)
    expect(useFrameStore.getState().frames).toHaveLength(1)
  })

  it('a refused commit (sourceTableId collision) changes NOTHING -- no history entry, no mutation', () => {
    const d = draftFrom(['k', 'n'], [['a', '1']], ['key', 'number'], 'Widgets')
    const v = validateDrafts([d])
    if (!v.ok) throw new Error('expected ok')
    // pre-seed a colliding table id via a first successful commit, then try to
    // replay the SAME plan again (same minted sourceTableId) -- must refuse.
    const first = g().commitDataImport(v.plan, { kind: 'none', origin: { x: 0, y: 0 } })
    expect(first.ok).toBe(true)

    const pastBefore = g().past.length
    const nodesBefore = g().nodes.length
    const tablesBefore = useDataImportStore.getState().tables.length

    const second = g().commitDataImport(v.plan, { kind: 'none', origin: { x: 200, y: 200 } })
    expect(second.ok).toBe(false)
    expect(g().past.length).toBe(pastBefore) // no new history entry
    expect(g().nodes.length).toBe(nodesBefore)
    expect(useDataImportStore.getState().tables).toHaveLength(tablesBefore)
  })
})
