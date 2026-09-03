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

describe('React Flow renderer state never reaches the document', () => {
  // React Flow writes `measured` (its ResizeObserver result) and `selected` /
  // `dragging` back onto the live node/edge objects the store then hands to
  // `serialize()`. Those depend on viewport size, fonts and render timing — they
  // are not document data and must not appear in any exported / persisted form.
  const dirtyNode = (): LoopNode =>
    ({
      ...(n('p', 'pool') as LoopNode),
      measured: { width: 118, height: 64 },
      selected: true,
      dragging: false,
      width: 118,
      height: 64,
      positionAbsolute: { x: 0, y: 0 },
    }) as unknown as LoopNode
  const dirtyEdge = (): LoopEdge =>
    ({
      id: 'e',
      source: 'p',
      target: 'p',
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'loop',
      // real document content lives in `data` — routing intent + the model tag
      data: {
        kind: 'resource',
        flow: '1',
        resourceType: 'gold',
        route: 'orthogonal',
        waypoints: [{ x: 10, y: 20 }],
      },
      selected: true,
    }) as unknown as LoopEdge

  it('serialize drops measured / selected / dragging and other RF-owned keys', () => {
    const text = serialize([dirtyNode()], [dirtyEdge()])
    for (const key of ['measured', 'selected', 'dragging', 'positionAbsolute', '"width"', '"height"']) {
      expect(text).not.toContain(key)
    }
    const parsed = JSON.parse(text) as GraphDoc
    expect(Object.keys(parsed.nodes[0])).toEqual(['id', 'type', 'position', 'data'])
    expect(Object.keys(parsed.edges[0])).toEqual([
      'id',
      'source',
      'target',
      'sourceHandle',
      'targetHandle',
      'type',
      'data',
    ])
  })

  it('keeps the authored `data` payload whole — route / waypoints / resourceType survive', () => {
    const parsed = JSON.parse(serialize([dirtyNode()], [dirtyEdge()])) as GraphDoc
    expect(parsed.edges[0].data).toEqual({
      kind: 'resource',
      flow: '1',
      resourceType: 'gold',
      route: 'orthogonal',
      waypoints: [{ x: 10, y: 20 }],
    })
  })

  it('an export before RF has measured is byte-identical to one after', () => {
    // the flake `e2e/i18n.spec.ts` caught: `en1` was captured pre-measurement,
    // `en2` after RF wrote `measured` onto the same store objects.
    const clean = serialize([n('p', 'pool') as LoopNode], [])
    const afterMeasure = serialize([dirtyNode()], [])
    expect(afterMeasure).toBe(clean)
  })

  it('the document fields (id / type / position / data) are untouched', () => {
    const parsed = JSON.parse(serialize([dirtyNode()], [])) as GraphDoc
    expect(parsed.nodes[0]).toEqual({
      id: 'p',
      type: 'pool',
      position: { x: 0, y: 0 },
      data: { kind: 'pool', label: 'p' },
    })
  })
})

beforeEach(() => {
  useGraphStore.getState().newGraph()
})

// ── loop-model/2 — the schema-based model-semantics discriminator ──────────
describe('loop-model/2 — schema discriminator (SEMANTICS-M2.md §M2-1)', () => {
  const g1 = [n('p', 'pool') as LoopNode]

  it('serialize(..., 1) writes schema "loop-studio/graph" (unchanged bytes)', () => {
    const s = serialize(g1, [])
    expect(JSON.parse(s).schema).toBe('loop-studio/graph')
    expect(JSON.parse(s).version).toBe(1)
    expect(serialize(g1, [], undefined, undefined, undefined, 1)).toBe(s) // explicit 1 == default
  })

  it('serialize(..., 2) writes schema "loop-studio/graph/2"; version stays 1', () => {
    const parsed = JSON.parse(serialize(g1, [], undefined, undefined, undefined, 2))
    expect(parsed.schema).toBe('loop-studio/graph/2')
    expect(parsed.version).toBe(1)
  })

  it('deserialize returns the model version from schema; v2 survives a round-trip', () => {
    expect(deserialize(serialize(g1, [])).modelVersion).toBe(1)
    const back1 = deserialize(serialize(g1, [], undefined, undefined, undefined, 2))
    expect(back1.modelVersion).toBe(2)
    // re-serialise with the version the reader returned ⇒ still the v2 schema, and a fixpoint
    const reser = serialize(back1.nodes, back1.edges, undefined, undefined, undefined, back1.modelVersion)
    expect(JSON.parse(reser).schema).toBe('loop-studio/graph/2')
    const back2 = deserialize(reser)
    expect(back2.modelVersion).toBe(2)
    expect(serialize(back2.nodes, back2.edges, undefined, undefined, undefined, back2.modelVersion)).toBe(reser)
  })

  it('an unknown schema (incl. a newer loop-studio/graph/N) is rejected — fail-closed (§M2-INV-6)', () => {
    const v99 = JSON.stringify({ schema: 'loop-studio/graph/99', version: 1, nodes: [], edges: [] })
    expect(() => deserialize(v99)).toThrow(/does not look like a Loop Studio graph file/)
    expect(() => deserialize(JSON.stringify({ schema: 'something-else', version: 1, nodes: [], edges: [] }))).toThrow()
  })

  it('a v1 document with a stray "@foo" flow round-trips byte-identically and stays v1 (§M2-INV-1)', () => {
    const src = doc([n('a', 'source'), n('b', 'pool')], [
      { id: 'e', source: 'a', target: 'b', type: 'loop', data: { kind: 'resource', flow: '@foo' } } as unknown as LoopEdge,
    ])
    const back = deserialize(src)
    expect(back.modelVersion).toBe(1)
    const reser = serialize(back.nodes, back.edges, undefined, undefined, undefined, back.modelVersion)
    expect(JSON.parse(reser).schema).toBe('loop-studio/graph')
    // the flow string is kept verbatim
    expect((JSON.parse(reser).edges[0].data as { flow: string }).flow).toBe('@foo')
  })
})

// ── LGR Slice 5 — saved frames (SEMANTICS-R5.md §R5-1.1 / §R5-2) ────────────
describe('serialize / deserialize — saved frames (loop-revision/5)', () => {
  const G = () => {
    const s = useGraphStore.getState()
    s.newGraph()
    s.addNodeAt('pool', { x: 0, y: 0 })
    return useGraphStore.getState()
  }
  const F = (over: Partial<import('./serialize').SavedFrame> = {}): import('./serialize').SavedFrame => ({
    id: 'f1',
    label: 'Zone',
    rect: { x: 10, y: 20, w: 300, h: 200 },
    ...over,
  })

  it('no frames ⇒ NO `frames` key; byte-identical to a pre-Slice-5 write', () => {
    const g = G()
    const withoutArg = serialize(g.nodes, g.edges)
    const withEmpty = serialize(g.nodes, g.edges, undefined, undefined, undefined, 1, [])
    expect(JSON.parse(withoutArg)).not.toHaveProperty('frames')
    expect(withEmpty).toBe(withoutArg)
  })

  it('serialize writes `frames` (canonical key order id/label/rect/color); color omitted when neutral', () => {
    const g = G()
    const out = JSON.parse(
      serialize(g.nodes, g.edges, undefined, undefined, undefined, 1, [
        F(),
        F({ id: 'f2', label: 'Rewards', color: 'rose' }),
      ]),
    )
    expect(out.frames).toEqual([
      { id: 'f1', label: 'Zone', rect: { x: 10, y: 20, w: 300, h: 200 } },
      { id: 'f2', label: 'Rewards', rect: { x: 10, y: 20, w: 300, h: 200 }, color: 'rose' },
    ])
    // key order on the coloured frame
    expect(Object.keys(out.frames[1])).toEqual(['id', 'label', 'rect', 'color'])
    expect(Object.keys(out.frames[1].rect)).toEqual(['x', 'y', 'w', 'h'])
  })

  it('round-trips label / rect / color; file order preserved; `n` never on the wire', () => {
    const g = G()
    const frames = [F({ id: 'a', label: 'One' }), F({ id: 'b', label: 'Two', color: 'gold' })]
    const back = deserialize(serialize(g.nodes, g.edges, undefined, undefined, undefined, 1, frames))
    expect(back.frames).toEqual(frames)
    expect(back.frames[0]).not.toHaveProperty('n')
  })

  it('deserialize of a file with no `frames` ⇒ frames: []', () => {
    expect(deserialize(doc([n('p', 'pool')], [])).frames).toEqual([])
  })

  it('§R5-1.1 defensive read — a bad entry is DROPPED, the graph is KEPT', () => {
    const raw = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [n('p', 'pool')],
      edges: [],
      frames: [
        { id: 'ok', label: 'good', rect: { x: 1, y: 2, w: 100, h: 50 }, color: 'sage' },
        { id: 'nan', label: 'x', rect: { x: NaN, y: 0, w: 10, h: 10 } }, // non-finite → drop
        { id: 'zero', label: 'x', rect: { x: 0, y: 0, w: 0, h: 10 } }, // w<=0 → drop
        { id: 'norect', label: 'x' }, // no rect → drop
        'nope', // not an object → drop
        { id: 'badcolor', label: 'x', rect: { x: 0, y: 0, w: 5, h: 5 }, color: 'chartreuse' }, // kept, color dropped
        { id: 'ok', label: 'dup', rect: { x: 9, y: 9, w: 9, h: 9 } }, // dup id → fresh id, kept
        { label: 'noid', rect: { x: 3, y: 3, w: 3, h: 3 } }, // missing id → fresh id, kept
        { id: 'long', label: 'y'.repeat(200), rect: { x: 0, y: 0, w: 4, h: 4 } }, // label capped
      ],
    })
    const back = deserialize(raw)
    expect(back.nodes).toHaveLength(1) // graph kept
    const labels = back.frames.map((f) => f.label)
    expect(labels).toEqual(['good', 'x', 'dup', 'noid', 'y'.repeat(120)])
    expect(back.frames.find((f) => f.label === 'x')?.color).toBeUndefined() // unknown color dropped
    // ids are all present + unique
    const ids = back.frames.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((i) => typeof i === 'string' && i.length > 0)).toBe(true)
  })

  it('§R5-1.1 — at most SF_FRAMES_MAX (200) entries survive', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: `f${i}`,
      label: `${i}`,
      rect: { x: i, y: 0, w: 10, h: 10 },
    }))
    const raw = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [n('p', 'pool')], edges: [], frames: many })
    expect(deserialize(raw).frames).toHaveLength(200)
  })

  it('`frames: []` / not-an-array in the file ⇒ frames: []', () => {
    for (const v of [[], 'x', 42, {}, null]) {
      const raw = JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: [n('p', 'pool')], edges: [], frames: v })
      expect(deserialize(raw).frames).toEqual([])
    }
  })

  it('a coloured frame with rect keys out of order still projects x/y/w/h in order', () => {
    const g = G()
    const out = JSON.parse(
      serialize(g.nodes, g.edges, undefined, undefined, undefined, 1, [
        { id: 'f', label: '', rect: { h: 1, w: 2, y: 3, x: 4 } as never },
      ]),
    )
    expect(Object.keys(out.frames[0].rect)).toEqual(['x', 'y', 'w', 'h'])
    expect(out.frames[0].rect).toEqual({ x: 4, y: 3, w: 2, h: 1 })
  })

  describe('saveToStorage / loadFromStorage carry frames', () => {
    class Mem {
      m = new Map<string, string>()
      getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
      setItem(k: string, v: string) { this.m.set(k, String(v)) }
      removeItem(k: string) { this.m.delete(k) }
      clear() { this.m.clear() }
      key(i: number) { return [...this.m.keys()][i] ?? null }
      get length() { return this.m.size }
    }
    beforeEach(() => vi.stubGlobal('localStorage', new Mem()))
    afterEach(() => vi.unstubAllGlobals())

    it('the current frames ride the autosave write atomically; an empty set writes no key', () => {
      const g = G()
      saveToStorage(g.nodes, g.edges, undefined, undefined, 1, [F({ color: 'violet' })])
      expect(loadFromStorage()!.frames).toEqual([F({ color: 'violet' })])
      saveToStorage(g.nodes, g.edges, undefined, undefined, 1, [])
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).not.toHaveProperty('frames')
      expect(loadFromStorage()!.frames).toEqual([])
    })
  })
})
