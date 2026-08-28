import { beforeEach, describe, expect, it } from 'vitest'
import { semanticDigest } from '../model/workspace'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useSimStore } from './simStore'
import { collectWorkspacePayload, importFile, serializeWorkspaceFile } from './workspaceIO'

// SEMANTICS-W.md loop-workspace/1 — Slice B: the payload assembly + the §W5
// defensive reader + the §W5.1 atomic restore, exercised through the stores.

/** Source ─2→ Pool ─1→ Drain(passive) ; Source ┄trigger d0┄> Drain */
function buildGraph() {
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
  const edges = useGraphStore.getState().edges
  const resIn = edges.find((e) => e.source === s.id && e.target === p.id)!
  useGraphStore.getState().setEdgeData(resIn.id, { kind: 'resource', flow: '2' })
  const trig = edges.find((e) => e.sourceHandle === 'state-source')!
  useGraphStore.getState().setEdgeData(trig.id, { kind: 'state', mode: 'trigger', expr: '', delay: 0 })
  return { sourceId: s.id, poolId: p.id, drainId: d.id, trigId: trig.id }
}

const graph = () => {
  const g = useGraphStore.getState()
  return { nodes: g.nodes, edges: g.edges }
}
const rev = () => useGraphStore.getState().simulationRev
const fakeResult = (poolId: string, runs = 3, steps = 2) => ({
  completedRuns: runs,
  pools: [{ id: poolId, label: 'P' }],
  runSeeds: Array.from({ length: runs }, (_, i) => i + 1),
  endedRuns: { atOrBeforeStep: Array.from({ length: steps + 1 }, () => 0) },
  series: { [poolId]: { p10: [0, 1, 2], p50: [0, 1, 2], p90: [0, 1, 2], mean: [0, 1, 2], min: [0, 1, 2], max: [0, 1, 2] } },
  final: { [poolId]: { values: [2, 2, 2], summary: { mean: 2, p10: 2, p50: 2, p90: 2, min: 2, max: 2 } } },
  config: { baseSeed: 1, runs, steps, tracked: [poolId] },
})

beforeEach(() => {
  useMcStore.getState().clear()
  useSimStore.getState().reset()
  useGraphStore.getState().newGraph()
})

// ── the plain-graph path is untouched ────────────────────────────────────
describe('a plain Graph file still imports exactly as before', () => {
  it('no `workspace` key ⇒ no workspace state, and previous workspace state does not leak', async () => {
    const ids = buildGraph()
    // arm some workspace state
    useMcStore.setState({ distributionPoolId: ids.poolId, showMean: true, view: 'distribution' })
    useSimStore.getState().stepOnce()
    useSimStore.getState().stepOnce()

    const plain = serialize0(graph())
    const before = rev()
    const out = await importFile(plain)

    expect(out.workspace).toBe(false)
    expect(out.warnings).toEqual([])
    expect(rev()).toBe(before + 1) // one bump, as today
    expect(useSimStore.getState().stepIndex).toBe(0) // sim reset by the load
    // the earlier view selection is not carried by a plain graph…
    expect(useMcStore.getState().result).toBeNull()
    // …but the view/pool fields are session state, not reset by a plain import
    // (matches today's behaviour — only a *Workspace* file restores them)
  })
})

function serialize0(g: { nodes: unknown[]; edges: unknown[] }): string {
  // a plain Graph Export = serialize with no workspace
  return JSON.stringify({ schema: 'loop-studio/graph', version: 1, nodes: g.nodes, edges: g.edges })
}

// ── round-trip + atomic restore ─────────────────────────────────────────
describe('Workspace round-trip and atomic restore (§W5.1)', () => {
  it('one simulationRev bump for the whole import; result stays non-stale, sim restored', async () => {
    const ids = buildGraph()
    useSimStore.getState().stepOnce()
    useSimStore.getState().stepOnce()
    const digest = await semanticDigest(graph())
    useMcStore.getState().restoreResult({ result: fakeResult(ids.poolId) as never, resultGraphDigest: digest, stale: false })
    useMcStore.setState({ distributionPoolId: ids.poolId, showMean: true, view: 'distribution' })

    const file = serializeWorkspaceFile(collectWorkspacePayload({ x: 12, y: -8, zoom: 1.5 }))

    // fresh session, then import
    useMcStore.getState().clear()
    useSimStore.getState().reset()
    const before = rev()
    const out = await importFile(file)

    expect(out.workspace).toBe(true)
    expect(out.warnings).toEqual([])
    expect(rev()).toBe(before + 1) // ← exactly one, despite graph + snapshot + result + view

    const mc = useMcStore.getState()
    expect(mc.result).not.toBeNull()
    expect(mc.stale).toBe(false) // atomic: the load bump did not re-stale it
    expect(mc.runRev).toBe(rev()) // pinned to the current rev
    expect(mc.resultGraphDigest).toBe(digest) // verbatim
    expect(mc.view).toBe('distribution')
    expect(mc.distributionPoolId).toBe(ids.poolId)
    expect(mc.showMean).toBe(true)

    const sim = useSimStore.getState()
    expect(sim.status).toBe('paused')
    expect(sim.stepIndex).toBe(2)
    expect(out.canvas).toEqual({ x: 12, y: -8, zoom: 1.5 })
  })

  it('the restored digest is carried verbatim — no recompute against the current graph', async () => {
    buildGraph()
    const bogus = 'f'.repeat(64) // not this graph's digest
    const ids = useGraphStore.getState().nodes
    const poolId = ids.find((n) => n.data.kind === 'pool')!.id
    useMcStore.getState().restoreResult({ result: fakeResult(poolId) as never, resultGraphDigest: bogus, stale: true })

    const file = serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
    // the file must contain the bogus digest, not a freshly computed one
    expect(JSON.parse(file).workspace.mc.resultGraphDigest).toBe(bogus)

    useMcStore.getState().clear()
    await importFile(file)
    // digest mismatch ⇒ stale, but the STORED digest is still the file's
    expect(useMcStore.getState().resultGraphDigest).toBe(bogus)
    expect(useMcStore.getState().stale).toBe(true)
  })

  it('Import → Export keeps the result digest and a `resultOmitted` note unchanged', async () => {
    buildGraph()
    const poolId = useGraphStore.getState().nodes.find((n) => n.data.kind === 'pool')!.id
    const digest = await semanticDigest(graph())
    const doc = {
      schema: 'loop-studio/graph',
      version: 1,
      nodes: graph().nodes,
      edges: graph().edges,
      workspace: {
        schema: 'loop-workspace/1',
        version: 1,
        mc: { config: { baseSeed: 1, runs: 3, steps: 2, tracked: [poolId] }, resultOmitted: 'size-limit', stale: false },
        view: { timeline: 'live', distributionPoolId: null, showMean: false },
        canvas: { x: 0, y: 0, zoom: 1 },
        simulation: { seed: 1, step: 0, ended: false, values: {}, fired: [], triggerQueue: [], stateEvents: [], series: [] },
      },
    }
    const out = await importFile(JSON.stringify(doc))
    expect(out.warnings.join(' ')).toMatch(/too large/)
    expect(useMcStore.getState().result).toBeNull() // omitted ⇒ no result

    // now put a real digest-bound result back and re-export: digest verbatim
    useMcStore.getState().restoreResult({ result: fakeResult(poolId) as never, resultGraphDigest: digest, stale: false })
    const re = serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
    expect(JSON.parse(re).workspace.mc.resultGraphDigest).toBe(digest)
  })
})

// ── seeds are independent ───────────────────────────────────────────────
describe('simulation.seed and mc.config.baseSeed do not overwrite each other', () => {
  it('restores each from its own field', async () => {
    buildGraph()
    const poolId = useGraphStore.getState().nodes.find((n) => n.data.kind === 'pool')!.id
    const doc = {
      schema: 'loop-studio/graph', version: 1, nodes: graph().nodes, edges: graph().edges,
      workspace: {
        schema: 'loop-workspace/1', version: 1,
        mc: { config: { baseSeed: 4242, runs: 5, steps: 3, tracked: [] }, stale: false },
        view: { timeline: 'live', distributionPoolId: null, showMean: false },
        canvas: { x: 0, y: 0, zoom: 1 },
        simulation: { seed: 99, step: 0, ended: false, values: { [poolId]: 0 }, fired: [], triggerQueue: [], stateEvents: [], series: [] },
      },
    }
    await importFile(JSON.stringify(doc))
    expect(useSimStore.getState().seed).toBe(99)
    expect(useMcStore.getState().config.baseSeed).toBe(4242)
  })
})

// ── defensive reader — corruption never blocks the graph ────────────────
describe('a corrupt workspace never blocks the graph; only the bad part is dropped', () => {
  const wsDoc = (workspace: unknown) => {
    buildGraph()
    return JSON.stringify({
      schema: 'loop-studio/graph', version: 1, nodes: graph().nodes, edges: graph().edges, workspace,
    })
  }

  it('a completely garbage workspace ⇒ graph loads, nothing restored', async () => {
    const out = await importFile(wsDoc({ schema: 'loop-workspace/1', version: 1, mc: 'nope', view: 42, simulation: [] }))
    expect(out.workspace).toBe(true)
    expect(useGraphStore.getState().nodes).toHaveLength(3) // graph fine
    expect(useMcStore.getState().result).toBeNull()
    expect(useSimStore.getState().stepIndex).toBe(0)
  })

  it('unsupported version ⇒ graph only + warning', async () => {
    const out = await importFile(wsDoc({ schema: 'loop-workspace/1', version: 2, mc: {}, view: {} }))
    expect(out.warnings.join(' ')).toMatch(/needs a newer Loop Studio/)
    expect(useGraphStore.getState().nodes).toHaveLength(3)
  })

  it('a corrupt result is discarded while config / view / sim still restore', async () => {
    buildGraph()
    const poolId = useGraphStore.getState().nodes.find((n) => n.data.kind === 'pool')!.id
    const badResult = { ...fakeResult(poolId), series: { [poolId]: { p50: [0, 1] } } } // wrong band length
    const doc = wsDoc({
      schema: 'loop-workspace/1', version: 1,
      mc: { config: { baseSeed: 7, runs: 3, steps: 2, tracked: [poolId] }, result: badResult, resultGraphDigest: 'a'.repeat(64), stale: false },
      view: { timeline: 'distribution', distributionPoolId: poolId, showMean: true },
      canvas: { x: 5, y: 6, zoom: 2 },
      simulation: { seed: 3, step: 0, ended: false, values: { [poolId]: 0 }, fired: [], triggerQueue: [], stateEvents: [], series: [] },
    })
    const out = await importFile(doc)
    expect(out.warnings.join(' ')).toMatch(/corrupt/)
    expect(useMcStore.getState().result).toBeNull()
    expect(useMcStore.getState().config.baseSeed).toBe(7) // config restored
    expect(useSimStore.getState().seed).toBe(3) // sim restored
    expect(useMcStore.getState().view).toBe('live') // §W5: distribution w/o result ⇒ live
  })
})

// ── triggerQueue guard + canonical sort ────────────────────────────────
describe('triggerQueue is filtered to live state edges/targets and re-sorted', () => {
  it('drops entries for missing edges/targets and orders by (deliveryStep, edgeId)', async () => {
    const ids = buildGraph()
    const doc = JSON.stringify({
      schema: 'loop-studio/graph', version: 1, nodes: graph().nodes, edges: graph().edges,
      workspace: {
        schema: 'loop-workspace/1', version: 1,
        mc: { config: { baseSeed: 1, runs: 3, steps: 2, tracked: [] }, stale: false },
        view: { timeline: 'live', distributionPoolId: null, showMean: false },
        canvas: { x: 0, y: 0, zoom: 1 },
        simulation: {
          seed: 1, step: 2, ended: false, values: { [ids.poolId]: 4 }, fired: [], stateEvents: [],
          series: [{ step: 2, values: { [ids.poolId]: 4 } }],
          triggerQueue: [
            { edgeId: 'ghost', target: ids.drainId, deliveryStep: 3 }, // edge gone
            { edgeId: ids.trigId, target: 'ghost-node', deliveryStep: 3 }, // target gone
            { edgeId: ids.trigId, target: ids.drainId, deliveryStep: 5 },
            { edgeId: ids.trigId, target: ids.drainId, deliveryStep: 3 },
            { edgeId: ids.trigId, target: ids.drainId, deliveryStep: 1 }, // <= step ⇒ dropped
          ],
        },
      },
    })
    await importFile(doc)
    const q = useSimStore.getState().triggerQueue
    expect(q).toEqual([
      { edgeId: ids.trigId, target: ids.drainId, deliveryStep: 3 },
      { edgeId: ids.trigId, target: ids.drainId, deliveryStep: 5 },
    ])
  })
})

// ── series — per-Pool independent validation ────────────────────────────
describe('series validation is per-Pool and never discards the whole snapshot', () => {
  it('a bad value for one Pool drops only that key; other Pools and the snapshot survive', async () => {
    const g = useGraphStore.getState()
    g.newGraph()
    g.addNodeAt('pool', { x: 0, y: 0 })
    g.addNodeAt('pool', { x: 200, y: 0 })
    const [pa, pb] = useGraphStore.getState().nodes
    const doc = JSON.stringify({
      schema: 'loop-studio/graph', version: 1, nodes: graph().nodes, edges: graph().edges,
      workspace: {
        schema: 'loop-workspace/1', version: 1,
        mc: { config: { baseSeed: 1, runs: 3, steps: 2, tracked: [] }, stale: false },
        view: { timeline: 'live', distributionPoolId: null, showMean: false },
        canvas: { x: 0, y: 0, zoom: 1 },
        simulation: {
          seed: 1, step: 1, ended: false,
          values: { [pa.id]: 3, [pb.id]: 5 }, fired: [], triggerQueue: [], stateEvents: [],
          series: [
            { step: 0, values: { [pa.id]: 0, [pb.id]: 0 } },
            { step: 1, values: { [pa.id]: 3, [pb.id]: 'oops', unknownPool: 9 } },
          ],
        },
      },
    })
    const out = await importFile(doc)
    expect(out.warnings).toEqual([]) // not fatal
    const s = useSimStore.getState().series
    expect(s).toHaveLength(2)
    expect(s[1].values[pa.id]).toBe(3) // good key kept
    expect(pb.id in s[1].values).toBe(false) // bad key dropped
    expect('unknownPool' in s[1].values).toBe(false) // unknown key dropped
    expect(useSimStore.getState().stepIndex).toBe(1) // snapshot still restored
  })
})
