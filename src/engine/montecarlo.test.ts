import { describe, expect, it, vi } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import {
  CELL_LIMIT,
  neumaier,
  projectMemory,
  quantile,
  runMonteCarlo,
  runSeed,
  toFinalCsv,
  toFinalSummaryCsv,
  toMonteCarloJson,
  toSeriesCsv,
  type MonteCarloProgress,
  type RunConfig,
} from './index'

// SEMANTICS-B2.md §MC9 — frozen fixtures.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({ id, type: 'source', position: XY, data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' } })
const gate = (id: string, distribution: 'deterministic' | 'probabilistic'): LoopNode => ({ id, type: 'gate', position: XY, data: { kind: 'gate', label: id, activation: 'automatic', distribution, mode: 'pullAny' } })
const drain = (id: string): LoopNode => ({ id, type: 'drain', position: XY, data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' } })
const end = (id: string, pullAll = false): LoopNode => ({ id, type: 'end', position: XY, data: { kind: 'end', label: id, activation: 'automatic', ...(pullAll ? { mode: 'pullAll' } : {}) } })
const edge = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow } })

// ── loop-mc-seed/1 ───────────────────────────────────────────────────────
describe('runSeed — loop-mc-seed/1 (frozen, baseSeed 1)', () => {
  it('i = 0…7', () => {
    expect(Array.from({ length: 8 }, (_, i) => runSeed(1, i))).toEqual([
      1119822658, 2846739420, 1652246540, 2344041868, 2234127498, 2381107215, 3605042148,
      3442733231,
    ])
  })
  it('is keyed in i, not sequential — extending the range never moves an existing seed', () => {
    const first8 = Array.from({ length: 8 }, (_, i) => runSeed(1, i))
    const first16 = Array.from({ length: 16 }, (_, i) => runSeed(1, i))
    expect(first16.slice(0, 8)).toEqual(first8)
  })
  it('baseSeed changes every derived seed', () => {
    expect(runSeed(2, 0)).not.toBe(runSeed(1, 0))
  })
})

// ── aggregation primitives ───────────────────────────────────────────────
describe('quantile — R-7 / linear on (n-1)q', () => {
  it('n = 1', () => expect(quantile([5], 0.9)).toBe(5))
  it('endpoints', () => {
    expect(quantile([1, 2, 3, 4], 0)).toBe(1)
    expect(quantile([1, 2, 3, 4], 1)).toBe(4)
  })
  it('interpolates between order statistics: [1,1,1,1,1,1,2,3] p90 = 2.3', () => {
    // h = 7·0.9 = 6.3 → x[6] + 0.3·(x[7]-x[6]) = 2 + 0.3·1
    expect(quantile([1, 1, 1, 1, 1, 1, 2, 3], 0.9)).toBeCloseTo(2.3, 12)
  })
  it('no interpolation when the neighbours are equal: [1,2,2,2,2,3,3,3] p90 = 3', () => {
    expect(quantile([1, 2, 2, 2, 2, 3, 3, 3], 0.9)).toBe(3)
  })
  it('median of even n interpolates: [3,5,6,6,7,7,8,9] p50 = 6.5', () => {
    expect(quantile([3, 5, 6, 6, 7, 7, 8, 9], 0.5)).toBe(6.5)
  })
})

describe('neumaier — order-independent, low error on mixed magnitudes', () => {
  it('[-1e16, 1, 1, 1, 1, 1e16] (sorted) = 4', () => {
    expect(neumaier([-1e16, 1, 1, 1, 1, 1e16])).toBe(4)
    // naive left-to-right on the same sorted array loses the small terms
    expect([-1e16, 1, 1, 1, 1, 1e16].reduce((s, x) => s + x, 0)).toBe(0)
  })
  it('matches a plain sum when magnitudes are close', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7]
    expect(neumaier(xs)).toBe(28)
  })
})

// ── V1: Source [1-3] -> uncapped Pool P ──────────────────────────────────
describe('MC · V1 — Source [1-3] → Pool P, baseSeed 1, runs 8, steps 3', () => {
  const cfg: RunConfig = { baseSeed: 1, runs: 8, steps: 3, tracked: [] }
  const r = runMonteCarlo([source('S'), pool('P', 0)], [edge('e1', 'S', 'P', '1-3')], cfg)
  const S = r.series.P
  const F = r.final.P

  it('per-run terminal values (run-index order)', () => {
    expect(F.values).toEqual([9, 6, 6, 7, 3, 5, 8, 7])
  })
  it('band table matches the frozen §MC9 vectors', () => {
    expect(S.min).toEqual([0, 1, 2, 3])
    expect(S.max).toEqual([0, 3, 6, 9])
    expect(S.p50).toEqual([0, 2, 4.5, 6.5])
    expect(S.mean).toEqual([0, 2.25, 4.25, 6.375])
    expect(S.p10[1]).toBeCloseTo(1.7, 12)
    expect(S.p10[2]).toBeCloseTo(2.7, 12)
    expect(S.p10[3]).toBeCloseTo(4.4, 12)
    expect(S.p90).toEqual([0, 3, 5.3, 8.3])
  })
  it('no runs ended', () => {
    expect(r.endedRuns.atOrBeforeStep).toEqual([0, 0, 0, 0])
  })
  it('runSeeds are recorded and match loop-mc-seed/1', () => {
    expect(r.runSeeds).toEqual(Array.from({ length: 8 }, (_, i) => runSeed(1, i)))
  })
})

// ── V2: mixed early endings + carry-forward ──────────────────────────────
describe('MC · V2 — Source [1-3] → P(cap 6) → End[4, pull all], runs 8, steps 6', () => {
  const cfg: RunConfig = { baseSeed: 1, runs: 8, steps: 6, tracked: ['P'] }
  const r = runMonteCarlo(
    [source('S'), pool('P', 0, 6), end('Z', true)],
    [edge('e1', 'S', 'P', '1-3'), edge('e2', 'P', 'Z', '4')],
    cfg,
  )
  it('endedRuns.atOrBeforeStep = [0,0,0,6,7,8,8]', () => {
    expect(r.endedRuns.atOrBeforeStep).toEqual([0, 0, 0, 6, 7, 8, 8])
  })
  it('carry-forward: every run holds its terminal value from endedAtStep on', () => {
    // run 4 ends latest (step 5) at P = 2; steps 5 and 6 are equal for every run
    for (let i = 0; i < 8; i++) {
      expect(r.series.P.mean[5]).toBe(r.series.P.mean[6])
    }
    expect(r.final.P.values.every((v) => v === 2 || v === 1)).toBe(true)
  })
})

// ── tracked resolution ──────────────────────────────────────────────────
describe('MC · tracked', () => {
  const nodes = [source('S'), pool('A', 0), pool('B', 1)]
  const edges = [edge('e1', 'S', 'A', '1')]
  it('empty tracked = every Pool in graph order', () => {
    const r = runMonteCarlo(nodes, edges, { baseSeed: 1, runs: 2, steps: 2, tracked: [] })
    expect(r.pools.map((p) => p.id)).toEqual(['A', 'B'])
  })
  it('unknown tracked ids are dropped, not fatal', () => {
    const r = runMonteCarlo(nodes, edges, { baseSeed: 1, runs: 2, steps: 2, tracked: ['B', 'ghost', 'S'] })
    expect(r.pools.map((p) => p.id)).toEqual(['B'])
    expect(r.droppedTracked).toEqual(['ghost', 'S'])
  })
})

// ── memory limit ────────────────────────────────────────────────────────
describe('MC · CELL_LIMIT', () => {
  it('projectMemory flags over-limit configs and includes worker buffers', () => {
    const p = projectMemory(100_000, 100, 1)
    expect(p.seriesCells).toBe(100_000 * 101 * 1)
    expect(p.overLimit).toBe(true)
    expect(p.workerBuffers).toBeGreaterThan(0)
  })
  it('runMonteCarlo rejects a config above CELL_LIMIT before running', () => {
    const nodes = [source('S'), pool('P', 0)]
    const edges = [edge('e1', 'S', 'P', '1')]
    const runs = Math.ceil(CELL_LIMIT / 2) + 1 // × (1+1) × 1 pool > CELL_LIMIT
    expect(() => runMonteCarlo(nodes, edges, { baseSeed: 1, runs, steps: 1, tracked: [] })).toThrow(
      /cell limit/i,
    )
  })
})

// ── cancellation ────────────────────────────────────────────────────────
describe('MC · cancellation', () => {
  it('aborted before start → AbortError, no result', () => {
    const ac = new AbortController()
    ac.abort()
    const nodes = [source('S'), pool('P', 0)]
    const edges = [edge('e1', 'S', 'P', '1')]
    try {
      runMonteCarlo(nodes, edges, { baseSeed: 1, runs: 10, steps: 3, tracked: [] }, { signal: ac.signal })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).name).toBe('AbortError')
      expect((e as { completedRuns?: number }).completedRuns).toBe(0)
    }
  })
  it('aborted mid-way → AbortError carrying completedRuns at a batch boundary', () => {
    const ac = new AbortController()
    const nodes = [source('S'), pool('P', 0)]
    const edges = [edge('e1', 'S', 'P', '1')]
    let seen = 0
    const onProgress = (p: MonteCarloProgress) => {
      seen = p.completedRuns
      if (p.completedRuns >= 20) ac.abort()
    }
    try {
      runMonteCarlo(
        nodes,
        edges,
        { baseSeed: 1, runs: 200, steps: 2, tracked: [] },
        { signal: ac.signal, batchSize: 10, progressEvery: 10, onProgress },
      )
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).name).toBe('AbortError')
      expect((e as { completedRuns?: number }).completedRuns).toBeGreaterThanOrEqual(20)
      expect((e as { completedRuns?: number }).completedRuns).toBeLessThan(200)
      expect(seen).toBeGreaterThanOrEqual(20)
    }
  })
})

// ── progress ────────────────────────────────────────────────────────────
describe('MC · progress', () => {
  it('fires provisional updates and one final tick at completedRuns === totalRuns', () => {
    const spy = vi.fn<(p: MonteCarloProgress) => void>()
    runMonteCarlo(
      [source('S'), pool('P', 0)],
      [edge('e1', 'S', 'P', '1')],
      { baseSeed: 1, runs: 100, steps: 2, tracked: [] },
      { batchSize: 16, progressEvery: 16, onProgress: spy },
    )
    expect(spy.mock.calls.length).toBeGreaterThan(1)
    for (const [p] of spy.mock.calls) expect(p.provisional).toBe(true)
    const last = spy.mock.calls.at(-1)![0]
    expect(last.completedRuns).toBe(100)
    expect(last.totalRuns).toBe(100)
    expect(last.progress).toBe(1)
  })
})

// ── I11 / I12 ───────────────────────────────────────────────────────────
describe('MC · I11 execution invariance / I12 determinism', () => {
  const nodes = [
    source('S'), pool('V', 3, 12), gate('G', 'probabilistic'), drain('A'), pool('P', 0, 8), drain('B'),
  ]
  const edges = [
    edge('e1', 'S', 'V', '1-3'),
    edge('e2', 'V', 'G', 'all'),
    edge('eA', 'G', 'A', '1'),
    edge('eB', 'G', 'P', '2'),
    edge('e3', 'P', 'B', '1-2'),
  ]
  const cfg: RunConfig = { baseSeed: 7, runs: 64, steps: 12, tracked: [] }

  it('I12 — two calls give an identical result', () => {
    const a = runMonteCarlo(nodes, edges, cfg)
    const b = runMonteCarlo(nodes, edges, cfg)
    expect(toMonteCarloJson(b)).toEqual(toMonteCarloJson(a))
  })
  it('I11 — batchSize does not change the result', () => {
    const base = toMonteCarloJson(runMonteCarlo(nodes, edges, cfg, { batchSize: 64 }))
    for (const bs of [1, 3, 7, 32, 1000]) {
      expect(toMonteCarloJson(runMonteCarlo(nodes, edges, cfg, { batchSize: bs }))).toEqual(base)
    }
  })
  it('I11 — node/edge array order does not change the result (each run is loop-rng/1)', () => {
    const rev = toMonteCarloJson(runMonteCarlo([...nodes].reverse(), [...edges].reverse(), cfg))
    // pool key order in `series` follows graph order, so compare per pool
    const a = runMonteCarlo(nodes, edges, cfg)
    const b = runMonteCarlo([...nodes].reverse(), [...edges].reverse(), cfg)
    for (const id of Object.keys(a.series)) {
      expect(b.series[id]).toEqual(a.series[id])
      expect(b.final[id]).toEqual(a.final[id])
    }
    expect(rev).toBeTypeOf('string')
  })
})

// ── statistical tolerance (S1–S3) ───────────────────────────────────────
describe('MC · statistical tolerance', () => {
  it('S1 — Source [1-3] → uncapped P, mean[t] ≈ 2t', () => {
    const r = runMonteCarlo(
      [source('S'), pool('P', 0)],
      [edge('e1', 'S', 'P', '1-3')],
      { baseSeed: 1, runs: 20000, steps: 10, tracked: [] },
    )
    for (let t = 0; t <= 10; t++) {
      expect(Math.abs(r.series.P.mean[t] - 2 * t)).toBeLessThan(0.05)
      expect(Math.abs(r.series.P.p50[t] - 2 * t)).toBeLessThanOrEqual(1)
    }
  })
  it('S2 — probabilistic Gate weights [1,3] → weight-3 branch share ≈ 0.75', () => {
    const r = runMonteCarlo(
      [pool('V', 100000), gate('G', 'probabilistic'), drain('A'), pool('P', 0)],
      [edge('ein', 'V', 'G', '1'), edge('eA', 'G', 'A', '1'), edge('eB', 'G', 'P', '3')],
      { baseSeed: 1, runs: 20000, steps: 1, tracked: ['P'] },
    )
    // P gets 1 unit exactly when the weight-3 branch was chosen
    const share = r.final.P.values.filter((v) => v > 0.5).length / r.completedRuns
    expect(Math.abs(share - 0.75)).toBeLessThan(0.01)
  })
  it('S3 — 2D6 into a Pool: mean ≈ 7, deciles in range', () => {
    const r = runMonteCarlo(
      [source('S'), pool('P', 0)],
      [edge('e1', 'S', 'P', '2D6')],
      { baseSeed: 1, runs: 20000, steps: 1, tracked: [] },
    )
    expect(Math.abs(r.series.P.mean[1] - 7)).toBeLessThan(0.1)
    expect(r.series.P.p10[1]).toBeGreaterThanOrEqual(4)
    expect(r.series.P.p10[1]).toBeLessThanOrEqual(5)
    expect(r.series.P.p90[1]).toBeGreaterThanOrEqual(9)
    expect(r.series.P.p90[1]).toBeLessThanOrEqual(10)
  })
})

// ── exports ─────────────────────────────────────────────────────────────
describe('MC · CSV / JSON exports', () => {
  const r = runMonteCarlo(
    [source('S'), pool('A', 0), pool('B', 0)],
    [edge('e1', 'S', 'A', '1-3'), edge('e2', 'S', 'B', '1')],
    { baseSeed: 1, runs: 4, steps: 2, tracked: [] },
  )

  it('series CSV: header + one row per (step, pool)', () => {
    const lines = toSeriesCsv(r).trim().split('\n')
    expect(lines[0]).toBe('step,pool,p10,p50,p90,mean,min,max')
    expect(lines.length).toBe(1 + 3 * 2) // (steps+1) × pools
  })
  it('final CSV: run,seed,<pools> in run-index order, seed matches runSeeds[]', () => {
    const lines = toFinalCsv(r).trim().split('\n')
    expect(lines[0]).toBe('run,seed,A,B')
    for (let i = 0; i < 4; i++) {
      const cells = lines[1 + i].split(',')
      expect(Number(cells[0])).toBe(i)
      expect(Number(cells[1])).toBe(r.runSeeds[i])
      expect(Number(cells[2])).toBe(r.final.A.values[i])
    }
  })
  it('final-summary CSV: one row per pool', () => {
    const lines = toFinalSummaryCsv(r).trim().split('\n')
    expect(lines[0]).toBe('pool,p10,p50,p90,mean,min,max')
    expect(lines.length).toBe(3)
  })
  it('JSON carries the spec ids and stable field order', () => {
    const j = JSON.parse(toMonteCarloJson(r))
    expect(j.spec).toBe('loop-mc/1')
    expect(j.seedSpec).toBe('loop-mc-seed/1')
    expect(j.rngSpec).toBe('loop-rng/1')
    expect(Object.keys(j)).toEqual([
      'spec', 'seedSpec', 'rngSpec', 'config', 'completedRuns', 'droppedTracked',
      'pools', 'runSeeds', 'endedRuns', 'series', 'final',
    ])
  })
})
