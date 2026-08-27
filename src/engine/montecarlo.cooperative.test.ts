import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import {
  CELL_LIMIT,
  runMonteCarlo,
  runMonteCarloCooperative,
  toMonteCarloJson,
  type RunConfig,
} from './index'

const XY = { x: 0, y: 0 }
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({ id, type: 'source', position: XY, data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' } })
const gate = (id: string): LoopNode => ({ id, type: 'gate', position: XY, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'probabilistic', mode: 'pullAny' } })
const drain = (id: string): LoopNode => ({ id, type: 'drain', position: XY, data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' } })
const end = (id: string, pullAll = false): LoopNode => ({ id, type: 'end', position: XY, data: { kind: 'end', label: id, activation: 'automatic', ...(pullAll ? { mode: 'pullAll' } : {}) } })
const edge = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow } })

// random flow + probabilistic gate + an early-ending End + a second pool
const nodes = [
  source('S'), pool('V', 3, null), gate('G'), pool('P', 0, 6), drain('A'), end('Z', true),
]
const edges = [
  edge('e1', 'S', 'V', '2D6'),
  edge('e2', 'V', 'G', 'all'),
  edge('eA', 'G', 'A', '1'),
  edge('eB', 'G', 'P', '2'),
  edge('e3', 'P', 'Z', '1-3'),
]
const cfg: RunConfig = { baseSeed: 11, runs: 120, steps: 14, tracked: [] }

describe('runMonteCarloCooperative — byte-identical to the sync reference', () => {
  const ref = toMonteCarloJson(runMonteCarlo(nodes, edges, cfg))

  it('default options', async () => {
    expect(toMonteCarloJson(await runMonteCarloCooperative(nodes, edges, cfg))).toEqual(ref)
  })

  it('any batchSize / frameBudgetMs gives the same result', async () => {
    for (const batchSize of [1, 3, 7, 64, 10_000]) {
      for (const frameBudgetMs of [0, 1, 8, 100]) {
        const j = toMonteCarloJson(
          await runMonteCarloCooperative(nodes, edges, cfg, { batchSize, frameBudgetMs }),
        )
        expect(j, `batchSize ${batchSize} frameBudgetMs ${frameBudgetMs}`).toEqual(ref)
      }
    }
  })

  it('a deterministic graph also matches', async () => {
    const dcfg: RunConfig = { baseSeed: 2, runs: 60, steps: 10, tracked: ['V'] }
    const dnodes = [source('S'), pool('V', 0, null), drain('A')]
    const dedges = [edge('e1', 'S', 'V', '3'), edge('e2', 'V', 'A', '1')]
    expect(toMonteCarloJson(await runMonteCarloCooperative(dnodes, dedges, dcfg, { batchSize: 5 }))).toEqual(
      toMonteCarloJson(runMonteCarlo(dnodes, dedges, dcfg)),
    )
  })
})

describe('runMonteCarloCooperative — event loop', () => {
  it('actually yields: an independent macrotask runs mid-loop, between batches', async () => {
    // an "equivalent task" per the spec — a separate MessageChannel message,
    // scheduled before the run, must be dispatched while the loop is only
    // partway through (i.e. the loop `await`ed a real macrotask between batches).
    const probe = new MessageChannel()
    let taskRan = false
    let taskRanWhilePartial = false
    probe.port1.onmessage = () => {
      taskRan = true
    }
    probe.port1.start?.()
    probe.port2.postMessage(null)

    await runMonteCarloCooperative(
      nodes,
      edges,
      { ...cfg, runs: 400 },
      {
        batchSize: 8,
        frameBudgetMs: 0,
        progressEvery: 8,
        onProgress: (p) => {
          if (taskRan && p.completedRuns > 0 && p.completedRuns < 400) taskRanWhilePartial = true
        },
      },
    )
    probe.port1.close()
    probe.port2.close()
    expect(taskRan).toBe(true)
    expect(taskRanWhilePartial).toBe(true) // ran between two batches, not only at the end
  })

  it('the synchronous reference does NOT let a pending macrotask run before it returns', async () => {
    const probe = new MessageChannel()
    let ran = false
    probe.port1.onmessage = () => {
      ran = true
    }
    probe.port1.start?.()
    probe.port2.postMessage(null)
    runMonteCarlo(nodes, edges, { ...cfg, runs: 400 })
    expect(ran).toBe(false) // sync path never yielded
    await new Promise((r) => setTimeout(r, 0))
    expect(ran).toBe(true)
    probe.port1.close()
    probe.port2.close()
  })
})

describe('runMonteCarloCooperative — cancellation', () => {
  it('a signal aborted from the start → AbortError, completedRuns 0, no engine work', async () => {
    const ac = new AbortController()
    ac.abort()
    const t0 = performance.now()
    // an over-CELL_LIMIT config: if abort were NOT checked first we would get
    // the cell-limit error (or spend time allocating / running) instead.
    const huge: RunConfig = { baseSeed: 1, runs: CELL_LIMIT, steps: 4, tracked: [] }
    let caught: unknown
    try {
      await runMonteCarloCooperative(nodes, edges, huge, { signal: ac.signal })
      expect.unreachable('should have thrown')
    } catch (e) {
      caught = e
    }
    expect((caught as Error).name).toBe('AbortError')
    expect((caught as { completedRuns?: number }).completedRuns).toBe(0)
    expect(performance.now() - t0).toBeLessThan(25) // bailed before any allocation / step()
  })

  it('aborting during the run → AbortError carrying the batch-boundary completedRuns', async () => {
    const ac = new AbortController()
    let caught: unknown
    try {
      await runMonteCarloCooperative(
        nodes,
        edges,
        { ...cfg, runs: 5000, steps: 20 },
        {
          batchSize: 10,
          frameBudgetMs: 0,
          progressEvery: 10,
          signal: ac.signal,
          onProgress: (p) => {
            if (p.completedRuns >= 30) ac.abort()
          },
        },
      )
      expect.unreachable('should have thrown')
    } catch (e) {
      caught = e
    }
    expect((caught as Error).name).toBe('AbortError')
    const c = (caught as { completedRuns?: number }).completedRuns ?? -1
    expect(c).toBeGreaterThanOrEqual(30)
    expect(c).toBeLessThan(5000)
    expect(c % 10).toBe(0) // batch boundary, never mid-run
  })
})

describe('runMonteCarloCooperative — CELL_LIMIT', () => {
  it('rejects an over-limit config (no abort) before running', async () => {
    await expect(
      runMonteCarloCooperative(nodes, edges, { baseSeed: 1, runs: CELL_LIMIT, steps: 4, tracked: [] }),
    ).rejects.toThrow(/cell limit/i)
  })
})
