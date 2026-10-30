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
  /** how lowMs/highMs were derived — `none`: not estimated (the memory
   *  projection is already over the limit, so no probe ran; issue #419) */
  source: 'benchmark' | 'measured' | 'none'
  /** 0 when `source` is `none` */
  lowMs: number
  /** 0 when `source` is `none` */
  highMs: number
  memoryBytes: number
  overLimit: boolean
}

const ASSUMED_SPAWN_MS = 6 // rough one-off cost per worker

// issue #419 item 3 (Lumi, 2026-10-30) — the synchronous probe limits the STEP
// COUNT it runs and adjusts its second sample from what it measured. It used to
// run `min(16, runs)` full-length runs before reading its budget: `steps` has
// no upper bound, so on a ~100-node graph 16 × 1000 steps froze the dialog for
// 2.5 s, 16 × 3000 for 8 s, and a two-node graph at 200 000 steps for 11.5 s.
// Now the first sample is ONE run of at most `PROBE_STEPS` steps; the second
// sample's run count is chosen from the first sample's time so that the two
// together aim at `PROBE_BUDGET_MS`; the cost per run-step is extrapolated to
// `runs × steps` — the model the `measured` prior already uses. The budget is
// a TARGET, not a guarantee of the running time: a slow enough graph can take
// longer than it for one run of `PROBE_STEPS` steps, and the second sample's
// time is a prediction from the first.
const PROBE_STEPS = 128
const PROBE_BUDGET_MS = 150
const PROBE_MAX_RUNS = 64

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

  // over the memory limit: the Run button is disabled anyway — no probe, no
  // time band, only the memory line with its warning (issue #419 item 3)
  if (mem.overLimit) {
    return { path, workers, fileProtocol, source: 'none', lowMs: 0, highMs: 0, memoryBytes: mem.projectedBytes, overLimit: true }
  }

  // ── the "work" quantity: total per-run-step cost, in ms ──────────────────
  let workMs: number
  let source: CostEstimate['source']
  if (opts.prior) {
    workMs = opts.prior.msPerRunStep * config.runs * config.steps
    source = 'measured'
  } else {
    // every sample runs `probeSteps` steps (the configured count when it is
    // smaller); `a` is the fitted per-probe fixed cost, `bRun` the cost of one
    // run at `probeSteps`, so the cost per run-step is `bRun / probeSteps`.
    const probeSteps = Math.max(1, Math.min(PROBE_STEPS, config.steps))
    const timeRuns = (n: number): number => {
      const t0 = performance.now()
      runMonteCarlo(nodes, edges, { ...config, runs: n, steps: probeSteps })
      return performance.now() - t0
    }
    const samples: Array<{ n: number; ms: number }> = [{ n: 1, ms: timeRuns(1) }]
    if (!opts.signal?.aborted && config.runs > 1) {
      // the second sample's run count is chosen from the first sample's time
      // so that both together aim at the budget — a prediction from the
      // per-run cost the first sample showed, not a bound on the time taken
      const left = PROBE_BUDGET_MS - samples[0].ms
      const n2 = Math.min(config.runs, PROBE_MAX_RUNS, Math.floor(left / Math.max(samples[0].ms, 0.01)))
      if (n2 >= 2) samples.push({ n: n2, ms: timeRuns(n2) })
    }
    let a = 0
    let bRun = samples[0].ms / samples[0].n
    if (samples.length >= 2) {
      const [p, q] = samples
      bRun = (q.ms - p.ms) / (q.n - p.n)
      a = p.ms - bRun * p.n
      if (bRun <= 0) bRun = q.ms / q.n
      if (a < 0) a = 0
    }
    const msPerRunStep = bRun / probeSteps
    workMs = a + msPerRunStep * config.runs * config.steps // fitted synchronous time for the full run
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
