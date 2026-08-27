import { describe, expect, it } from 'vitest'
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

  it('reports exact memory + an over-limit flag', async () => {
    const e = await estimateMonteCarloCost(nodes, edges, cfg)
    expect(e.memoryBytes).toBeGreaterThan(0)
    expect(e.overLimit).toBe(false)
    const big = await estimateMonteCarloCost(nodes, edges, { ...cfg, runs: 3_000_000 })
    expect(big.overLimit).toBe(true)
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

  it('a tiny run count uses the local (non-parallel) path', async () => {
    const e = await estimateMonteCarloCost(nodes, edges, { ...cfg, runs: 8 })
    expect(e.path).toBe('local')
  })
})
