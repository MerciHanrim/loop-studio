import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initSim, step } from '../engine/step'
import { STORAGE_KEY } from '../model/serialize'
import type { ImportColumn, ImportSourceTable } from '../model/serialize'
import type { LoopNode } from '../model/types'
import { semanticDigest } from '../model/workspace'
import { useDataImportStore } from './dataImportStore'
import { flushAutosave, useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useProjectStore } from './projectStore'
import { routeImport } from './revisionIO'
import { useSimStore } from './simStore'

// #619 item 1 — SEMANTICS-W.md §W3: a rename is a cosmetic edit, it does not
// reset the run nor stale a Monte Carlo result. Before, renaming an imported
// Parameter (its first keystroke also detaches the auto-composed label), renaming
// its table, and the Undo / Redo of ANY rename (a plain Parameter's included)
// reset the run. A rename is still a change of the document: it is one Undo
// entry, autosaved, and marks an open revision changed.

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

const col = (sourceColumnId: string, role: ImportColumn['role'], header: string): ImportColumn => ({ sourceColumnId, role, header })
const items = (): ImportSourceTable => ({
  sourceTableId: 'srctable_items',
  label: 'Items',
  columns: [col('col_key', 'key', 'item_key'), col('col_name', 'label', 'display_name'), col('col_rate', 'number', 'rate')],
  rows: [{ sourceKey: 'itm_a', number: { col_rate: 2 }, label: { col_name: 'Ember' }, foreignKey: {} }],
})
// a Source pushes `@imp` (the imported Parameter) into Pool b; `plain` is a plain Parameter
const NODES = [
  { id: 'imp', type: 'parameter', position: { x: 0, y: 200 }, data: { kind: 'parameter', label: 'Items · Ember · rate', value: 2, sourceTableId: 'srctable_items', sourceKey: 'itm_a', sourceColumnId: 'col_rate', labelAutoComposed: true } },
  { id: 'plain', type: 'parameter', position: { x: 0, y: 300 }, data: { kind: 'parameter', label: 'Plain', value: 1 } },
  { id: 's', type: 'source', position: { x: 200, y: 0 }, data: { kind: 'source', label: 's', activation: 'automatic', mode: 'pushAny' } },
  { id: 'b', type: 'pool', position: { x: 400, y: 0 }, data: { kind: 'pool', label: 'b', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
]
const EDGES = [{ id: 'e', type: 'loop', source: 's', target: 'b', sourceHandle: 'r-out', targetHandle: 'l-in', data: { kind: 'resource', flow: '@imp' } }]
const PROJECT = {
  schema: 'loop-revision/1',
  version: 1,
  projectId: 'proj_' + '0'.repeat(26),
  revisionId: 'rev_' + '1'.repeat(26),
  parentId: null,
  role: 'revision',
}
const fileText = () =>
  JSON.stringify({ schema: 'loop-studio/graph/2', version: 1, layoutVersion: 1, nodes: NODES, edges: EDGES, dataImports: [items()], project: PROJECT })

const g = () => useGraphStore.getState()
const labelOf = (id: string) => (g().nodes.find((n) => n.id === id)!.data as { label: string }).label
/** the single run 3 steps in, and a finished Monte Carlo result, both current */
function startRuns() {
  for (let i = 0; i < 3; i++) useSimStore.getState().stepOnce()
  useMcStore.getState().restoreResult({ result: { pools: [] } as never, resultGraphDigest: 'test', stale: false })
}
const KEPT = { stepKept: true, mcStale: false }
const RESET = { stepKept: false, atStepZero: true, mcStale: true }
/** what `act` does to the runs started just before it (each start adds 3 steps) */
function after(act: () => void) {
  startRuns()
  const before = useSimStore.getState().stepIndex
  act()
  const now = useSimStore.getState().stepIndex
  const mcStale = useMcStore.getState().stale
  return now === before ? { stepKept: true, mcStale } : { stepKept: false, atStepZero: now === 0, mcStale }
}
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { nodes: LoopNode[]; dataImports?: ImportSourceTable[] } | null

const RENAMES: [string, () => void][] = [
  ['a plain Parameter', () => g().updateNodeData('plain', { label: 'Plain renamed' })],
  // the Inspector's patch for an imported Parameter's first keystroke (Inspector.tsx)
  ['an imported Parameter', () => g().updateNodeData('imp', { label: 'Renamed', labelAutoComposed: false })],
  ['its table', () => void g().renameDataImportTable('srctable_items', 'Gear')],
]

describe('a rename keeps the run, and is still a saved, undoable change (#619 item 1)', () => {
  beforeEach(async () => {
    vi.stubGlobal('localStorage', new MemStorage())
    g().newGraph()
    useProjectStore.getState().clear()
    useMcStore.getState().restoreResult(null)
    // a revision file: an open project, so its changed mark is measurable
    await routeImport(fileText())
    useProjectStore.getState().refreshDirty()
    expect(useProjectStore.getState().dirty).toBe(false)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  for (const [name, rename] of RENAMES) {
    it(`renaming ${name}: the run and the Monte Carlo result are kept, through Undo and Redo too`, () => {
      expect.soft(after(rename)).toEqual(KEPT)
      expect.soft(after(() => g().undo())).toEqual(KEPT)
      expect(after(() => g().redo())).toEqual(KEPT)
    })

    it(`renaming ${name}: one Undo entry, autosaved, and the revision is marked changed`, () => {
      const before = { plain: labelOf('plain'), imp: labelOf('imp'), table: useDataImportStore.getState().tables[0].label }
      rename()
      flushAutosave()
      const saved = stored()
      const now = { plain: labelOf('plain'), imp: labelOf('imp'), table: useDataImportStore.getState().tables[0].label }
      expect(now).not.toEqual(before)
      // the record holds the new names
      expect(saved?.nodes.find((n) => n.id === 'plain')?.data).toMatchObject({ label: now.plain })
      expect(saved?.nodes.find((n) => n.id === 'imp')?.data).toMatchObject({ label: now.imp })
      expect(saved?.dataImports?.[0]?.label).toBe(now.table)
      useProjectStore.getState().refreshDirty()
      expect(useProjectStore.getState().dirty).toBe(true)
      // one Undo restores the names, and the revision is unchanged again
      g().undo()
      expect({ plain: labelOf('plain'), imp: labelOf('imp'), table: useDataImportStore.getState().tables[0].label }).toEqual(before)
      useProjectStore.getState().refreshDirty()
      expect(useProjectStore.getState().dirty).toBe(false)
    })
  }

  it('the renames reach neither the engine nor the result check', async () => {
    const values = () => {
      let s = initSim(g().nodes)
      for (let i = 0; i < 3; i++) s = step(g().nodes, g().edges, s, i + 1, 2).state
      return s.values
    }
    const v0 = values()
    const d0 = await semanticDigest({ nodes: g().nodes, edges: g().edges }, 2)
    for (const [, rename] of RENAMES) rename()
    expect(values()).toEqual(v0)
    expect(await semanticDigest({ nodes: g().nodes, edges: g().edges }, 2)).toBe(d0)
  })

  it('control: a value change still resets the run, and so do its Undo and Redo', () => {
    expect.soft(after(() => g().updateNodeData('imp', { value: 5 }))).toEqual(RESET)
    expect.soft(after(() => g().undo())).toEqual(RESET)
    expect(after(() => g().redo())).toEqual(RESET)
  })

  it('control: a value change together with a rename still resets the run', () => {
    expect(after(() => g().updateNodeData('plain', { label: 'Both', value: 9 }))).toEqual(RESET)
  })
})
