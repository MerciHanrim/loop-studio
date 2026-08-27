// Pre-run cost estimate for the Monte-Carlo dialog. Memory is exact
// (`projectMemory`). Time is either a local synchronous BENCHMARK (a short timed
// probe) or the throughput MEASURED from the last real run of this graph — the
// two are labelled distinctly so the number is never read as a parallel
// prediction. No fixed "efficiency factor".

import type { LoopEdge, LoopNode } from '../model/types'
import { projectMemory, runMonteCarlo, type RunConfig } from './montecarlo'
import { canUseWorkers, defaultWorkerCount } from './montecarlo.parallel'

export type CostEstimate = {
  /** the path the run will actually take */
  path: 'parallel' | 'local'
  /** workers the run will use (capped by the number of jobs) */
  workers: number
  /** opaque origin (file:// double-click) → local path, may freeze the UI */
  fileProtocol: boolean
  /** how lowMs/highMs were derived */
  source: 'benchmark' | 'measured'
  lowMs: number
  highMs: number
  memoryBytes: number
  overLimit: boolean
}

const ASSUMED_SPAWN_MS = 6 // rough one-off cost per worker

function effectiveWorkers(runs: number): { workers: number; jobs: number } {
  const cap = defaultWorkerCount()
  const jobSize = Math.max(1, Math.ceil(runs / (cap * 4)) || 1)
  const jobs = Math.ceil(runs / jobSize)
  return { workers: Math.min(cap, jobs), jobs }
}

/** Optional prior from the last completed run of the current graph. */
export type ThroughputHint = { msPerRunStep: number }

export async function estimateMonteCarloCost(
  nodes: LoopNode[],
  edges: LoopEdge[],
  config: RunConfig,
  opts: { signal?: AbortSignal; prior?: ThroughputHint } = {},
): Promise<CostEstimate> {
  const fileProtocol = typeof location !== 'undefined' && location.protocol === 'file:'
  const { workers } = effectiveWorkers(config.runs)
  const parallel = canUseWorkers() && config.runs >= 32 && workers > 1
  const path: CostEstimate['path'] = parallel ? 'parallel' : 'local'

  const poolIds = config.tracked.length
    ? config.tracked
    : nodes.filter((n) => n.data.kind === 'pool').map((n) => n.id)
  const mem = projectMemory(config.runs, config.steps, poolIds.length, parallel ? workers : 1)

  // ── the "work" quantity: total per-run-step cost, in ms ──────────────────
  let workMs: number
  let source: CostEstimate['source']
  if (opts.prior) {
    workMs = opts.prior.msPerRunStep * config.runs * config.steps
    source = 'measured'
  } else {
    const samples: Array<{ n: number; ms: number }> = []
    for (const target of [16, 64]) {
      if (opts.signal?.aborted) break
      const n = Math.max(1, Math.min(target, config.runs))
      const t0 = performance.now()
      runMonteCarlo(nodes, edges, { ...config, runs: n })
      const ms = performance.now() - t0
      samples.push({ n, ms })
      if (ms >= 150) break // probe budget hit — do not grow it
    }
    let a = 0
    let b = samples[0].ms / samples[0].n
    if (samples.length >= 2 && samples[1].n !== samples[0].n) {
      const [p, q] = samples
      b = (q.ms - p.ms) / (q.n - p.n)
      a = p.ms - b * p.n
      if (b <= 0) b = q.ms / q.n
      if (a < 0) a = 0
    }
    workMs = a + b * config.runs // fitted synchronous time for the full run count
    source = 'benchmark'
  }

  let lowMs: number
  let highMs: number
  if (parallel) {
    const spawn = workers * ASSUMED_SPAWN_MS
    lowMs = spawn + workMs / workers // ideal linear speedup
    highMs = spawn + workMs / 2 // conservative: ~2× regardless of core count
  } else {
    lowMs = workMs * 0.8
    highMs = workMs * 1.4
  }
  if (source === 'measured') {
    // a real measurement — tighten the band
    lowMs *= 0.85
    highMs *= 1.2
  }

  return {
    path,
    workers,
    fileProtocol,
    source,
    lowMs: Math.max(1, lowMs),
    highMs: Math.max(Math.max(1, lowMs), highMs),
    memoryBytes: mem.projectedBytes,
    overLimit: mem.overLimit,
  }
}
