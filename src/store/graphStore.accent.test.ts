import { beforeEach, describe, expect, it } from 'vitest'
import { serialize } from '../model/serialize'
import { accentTargets, onlyAccentsDiffer, useGraphStore } from './graphStore'

// docs/flow-colour-and-compact-nodes.md FC-2.4 / FC-5 — a flow colour is one
// undo entry, never a simulation change, and applies to what is selected.

const S = () => useGraphStore.getState()
const rev = () => S().simulationRev
const accentOf = (data: unknown) => (data as { accent?: unknown } | undefined)?.accent

function three() {
  S().newGraph()
  S().addNodeAt('source', { x: 0, y: 0 })
  S().addNodeAt('pool', { x: 200, y: 0 })
  S().addNodeAt('drain', { x: 400, y: 0 })
  const [a, b, c] = S().nodes
  S().onConnect({ source: a!.id, target: b!.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  S().onConnect({ source: b!.id, target: c!.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  // the last palette add is marked selected; start from nothing marked, as a
  // click on empty canvas leaves it
  S().onNodesChange(S().nodes.filter((n) => n.selected).map((n) => ({ id: n.id, type: 'select' as const, selected: false })))
  return { a: a!.id, b: b!.id, c: c!.id, e1: S().edges[0]!.id, e2: S().edges[1]!.id }
}

beforeEach(() => S().newGraph())

describe('setAccent', () => {
  it('colours several nodes and edges as ONE undo entry, with no simulation change', () => {
    const { a, b, e1 } = three()
    const r = rev()
    const past = S().past.length
    S().setAccent([a, b], [e1], '#638ea5')
    expect(S().past.length).toBe(past + 1)
    expect(rev()).toBe(r)
    expect(accentOf(S().nodes.find((n) => n.id === a)!.data)).toBe('#638EA5')
    expect(accentOf(S().nodes.find((n) => n.id === b)!.data)).toBe('#638EA5')
    expect(accentOf(S().edges.find((e) => e.id === e1)!.data)).toBe('#638EA5')
  })

  it('undo and redo restore each element’s previous colour or its absence, and never bump the run', () => {
    const { a, b, e1 } = three()
    S().setAccent([a], [], '#B47599')
    S().setAccent([a, b], [e1], '#74906B')
    const r = rev()
    S().undo()
    expect(accentOf(S().nodes.find((n) => n.id === a)!.data)).toBe('#B47599')
    expect('accent' in S().nodes.find((n) => n.id === b)!.data).toBe(false)
    expect('accent' in (S().edges.find((e) => e.id === e1)!.data as object)).toBe(false)
    S().redo()
    expect(accentOf(S().nodes.find((n) => n.id === b)!.data)).toBe('#74906B')
    expect(rev()).toBe(r)
  })

  it('null removes the key (Default), and re-applying the current colour adds no entry', () => {
    const { a } = three()
    S().setAccent([a], [], '#A78243')
    const past = S().past.length
    S().setAccent([a], [], '#a78243')
    expect(S().past.length).toBe(past)
    S().setAccent([a], [], null)
    expect('accent' in S().nodes.find((n) => n.id === a)!.data).toBe(false)
    expect(S().past.length).toBe(past + 1)
  })

  it('an invalid value is refused: nothing changes, no entry', () => {
    const { a } = three()
    const past = S().past.length
    const before = S().nodes
    S().setAccent([a], [], 'red')
    S().setAccent([a], [], '#3a7bd580')
    expect(S().nodes).toBe(before)
    expect(S().past.length).toBe(past)
  })

  it('updateNodeData / setEdgeData with only `accent` are no simulation change either', () => {
    const { a, e1 } = three()
    const r = rev()
    S().updateNodeData(a, { accent: '#638EA5' })
    const ed = S().edges.find((e) => e.id === e1)!.data!
    S().setEdgeData(e1, { ...ed, accent: '#638EA5' })
    expect(rev()).toBe(r)
    // …but a real change still is
    S().updateNodeData(a, { accent: '#74906B', activation: 'passive' })
    expect(rev()).toBeGreaterThan(r)
  })

  it('undoing a model change still bumps the run, even when a colour changed with it', () => {
    const { b } = three()
    S().updateNodeData(b, { capacity: 9 })
    const r = rev()
    S().undo()
    expect(rev()).toBeGreaterThan(r)
  })
})

describe('onlyAccentsDiffer', () => {
  // #391 — the question is "does anything the engine reads differ?": an
  // accent-only difference, a position-only one and two identical graphs all
  // answer no (true); a label, a data field or an element answers yes (false)
  it('true when nothing the engine reads differs — accent, position or nothing at all; false for a label, a field or an element', () => {
    three()
    const a = { nodes: S().nodes, edges: S().edges, modelVersion: S().modelVersion }
    expect(onlyAccentsDiffer(a, a), 'identical').toBe(true)
    const n0 = a.nodes[0]!
    const recoloured = { ...a, nodes: [{ ...n0, data: { ...n0.data, accent: '#638EA5' } }, ...a.nodes.slice(1)] }
    expect(onlyAccentsDiffer(a, recoloured)).toBe(true)
    const moved = { ...a, nodes: [{ ...n0, position: { x: 5, y: 5 }, data: { ...n0.data, accent: '#638EA5' } }, ...a.nodes.slice(1)] }
    expect(onlyAccentsDiffer(a, moved), 'a position is layout, not model').toBe(true)
    const relabelled = { ...a, nodes: [{ ...n0, data: { ...n0.data, label: 'x', accent: '#638EA5' } }, ...a.nodes.slice(1)] }
    expect(onlyAccentsDiffer(a, relabelled)).toBe(false)
    expect(onlyAccentsDiffer(a, { ...a, edges: a.edges.slice(1) })).toBe(false)
  })
})

describe('accentTargets — condition 1: the selection model is unchanged', () => {
  it('React Flow’s selected flags, nodes and edges', () => {
    const { a, b, e2 } = three()
    const nodes = S().nodes.map((n) => (n.id === a || n.id === b ? { ...n, selected: true } : n))
    const edges = S().edges.map((e) => (e.id === e2 ? { ...e, selected: true } : e))
    expect(accentTargets({ nodes, edges, selectedNodeId: a, selectedEdgeId: null })).toEqual({ nodeIds: [a, b], edgeIds: [e2] })
  })
  it('with no flag, the one element the Inspector shows', () => {
    const { b, e1 } = three()
    expect(accentTargets({ nodes: S().nodes, edges: S().edges, selectedNodeId: b, selectedEdgeId: null })).toEqual({ nodeIds: [b], edgeIds: [] })
    expect(accentTargets({ nodes: S().nodes, edges: S().edges, selectedNodeId: null, selectedEdgeId: e1 })).toEqual({ nodeIds: [], edgeIds: [e1] })
    expect(accentTargets({ nodes: S().nodes, edges: S().edges, selectedNodeId: 'gone', selectedEdgeId: null })).toEqual({ nodeIds: [], edgeIds: [] })
  })
  it('the flags never reach the saved document', () => {
    three()
    const nodes = S().nodes.map((n) => ({ ...n, selected: true }))
    const edges = S().edges.map((e) => ({ ...e, selected: true }))
    expect(serialize(nodes, edges)).not.toContain('selected')
  })
})

describe('a node added from the palette is the selection the colour applies to', () => {
  const targets = () => accentTargets(S())
  const marked = () => S().nodes.filter((n) => n.selected).map((n) => n.id)

  it('A dragged (marked) → B added → the colour goes to B, and undo takes it back', () => {
    S().addNodeAt('pool', { x: 0, y: 0 })
    const a = S().nodes[0]!.id
    // a drag leaves React Flow marking the dragged node
    S().onNodesChange([{ id: a, type: 'select', selected: true }])
    expect(marked()).toEqual([a])
    S().addNodeAt('drain', { x: 300, y: 0 })
    const b = S().nodes[1]!.id
    expect(S().selectedNodeId).toBe(b)
    expect(marked()).toEqual([b])
    expect(targets()).toEqual({ nodeIds: [b], edgeIds: [] })
    S().setAccent(targets().nodeIds, targets().edgeIds, '#A78243')
    expect(accentOf(S().nodes.find((n) => n.id === b)!.data)).toBe('#A78243')
    expect('accent' in S().nodes.find((n) => n.id === a)!.data).toBe(false)
    S().undo()
    expect('accent' in S().nodes.find((n) => n.id === b)!.data).toBe(false)
    S().undo()
    expect(S().nodes.map((n) => n.id)).toEqual([a])
  })

  it('a marked connection is cleared too, and a multi-selection made afterwards still colours every member', () => {
    const { a, b, c, e1 } = three()
    S().onEdgesChange([{ id: e1, type: 'select', selected: true }])
    S().addNodeAt('end', { x: 600, y: 0 })
    const d = S().nodes[3]!.id
    expect(S().edges.filter((e) => e.selected)).toHaveLength(0)
    expect(targets()).toEqual({ nodeIds: [d], edgeIds: [] })
    // Ctrl-click style multi-selection, then one colour for all
    S().onNodesChange([{ id: a, type: 'select', selected: true }, { id: c, type: 'select', selected: true }, { id: d, type: 'select', selected: false }])
    S().onEdgesChange([{ id: e1, type: 'select', selected: true }])
    expect(targets()).toEqual({ nodeIds: [a, c], edgeIds: [e1] })
    S().setAccent(targets().nodeIds, targets().edgeIds, '#74906B')
    for (const id of [a, c]) expect(accentOf(S().nodes.find((n) => n.id === id)!.data)).toBe('#74906B')
    expect('accent' in S().nodes.find((n) => n.id === b)!.data).toBe(false)
    expect(accentOf(S().edges.find((e) => e.id === e1)!.data)).toBe('#74906B')
  })
})
