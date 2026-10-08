import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { isEditBlocked, useGraphStore } from './graphStore'
import { useFrameStore } from './frameStore'
import { useProjectStore } from './projectStore'
import { useSimStore } from './simStore'
import { useUiStore } from './uiStore'
import { digestOfCanonical, canonicalContent } from '../model/revision'

// Issue #334 — the Canvas edit lock as one policy (docs/canvas-edit-lock.md):
// while locked, every user edit is refused at the store; a whole-document
// replacement, the runtime of Run / Step and unlocking pass.

const g = () => useGraphStore.getState()
const lock = (v: boolean) => useUiStore.getState().setCanvasLocked(v)

/** everything a refused edit must leave exactly as it was */
const snapshot = () => {
  const s = g()
  return {
    nodes: s.nodes,
    edges: s.edges,
    past: s.past,
    future: s.future,
    simulationRev: s.simulationRev,
    modelVersion: s.modelVersion,
    frames: useFrameStore.getState().frames,
  }
}
const digest = () => digestOfCanonical(canonicalContent({ nodes: g().nodes, edges: g().edges }))

/** Source ─1→ Pool, one saved frame; unlocked, with one undo step */
function seed() {
  lock(false)
  g().newGraph()
  g().addNodeAt('source', { x: 0, y: 0 })
  g().addNodeAt('pool', { x: 200, y: 0 })
  const [src, pool] = g().nodes
  g().onConnect({ source: src.id, target: pool.id, sourceHandle: 'out', targetHandle: 'in' })
  useFrameStore.getState().addFrame({ x: -20, y: -20, w: 400, h: 120 })
  return { src: src.id, pool: pool.id, edge: g().edges[0].id, frame: useFrameStore.getState().frames[0].id }
}

beforeEach(() => lock(false))

describe('editPolicy — registration', () => {
  it('the guard follows uiStore.canvasLocked', () => {
    lock(false)
    expect(isEditBlocked()).toBe(false)
    lock(true)
    expect(isEditBlocked()).toBe(true)
  })
})

describe('editPolicy — while locked, every user edit is refused', () => {
  const refused: [string, (ids: ReturnType<typeof seed>) => unknown][] = [
    ['addNodeAt', () => g().addNodeAt('pool', { x: 400, y: 0 })],
    ['onConnect', (i) => g().onConnect({ source: i.pool, target: i.src, sourceHandle: 'out', targetHandle: 'in' })],
    ['updateNodeData', (i) => g().updateNodeData(i.pool, { label: 'Renamed' })],
    ['setEdgeData', (i) => g().setEdgeData(i.edge, { kind: 'resource', flow: '5' })],
    ['setAccent', (i) => g().setAccent([i.pool], [], '#aa3355')],
    ['removeNode', (i) => g().removeNode(i.pool)],
    ['removeEdge', (i) => g().removeEdge(i.edge)],
    ['undo', () => g().undo()],
    ['redo', () => g().redo()],
    ['onNodesChange position', (i) => g().onNodesChange([{ type: 'position', id: i.pool, position: { x: 999, y: 999 }, dragging: false }])],
    ['onNodesChange remove', (i) => g().onNodesChange([{ type: 'remove', id: i.pool }])],
    ['onEdgesChange remove', (i) => g().onEdgesChange([{ type: 'remove', id: i.edge }])],
    ['applyGesturePositions', (i) => g().applyGesturePositions({ [i.pool]: { x: 5, y: 5 } }, {})],
    ['pushGestureEntry', () => g().pushGestureEntry(g().captureGestureSnapshot())],
    ['loadDoc revision-apply', () => g().loadDoc({ nodes: [], edges: [] }, { mode: 'revision-apply' })],
    ['frame add', () => useFrameStore.getState().addFrame({ x: 0, y: 0, w: 10, h: 10 })],
    ['frame rename', (i) => useFrameStore.getState().renameFrame(i.frame, 'Area')],
    ['frame resize', (i) => useFrameStore.getState().resizeFrame(i.frame, { x: 0, y: 0, w: 50, h: 50 })],
    ['frame colour', (i) => useFrameStore.getState().setFrameColor(i.frame, 'gold')],
    ['frame move', (i) => useFrameStore.getState().setRectsSilently({ [i.frame]: { x: 9, y: 9, w: 400, h: 120 } })],
    ['frame adopt', () => useFrameStore.getState().adoptFrame({ x: 0, y: 0, w: 10, h: 10 }, 'Area')],
    ['frame remove', (i) => useFrameStore.getState().removeFrame(i.frame)],
    ['frames clear', () => useFrameStore.getState().clearFrames()],
  ]
  for (const [name, edit] of refused) {
    it(`${name} changes nothing`, () => {
      const ids = seed()
      g().undo()
      g().redo() // one entry each way, so undo AND redo have something to refuse
      lock(true)
      const before = snapshot()
      const d0 = digest()
      edit(ids)
      expect(snapshot()).toEqual(before)
      expect(g().nodes).toBe(before.nodes)
      expect(g().past).toBe(before.past)
      expect(digest()).toBe(d0)
    })
  }

  it('the actions that report a result say `locked`', () => {
    seed()
    lock(true)
    expect(g().insertModule({ nodes: [], edges: [], modelVersion: 1 }, { at: { x: 0, y: 0 } })).toEqual({ ok: false, reason: 'locked' })
    expect(g().commitDataImport({} as never, {} as never)).toEqual({ ok: false, reason: 'locked' })
    expect(g().commitRefresh({} as never, {} as never, { x: 0, y: 0 })).toEqual({ ok: false, reason: 'locked' })
    expect(g().renameDataImportTable('t', 'Name')).toEqual({ ok: false, reason: 'locked' })
    const apply = useProjectStore.getState().applyProposal({ project: {} as never, base: {} as never, proposed: { nodes: [], edges: [] } })
    expect(apply).toEqual({ ok: false, reason: 'locked' })
  })
})

describe('editPolicy — what stays available while locked', () => {
  it('selection and size measurements still apply; a move in the same batch does not', () => {
    const { pool } = seed()
    lock(true)
    const at = g().nodes.find((n) => n.id === pool)!.position
    g().onNodesChange([
      { type: 'select', id: pool, selected: true },
      { type: 'position', id: pool, position: { x: 999, y: 999 }, dragging: false },
    ])
    const n = g().nodes.find((x) => x.id === pool)!
    expect(n.selected).toBe(true)
    expect(n.position).toEqual(at)
    g().onEdgesChange([{ type: 'select', id: g().edges[0].id, selected: true }])
    expect(g().edges[0].selected).toBe(true)
    g().setSelection(pool, null)
    expect(g().selectedNodeId).toBe(pool)
  })

  it('a `replace` that only flips `selected` (a panel reveal through setNodes) applies; one that moves does not', () => {
    const { pool, edge } = seed()
    lock(true)
    const n0 = g().nodes.find((n) => n.id === pool)!
    g().onNodesChange([{ type: 'replace', id: pool, item: { ...n0, selected: true } }])
    expect(g().nodes.find((n) => n.id === pool)!.selected).toBe(true)
    const n1 = g().nodes.find((n) => n.id === pool)!
    g().onNodesChange([{ type: 'replace', id: pool, item: { ...n1, position: { x: 999, y: 999 } } }])
    expect(g().nodes.find((n) => n.id === pool)!.position).toEqual(n0.position)
    const e0 = g().edges.find((e) => e.id === edge)!
    g().onEdgesChange([{ type: 'replace', id: edge, item: { ...e0, selected: true } }])
    expect(g().edges.find((e) => e.id === edge)!.selected).toBe(true)
    g().onEdgesChange([{ type: 'replace', id: edge, item: { ...e0, target: e0.source } }])
    expect(g().edges.find((e) => e.id === edge)!.target).toBe(e0.target)
  })

  it('Run / Step: a Step on a locked document advances and changes no document', () => {
    seed()
    lock(true)
    const d0 = digest()
    useSimStore.getState().reset()
    useSimStore.getState().advance()
    expect(useSimStore.getState().stepIndex).toBe(1)
    expect(digest()).toBe(d0)
  })

  it('unlocking passes, and edits work again', () => {
    seed()
    lock(true)
    g().addNodeAt('pool', { x: 400, y: 0 })
    expect(g().nodes).toHaveLength(2)
    useUiStore.getState().toggleCanvasLocked()
    expect(useUiStore.getState().canvasLocked).toBe(false)
    g().addNodeAt('pool', { x: 400, y: 0 })
    expect(g().nodes).toHaveLength(3)
  })

  it('export reads the locked document without changing it', () => {
    seed()
    lock(true)
    const before = snapshot()
    const text = g().exportJSON()
    expect(JSON.parse(text).nodes).toHaveLength(2)
    expect(snapshot()).toEqual(before)
  })
})
