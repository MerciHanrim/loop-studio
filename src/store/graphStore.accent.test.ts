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
  S().onConnect({ source: a!.id, target: b!.id, sourceHandle: 'out', targetHandle: 'in' })
  S().onConnect({ source: b!.id, target: c!.id, sourceHandle: 'out', targetHandle: 'in' })
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
  it('true only when an accent differs and nothing else does', () => {
    three()
    const a = { nodes: S().nodes, edges: S().edges, modelVersion: S().modelVersion }
    expect(onlyAccentsDiffer(a, a)).toBe(false)
    const n0 = a.nodes[0]!
    const recoloured = { ...a, nodes: [{ ...n0, data: { ...n0.data, accent: '#638EA5' } }, ...a.nodes.slice(1)] }
    expect(onlyAccentsDiffer(a, recoloured)).toBe(true)
    const moved = { ...a, nodes: [{ ...n0, position: { x: 5, y: 5 }, data: { ...n0.data, accent: '#638EA5' } }, ...a.nodes.slice(1)] }
    expect(onlyAccentsDiffer(a, moved)).toBe(false)
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
