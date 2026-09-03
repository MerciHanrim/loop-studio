import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'
import { useAutoFrameStore, hasAutoFrames, autoFramesStale, graphSignature } from './autoFrameStore'
import { useFrameStore } from './frameStore'
import type { AFEdge, AFNode } from '../components/frames/autoFrames'

// docs/large-graph-readability-auto-frames.md §AF — the DERIVED auto-frame store.
// Session-only, no serialization, cleared on a whole-graph swap (`loadRev`).

const resetStores = () => {
  useAutoFrameStore.setState({ autoFrames: [], lastSignature: null })
  useFrameStore.setState({ frames: [], toolArmed: false, selectedId: null, nextN: 1 })
}

/** two dense blobs of 5 pools, far apart, one thin bridge, + 2 model nodes. */
function twoBlobDoc(): { nodes: AFNode[]; edges: AFEdge[] } {
  const nodes: AFNode[] = []
  const edges: AFEdge[] = []
  for (let b = 0; b < 2; b++) {
    const base = b === 0 ? 0 : 4000
    for (let i = 0; i < 5; i++) {
      nodes.push({ id: `b${b}_${i}`, kind: 'pool', position: { x: base + i * 40, y: b * 10 }, measured: { width: 100, height: 40 } } as AFNode)
      for (let j = i + 1; j < 5; j++) edges.push({ source: `b${b}_${i}`, target: `b${b}_${j}` })
    }
  }
  edges.push({ source: 'b0_4', target: 'b1_0' })
  nodes.push({ id: 'p1', kind: 'parameter', position: { x: 0, y: 400 } } as AFNode)
  nodes.push({ id: 'r1', kind: 'register', position: { x: 100, y: 400 } } as AFNode)
  return { nodes, edges }
}

describe('autoFrameStore', () => {
  beforeEach(() => {
    resetStores()
    const { nodes, edges } = twoBlobDoc()
    // feed the graph store what `suggest()` reads
    useGraphStore.setState({
      nodes: nodes.map((n) => ({ id: n.id, type: n.kind, position: n.position, data: { kind: n.kind }, measured: n.measured })) as never,
      edges: edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, type: 'loop', data: { kind: 'resource' } })) as never,
    })
  })

  it('suggest() computes a derived set and records a signature; hasAutoFrames flips', () => {
    expect(hasAutoFrames(useAutoFrameStore.getState())).toBe(false)
    useAutoFrameStore.getState().suggest()
    const s = useAutoFrameStore.getState()
    expect(s.autoFrames.length).toBe(2)
    expect(s.lastSignature).not.toBeNull()
    expect(hasAutoFrames(s)).toBe(true)
    // model nodes never in a frame
    for (const f of s.autoFrames) {
      expect(f.members).not.toContain('p1')
      expect(f.members).not.toContain('r1')
    }
    // 1-based area ordinals in order
    expect(s.autoFrames.map((f) => f.area)).toEqual([1, 2])
  })

  it('suggest() is idempotent on an unchanged graph — identical rects + members', () => {
    useAutoFrameStore.getState().suggest()
    const a = useAutoFrameStore.getState().autoFrames.map((f) => ({ rect: f.rect, members: f.members }))
    useAutoFrameStore.getState().suggest()
    const b = useAutoFrameStore.getState().autoFrames.map((f) => ({ rect: f.rect, members: f.members }))
    expect(b).toEqual(a)
  })

  it('dismissAuto removes only that frame; a later suggest re-proposes it (§AF5 R8)', () => {
    useAutoFrameStore.getState().suggest()
    const firstId = useAutoFrameStore.getState().autoFrames[0].id
    useAutoFrameStore.getState().dismissAuto(firstId)
    expect(useAutoFrameStore.getState().autoFrames.length).toBe(1)
    useAutoFrameStore.getState().suggest()
    expect(useAutoFrameStore.getState().autoFrames.length).toBe(2) // re-proposed
  })

  it('clearAuto empties the set and the signature', () => {
    useAutoFrameStore.getState().suggest()
    useAutoFrameStore.getState().clearAuto()
    expect(useAutoFrameStore.getState().autoFrames).toEqual([])
    expect(useAutoFrameStore.getState().lastSignature).toBeNull()
  })

  it('a loadRev bump (whole-graph swap) drops the derived set (§AF6)', () => {
    useAutoFrameStore.getState().suggest()
    expect(useAutoFrameStore.getState().autoFrames.length).toBe(2)
    useGraphStore.setState({ loadRev: useGraphStore.getState().loadRev + 1 })
    expect(useAutoFrameStore.getState().autoFrames).toEqual([])
    expect(useAutoFrameStore.getState().lastSignature).toBeNull()
  })

  it('autoFramesStale — false right after suggest, true after a node moves, cleared by re-suggest (§AF4.3)', () => {
    useAutoFrameStore.getState().suggest()
    const sig = useAutoFrameStore.getState().lastSignature
    expect(autoFramesStale(sig)).toBe(false)
    // move a node
    useGraphStore.setState({
      nodes: useGraphStore.getState().nodes.map((n) =>
        n.id === 'b0_0' ? { ...n, position: { x: n.position.x + 999, y: n.position.y } } : n,
      ) as never,
    })
    expect(autoFramesStale(sig)).toBe(true)
    useAutoFrameStore.getState().suggest()
    expect(autoFramesStale(useAutoFrameStore.getState().lastSignature)).toBe(false)
  })

  it('graphSignature is order-independent for nodes and edges', () => {
    const { nodes, edges } = twoBlobDoc()
    const a = graphSignature(nodes, edges)
    const b = graphSignature([...nodes].reverse(), [...edges].reverse())
    expect(b).toBe(a)
  })

  it('suggest() below the floor / with no result clears the signature (nothing to be stale about)', () => {
    // shrink to < WORTH_IT_FLOOR eligible nodes
    useGraphStore.setState({
      nodes: [
        { id: 'x1', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool' } },
        { id: 'x2', type: 'pool', position: { x: 60, y: 0 }, data: { kind: 'pool' } },
      ] as never,
      edges: [{ id: 'e', source: 'x1', target: 'x2', type: 'loop', data: { kind: 'resource' } }] as never,
    })
    useAutoFrameStore.getState().suggest()
    expect(useAutoFrameStore.getState().autoFrames).toEqual([])
    expect(useAutoFrameStore.getState().lastSignature).toBeNull()
    expect(autoFramesStale(useAutoFrameStore.getState().lastSignature)).toBe(false)
  })
})

// §AF8 / review boundary 2 — exactly which changes make the auto set "stale"
describe('autoFrameStore — the staleness-signature boundary', () => {
  const base = () => {
    const { nodes, edges } = twoBlobDoc()
    return {
      nodes: nodes.map((n) => ({ id: n.id, type: n.kind, position: { ...n.position }, data: { kind: n.kind, label: 'L' } })),
      edges: edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, type: 'loop', data: { kind: 'resource' } })),
    }
  }
  const sigOf = (d: ReturnType<typeof base>) =>
    graphSignature(
      d.nodes.map((n) => ({ id: n.id, kind: n.data.kind, position: n.position }) as AFNode),
      d.edges.map((e) => ({ source: e.source, target: e.target }) as AFEdge),
    )

  it('STALE on: node add/delete, edge add/delete, a position move, a kind change, a parallel-edge multiplicity change', () => {
    const s0 = sigOf(base())

    const addNode = base()
    addNode.nodes.push({ id: 'zz', type: 'pool', position: { x: 9, y: 9 }, data: { kind: 'pool', label: 'L' } })
    expect(sigOf(addNode)).not.toBe(s0)

    const delNode = base()
    delNode.nodes = delNode.nodes.filter((n) => n.id !== 'b0_0')
    expect(sigOf(delNode)).not.toBe(s0)

    const addEdge = base()
    addEdge.edges.push({ id: 'extra', source: 'b0_0', target: 'b1_4', type: 'loop', data: { kind: 'resource' } })
    expect(sigOf(addEdge)).not.toBe(s0)

    const delEdge = base()
    delEdge.edges = delEdge.edges.slice(1)
    expect(sigOf(delEdge)).not.toBe(s0)

    const move = base()
    move.nodes = move.nodes.map((n) => (n.id === 'b0_0' ? { ...n, position: { x: n.position.x + 40, y: n.position.y } } : n))
    expect(sigOf(move)).not.toBe(s0)

    const kind = base()
    kind.nodes = kind.nodes.map((n) => (n.id === 'b0_0' ? { ...n, data: { ...n.data, kind: 'gate' } } : n))
    expect(sigOf(kind)).not.toBe(s0)

    const parallel = base()
    // add a SECOND edge between an already-connected pair (multiplicity 1 → 2)
    parallel.edges.push({ id: 'dup', source: 'b0_0', target: 'b0_1', type: 'loop', data: { kind: 'resource' } })
    expect(sigOf(parallel)).not.toBe(s0)
  })

  it('NOT stale on: a node label change, a Parameter value change, a manual/auto frame op, a filter, a sim run (none touch graph structure or positions)', () => {
    const s0 = sigOf(base())

    const label = base()
    label.nodes = label.nodes.map((n) => (n.id === 'b0_0' ? { ...n, data: { ...n.data, label: 'renamed' } } : n))
    expect(sigOf(label)).toBe(s0)

    const paramVal = base()
    paramVal.nodes = paramVal.nodes.map((n) => (n.id === 'b0_0' ? { ...n, data: { ...n.data, value: 42, expr: '@x + 1' } } : n))
    expect(sigOf(paramVal)).toBe(s0)

    // manual-frame ops, auto-frame dismiss, filter selections, sim state, locale,
    // theme are all in OTHER stores — the signature only reads graph.nodes /
    // graph.edges, so it is unchanged by construction. Assert the store-level
    // behaviour: dismiss / manual add do not re-sign.
    useGraphStore.setState({ nodes: base().nodes as never, edges: base().edges as never })
    useAutoFrameStore.getState().suggest()
    const sigAfterSuggest = useAutoFrameStore.getState().lastSignature
    useAutoFrameStore.getState().dismissAuto(useAutoFrameStore.getState().autoFrames[0].id)
    useFrameStore.getState().adoptFrame({ x: 0, y: 0, w: 40, h: 40 }, 'M')
    useFrameStore.getState().renameFrame(useFrameStore.getState().frames[0].id, 'M2')
    expect(useAutoFrameStore.getState().lastSignature).toBe(sigAfterSuggest) // no re-sign
    expect(autoFramesStale(useAutoFrameStore.getState().lastSignature)).toBe(false)
  })
})

describe('frameStore.adoptFrame — the promote target (§AF5 R5)', () => {
  beforeEach(resetStores)

  it('adds a manual frame with the given rect + label and the next Group ordinal', () => {
    const id = useFrameStore.getState().adoptFrame({ x: 1, y: 2, w: 30, h: 40 }, 'Combat')
    const f = useFrameStore.getState().frames[0]
    expect(f).toMatchObject({ id, label: 'Combat', n: 1, rect: { x: 1, y: 2, w: 30, h: 40 } })
    // does NOT touch the tool (unlike addFrame)
    const id2 = useFrameStore.getState().adoptFrame({ x: 0, y: 0, w: 50, h: 50 }, '')
    expect(useFrameStore.getState().frames.map((x) => x.n)).toEqual([1, 2])
    expect(useFrameStore.getState().selectedId).toBe(id2)
  })
})
