// Pre-run cost estimate for the Monte-Carlo dialog. Memory is exact
// (`projectMemory`); time is a measured RANGE from a short timed probe with the
// current steps / tracked settings — no fixed "efficiency factor".

import type { LoopEdge, LoopNode } from '../model/types'
import { projectMemory, runMonteCarlo, type RunConfig } from './montecarlo'
import { canUseWorkers } from './montecarlo.parallel'

export type CostEstimate = {
  path: 'parallel' | 'local'
  workers: number
  /** opaque origin (file:// double-click) → local path, may freeze the UI */
  fileProtocol: boolean
  lowMs: number
  highMs: number
  memoryBytes: number
  overLimit: boolean
}

const cpu = (): number =>
  (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4

/** Runs a synchronous probe of 16 then (if fast) 64 runs, fits `t ≈ a + b·n`,
 *  and brackets the full-run time. Parallel path is bracketed between ideal
 *  (÷workers) and conservative (÷2) speedup — a range, not one number. */
export async function estimateMonteCarloCost(
  nodes: LoopNode[],
  edges: LoopEdge[],
  config: RunConfig,
  opts: { signal?: AbortSignal } = {},
): Promise<CostEstimate> {
  const workers = cpu()
  const fileProtocol = typeof location !== 'undefined' && location.protocol === 'file:'
  const parallel = canUseWorkers() && config.runs >= 32
  const path: CostEstimate['path'] = parallel ? 'parallel' : 'local'

  const poolIds = config.tracked.length
    ? config.tracked
    : nodes.filter((n) => n.data.kind === 'pool').map((n) => n.id)
  const mem = projectMemory(config.runs, config.steps, poolIds.length, parallel ? workers : 1)

  const samples: Array<{ n: number; ms: number }> = []
  for (const target of [16, 64]) {
    if (opts.signal?.aborted) break
    const n = Math.max(1, Math.min(target, config.runs))
    const t0 = performance.now()
    runMonteCarlo(nodes, edges, { ...config, runs: n })
    const ms = performance.now() - t0
    samples.push({ n, ms })
    if (ms >= 150) break // probe budget hit — do not grow it further
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
  const syncMs = a + b * config.runs
  const work = Math.max(0, syncMs - a) // the part that parallelises

  let lowMs: number
  let highMs: number
  if (parallel) {
    const spawn = workers * 6 // rough one-off worker start cost
    lowMs = spawn + work / workers // ideal linear speedup
    highMs = spawn + work / 2 + a // conservative: ~2× regardless of core count
  } else {
    lowMs = syncMs * 0.8
    highMs = syncMs * 1.4
  }
  return {
    path,
    workers,
    fileProtocol,
    lowMs: Math.max(1, lowMs),
    highMs: Math.max(Math.max(1, lowMs), highMs),
    memoryBytes: mem.projectedBytes,
    overLimit: mem.overLimit,
  }
}
