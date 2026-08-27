import { describe, expect, it } from 'vitest'
import fixtureDoc from '../../examples/engine-b-verification.json'
import committedExpected from '../../examples/engine-b-verification.expected.json'
import { normalizeGraph } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { MC_SPEC, runMonteCarlo, toMonteCarloJson, type MonteCarloResult, type RunConfig } from './index'
import { initSim, step } from './step'

// `examples/engine-b-verification.json` is a real Export from the app (built via
// the graph store + serializer). This test re-derives every value recorded in
// `examples/engine-b-verification.expected.json` from that fixture and asserts
// they still match — an Engine A + Engine B (RNG, Monte-Carlo) regression guard.
//
// To regenerate after a deliberate change, set GEN_FIXTURE=1 (writes both files).

const round = (v: number) => Math.round(v * 1e6) / 1e6

function loadFixture(): { nodes: LoopNode[]; edges: LoopEdge[] } {
  return normalizeGraph(fixtureDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[] })
}
const poolIdByLabel = (nodes: LoopNode[], label: string) =>
  nodes.find((n) => n.data.kind === 'pool' && n.data.label === label)!.id

/** step the graph `steps` times at `seed`; return each Pool's value per step */
function trace(nodes: LoopNode[], edges: LoopEdge[], seed: number, steps: number) {
  let st = initSim(nodes)
  const poolIds = nodes.filter((n) => n.data.kind === 'pool').map((n) => n.id)
  const rows: Record<string, number[]> = Object.fromEntries(
    poolIds.map((id) => [id, [st.values[id] ?? 0]]),
  )
  for (let t = 1; t <= steps; t++) {
    st = step(nodes, edges, st, seed).state
    for (const id of poolIds) rows[id].push(st.values[id] ?? 0)
  }
  return rows
}

function fnvHex(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ (c & 0xff), 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c >>> 8), 0x01000193) >>> 0
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}
function digest(mc: MonteCarloResult) {
  return {
    completedRuns: mc.completedRuns,
    pools: mc.pools.map((p) => p.label),
    runSeed0: mc.runSeeds[0],
    endedRunsLast: mc.endedRuns.atOrBeforeStep.at(-1),
    finalMeans: Object.fromEntries(
      mc.pools.map((p) => [p.label, round(mc.final[p.id].summary.mean)]),
    ),
  }
}

function deriveExpected(nodes: LoopNode[], edges: LoopEdge[]) {
  const detPool = poolIdByLabel(nodes, 'Det Pool')
  const dicePool = poolIdByLabel(nodes, 'Dice Pool')
  const gateA = poolIdByLabel(nodes, 'Gate A')
  const gateB = poolIdByLabel(nodes, 'Gate B')

  const s1 = trace(nodes, edges, 1, 10)
  const s2 = trace(nodes, edges, 2, 10)

  const config: RunConfig = { baseSeed: 1, runs: 200, steps: 30, tracked: [detPool, dicePool, gateA, gateB] }
  const mc = runMonteCarlo(nodes, edges, config)
  const band = (id: string) => ({
    p10: mc.series[id].p10.map(round),
    p50: mc.series[id].p50.map(round),
    p90: mc.series[id].p90.map(round),
  })
  const gaMean = mc.final[gateA].summary.mean
  const gbMean = mc.final[gateB].summary.mean

  return {
    about: 'Engine B verification fixture. Import engine-b-verification.json, then follow examples/README.md.',
    spec: MC_SPEC,
    pools: { detPool, dicePool, gateA, gateB },
    deterministicLane: {
      note: 'Det Pool must increase by exactly 1 every step (Source 2, Drain 1, init 1).',
      seed1PoolValues: s1[detPool],
      deltaAlwaysOne: s1[detPool].slice(1).every((v, i) => v - s1[detPool][i] === 1),
    },
    diceLane: {
      note: 'Same seed ⇒ identical trajectory; a different seed diverges.',
      seed1PoolValues: s1[dicePool],
      seed2PoolValues: s2[dicePool],
      seed1DiffersFromSeed2: JSON.stringify(s1[dicePool]) !== JSON.stringify(s2[dicePool]),
    },
    gateLane: {
      note: 'Exactly one branch moves per step; long-run ≈ 25 / 75.',
      seed1GateAValues: s1[gateA],
      seed1GateBValues: s1[gateB],
      oneBranchPerStep: s1[gateA].slice(1).every((a, i) => {
        const da = a - s1[gateA][i]
        const db = s1[gateB][i + 1] - s1[gateB][i]
        return (da > 0) !== (db > 0) || (da === 0 && db === 0)
      }),
      gateBShare: round(gbMean / (gaMean + gbMean)),
    },
    monteCarlo: {
      config,
      trackedPools: config.tracked,
      bands: { detPool: band(detPool), dicePool: band(dicePool), gateA: band(gateA), gateB: band(gateB) },
      resultJsonSha256: fnvHex(toMonteCarloJson(mc)),
      resultDigest: digest(mc),
    },
  }
}

describe('engine-b verification fixture', () => {
  const { nodes, edges } = loadFixture()
  const derived = deriveExpected(nodes, edges)

  it('reproduces examples/engine-b-verification.expected.json exactly', async () => {
    if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEN_FIXTURE === '1') {
      const fs = await import('node:' + 'fs') // non-literal: no @types/node needed for the dev-only path
      fs.writeFileSync(
        new URL('../../examples/engine-b-verification.json', import.meta.url),
        JSON.stringify(fixtureDoc, null, 2) + '\n',
      )
      fs.writeFileSync(
        new URL('../../examples/engine-b-verification.expected.json', import.meta.url),
        JSON.stringify(derived, null, 2) + '\n',
      )
      return
    }
    expect(derived).toEqual(committedExpected)
  })

  it('deterministic lane rises by exactly 1 each step', () => {
    expect(derived.deterministicLane.deltaAlwaysOne).toBe(true)
    expect(derived.deterministicLane.seed1PoolValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('dice lane is seed-sensitive and its Monte-Carlo band widens over time', () => {
    expect(derived.diceLane.seed1DiffersFromSeed2).toBe(true)
    const b = derived.monteCarlo.bands.dicePool
    const spreadEarly = b.p90[1] - b.p10[1]
    const spreadLate = b.p90[30] - b.p10[30]
    expect(spreadLate).toBeGreaterThan(spreadEarly * 3) // a real widening cone
  })

  it('probabilistic gate fires one branch per step and lands ≈ 75 % on branch B', () => {
    expect(derived.gateLane.oneBranchPerStep).toBe(true)
    expect(derived.gateLane.gateBShare).toBeGreaterThan(0.68)
    expect(derived.gateLane.gateBShare).toBeLessThan(0.82)
  })

  it('deterministic-lane band has zero spread (p10 == p50 == p90)', () => {
    const b = derived.monteCarlo.bands.detPool
    expect(b.p10).toEqual(b.p50)
    expect(b.p50).toEqual(b.p90)
  })
})
