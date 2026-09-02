import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphStore } from '../store/graphStore'
import { STORAGE_KEY, deserialize, loadFromStorage, normalizeGraph, saveToStorage, serialize } from './serialize'
import type { GraphDoc } from './serialize'
import type { LoopEdge, LoopNode } from './types'

// ── helpers ────────────────────────────────────────────────────────────────
const doc = (nodes: Partial<LoopNode>[], edges: Partial<LoopEdge>[]): string =>
  JSON.stringify({
    schema: 'loop-studio/graph',
    version: 1,
    nodes,
    edges,
  } as unknown as GraphDoc)

const n = (id: string, kind: LoopNode['type']): Partial<LoopNode> => ({
  id,
  type: kind,
  position: { x: 0, y: 0 },
  data: { kind, label: id } as LoopNode['data'],
})

// ── handle-id migration ────────────────────────────────────────────────────
describe('resource handle ids', () => {
  it('a connection from the right circle is stored as sourceHandle "out"', () => {
    const g = useGraphStore.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 200, y: 0 })
    const [src, pool] = useGraphStore.getState().nodes
    useGraphStore
      .getState()
      .onConnect({ source: src.id, target: pool.id, sourceHandle: 'out', targetHandle: 'in' })
    const edge = useGraphStore.getState().edges.at(-1)!
    expect(edge.sourceHandle).toBe('out')
    expect(edge.data).toMatchObject({ kind: 'resource' })
  })

  it('a connection into the left circle is stored as targetHandle "in"', () => {
    const g = useGraphStore.getState()
    g.newGraph()
    g.addNodeAt('source', { x: 0, y: 0 })
    g.addNodeAt('gate', { x: 200, y: 0 })
    const [src, gate] = useGraphStore.getState().nodes
    // React Flow can report a null handle when the port carries no id; the
    // store must still pin a resource edge to the side ports.
    useGraphStore
      .getState()
      .onConnect({ source: src.id, target: gate.id, sourceHandle: null, targetHandle: null })
    const edge = useGraphStore.getState().edges.at(-1)!
    expect(edge.sourceHandle).toBe('out')
    expect(edge.targetHandle).toBe('in')
  })

  it('null / undefined / "" handles in a loaded file all recover to out/in', () => {
    const { edges } = deserialize(
      doc(
        [n('s', 'source'), n('p', 'pool')],
        [
          { id: 'e-null', source: 's', target: 'p', sourceHandle: null, targetHandle: null, data: { kind: 'resource', flow: '1' } },
          { id: 'e-empty', source: 's', target: 'p', sourceHandle: '', targetHandle: '', data: { kind: 'resource', flow: '2' } },
          { id: 'e-missing', source: 's', target: 'p', data: { kind: 'resource', flow: '3' } },
        ] as unknown as Partial<LoopEdge>[],
      ),
    )
    for (const e of edges) {
      expect(e.sourceHandle).toBe('out')
      expect(e.targetHandle).toBe('in')
    }
    expect(edges.map((e) => (e.data as { flow: string }).flow)).toEqual(['1', '2', '3'])
  })

  it('explicit state handles survive import and are never rewritten to out/in', () => {
    const { edges } = deserialize(
      doc(
        [n('p', 'pool'), n('g', 'gate')],
        [
          {
            id: 's1',
            source: 'p',
            target: 'g',
            sourceHandle: 'state-source',
            targetHandle: 'state-target',
            data: { kind: 'state', mode: 'trigger', expr: '' },
          },
        ] as unknown as Partial<LoopEdge>[],
      ),
    )
    expect(edges[0].sourceHandle).toBe('state-source')
    expect(edges[0].targetHandle).toBe('state-target')
    expect(edges[0].data).toMatchObject({ kind: 'state' })
  })

  it('a state edge with one blank handle fills the state default, not out/in', () => {
    const { edges } = deserialize(
      doc(
        [n('p', 'pool'), n('g', 'gate')],
        [
          {
            id: 's1',
            source: 'p',
            target: 'g',
            sourceHandle: 'state-source',
            targetHandle: null,
            data: { kind: 'state', mode: 'trigger', expr: '' },
          },
        ] as unknown as Partial<LoopEdge>[],
      ),
    )
    expect(edges[0].sourceHandle).toBe('state-source')
    expect(edges[0].targetHandle).toBe('state-target')
  })

  it('import → export → import keeps every handle id', () => {
    const first = deserialize(
      doc(
        [n('s', 'source'), n('p', 'pool'), n('g', 'gate')],
        [
          { id: 'r1', source: 's', target: 'p', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
          { id: 'x1', source: 'p', target: 'g', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '' } },
        ] as unknown as Partial<LoopEdge>[],
      ),
    )
    const round = deserialize(serialize(first.nodes, first.edges))
    expect(round.edges.map((e) => [e.id, e.sourceHandle, e.targetHandle])).toEqual([
      ['r1', 'out', 'in'],
      ['x1', 'state-source', 'state-target'],
    ])
  })

  it('a trigger `delay` survives import → export → import; a mode with no delay stays clean', () => {
    const first = deserialize(
      doc(
        [n('s', 'source'), n('d', 'drain'), n('p', 'pool'), n('g', 'gate')],
        [
          { id: 'td', source: 's', target: 'd', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'trigger', expr: '', delay: 2 } },
          { id: 'ac', source: 'p', target: 'g', sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode: 'activator', expr: '>= 5' } },
        ] as unknown as Partial<LoopEdge>[],
      ),
    )
    const round = deserialize(serialize(first.nodes, first.edges))
    expect(round.edges.find((e) => e.id === 'td')?.data).toEqual({ kind: 'state', mode: 'trigger', expr: '', delay: 2 })
    expect(round.edges.find((e) => e.id === 'ac')?.data).toEqual({ kind: 'state', mode: 'activator', expr: '>= 5' })
  })

  it('normalizeGraph backfills a template-style edge with no handles', () => {
    const { edges } = normalizeGraph({
      nodes: [],
      edges: [
        { id: 't', source: 'a', target: 'b', type: 'loop', data: { kind: 'resource', flow: 'all' } } as LoopEdge,
      ],
    })
    expect(edges[0].sourceHandle).toBe('out')
    expect(edges[0].targetHandle).toBe('in')
  })
})

describe('recommendedRunConfig round-trip', () => {
  const g = () => ({ nodes: [n('p', 'pool') as LoopNode], edges: [] as LoopEdge[] })

  it('serialize omits the key when no config is passed', () => {
    expect(JSON.parse(serialize(g().nodes, g().edges))).not.toHaveProperty('recommendedRunConfig')
  })

  it('serialize writes it, deserialize reads it back unchanged', () => {
    const rrc = { baseSeed: 7, runs: 500, steps: 40, tracked: ['p'] }
    const back = deserialize(serialize(g().nodes, g().edges, rrc))
    expect(back.recommendedRunConfig).toEqual(rrc)
  })

  it('a file without the field deserializes with recommendedRunConfig undefined', () => {
    expect(deserialize(doc([n('p', 'pool')], [])).recommendedRunConfig).toBeUndefined()
  })

  it('a non-object recommendedRunConfig value is ignored', () => {
    const bad = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [n('p', 'pool')], edges: [], recommendedRunConfig: [1, 2, 3] })
    expect(deserialize(bad).recommendedRunConfig).toBeUndefined()
  })

  it('Import → Export → Import preserves the metadata', () => {
    const rrc = { baseSeed: 1, runs: 500, steps: 40, tracked: ['p'] }
    const once = deserialize(serialize(g().nodes, g().edges, rrc))
    const twice = deserialize(serialize(once.nodes, once.edges, once.recommendedRunConfig))
    expect(twice.recommendedRunConfig).toEqual(rrc)
  })

  it('timelineSeries (Pool + Register ids) round-trips like any other field', () => {
    const rrc = {
      baseSeed: 1,
      runs: 10,
      steps: 5,
      tracked: ['p'],
      timelineSeries: ['p', 'reg_net', 'reg_share'],
    }
    const once = deserialize(serialize(g().nodes, g().edges, rrc))
    expect(once.recommendedRunConfig).toEqual(rrc)
    const twice = deserialize(serialize(once.nodes, once.edges, once.recommendedRunConfig))
    expect(twice.recommendedRunConfig).toEqual(rrc)
  })

  it('a file with no timelineSeries deserializes without it (older-file behaviour)', () => {
    const back = deserialize(serialize(g().nodes, g().edges, { baseSeed: 2, runs: 3, steps: 3 }))
    expect(back.recommendedRunConfig).not.toHaveProperty('timelineSeries')
  })

  it('canvasLocked round-trips; a file without it deserialises without it', () => {
    const rrc = { baseSeed: 1, runs: 5, steps: 5, canvasLocked: true }
    const once = deserialize(serialize(g().nodes, g().edges, rrc))
    expect(once.recommendedRunConfig).toEqual(rrc)
    const twice = deserialize(serialize(once.nodes, once.edges, once.recommendedRunConfig))
    expect(twice.recommendedRunConfig).toEqual(rrc)
    const plain = deserialize(serialize(g().nodes, g().edges, { baseSeed: 1, runs: 1, steps: 1 }))
    expect(plain.recommendedRunConfig).not.toHaveProperty('canvasLocked')
  })
})

// ── autosave record: only the `timelineSeries` slice of recommendedRunConfig
//    rides `localStorage`; the MC fields + canvasLocked never do ────────────────
describe('saveToStorage / loadFromStorage — the Timeline display default', () => {
  class MemStorage {
    m = new Map<string, string>()
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
    setItem(k: string, v: string) { this.m.set(k, String(v)) }
    removeItem(k: string) { this.m.delete(k) }
    clear() { this.m.clear() }
    key(i: number) { return [...this.m.keys()][i] ?? null }
    get length() { return this.m.size }
  }
  const nodes = [n('p', 'pool') as LoopNode]
  const edges: LoopEdge[] = []

  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('an explicit timelineSeries list is written and comes back on restore', () => {
    saveToStorage(nodes, edges, null, ['p', 'reg_a'])
    const rec = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(rec.recommendedRunConfig).toEqual({ timelineSeries: ['p', 'reg_a'] })
    expect(loadFromStorage()?.recommendedRunConfig?.timelineSeries).toEqual(['p', 'reg_a'])
  })

  it("'all' (the default) writes no recommendedRunConfig at all", () => {
    saveToStorage(nodes, edges, null, 'all')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).not.toHaveProperty('recommendedRunConfig')
    saveToStorage(nodes, edges, null, []) // empty list ⇒ same as 'all'
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).not.toHaveProperty('recommendedRunConfig')
    saveToStorage(nodes, edges) // omitted ⇒ same
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).not.toHaveProperty('recommendedRunConfig')
  })

  it('the project header and the timelineSeries slice land in ONE record', () => {
    saveToStorage(nodes, edges, { schema: 'loop-revision/1', revisionId: 'rev_x' }, ['p'])
    const rec = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(rec.project.revisionId).toBe('rev_x')
    expect(rec.recommendedRunConfig.timelineSeries).toEqual(['p'])
  })

  it('the written recommendedRunConfig carries ONLY timelineSeries — no MC fields, no canvasLocked', () => {
    saveToStorage(nodes, edges, null, ['p', 'reg_a'])
    const rec = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(Object.keys(rec.recommendedRunConfig)).toEqual(['timelineSeries'])
    for (const k of ['baseSeed', 'runs', 'steps', 'tracked', 'canvasLocked']) {
      expect(rec.recommendedRunConfig).not.toHaveProperty(k)
    }
  })

  it('the graph bytes in the record are exactly a plain serialize (autosave adds nothing to nodes/edges)', () => {
    saveToStorage(nodes, edges, null, ['p'])
    const rec = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    const plain = JSON.parse(serialize(nodes, edges))
    expect(rec.nodes).toEqual(plain.nodes)
    expect(rec.edges).toEqual(plain.edges)
    expect({ schema: rec.schema, version: rec.version }).toEqual({ schema: plain.schema, version: plain.version })
  })
})

beforeEach(() => {
  useGraphStore.getState().newGraph()
})
