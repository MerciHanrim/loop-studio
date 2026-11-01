import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ENGINE_REVISION } from '../src/engine/revision'
import { initSim, runMonteCarlo } from '../src/engine'
import { deserialize, serialize } from '../src/model/serialize'
import { buildWorkspacePayload, semanticDigest } from '../src/model/workspace'
import { useGraphStore } from '../src/store/graphStore'
import { useMcStore } from '../src/store/mcStore'
import { useSimStore } from '../src/store/simStore'
import { importFile } from '../src/store/workspaceIO'

// SEMANTICS-W2.md — a committed `loop-workspace/2` file with a real Monte Carlo
// result computed at engine revision 1 (`test/fixtures/workspace-v2-engine-revision-1.json`,
// from `examples/equilibrium.json`, 20 runs × 12 steps, seed 1).
//
// Two uses. (1) Here: the file this app writes is the file this app reads —
// while `ENGINE_REVISION` is 1 the result imports current; once the revision
// moves on, the same file imports stale with the §W2-2 (3) notice, so the
// fixture never needs regenerating. (2) The older-app check of §W2-5: an app
// from before `loop-workspace/2` opens this file's graph and skips its
// workspace with the §W5.3 warning — run once against the base commit's code
// and its portable build, recorded in the pull request that introduced W2.
//
// Regenerate (only if the file shape itself changes):
//   GEN_WORKSPACE_V2_FIXTURE=1 npm test -- workspace-v2-fixture

const FIXTURE = resolve(import.meta.dirname, 'fixtures/workspace-v2-engine-revision-1.json')
const FIXTURE_REVISION = 1

describe('loop-workspace/2 fixture', () => {
  beforeEach(() => {
    useMcStore.getState().clear()
    useSimStore.getState().reset()
    useGraphStore.getState().newGraph()
  })

  if (process.env.GEN_WORKSPACE_V2_FIXTURE) {
    it('regenerates the fixture from examples/equilibrium.json', async () => {
      expect(ENGINE_REVISION, 'the fixture is named after revision 1; a later engine would record its own').toBe(FIXTURE_REVISION)
      const doc = deserialize(readFileSync(resolve(import.meta.dirname, '../examples/equilibrium.json'), 'utf8'))
      const config = { baseSeed: 1, runs: 20, steps: 12, tracked: [] as string[], modelVersion: doc.modelVersion }
      const result = runMonteCarlo(doc.nodes, doc.edges, config)
      const { modelVersion: _mv, ...savedConfig } = config
      const payload = buildWorkspacePayload({
        mc: {
          config: savedConfig,
          result,
          resultGraphDigest: await semanticDigest({ nodes: doc.nodes, edges: doc.edges }, doc.modelVersion),
          engineRevision: ENGINE_REVISION,
          stale: false,
        },
        view: { timeline: 'distribution', distributionPoolId: result.pools[0]?.id ?? null, showMean: false },
        canvas: { x: 0, y: 0, zoom: 1 },
        simulation: {
          seed: 1, step: 0, ended: false, values: initSim(doc.nodes).values,
          fired: [], triggerQueue: [], stateEvents: [], series: [],
        },
      })
      writeFileSync(FIXTURE, serialize(doc.nodes, doc.edges, undefined, payload, undefined, doc.modelVersion) + '\n')
    })
  }

  it('is a loop-workspace/2 file with a result at engine revision 1', () => {
    const file = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    expect(file.workspace.schema).toBe('loop-workspace/2')
    expect(file.workspace.version).toBe(2)
    expect(file.workspace.mc.engineRevision).toBe(FIXTURE_REVISION)
    expect(file.workspace.mc.result.completedRuns).toBe(20)
    expect(file.workspace.mc.resultGraphDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('imports with its result current at revision 1, and stale with the engine notice at any other revision', async () => {
    const text = readFileSync(FIXTURE, 'utf8')
    const out = await importFile(text)
    expect(out.workspace).toBe(true)
    expect(useGraphStore.getState().nodes.length).toBe(JSON.parse(text).nodes.length)
    const mc = useMcStore.getState()
    expect(mc.status).toBe('done')
    expect(mc.resultEngineRevision).toBe(FIXTURE_REVISION)
    if (ENGINE_REVISION === FIXTURE_REVISION) {
      expect(out.warnings).toEqual([])
      expect(mc.stale).toBe(false)
    } else {
      expect(out.warnings.join(' ')).toMatch(/different version of the engine/)
      expect(mc.stale).toBe(true)
    }
  })
})
