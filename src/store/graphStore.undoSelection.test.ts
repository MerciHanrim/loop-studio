import { beforeEach, describe, expect, it } from 'vitest'
import './editPolicy'
import { useGraphStore } from './graphStore'
import { useUiStore } from './uiStore'
import { serialize } from '../model/serialize'
import type { LoopNode } from '../model/types'

// Undo / redo end with nothing selected, on the canvas as in the Inspector: a
// history entry keeps React Flow's `selected` flags as they were when it was
// taken, and restoring them left a mark the Inspector did not show (a click
// then changed nothing; Delete and the arrow keys acted on it) or brought back
// an old selection (share note 56). The one exception is a module insert
// (docs/module-system.md §MS3.5): its undo restores the selection from before
// the insert, its redo the inserted set — the flags and the Inspector's ids
// together.

const S = () => useGraphStore.getState()
const flagged = () => [...S().nodes.filter((n) => n.selected).map((n) => n.id), ...S().edges.filter((e) => e.selected).map((e) => e.id)]

/** what React Flow does on a click: a `select` change, then the Inspector's ids */
function select(nodeIds: string[], edgeIds: string[]) {
  S().onNodesChange(S().nodes.map((n) => ({ type: 'select' as const, id: n.id, selected: nodeIds.includes(n.id) })))
  S().onEdgesChange(S().edges.map((e) => ({ type: 'select' as const, id: e.id, selected: edgeIds.includes(e.id) })))
  S().setSelection(nodeIds[0] ?? null, edgeIds[0] ?? null)
}

/** Pool a → Pool b; addNodeAt selects the node it adds, so the selection is cleared first */
function graph() {
  S().addNodeAt('pool', { x: 0, y: 0 })
  S().addNodeAt('pool', { x: 320, y: 0 })
  const [a, b] = S().nodes.map((n) => n.id)
  S().onConnect({ source: a!, target: b!, sourceHandle: 'out', targetHandle: 'in' })
  select([], [])
  return { a: a!, b: b!, e: S().edges[0]!.id }
}

const edit = (e: string, flow: string) => S().setEdgeData(e, { ...(S().edges.find((x) => x.id === e)!.data as object), flow } as never)

beforeEach(() => {
  useUiStore.getState().setCanvasLocked(false)
  S().newGraph()
})

describe('undo / redo and the selection', () => {
  it('undo clears every selected flag and the Inspector ids, for nodes and connections; redo too', () => {
    const { a, e } = graph()
    select([a], [e])
    edit(e, '3')
    expect(flagged(), 'an edit keeps the selection').toEqual([a, e])
    S().undo()
    expect(flagged()).toEqual([])
    expect([S().selectedNodeId, S().selectedEdgeId]).toEqual([null, null])
    select([a], [e])
    S().redo()
    expect(flagged()).toEqual([])
    expect([S().selectedNodeId, S().selectedEdgeId]).toEqual([null, null])
  })

  it('an old selection is not brought back: deselected before the undo, nothing is selected after it', () => {
    const { e } = graph()
    select([], [e])
    edit(e, '3') // the entry holds e selected
    select([], [])
    S().undo()
    expect(flagged()).toEqual([])
    S().redo()
    expect(flagged()).toEqual([])
  })

  it('a selection made after the undo is the only one', () => {
    const { a, b, e } = graph()
    select([a], [e])
    edit(e, '3')
    S().undo()
    select([b], [])
    expect(flagged()).toEqual([b])
    expect([S().selectedNodeId, S().selectedEdgeId]).toEqual([b, null])
  })

  it('clearing the flags is no history entry and no document change; an unselected element keeps its object', () => {
    const { a, b, e } = graph()
    select([a], [e])
    edit(e, '3')
    const entry = S().past[S().past.length - 1]!
    const [p, f] = [S().past.length, S().future.length]
    S().undo()
    expect([S().past.length, S().future.length]).toEqual([p - 1, f + 1])
    expect(serialize(S().nodes, S().edges)).toBe(serialize(entry.nodes, entry.edges))
    expect(S().nodes.find((n) => n.id === b), 'not selected: the same object as in the entry').toBe(entry.nodes.find((n) => n.id === b))
    expect(S().edges.find((x) => x.id === e)).toEqual({ ...entry.edges.find((x) => x.id === e)!, selected: false })
  })
})

const pool = (id: string): LoopNode =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as LoopNode
const ids = () => [S().selectedNodeId, S().selectedEdgeId]

describe('a module insert restores its own selection (§MS3.5)', () => {
  it('undo brings back the selection from before the insert, redo the inserted set — flags and ids together', () => {
    const { a, e } = graph()
    select([a], [])
    const r = S().insertModule({ nodes: [pool('m1'), pool('m2')], edges: [], modelVersion: 1 }, { at: { x: 600, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const inserted = [...r.insertedNodeIds].sort()
    expect([...flagged()].sort()).toEqual(inserted)
    S().undo()
    expect(flagged()).toEqual([a])
    expect(ids()).toEqual([a, null])
    S().redo()
    expect([...flagged()].sort()).toEqual(inserted)
    expect(ids(), 'two inserted nodes: no single one in the Inspector, as after the insert itself').toEqual([null, null])
    // the step keeps its selection however often it is undone and redone
    S().undo()
    expect(flagged()).toEqual([a])
    S().redo()
    expect([...flagged()].sort()).toEqual(inserted)
    // a connection selected before the insert: not left marked beside the block,
    // and its undo selects it again
    S().undo()
    select([], [e])
    const one = S().insertModule({ nodes: [pool('m3')], edges: [], modelVersion: 1 }, { at: { x: 600, y: 300 } })
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(flagged()).toEqual([one.insertedNodeIds[0]])
    expect(ids()).toEqual([one.insertedNodeIds[0], null])
    S().undo()
    expect(flagged()).toEqual([e])
    expect(ids()).toEqual([null, e])
    S().redo()
    expect(ids()).toEqual([one.insertedNodeIds[0], null])
  })

  it('only the insert step restores a selection: an ordinary step before or after it still ends with nothing selected', () => {
    const { a, e } = graph()
    select([a], [e])
    edit(e, '3')
    const r = S().insertModule({ nodes: [pool('m1')], edges: [], modelVersion: 1 }, { at: { x: 600, y: 0 } })
    expect(r.ok).toBe(true)
    edit(e, '4') // an ordinary step after the insert, the inserted node selected
    S().undo()
    expect(flagged(), 'undoing the ordinary step').toEqual([])
    S().undo()
    expect(flagged(), 'undoing the insert: the selection before it').toEqual([a, e])
    expect(ids()).toEqual([a, e])
    S().undo()
    expect(flagged(), 'undoing the edit before the insert').toEqual([])
    S().redo()
    expect(flagged()).toEqual([])
    S().redo()
    expect(flagged()).toEqual(r.ok ? [...r.insertedNodeIds] : [])
    S().redo()
    expect(flagged()).toEqual([])
  })
})
