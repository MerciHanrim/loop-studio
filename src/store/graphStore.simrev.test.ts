import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graphStore'

// `simulationRev` must bump on every change that alters what a simulation
// computes, and ONLY those — never position / selection / a pure label rename.

const rev = () => useGraphStore.getState().simulationRev
const bumped = (fn: () => void) => {
  const before = rev()
  fn()
  return rev() - before
}

function base() {
  const g = useGraphStore.getState()
  g.newGraph()
  g.addNodeAt('source', { x: 0, y: 0 })
  g.addNodeAt('pool', { x: 200, y: 0 })
  const [s, p] = useGraphStore.getState().nodes
  useGraphStore.getState().onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' })
  return {
    sourceId: s.id,
    poolId: p.id,
    edgeId: useGraphStore.getState().edges[0].id,
  }
}

beforeEach(() => {
  useGraphStore.getState().newGraph()
})

describe('graphStore.simulationRev', () => {
  it('bumps: add node, connect, remove node, remove edge', () => {
    expect(bumped(() => useGraphStore.getState().addNodeAt('gate', { x: 0, y: 0 }))).toBeGreaterThan(0)
    const gid = useGraphStore.getState().nodes[0].id
    useGraphStore.getState().addNodeAt('drain', { x: 100, y: 0 })
    const did = useGraphStore.getState().nodes[1].id
    expect(
      bumped(() =>
        useGraphStore
          .getState()
          .onConnect({ source: gid, target: did, sourceHandle: 'out', targetHandle: 'in' }),
      ),
    ).toBeGreaterThan(0)
    const eid = useGraphStore.getState().edges[0].id
    expect(bumped(() => useGraphStore.getState().removeEdge(eid))).toBeGreaterThan(0)
    expect(bumped(() => useGraphStore.getState().removeNode(gid))).toBeGreaterThan(0)
  })

  it('bumps: edge flow, pool capacity/initial, activation, mode, gate distribution', () => {
    const { poolId, edgeId } = base()
    expect(
      bumped(() => useGraphStore.getState().setEdgeData(edgeId, { kind: 'resource', flow: '2D6' })),
    ).toBeGreaterThan(0)
    expect(bumped(() => useGraphStore.getState().updateNodeData(poolId, { capacity: 9 }))).toBeGreaterThan(0)
    expect(bumped(() => useGraphStore.getState().updateNodeData(poolId, { initial: 3 }))).toBeGreaterThan(0)
    expect(
      bumped(() => useGraphStore.getState().updateNodeData(poolId, { activation: 'automatic' })),
    ).toBeGreaterThan(0)
    expect(bumped(() => useGraphStore.getState().updateNodeData(poolId, { mode: 'pullAll' }))).toBeGreaterThan(0)

    useGraphStore.getState().addNodeAt('gate', { x: 0, y: 0 })
    const gid = useGraphStore.getState().nodes.at(-1)!.id
    expect(
      bumped(() =>
        useGraphStore.getState().updateNodeData(gid, { distribution: 'probabilistic' }),
      ),
    ).toBeGreaterThan(0)
  })

  it('bumps: import (loadGraph / loadJSON) and undo / redo', () => {
    const { poolId } = base()
    useGraphStore.getState().updateNodeData(poolId, { capacity: 5 }) // something to undo
    expect(bumped(() => useGraphStore.getState().undo())).toBeGreaterThan(0)
    expect(bumped(() => useGraphStore.getState().redo())).toBeGreaterThan(0)
    expect(
      bumped(() => useGraphStore.getState().loadGraph({ nodes: [], edges: [] })),
    ).toBeGreaterThan(0)
    const doc = useGraphStore.getState().exportJSON()
    expect(bumped(() => useGraphStore.getState().loadJSON(doc))).toBeGreaterThan(0)
  })

  it('does NOT bump: a routing-only edge edit (route / waypoints are cosmetic — loop-revision/3 §R3-3)', () => {
    const { edgeId } = base()
    const set = (d: Record<string, unknown>) => useGraphStore.getState().setEdgeData(edgeId, d as never)
    // route only
    expect(bumped(() => set({ kind: 'resource', flow: '1', route: 'orthogonal' }))).toBe(0)
    // waypoints only (route already present)
    expect(
      bumped(() => set({ kind: 'resource', flow: '1', route: 'orthogonal', waypoints: [{ x: 10, y: 20 }] })),
    ).toBe(0)
    // change just the waypoints array
    expect(
      bumped(() => set({ kind: 'resource', flow: '1', route: 'orthogonal', waypoints: [{ x: 30, y: 40 }, { x: 30, y: 80 }] })),
    ).toBe(0)
    // Orthogonal → Curved: BOTH keys removed in one patch — still cosmetic
    expect(bumped(() => set({ kind: 'resource', flow: '1' }))).toBe(0)
  })

  it('bumps exactly +1: a patch that mixes a routing key with a real field', () => {
    const { edgeId } = base()
    const set = (d: Record<string, unknown>) => useGraphStore.getState().setEdgeData(edgeId, d as never)
    // flow changed alongside route
    expect(bumped(() => set({ kind: 'resource', flow: '3', route: 'orthogonal' }))).toBe(1)
    // kind / mode / expr changed alongside route (resource → state in one patch)
    expect(
      bumped(() => set({ kind: 'state', mode: 'activator', expr: '@x > 1', route: 'orthogonal' })),
    ).toBe(1)
    // and a routing-only follow-up on the state edge does not bump
    expect(
      bumped(() => set({ kind: 'state', mode: 'activator', expr: '@x > 1', route: 'orthogonal', waypoints: [{ x: 1, y: 2 }] })),
    ).toBe(0)
  })

  it('does NOT bump: a pure label rename', () => {
    const { poolId, sourceId } = base()
    expect(bumped(() => useGraphStore.getState().updateNodeData(poolId, { label: 'Vault' }))).toBe(0)
    expect(bumped(() => useGraphStore.getState().updateNodeData(sourceId, { label: 'Tap' }))).toBe(0)
  })

  it('does NOT bump: selection', () => {
    const { poolId, edgeId } = base()
    expect(bumped(() => useGraphStore.getState().setSelection(poolId, null))).toBe(0)
    expect(bumped(() => useGraphStore.getState().setSelection(null, edgeId))).toBe(0)
    expect(bumped(() => useGraphStore.getState().setSelection(null, null))).toBe(0)
  })

  it('does NOT bump: dragging / settling a node position', () => {
    const { poolId } = base()
    const move = (x: number, y: number, dragging: boolean) =>
      useGraphStore
        .getState()
        .onNodesChange([{ type: 'position', id: poolId, position: { x, y }, dragging }])
    expect(
      bumped(() => {
        move(10, 0, true)
        move(20, 0, true)
        move(30, 0, false)
      }),
    ).toBe(0)
  })

  it('a label rename mixed with a real field still bumps (only pure-label is exempt)', () => {
    const { poolId } = base()
    expect(
      bumped(() => useGraphStore.getState().updateNodeData(poolId, { label: 'V', capacity: 4 })),
    ).toBeGreaterThan(0)
  })
})
