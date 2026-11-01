import { beforeEach, describe, expect, it } from 'vitest'
import { ENGINE_REVISION } from '../engine/revision'
import { toMonteCarloJson, type MonteCarloResult } from '../engine/montecarlo'
import { readWorkspace, semanticDigest } from '../model/workspace'
import { useGraphStore } from './graphStore'
import { useMcStore } from './mcStore'
import { useSimStore } from './simStore'
import { collectWorkspacePayload, importFile, serializeWorkspaceFile } from './workspaceIO'

// SEMANTICS-W2.md (loop-workspace/2) — the engine revision beside a saved
// Monte Carlo result (§W2-1) and the rule that reads it (§W2-2): a result whose
// revision is missing or not this app's is attached stale, with one warning,
// and its stored revision travels verbatim. The acceptance vectors of §W2-5.

function buildGraph() {
  const g = useGraphStore.getState()
  g.newGraph()
  g.addNodeAt('source', { x: 0, y: 0 })
  g.addNodeAt('pool', { x: 200, y: 0 })
  const [s, p] = useGraphStore.getState().nodes
  useGraphStore.getState().onConnect({ source: s.id, target: p.id, sourceHandle: 'out', targetHandle: 'in' }, 'flow')
  return p.id
}
const graph = () => {
  const g = useGraphStore.getState()
  return { nodes: g.nodes, edges: g.edges }
}
const fakeResult = (poolId: string, runs = 3, steps = 2) => ({
  completedRuns: runs,
  pools: [{ id: poolId, label: 'P' }],
  runSeeds: Array.from({ length: runs }, (_, i) => i + 1),
  endedRuns: { atOrBeforeStep: Array.from({ length: steps + 1 }, () => 0) },
  series: { [poolId]: { p10: [0, 1, 2], p50: [0, 1, 2], p90: [0, 1, 2], mean: [0, 1, 2], min: [0, 1, 2], max: [0, 1, 2] } },
  final: { [poolId]: { values: [2, 2, 2], summary: { mean: 2, p10: 2, p50: 2, p90: 2, min: 2, max: 2 } } },
  config: { baseSeed: 1, runs, steps, tracked: [poolId] },
})
const file = (poolId: string, mc: Record<string, unknown>, schema = 'loop-workspace/2', version: unknown = 2) =>
  JSON.stringify({
    schema: 'loop-studio/graph', version: 1, nodes: graph().nodes, edges: graph().edges,
    workspace: {
      schema, version,
      mc: { config: { baseSeed: 1, runs: 3, steps: 2, tracked: [poolId] }, stale: false, ...mc },
      view: { timeline: 'live', distributionPoolId: null, showMean: false },
      canvas: { x: 0, y: 0, zoom: 1 },
      simulation: { seed: 5, step: 0, ended: false, values: {}, fired: [], triggerQueue: [], stateEvents: [], series: [] },
    },
  })
const ENGINE_NOTICE = /different version of the engine/

beforeEach(() => {
  useMcStore.getState().clear()
  useSimStore.getState().reset()
  useGraphStore.getState().newGraph()
})

describe('loop-workspace/2 — the engine revision is written with a result', () => {
  it('Export writes the schema, the version and the revision of the result; no revision without a result', async () => {
    const poolId = buildGraph()
    const digest = await semanticDigest(graph())
    let ws = JSON.parse(serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))).workspace
    expect(ws.schema).toBe('loop-workspace/2')
    expect(ws.version).toBe(2)
    expect(ws.mc.engineRevision).toBeUndefined()

    useMcStore.getState().restoreResult({ result: fakeResult(poolId) as never, resultGraphDigest: digest, stale: false, engineRevision: ENGINE_REVISION })
    ws = JSON.parse(serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))).workspace
    expect(ws.mc.engineRevision).toBe(ENGINE_REVISION)
    expect(ws.mc.resultGraphDigest).toBe(digest)
  })

  it('a result restored from a file keeps the revision that produced it, and re-exports it verbatim', async () => {
    const poolId = buildGraph()
    const digest = await semanticDigest(graph())
    const out = await importFile(file(poolId, { result: fakeResult(poolId), resultGraphDigest: digest, engineRevision: ENGINE_REVISION + 1 }))
    expect(out.warnings.join(' ')).toMatch(ENGINE_NOTICE)
    const mc = useMcStore.getState()
    expect(mc.status).toBe('done')
    expect(mc.stale).toBe(true)
    expect(mc.resultEngineRevision).toBe(ENGINE_REVISION + 1)
    const ws = JSON.parse(serializeWorkspaceFile(collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))).workspace
    expect(ws.mc.engineRevision).toBe(ENGINE_REVISION + 1) // verbatim, as the digest
    expect(ws.mc.stale).toBe(true)
  })

  it('the Monte Carlo JSON export carries the revision beside the loop-mc/1 fields, and none when the result has none', () => {
    const r = fakeResult('p') as unknown as MonteCarloResult
    expect(JSON.parse(toMonteCarloJson(r, 1))).toMatchObject({ completedRuns: 3, engineRevision: 1 })
    expect(JSON.parse(toMonteCarloJson(r, null)).engineRevision).toBeUndefined()
    expect(JSON.parse(toMonteCarloJson(r)).engineRevision).toBeUndefined()
  })
})

describe('loop-workspace/2 — reading the revision (§W2-2)', () => {
  it('the same revision and the same graph: the result is current', async () => {
    const poolId = buildGraph()
    const digest = await semanticDigest(graph())
    const out = await importFile(file(poolId, { result: fakeResult(poolId), resultGraphDigest: digest, engineRevision: ENGINE_REVISION }))
    expect(out.warnings).toEqual([])
    expect(useMcStore.getState()).toMatchObject({ status: 'done', stale: false, resultEngineRevision: ENGINE_REVISION })
  })

  it('missing, 0, a string, or a newer revision: the result is attached stale with one notice; config, view and sim still restore', async () => {
    const poolId = buildGraph()
    const digest = await semanticDigest(graph())
    for (const engineRevision of [undefined, 0, '1', ENGINE_REVISION + 1]) {
      useMcStore.getState().clear()
      const mc: Record<string, unknown> = { result: fakeResult(poolId), resultGraphDigest: digest }
      if (engineRevision !== undefined) mc.engineRevision = engineRevision
      const out = await importFile(file(poolId, mc))
      const label = `engineRevision ${JSON.stringify(engineRevision)}`
      expect(out.warnings.filter((w) => ENGINE_NOTICE.test(w)), label).toHaveLength(1)
      expect(out.warnings.some((w) => /earlier version of this graph/.test(w)), label).toBe(false) // the graph did not change
      const s = useMcStore.getState()
      expect(s.status, label).toBe('done')
      expect(s.stale, label).toBe(true)
      expect(s.resultEngineRevision, label).toBe(typeof engineRevision === 'number' ? engineRevision : null)
      expect(useSimStore.getState().seed, label).toBe(5)
    }
  })

  it('a loop-workspace/1 file: config, view and sim restore; its result is attached stale, because it has no revision', async () => {
    const poolId = buildGraph()
    const digest = await semanticDigest(graph())
    const out = await importFile(file(poolId, { result: fakeResult(poolId), resultGraphDigest: digest }, 'loop-workspace/1', 1))
    expect(out.warnings.join(' ')).toMatch(ENGINE_NOTICE)
    expect(useMcStore.getState()).toMatchObject({ status: 'done', stale: true, resultEngineRevision: null })
    expect(useSimStore.getState().seed).toBe(5)
  })

  it('a loop-workspace/1 file carrying engineRevision equal to this app’s: the field is not read, the result is still stale (review of #472, item 2)', async () => {
    const poolId = buildGraph()
    const digest = await semanticDigest(graph())
    const out = await importFile(file(poolId, { result: fakeResult(poolId), resultGraphDigest: digest, engineRevision: ENGINE_REVISION }, 'loop-workspace/1', 1))
    expect(out.workspace).toBe(true)
    expect(out.warnings.join(' ')).toMatch(ENGINE_NOTICE)
    expect(useMcStore.getState()).toMatchObject({ status: 'done', stale: true, resultEngineRevision: null })
    // and the pure reader, with the file's own `stale: false` and a matching digest
    const ws = JSON.parse(file(poolId, { result: fakeResult(poolId), resultGraphDigest: digest, engineRevision: ENGINE_REVISION }, 'loop-workspace/1', 1)).workspace
    const read = readWorkspace(ws, graph(), digest)
    expect(read.restored?.result).toMatchObject({ stale: true, engineRevision: null })
    expect(read.warnings.join(' ')).toMatch(ENGINE_NOTICE)
  })

  it('a changed graph and a different revision: both notices, one stale mark', async () => {
    const poolId = buildGraph()
    const out = await importFile(file(poolId, { result: fakeResult(poolId), resultGraphDigest: 'a'.repeat(64), engineRevision: ENGINE_REVISION + 1 }))
    expect(out.warnings.some((w) => /earlier version of this graph/.test(w))).toBe(true)
    expect(out.warnings.some((w) => ENGINE_NOTICE.test(w))).toBe(true)
    expect(useMcStore.getState().stale).toBe(true)
  })

  it('pure reader: another app with revision N reads this app’s file as stale, and its own as current', async () => {
    const poolId = buildGraph()
    const digest = await semanticDigest(graph())
    const ws = JSON.parse(file(poolId, { result: fakeResult(poolId), resultGraphDigest: digest, engineRevision: ENGINE_REVISION })).workspace
    const other = readWorkspace(ws, graph(), digest, ENGINE_REVISION + 7)
    expect(other.restored?.result?.stale).toBe(true)
    expect(other.restored?.result?.engineRevision).toBe(ENGINE_REVISION)
    expect(other.warnings.join(' ')).toMatch(ENGINE_NOTICE)
    const same = readWorkspace(ws, graph(), digest)
    expect(same.restored?.result?.stale).toBe(false)
    expect(same.warnings).toEqual([])
  })
})
