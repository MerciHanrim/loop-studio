import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import {
  CELL_LIMIT,
  canUseWorkers,
  runMonteCarlo,
  runMonteCarloParallel,
  runRange,
  runSeed,
  toMonteCarloJson,
  type RunConfig,
} from './index'

// In the vitest (node) environment there is no DOM `Worker`, so
// `runMonteCarloParallel` exercises its synchronous fallback. The Worker-only
// criteria (inline worker on web + file://, N-worker byte-equality, leak-free
// repeats) are checked in the browser — see the session notes.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({ id, type: 'source', position: XY, data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' } })
const gate = (id: string): LoopNode => ({ id, type: 'gate', position: XY, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'probabilistic', mode: 'pullAny' } })
const drain = (id: string): LoopNode => ({ id, type: 'drain', position: XY, data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' } })
const edge = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow } })

const nodes = [source('S'), pool('V', 3, 12), gate('G'), drain('A'), pool('P', 0, 8), drain('B')]
const edges = [
  edge('e1', 'S', 'V', '1-3'),
  edge('e2', 'V', 'G', 'all'),
  edge('eA', 'G', 'A', '1'),
  edge('eB', 'G', 'P', '2'),
  edge('e3', 'P', 'B', '1-2'),
]
const cfg: RunConfig = { baseSeed: 5, runs: 40, steps: 9, tracked: [] }

describe('runMonteCarloParallel — synchronous fallback (no DOM Worker)', () => {
  it('canUseWorkers() is false under vitest/node', () => {
    expect(canUseWorkers()).toBe(false)
  })

  it('falls back to runMonteCarlo and matches it byte-for-byte', async () => {
    const sync = runMonteCarlo(nodes, edges, cfg)
    const par = await runMonteCarloParallel(nodes, edges, cfg, { workers: 4, jobSize: 7 })
    expect(toMonteCarloJson(par)).toEqual(toMonteCarloJson(sync))
  })

  it('workers: 1 is the sync path', async () => {
    const sync = runMonteCarlo(nodes, edges, cfg)
    const par = await runMonteCarloParallel(nodes, edges, cfg, { workers: 1 })
    expect(toMonteCarloJson(par)).toEqual(toMonteCarloJson(sync))
  })

  it('rejects an over-CELL_LIMIT config', async () => {
    await expect(
      runMonteCarloParallel([source('S'), pool('P', 0)], [edge('e1', 'S', 'P', '1')], {
        baseSeed: 1,
        runs: Math.ceil(CELL_LIMIT / 2) + 1,
        steps: 1,
        tracked: [],
      }, { workers: 4 }),
    ).rejects.toThrow(/cell limit/i)
  })

  it('an already-aborted signal → AbortError', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      runMonteCarloParallel(nodes, edges, cfg, { workers: 4, signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('runRange — the Worker envelope layout', () => {
  it('de-interleaving a full-range runRange reproduces the sync trajectories', () => {
    const poolIds = ['V', 'P']
    const span = cfg.steps + 1
    const poolCount = poolIds.length
    const { values, endedAt } = runRange(nodes, edges, cfg, poolIds, 0, cfg.runs)

    // rebuild per-pool run-major store from the interleaved envelope
    const store = poolIds.map(() => new Float64Array(cfg.runs * span))
    for (let r = 0; r < cfg.runs; r++) {
      for (let t = 0; t < span; t++) {
        const base = (r * span + t) * poolCount
        for (let p = 0; p < poolCount; p++) store[p][r * span + t] = values[base + p]
      }
    }

    const sync = runMonteCarlo(nodes, edges, { ...cfg, tracked: poolIds })
    // terminal (carry-forward) values match, per pool, in run-index order
    expect(Array.from({ length: cfg.runs }, (_, r) => store[0][r * span + cfg.steps])).toEqual(
      sync.final.V.values,
    )
    expect(Array.from({ length: cfg.runs }, (_, r) => store[1][r * span + cfg.steps])).toEqual(
      sync.final.P.values,
    )
    // endedAt reconstructs the same monotone histogram
    const cum = new Array<number>(span).fill(0)
    for (let r = 0; r < cfg.runs; r++) {
      const e = endedAt[r]
      if (e >= 0) for (let t = e; t < span; t++) cum[t]++
    }
    expect(cum).toEqual(sync.endedRuns.atOrBeforeStep)
  })

  it('a sub-range starts its local index at 0 but uses global run seeds', () => {
    const poolIds = ['V', 'P']
    const span = cfg.steps + 1
    const mid = runRange(nodes, edges, cfg, poolIds, 10, 20)
    const full = runRange(nodes, edges, cfg, poolIds, 0, cfg.runs)
    // local run 0 of the sub-range == global run 10 of the full range
    for (let t = 0; t < span; t++) {
      for (let p = 0; p < 2; p++) {
        expect(mid.values[(0 * span + t) * 2 + p]).toBe(full.values[(10 * span + t) * 2 + p])
      }
    }
    expect(runSeed(cfg.baseSeed, 10)).toBeTypeOf('number')
  })
})
