import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY, serialize } from '../model/serialize'
import { TEMPLATES } from '../model/templates'
import { useGraphStore } from './graphStore'
import { useSimStore } from './simStore'

// SEMANTICS-S.md loop-state/1 §S8 — the state trigger queue lives in the sim
// state and must be cleared on Reset and on every simulation-relevant graph
// change (edit / undo / redo / import / template swap), never carried across.

/** Source ─2→ Pool ; Source ┄trigger d0┄> Drain(passive) ─1← Pool */
function triggerGraph() {
  const g = useGraphStore.getState()
  g.newGraph()
  g.addNodeAt('source', { x: 0, y: 0 })
  g.addNodeAt('pool', { x: 200, y: 0 })
  g.addNodeAt('drain', { x: 400, y: 0 })
  const [s, p, d] = useGraphStore.getState().nodes
  useGraphStore.getState().updateNodeData(d.id, { activation: 'passive' })
  const gs = useGraphStore.getState()
  gs.onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' })
  gs.onConnect({ source: p.id, target: d.id, sourceHandle: 'out', targetHandle: 'in' })
  gs.onConnect({ source: s.id, target: d.id, sourceHandle: 'state-source', targetHandle: 'state-target' })
  const res = useGraphStore.getState().edges.find((e) => e.source === s.id && e.target === p.id)!
  useGraphStore.getState().setEdgeData(res.id, { kind: 'resource', flow: '2' })
  return { sourceId: s.id, poolId: p.id, drainId: d.id }
}

const sim = () => useSimStore.getState()

beforeEach(() => {
  useSimStore.getState().reset()
  useGraphStore.getState().newGraph()
})

describe('simStore carries the trigger queue', () => {
  it('a step through a trigger graph populates triggerQueue', () => {
    const { drainId } = triggerGraph()
    sim().stepOnce()
    expect(sim().stepIndex).toBe(1)
    expect(sim().triggerQueue).toEqual([
      { edgeId: expect.any(String), target: drainId, deliveryStep: 2 },
    ])
    expect(sim().firedNodeIds.length).toBeGreaterThan(0)
  })

  it('reset() clears triggerQueue and firedNodeIds', () => {
    triggerGraph()
    sim().stepOnce()
    expect(sim().triggerQueue.length).toBe(1)
    sim().reset()
    expect(sim().triggerQueue).toEqual([])
    expect(sim().firedNodeIds).toEqual([])
    expect(sim().stepIndex).toBe(0)
  })
})

describe('a simulation-relevant graph change discards the pending queue', () => {
  const armQueue = () => {
    triggerGraph()
    sim().stepOnce()
    sim().stepOnce()
    expect(sim().triggerQueue.length).toBeGreaterThan(0)
  }

  it('a structural node-data edit (capacity)', () => {
    armQueue()
    const poolId = useGraphStore.getState().nodes.find((n) => n.data.kind === 'pool')!.id
    useGraphStore.getState().updateNodeData(poolId, { capacity: 10 })
    expect(sim().triggerQueue).toEqual([])
    expect(sim().stepIndex).toBe(0)
  })

  it('undo', () => {
    armQueue()
    const poolId = useGraphStore.getState().nodes.find((n) => n.data.kind === 'pool')!.id
    useGraphStore.getState().updateNodeData(poolId, { capacity: 10 })
    sim().stepOnce()
    expect(sim().triggerQueue.length).toBeGreaterThan(0)
    useGraphStore.getState().undo()
    expect(sim().triggerQueue).toEqual([])
  })

  it('redo', () => {
    armQueue()
    const poolId = useGraphStore.getState().nodes.find((n) => n.data.kind === 'pool')!.id
    useGraphStore.getState().updateNodeData(poolId, { capacity: 10 })
    useGraphStore.getState().undo()
    sim().stepOnce()
    expect(sim().triggerQueue.length).toBeGreaterThan(0)
    useGraphStore.getState().redo()
    expect(sim().triggerQueue).toEqual([])
  })

  it('Import (loadJSON)', () => {
    armQueue()
    const doc = serialize(useGraphStore.getState().nodes, useGraphStore.getState().edges)
    // re-arm on a fresh graph, then import over it
    triggerGraph()
    sim().stepOnce()
    sim().stepOnce()
    expect(sim().triggerQueue.length).toBeGreaterThan(0)
    useGraphStore.getState().loadJSON(doc)
    expect(sim().triggerQueue).toEqual([])
    expect(sim().stepIndex).toBe(0)
  })

  it('template swap (loadGraph)', () => {
    armQueue()
    useGraphStore.getState().loadGraph(TEMPLATES[0].graph)
    expect(sim().triggerQueue).toEqual([])
    expect(sim().stepIndex).toBe(0)
  })
})

describe('timelineSeries — the Timeline default visible set (UI-only)', () => {
  const s = () => useSimStore.getState()

  it('defaults to "all"', () => {
    expect(s().timelineSeries).toBe('all')
  })

  it('setTimelineSeries: undefined / empty ⇒ "all"; an array is sorted + de-duped', () => {
    s().setTimelineSeries(['b', 'a', 'a', 'c'])
    expect(s().timelineSeries).toEqual(['a', 'b', 'c'])
    s().setTimelineSeries([])
    expect(s().timelineSeries).toBe('all')
    s().setTimelineSeries(['x'])
    expect(s().timelineSeries).toEqual(['x'])
    s().setTimelineSeries(undefined)
    expect(s().timelineSeries).toBe('all')
  })

  it('setTimelineSeries drops non-strings, keeps unknown ids verbatim', () => {
    s().setTimelineSeries(['ghost', 'level', 2 as unknown as string, null as unknown as string])
    expect(s().timelineSeries).toEqual(['ghost', 'level'])
  })

  it('toggleTimelineSeries flips one id and collapses back to "all"', () => {
    const all = ['a', 'b', 'c']
    s().setTimelineSeries(['a', 'b', 'c'])
    s().toggleTimelineSeries('b', all) // hide b
    expect(s().timelineSeries).toEqual(['a', 'c'])
    s().toggleTimelineSeries('b', all) // show b again ⇒ every id on ⇒ "all"
    expect(s().timelineSeries).toBe('all')
  })

  it('toggleTimelineSeries from "all" starts an explicit list minus the toggled id', () => {
    const all = ['a', 'b', 'c']
    expect(s().timelineSeries).toBe('all')
    s().toggleTimelineSeries('c', all)
    expect(s().timelineSeries).toEqual(['a', 'b'])
  })
})

// The current selection is mirrored into the graph autosave record immediately —
// no graph edit and no debounce needed — so a plain reload restores it. Toggling
// back to "all" clears the field. (serialize.ts owns the record shape.)
describe('timelineSeries — immediate autosave into the graph record', () => {
  class MemStorage {
    m = new Map<string, string>()
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
    setItem(k: string, v: string) { this.m.set(k, String(v)) }
    removeItem(k: string) { this.m.delete(k) }
    clear() { this.m.clear() }
    key(i: number) { return [...this.m.keys()][i] ?? null }
    get length() { return this.m.size }
  }
  const rec = () => {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  }
  const s = () => useSimStore.getState()

  beforeEach(() => {
    vi.useFakeTimers() // neutralise the graphStore `persist()` debounce
    vi.stubGlobal('localStorage', new MemStorage())
    useGraphStore.getState().newGraph()
    useGraphStore.getState().addNodeAt('pool', { x: 0, y: 0 })
    useSimStore.getState().setTimelineSeries(undefined) // selection back to 'all'
    localStorage.clear() // start from a known-empty record
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('setTimelineSeries writes the selection with NO intervening graph edit', () => {
    s().setTimelineSeries(['p1'])
    expect(rec().recommendedRunConfig).toEqual({ timelineSeries: ['p1'] })
    // the record is a full graph record, not a stray fragment
    expect(Array.isArray(rec().nodes)).toBe(true)
  })

  it('toggleTimelineSeries writes on every flip; collapsing to "all" clears the field', () => {
    const all = ['a', 'b']
    s().toggleTimelineSeries('a', all) // ⇒ ['b']
    expect(rec().recommendedRunConfig).toEqual({ timelineSeries: ['b'] })
    s().toggleTimelineSeries('a', all) // every id on again ⇒ 'all'
    expect(rec()).not.toHaveProperty('recommendedRunConfig')
  })

  it('an explicit setTimelineSeries(undefined) — user chose "all" — also clears the field', () => {
    s().setTimelineSeries(['p1'])
    expect(rec().recommendedRunConfig.timelineSeries).toEqual(['p1'])
    s().setTimelineSeries(undefined)
    expect(rec()).not.toHaveProperty('recommendedRunConfig')
  })

  it('the autosave write never adds canvasLocked or MC fields', () => {
    s().setTimelineSeries(['p1'])
    expect(Object.keys(rec().recommendedRunConfig)).toEqual(['timelineSeries'])
  })
})
