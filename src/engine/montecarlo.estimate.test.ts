import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { defaultWorkerCount, estimateMonteCarloCost, type RunConfig } from './index'

const XY = { x: 0, y: 0 }
const pool = (id: string, initial: number): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({ id, type: 'source', position: XY, data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' } })
const edge = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow } })

const nodes = [source('S'), pool('P', 0)]
const edges = [edge('e1', 'S', 'P', '1-3')]
const cfg: RunConfig = { baseSeed: 1, runs: 200, steps: 30, tracked: [] }

describe('estimateMonteCarloCost', () => {
  it('the default worker count never exceeds 4', () => {
    expect(defaultWorkerCount()).toBeLessThanOrEqual(4)
    expect(defaultWorkerCount()).toBeGreaterThanOrEqual(1)
  })

  it('reports exact memory + an over-limit flag; over the limit nothing is probed and there is no time band (#419 item 3)', async () => {
    const e = await estimateMonteCarloCost(nodes, edges, cfg)
    expect(e.memoryBytes).toBeGreaterThan(0)
    expect(e.overLimit).toBe(false)
    const t0 = performance.now()
    const big = await estimateMonteCarloCost(nodes, edges, { ...cfg, runs: 3_000_000, steps: 1_000_000 })
    expect(big.overLimit).toBe(true)
    expect(big.source).toBe('none')
    expect(big.lowMs).toBe(0)
    expect(big.highMs).toBe(0)
    expect(performance.now() - t0).toBeLessThan(500) // no probe ran (16 × 1 000 000 steps would take minutes)
  })

  it('the probe is bounded: a huge step count returns a band without running the full length (#419 item 3)', async () => {
    // before: the first sample was 16 full-length runs — 3.2 million engine
    // steps here, 11.5 s on the authoring machine — before the budget was read
    // (24 runs × 200 000 steps × 1 Pool = 4.8 M cells, under the memory limit)
    const t0 = performance.now()
    const e = await estimateMonteCarloCost(nodes, edges, { ...cfg, runs: 24, steps: 200_000 })
    const took = performance.now() - t0
    expect(e.source).toBe('benchmark')
    expect(e.overLimit).toBe(false)
    expect(e.lowMs).toBeGreaterThan(0)
    expect(e.highMs).toBeGreaterThanOrEqual(e.lowMs)
    expect(took).toBeLessThan(1500) // 128-step samples aimed at a 150 ms target, plus slack for a slow CI runner
    // (no assertion on the band's size: it is a timing of a 128-step sample, and
    // two such timings under a loaded test runner do not compare reliably —
    // the band came out smaller for 10× the steps once, under the full suite)
  })

  it('source is "benchmark" without a prior, "measured" with one, and the workers count is capped', async () => {
    const probed = await estimateMonteCarloCost(nodes, edges, cfg)
    expect(probed.source).toBe('benchmark')
    expect(probed.workers).toBeLessThanOrEqual(4)
    expect(probed.lowMs).toBeGreaterThan(0)
    expect(probed.highMs).toBeGreaterThanOrEqual(probed.lowMs)

    const measured = await estimateMonteCarloCost(nodes, edges, cfg, {
      prior: { msPerRunStep: 0.001 },
    })
    expect(measured.source).toBe('measured')
    // 200 runs · 30 steps · 0.001 ms/run-step ≈ 6 ms of work, plus spawn
    expect(measured.lowMs).toBeLessThan(200)
  })

  it('without Workers (here: no DOM `Worker`) the path is local, whatever the run count', async () => {
    const e = await estimateMonteCarloCost(nodes, edges, { ...cfg, runs: 8 })
    expect(e.path).toBe('local')
  })
})

// #620 item 1 — the estimate described the local path below 32 runs while the
// run (runMonteCarloParallel) used Workers whenever more than one was available:
// at 16 runs the dialog said "Local" and the run created 4 Workers. The
// estimate now takes the driver's rule, so the Execution line, the worker count
// and the time band describe the path the run takes.
describe('estimateMonteCarloCost follows the run’s own rule for Workers (#620 item 1)', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', class {})
    vi.stubGlobal('navigator', { hardwareConcurrency: 12 }) // defaultWorkerCount() = 4
  })
  afterEach(() => vi.unstubAllGlobals())

  it('below 32 runs, with Workers available, the path is parallel with the workers the run starts', async () => {
    for (const [runs, workers] of [[16, 4], [3, 3], [2, 2], [64, 4]] as const) {
      const e = await estimateMonteCarloCost(nodes, edges, { ...cfg, runs, steps: 10 })
      expect(e.path, `runs ${runs}`).toBe('parallel')
      expect(e.workers, `runs ${runs}`).toBe(workers)
    }
  })

  it('one run is parallel too (the run starts one Worker), and its band assumes no speed-up', async () => {
    const e = await estimateMonteCarloCost(nodes, edges, { ...cfg, runs: 1, steps: 10 }, { prior: { msPerRunStep: 1 } })
    expect(e.path).toBe('parallel')
    expect(e.workers).toBe(1)
    // 1 run × 10 steps × 1 ms = 10 ms of work, one Worker: never under the work itself
    expect(e.lowMs).toBeGreaterThanOrEqual(10 * 0.85)
    expect(e.highMs).toBeGreaterThanOrEqual(e.lowMs)
  })

  it('one core (one worker at most): the run stays local, and so does the estimate', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 1 })
    const e = await estimateMonteCarloCost(nodes, edges, { ...cfg, runs: 64, steps: 10 })
    expect(e.path).toBe('local')
  })
})
