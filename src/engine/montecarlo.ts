// Monte-Carlo — spec "loop-mc/1" (SEMANTICS-B2.md), frozen.
//
// Runs the existing deterministic `step()` many times with derived seeds and
// aggregates the traces into per-timestep bands + a final-value distribution.
// This module is the SYNCHRONOUS reference: `runMonteCarlo` is a pure function
// of (nodes, edges, config). A parallel driver (later, separate) must match it
// bit-for-bit.

import type { LoopEdge, LoopNode } from '../model/types'
import { mix32 } from './rng'
import { initSim, step } from './step'

export const MC_SPEC = 'loop-mc/1'
export const MC_SEED_SPEC = 'loop-mc-seed/1'
export const RNG_SPEC_REF = 'loop-rng/1'

/** Exact-aggregation cell budget: runs × (steps+1) × trackedPoolCount. */
export const CELL_LIMIT = 5_000_000

// ── config ────────────────────────────────────────────────────────────────
export type RunConfig = {
  /** uint32 (validated at the UI boundary, SEMANTICS-B1.md §B1.3) */
  baseSeed: number
  /** integer ≥ 1 */
  runs: number
  /** integer ≥ 1 — max steps per run */
  steps: number
  /** Pool ids to record; [] means every Pool in the graph */
  tracked: string[]
}

export type RunOptions = {
  batchSize?: number
  progressEvery?: number
  onProgress?: (p: MonteCarloProgress) => void
  signal?: AbortSignal
}

// ── results ───────────────────────────────────────────────────────────────
export type BandSummary = {
  p10: number
  p50: number
  p90: number
  mean: number
  min: number
  max: number
}

export type MonteCarloResult = {
  spec: 'loop-mc/1'
  seedSpec: 'loop-mc-seed/1'
  rngSpec: 'loop-rng/1'
  config: RunConfig
  completedRuns: number
  droppedTracked: string[]
  pools: { id: string; label: string }[]
  /** runSeeds[i] = runSeed(config.baseSeed, i); length = runs */
  runSeeds: number[]
  /** length steps+1, monotone non-decreasing */
  endedRuns: { atOrBeforeStep: number[] }
  /** per Pool id → six arrays of length steps+1 */
  series: Record<
    string,
    { p10: number[]; p50: number[]; p90: number[]; mean: number[]; min: number[]; max: number[] }
  >
  /** per Pool id → terminal values (run-index order) + summary */
  final: Record<string, { values: number[]; summary: BandSummary }>
}

/** Lightweight, export-incompatible progress type (SEMANTICS-B2.md §MC7.3). */
export type MonteCarloProgress = {
  provisional: true
  completedRuns: number
  totalRuns: number
  progress: number
}

// ── loop-mc-seed/1 ────────────────────────────────────────────────────────
/** Per-iteration seed: FNV-1a → one mulberry32 output (the loop-rng/1 path). */
export const runSeed = (baseSeed: number, i: number): number => mix32(`${baseSeed}|run|${i}`).out

// ── aggregation primitives ────────────────────────────────────────────────
/** R-7 / linear-on-(n-1)q quantile (NumPy default). `sortedAsc` ascending. */
export function quantile(sortedAsc: ArrayLike<number>, q: number): number {
  const n = sortedAsc.length
  if (n === 0) return NaN
  if (n === 1) return sortedAsc[0]
  const h = (n - 1) * q
  const lo = Math.floor(h)
  const frac = h - lo
  return sortedAsc[lo] + frac * (sortedAsc[Math.min(lo + 1, n - 1)] - sortedAsc[lo])
}

/** Neumaier compensated summation. Pass the values ascending-sorted so the
 *  result is also independent of execution order (SEMANTICS-B2.md §MC6). */
export function neumaier(xs: ArrayLike<number>): number {
  let sum = 0
  let c = 0
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const t = sum + x
    c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum
    sum = t
  }
  return sum + c
}

function summarise(sortedAsc: ArrayLike<number>): BandSummary {
  const n = sortedAsc.length
  return {
    p10: quantile(sortedAsc, 0.1),
    p50: quantile(sortedAsc, 0.5),
    p90: quantile(sortedAsc, 0.9),
    mean: n ? neumaier(sortedAsc) / n : NaN,
    min: n ? sortedAsc[0] : NaN,
    max: n ? sortedAsc[n - 1] : NaN,
  }
}

// ── config resolution & memory ───────────────────────────────────────────
export type MemoryProjection = {
  cells: number
  overLimit: boolean
  seriesCells: number
  finalCells: number
  sortBuffer: number
  workerBuffers: number
  projectedBytes: number
}

/** Projected footprint for a config (SEMANTICS-B2.md §MC7.4). */
export function projectMemory(
  runs: number,
  steps: number,
  trackedPoolCount: number,
  workers = 1,
  batchSize = 64,
): MemoryProjection {
  const seriesCells = runs * (steps + 1) * trackedPoolCount
  const finalCells = runs * trackedPoolCount
  const sortBuffer = runs * trackedPoolCount
  const workerBuffers = workers * batchSize * (steps + 1) * trackedPoolCount
  const projectedBytes = (seriesCells + finalCells + sortBuffer + workerBuffers) * 8
  return {
    cells: seriesCells,
    overLimit: seriesCells > CELL_LIMIT,
    seriesCells,
    finalCells,
    sortBuffer,
    workerBuffers,
    projectedBytes,
  }
}

function resolveTracked(
  nodes: LoopNode[],
  tracked: string[],
): { pools: { id: string; label: string }[]; dropped: string[] } {
  const poolsInGraph = nodes.filter((n) => n.data.kind === 'pool')
  const byId = new Map(poolsInGraph.map((n) => [n.id, n.data.label]))
  if (tracked.length === 0) {
    return { pools: poolsInGraph.map((n) => ({ id: n.id, label: n.data.label })), dropped: [] }
  }
  const pools: { id: string; label: string }[] = []
  const dropped: string[] = []
  for (const id of tracked) {
    const label = byId.get(id)
    if (label === undefined) dropped.push(id)
    else pools.push({ id, label })
  }
  return { pools, dropped }
}

export function abortError(completedRuns: number): Error {
  const e =
    typeof DOMException === 'function'
      ? new DOMException('Monte-Carlo run cancelled', 'AbortError')
      : Object.assign(new Error('Monte-Carlo run cancelled'), { name: 'AbortError' })
  return Object.assign(e, { completedRuns })
}

export { resolveTracked }

/**
 * Execute run indices `[startRun, endRun)` and return their raw trajectories in
 * the run-major envelope layout (SEMANTICS-B2.md §MC7.1):
 *   values[ ((localRun * (steps+1) + step) * poolCount) + poolIndex ]
 * `endedAt[localRun]` is the step the run ended on, or `-1`. This is what a
 * Worker computes and posts back; the main thread de-interleaves and aggregates.
 */
export function runRange(
  nodes: LoopNode[],
  edges: LoopEdge[],
  config: RunConfig,
  poolIds: string[],
  startRun: number,
  endRun: number,
): { values: Float64Array; endedAt: Int32Array } {
  const span = config.steps + 1
  const poolCount = poolIds.length
  const local = endRun - startRun
  const values = new Float64Array(local * span * poolCount)
  const endedAt = new Int32Array(local).fill(-1)

  for (let r = startRun; r < endRun; r++) {
    const lr = r - startRun
    const seed = runSeed(config.baseSeed, r)
    let st = initSim(nodes)
    for (let p = 0; p < poolCount; p++) values[(lr * span + 0) * poolCount + p] = st.values[poolIds[p]] ?? 0
    let ended = false
    for (let t = 1; t <= config.steps; t++) {
      if (!ended) {
        st = step(nodes, edges, st, seed).state
        if (st.ended) {
          ended = true
          endedAt[lr] = t
        }
      }
      for (let p = 0; p < poolCount; p++)
        values[(lr * span + t) * poolCount + p] = st.values[poolIds[p]] ?? 0
    }
  }
  return { values, endedAt }
}

// ── the synchronous reference ────────────────────────────────────────────
export function runMonteCarlo(
  nodes: LoopNode[],
  edges: LoopEdge[],
  config: RunConfig,
  options: RunOptions = {},
): MonteCarloResult {
  const { baseSeed, runs, steps } = config
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`runs must be an integer ≥ 1 (got ${runs})`)
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`steps must be an integer ≥ 1 (got ${steps})`)

  const { pools, dropped } = resolveTracked(nodes, config.tracked)
  const poolCount = pools.length
  const span = steps + 1

  const proj = projectMemory(runs, steps, poolCount)
  if (proj.overLimit) {
    throw new Error(
      `Monte-Carlo config exceeds the ${CELL_LIMIT.toLocaleString()}-cell limit: ` +
        `runs ${runs} × (steps ${steps} + 1) × ${poolCount} tracked Pool(s) = ` +
        `${proj.seriesCells.toLocaleString()} cells (~${Math.round(proj.projectedBytes / 1e6)} MB projected). ` +
        `Reduce runs, steps, or the tracked Pool list.`,
    )
  }

  const { batchSize = 64, progressEvery = 64, onProgress, signal } = options

  // run-major storage: store[p] has length runs*span, idx = run*span + t
  const store = pools.map(() => new Float64Array(runs * span))
  const endedAt = new Int32Array(runs).fill(-1)
  const runSeeds = new Array<number>(runs)

  const emitProgress = (done: number) => {
    onProgress?.({ provisional: true, completedRuns: done, totalRuns: runs, progress: done / runs })
  }

  let done = 0
  let lastProgressAt = 0
  for (let batchStart = 0; batchStart < runs; batchStart += batchSize) {
    if (signal?.aborted) throw abortError(done)
    const batchEnd = Math.min(batchStart + batchSize, runs)

    for (let i = batchStart; i < batchEnd; i++) {
      const seed = runSeed(baseSeed, i)
      runSeeds[i] = seed
      let st = initSim(nodes)
      for (let p = 0; p < poolCount; p++) store[p][i * span] = st.values[pools[p].id] ?? 0

      let ended = false
      for (let t = 1; t <= steps; t++) {
        if (!ended) {
          const r = step(nodes, edges, st, seed)
          st = r.state
          if (st.ended) {
            ended = true
            endedAt[i] = t
          }
        }
        // carry-forward once ended: st is unchanged, values repeat
        for (let p = 0; p < poolCount; p++) store[p][i * span + t] = st.values[pools[p].id] ?? 0
      }
    }

    done = batchEnd
    if (done - lastProgressAt >= progressEvery || done === runs) {
      emitProgress(done)
      lastProgressAt = done
    }
  }

  return aggregateRuns({ pools, runs, steps, store, endedAt, runSeeds, droppedTracked: dropped, config })
}

/**
 * The single aggregation path — used by both `runMonteCarlo` (sync) and
 * `runMonteCarloParallel`, so their results are byte-identical (I11).
 * `store[p]` is run-major over one Pool: `store[p][run * (steps+1) + t]`.
 * `endedAt[i]` is the step a run ended on, or `-1`.
 */
export function aggregateRuns(params: {
  pools: { id: string; label: string }[]
  runs: number
  steps: number
  store: Float64Array[]
  endedAt: Int32Array | number[]
  runSeeds: number[]
  droppedTracked: string[]
  config: RunConfig
}): MonteCarloResult {
  const { pools, runs, steps, store, endedAt, runSeeds, droppedTracked, config } = params
  const span = steps + 1
  const poolCount = pools.length

  const endedCum = new Array<number>(span).fill(0)
  for (let i = 0; i < runs; i++) {
    const e = endedAt[i]
    if (e >= 0) for (let t = e; t < span; t++) endedCum[t]++
  }

  const series: MonteCarloResult['series'] = {}
  const final: MonteCarloResult['final'] = {}
  const col = new Float64Array(runs) // reused sort buffer

  for (let p = 0; p < poolCount; p++) {
    const p10 = new Array<number>(span)
    const p50 = new Array<number>(span)
    const p90 = new Array<number>(span)
    const mean = new Array<number>(span)
    const mn = new Array<number>(span)
    const mx = new Array<number>(span)
    for (let t = 0; t < span; t++) {
      for (let i = 0; i < runs; i++) col[i] = store[p][i * span + t]
      col.sort() // ascending; Float64Array.sort is numeric by default
      const s = summarise(col)
      p10[t] = s.p10
      p50[t] = s.p50
      p90[t] = s.p90
      mean[t] = s.mean
      mn[t] = s.min
      mx[t] = s.max
    }
    series[pools[p].id] = { p10, p50, p90, mean, min: mn, max: mx }

    const values = new Array<number>(runs)
    for (let i = 0; i < runs; i++) values[i] = store[p][i * span + steps] // terminal (carry-forward)
    const sorted = Float64Array.from(values).sort()
    final[pools[p].id] = { values, summary: summarise(sorted) }
  }

  return {
    spec: 'loop-mc/1',
    seedSpec: 'loop-mc-seed/1',
    rngSpec: 'loop-rng/1',
    config,
    completedRuns: runs,
    droppedTracked,
    pools,
    runSeeds,
    endedRuns: { atOrBeforeStep: endedCum },
    series,
    final,
  }
}

// ── exports ──────────────────────────────────────────────────────────────
const sanitise = (s: string) => s.replace(/[",\n]/g, ' ')

/** `montecarlo-series.csv` — one row per (step, pool). */
export function toSeriesCsv(r: MonteCarloResult): string {
  const rows = ['step,pool,p10,p50,p90,mean,min,max']
  for (let t = 0; t < r.endedRuns.atOrBeforeStep.length; t++) {
    for (const pool of r.pools) {
      const s = r.series[pool.id]
      rows.push(
        [t, sanitise(pool.label), s.p10[t], s.p50[t], s.p90[t], s.mean[t], s.min[t], s.max[t]].join(','),
      )
    }
  }
  return rows.join('\n') + '\n'
}

/** `montecarlo-final.csv` — one row per run, run-index order, seed inline. */
export function toFinalCsv(r: MonteCarloResult): string {
  const head = ['run', 'seed', ...r.pools.map((p) => sanitise(p.label))].join(',')
  const rows = [head]
  for (let i = 0; i < r.completedRuns; i++) {
    rows.push([i, r.runSeeds[i], ...r.pools.map((p) => r.final[p.id].values[i])].join(','))
  }
  return rows.join('\n') + '\n'
}

/** `montecarlo-final-summary.csv` — one row per Pool. */
export function toFinalSummaryCsv(r: MonteCarloResult): string {
  const rows = ['pool,p10,p50,p90,mean,min,max']
  for (const pool of r.pools) {
    const s = r.final[pool.id].summary
    rows.push([sanitise(pool.label), s.p10, s.p50, s.p90, s.mean, s.min, s.max].join(','))
  }
  return rows.join('\n') + '\n'
}

/** `MonteCarloResult` as pretty JSON (field order is the frozen contract). */
export function toMonteCarloJson(r: MonteCarloResult): string {
  return JSON.stringify(r, null, 2)
}
