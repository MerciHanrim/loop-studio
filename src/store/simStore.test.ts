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
    useGraphStore.getState().loadGraph(TEMPLATES[0].graph, { canvasLocked: false })
    expect(sim().triggerQueue).toEqual([])
    expect(sim().stepIndex).toBe(0)
  })
})

describe('timelineSeries — the Timeline default visible set (UI-only)', () => {
  const s = () => useSimStore.getState()

  it('defaults to "auto" — the automatic default, not a stored choice', () => {
    expect(s().timelineSeries).toBe('auto')
  })

  it('setTimelineSeries: undefined / empty ⇒ "auto"; "all" stays "all"; an array is sorted + de-duped', () => {
    s().setTimelineSeries(['b', 'a', 'a', 'c'])
    expect(s().timelineSeries).toEqual(['a', 'b', 'c'])
    s().setTimelineSeries([])
    expect(s().timelineSeries).toBe('auto')
    s().setTimelineSeries(['x'])
    expect(s().timelineSeries).toEqual(['x'])
    s().setTimelineSeries('all')
    expect(s().timelineSeries).toBe('all')
    s().setTimelineSeries(undefined)
    expect(s().timelineSeries).toBe('auto')
  })

  it('setTimelineSeries drops non-strings, keeps unknown ids verbatim', () => {
    s().setTimelineSeries(['ghost', 'level', 2 as unknown as string, null as unknown as string])
    expect(s().timelineSeries).toEqual(['ghost', 'level'])
  })

  // docs/timeline-series-contract.md §6.1 (decided 2026-10-01): re-selecting
  // every series by hand is an EXPLICIT choice of the series that exist now.
  // It never collapses to 'all' — 'all' (future series included) is reached
  // only through the named "show all" action (`setTimelineSeries('all')`).
  it('toggleTimelineSeries flips one id; re-selecting every series stores the explicit array, NOT "all"', () => {
    const shown = ['a', 'b', 'c']
    s().setTimelineSeries(['a', 'b', 'c'])
    expect(s().toggleTimelineSeries('b', shown)).toBe(true) // hide b
    expect(s().timelineSeries).toEqual(['a', 'c'])
    expect(s().toggleTimelineSeries('b', ['a', 'c'])).toBe(true) // show b again ⇒ every id on
    expect(s().timelineSeries).toEqual(['a', 'b', 'c'])
    expect(s().timelineSeries).not.toBe('all')
  })

  it('toggleTimelineSeries from "all" starts an explicit list minus the toggled id', () => {
    const shown = ['a', 'b', 'c'] // 'all' resolves to every id — the caller passes the resolved set
    s().setTimelineSeries('all')
    s().toggleTimelineSeries('c', shown)
    expect(s().timelineSeries).toEqual(['a', 'b'])
  })

  it('toggleTimelineSeries from "auto" works on the RESOLVED (capped) set the caller passes, not every id', () => {
    s().setTimelineSeries(undefined)
    expect(s().timelineSeries).toBe('auto')
    // auto drew the first 8 of many; hiding one leaves the other seven — not "every id minus one"
    const drawn = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']
    s().toggleTimelineSeries('s2', drawn)
    expect(s().timelineSeries).toEqual(['s0', 's1', 's3', 's4', 's5', 's6', 's7'])
  })

  it('toggleTimelineSeries stores the list SORTED and de-duplicated, whatever order the view passed', () => {
    s().setTimelineSeries(undefined)
    s().toggleTimelineSeries('x', ['z', 'm', 'z'])
    expect(s().timelineSeries).toEqual(['m', 'x', 'z'])
  })

  // §6.2 — at least one series while one is eligible. The guard is in the
  // store so the legend chip and the selector checkbox cannot disagree.
  it('toggleTimelineSeries REFUSES to hide the last drawn series: returns false, changes nothing, writes nothing', () => {
    s().setTimelineSeries(['only'])
    expect(s().toggleTimelineSeries('only', ['only'])).toBe(false)
    expect(s().timelineSeries).toEqual(['only'])
  })

  it('…and the refusal holds from "all" / "auto" too when the resolved set has one member', () => {
    s().setTimelineSeries('all')
    expect(s().toggleTimelineSeries('p', ['p'])).toBe(false)
    expect(s().timelineSeries).toBe('all')
    s().setTimelineSeries(undefined)
    expect(s().toggleTimelineSeries('p', ['p'])).toBe(false)
    expect(s().timelineSeries).toBe('auto')
  })
})

// The current selection is mirrored into the graph autosave record immediately —
// no graph edit and no debounce needed — so a plain reload restores it. "auto"
// clears the field; "all" and a list write it. (serialize.ts owns the record shape.)
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
    useSimStore.getState().setTimelineSeries(undefined) // selection back to 'auto'
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

  it('toggleTimelineSeries writes on every accepted flip; re-selecting every series writes the explicit array, never "all"', () => {
    s().toggleTimelineSeries('a', ['a', 'b']) // ⇒ ['b']
    expect(rec().recommendedRunConfig).toEqual({ timelineSeries: ['b'] })
    s().toggleTimelineSeries('a', ['b']) // every id on again ⇒ the explicit pair (§6.1, decision A)
    expect(s().timelineSeries).toEqual(['a', 'b'])
    expect(rec().recommendedRunConfig).toEqual({ timelineSeries: ['a', 'b'] })
  })

  it('a REFUSED toggle (last drawn series) writes nothing at all', () => {
    s().setTimelineSeries(['a'])
    const before = localStorage.getItem(STORAGE_KEY)
    expect(s().toggleTimelineSeries('a', ['a'])).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it("setTimelineSeries('all') writes the field; setTimelineSeries(undefined) ⇒ 'auto' clears it", () => {
    s().setTimelineSeries(['p1'])
    expect(rec().recommendedRunConfig.timelineSeries).toEqual(['p1'])
    s().setTimelineSeries('all')
    expect(s().timelineSeries).toBe('all')
    expect(rec().recommendedRunConfig).toEqual({ timelineSeries: 'all' })
    s().setTimelineSeries(undefined)
    expect(s().timelineSeries).toBe('auto')
    expect(rec()).not.toHaveProperty('recommendedRunConfig')
  })

  it('the autosave write never adds canvasLocked or MC fields', () => {
    s().setTimelineSeries(['p1'])
    expect(Object.keys(rec().recommendedRunConfig)).toEqual(['timelineSeries'])
  })
})

// docs/simulation-playback-ordering.md §PBO5 — steady-state detection.
describe('steadyState — §PBO5', () => {
  /** Source ─N→ Pool ─all→ Drain — settles to a fixed point after the drain
   *  starts pulling; from then on pools + flow are constant every step. */
  function fixedPointGraph(n = 4) {
    const g = useGraphStore.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 200, y: 0 })
    g.addNodeAt('drain', { x: 400, y: 0 })
    const [src, pool, drn] = useGraphStore.getState().nodes
    const gs = useGraphStore.getState()
    gs.onConnect({ source: src.id, target: pool.id, sourceHandle: 'out', targetHandle: 'in' })
    gs.onConnect({ source: pool.id, target: drn.id, sourceHandle: 'out', targetHandle: 'in' })
    const edges = useGraphStore.getState().edges
    const sp = edges.find((e) => e.source === src.id)!
    const pd = edges.find((e) => e.source === pool.id)!
    useGraphStore.getState().setEdgeData(sp.id, { kind: 'resource', flow: String(n) })
    useGraphStore.getState().setEdgeData(pd.id, { kind: 'resource', flow: 'all' })
    return { srcId: src.id, poolId: pool.id }
  }

  /** advance until steady (bounded), returning the committed step it flipped on */
  function runToSteady(max = 10) {
    for (let i = 1; i <= max; i++) {
      sim().advance()
      if (sim().steadyState) return i
    }
    return -1
  }

  it('cannot be steady before 3 committed steps; becomes true at a fixed point and holds', () => {
    fixedPointGraph()
    expect(sim().steadyState).toBe(false)
    sim().advance()
    sim().advance()
    expect(sim().steadyState).toBe(false) // only 2 samples — never enough
    expect(runToSteady()).toBeGreaterThan(0) // reaches steady
    sim().advance()
    sim().advance()
    expect(sim().steadyState).toBe(true) // holds across further steps
  })

  it('a simulation-relevant graph edit clears the window and the verdict', () => {
    const { poolId } = fixedPointGraph()
    expect(runToSteady()).toBeGreaterThan(0)
    // change the inflow expression — a real simulationRev bump → sim resets
    const spId = useGraphStore.getState().edges.find((e) => e.target === poolId)!.id
    useGraphStore.getState().setEdgeData(spId, { kind: 'resource', flow: '7' })
    expect(sim().steadyState).toBe(false)
    expect(sim().stepIndex).toBe(0) // the sim reset too
  })

  it('reset() and setSeed() both clear it', () => {
    fixedPointGraph()
    expect(runToSteady()).toBeGreaterThan(0)
    sim().reset()
    expect(sim().steadyState).toBe(false)

    expect(runToSteady()).toBeGreaterThan(0)
    sim().setSeed(sim().seed + 1)
    expect(sim().steadyState).toBe(false)
  })

  it('a prepared step that fails the commit ladder never enters the window', () => {
    fixedPointGraph()
    expect(runToSteady()).toBeGreaterThan(0)
    const p = sim().armPrepared(sim().prepareTransition())
    sim().reset() // bumps commitEpoch, empties the window + clears the flag
    expect(sim().commitPrepared(p)).not.toBe('committed')
    expect(sim().steadyState).toBe(false)
  })

  it('is not steady while flow continues but a pool balance is still climbing', () => {
    // Source ─2→ Pool(cap 100), no outflow: pool rises 2 per step forever
    const g = useGraphStore.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 200, y: 0 })
    const [src, pool] = useGraphStore.getState().nodes
    useGraphStore.getState().updateNodeData(pool.id, { capacity: 100 })
    useGraphStore
      .getState()
      .onConnect({ source: src.id, target: pool.id, sourceHandle: 'out', targetHandle: 'in' })
    const e = useGraphStore.getState().edges[0]
    useGraphStore.getState().setEdgeData(e.id, { kind: 'resource', flow: '2' })
    for (let i = 0; i < 6; i++) sim().advance()
    expect(sim().steadyState).toBe(false) // pool vector keeps changing
  })
})
