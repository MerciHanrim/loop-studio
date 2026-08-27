// Parallel Monte-Carlo driver (SEMANTICS-B2.md §MC7.1). Workers return only raw
// per-run trajectories; the main thread de-interleaves them by run index and
// calls the SAME `aggregateRuns` the synchronous reference uses, so the result
// is byte-identical for any worker count or job size (I11).
//
// Falls back to the synchronous `runMonteCarlo` when Workers are unavailable or
// cannot be constructed (e.g. module workers blocked on `file://`). A worker
// that errors *during* a run fails the whole call — never a silent partial.

import type { LoopEdge, LoopNode } from '../model/types'
import {
  abortError,
  aggregateRuns,
  projectMemory,
  resolveTracked,
  runMonteCarlo,
  runSeed,
  CELL_LIMIT,
  type MonteCarloResult,
  type RunConfig,
  type RunOptions,
} from './montecarlo'

export type ParallelOptions = RunOptions & {
  /** worker pool size; default = hardwareConcurrency (min 1). 1 ⇒ synchronous. */
  workers?: number
  /** run indices per job; default ≈ runs / (workers · 4), clamped ≥ 1. */
  jobSize?: number
}

export const cpuCount = (): number =>
  (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4

/** Modest default: min(4, cores-1). Only an explicit `options.workers` (an
 *  advanced setting) goes higher — a big pool costs spawn time + memory and
 *  rarely helps the small runs the UI defaults to. */
export const defaultWorkerCount = (): number => Math.min(4, Math.max(1, cpuCount() - 1))

/**
 * True if this environment should use Workers. `false` when there is no DOM
 * `Worker` (vitest / SSR) and when the page has an **opaque origin**
 * (`file://` double-click) — inlined blob / data module Workers are unreliable
 * there across browsers, so portable single-file builds take the synchronous
 * path. A portable file *served over http* still uses Workers. The frozen spec
 * and the sync core are unchanged either way (SEMANTICS-B2.md).
 */
export function canUseWorkers(): boolean {
  if (typeof Worker === 'undefined') return false
  try {
    if (typeof location !== 'undefined' && location.protocol === 'file:') return false
  } catch {
    /* no `location` — fine */
  }
  return true
}

export async function runMonteCarloParallel(
  nodes: LoopNode[],
  edges: LoopEdge[],
  config: RunConfig,
  options: ParallelOptions = {},
): Promise<MonteCarloResult> {
  const workers = Math.max(1, Math.floor(options.workers ?? defaultWorkerCount()))
  if (workers <= 1 || !canUseWorkers()) {
    return runMonteCarlo(nodes, edges, config, options)
  }

  const { runs, steps } = config
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`runs must be an integer ≥ 1 (got ${runs})`)
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`steps must be an integer ≥ 1 (got ${steps})`)

  const { pools, dropped } = resolveTracked(nodes, config.tracked)
  const poolCount = pools.length
  const span = steps + 1
  const jobSize = Math.max(
    1,
    Math.floor(options.jobSize ?? (Math.ceil(runs / (workers * 4)) || 1)),
  )

  const proj = projectMemory(runs, steps, poolCount, workers, jobSize)
  if (proj.overLimit) {
    throw new Error(
      `Monte-Carlo config exceeds the ${CELL_LIMIT.toLocaleString()}-cell limit: ` +
        `runs ${runs} × (steps ${steps} + 1) × ${poolCount} tracked Pool(s) = ` +
        `${proj.seriesCells.toLocaleString()} cells (~${Math.round(proj.projectedBytes / 1e6)} MB projected). ` +
        `Reduce runs, steps, or the tracked Pool list.`,
    )
  }
  if (options.signal?.aborted) throw abortError(0)

  // lazy so importing this module never evaluates the worker chunk (vitest, SSR)
  let McWorker: new () => Worker
  try {
    ;({ default: McWorker } = await import('./mc.worker.ts?worker&inline'))
  } catch {
    return runMonteCarlo(nodes, edges, config, options) // no inlined worker → sync
  }

  const poolIds = pools.map((p) => p.id)
  const store = pools.map(() => new Float64Array(runs * span)) // per-pool, run-major run*span+t
  const endedAt = new Int32Array(runs).fill(-1)
  const runSeeds = Array.from({ length: runs }, (_, i) => runSeed(config.baseSeed, i))

  const jobs: Array<{ startRun: number; endRun: number }> = []
  for (let s = 0; s < runs; s += jobSize) jobs.push({ startRun: s, endRun: Math.min(s + jobSize, runs) })

  let pool: Worker[]
  try {
    pool = Array.from({ length: Math.min(workers, jobs.length) }, () => new McWorker())
  } catch {
    return runMonteCarlo(nodes, edges, config, options) // construction blocked (file://) → sync
  }

  const { progressEvery = 64, onProgress, signal } = options

  await new Promise<void>((resolve, reject) => {
    let nextJob = 0
    let doneRuns = 0
    let lastProgressAt = 0
    let settled = false

    const cleanup = () => {
      for (const w of pool) {
        w.onmessage = null
        w.onerror = null
        w.terminate()
      }
      signal?.removeEventListener('abort', onAbort)
    }
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    function onAbort() {
      done(() => reject(abortError(doneRuns)))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const assign = (w: Worker) => {
      if (settled || nextJob >= jobs.length) return
      w.postMessage({ type: 'job', ...jobs[nextJob++] })
    }

    for (const w of pool) {
      w.onerror = (ev: ErrorEvent) => {
        // a worker crashing mid-run fails the whole call — no partial result
        done(() => reject(new Error(`Monte-Carlo worker crashed: ${ev.message || 'unknown error'}`)))
      }
      w.onmessage = (ev: MessageEvent) => {
        if (settled) return
        const m = ev.data as
          | { type: 'ready' }
          | { type: 'error'; message: string }
          | {
              type: 'result'
              startRun: number
              endRun: number
              values: Float64Array
              endedAt: Int32Array
            }
        if (m.type === 'ready') {
          assign(w)
          return
        }
        if (m.type === 'error') {
          done(() => reject(new Error(`Monte-Carlo worker: ${m.message}`)))
          return
        }
        // m.type === 'result' — place strictly by run index (order-independent)
        const { startRun, endRun, values, endedAt: ea } = m
        const local = endRun - startRun
        for (let lr = 0; lr < local; lr++) {
          const run = startRun + lr
          endedAt[run] = ea[lr]
          for (let t = 0; t < span; t++) {
            const base = (lr * span + t) * poolCount
            for (let p = 0; p < poolCount; p++) store[p][run * span + t] = values[base + p]
          }
        }
        doneRuns += local
        if (doneRuns - lastProgressAt >= progressEvery || doneRuns === runs) {
          lastProgressAt = doneRuns
          onProgress?.({
            provisional: true,
            completedRuns: doneRuns,
            totalRuns: runs,
            progress: doneRuns / runs,
          })
        }
        if (doneRuns >= runs) {
          done(resolve)
          return
        }
        assign(w)
      }
      w.postMessage({ type: 'init', nodes, edges, config, poolIds })
    }
  })

  return aggregateRuns({
    pools,
    runs,
    steps,
    store,
    endedAt,
    runSeeds,
    droppedTracked: dropped,
    config,
  })
}
