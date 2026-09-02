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
  /** loop-model/2 (SEMANTICS-M2.md) — the document's model-semantics version;
   *  threaded to `step()`. Absent / `1` ⇒ loop-model/1 execution (no `@id` flow
   *  resolution), byte-identical to before. A transient run input, not a
   *  persisted config field. */
  modelVersion?: 1 | 2
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
        st = step(nodes, edges, st, seed, config.modelVersion ?? 1).state
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

// ── shared run machinery (one implementation for sync + cooperative) ──────
type Prepared = { pools: { id: string; label: string }[]; dropped: string[]; span: number }

/** Validate the config, resolve tracked Pools, and enforce CELL_LIMIT.
 *  Cheap — no large allocations. Throws on an invalid or over-limit config. */
function prepareRun(nodes: LoopNode[], config: RunConfig): Prepared {
  const { runs, steps } = config
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`runs must be an integer ≥ 1 (got ${runs})`)
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`steps must be an integer ≥ 1 (got ${steps})`)
  const { pools, dropped } = resolveTracked(nodes, config.tracked)
  const proj = projectMemory(runs, steps, pools.length)
  if (proj.overLimit) {
    throw new Error(
      `Monte-Carlo config exceeds the ${CELL_LIMIT.toLocaleString()}-cell limit: ` +
        `runs ${runs} × (steps ${steps} + 1) × ${pools.length} tracked Pool(s) = ` +
        `${proj.seriesCells.toLocaleString()} cells (~${Math.round(proj.projectedBytes / 1e6)} MB projected). ` +
        `Reduce runs, steps, or the tracked Pool list.`,
    )
  }
  return { pools, dropped, span: steps + 1 }
}

type RunFill = {
  nodes: LoopNode[]
  edges: LoopEdge[]
  config: RunConfig
  pools: { id: string; label: string }[]
  span: number
  store: Float64Array[]
  endedAt: Int32Array
  runSeeds: number[]
}

/** Compute run `i` and write it into the run-major per-Pool `store`. This is
 *  the ONLY place a Monte-Carlo run is executed — sync and cooperative both
 *  call it in ascending index order, so their `store` / `endedAt` are identical. */
function fillOneRun(f: RunFill, i: number): void {
  const { nodes, edges, config, pools, span, store, endedAt, runSeeds } = f
  const poolCount = pools.length
  const seed = runSeed(config.baseSeed, i)
  runSeeds[i] = seed
  let st = initSim(nodes)
  for (let p = 0; p < poolCount; p++) store[p][i * span] = st.values[pools[p].id] ?? 0
  let ended = false
  for (let t = 1; t <= config.steps; t++) {
    if (!ended) {
      st = step(nodes, edges, st, seed, config.modelVersion ?? 1).state
      if (st.ended) {
        ended = true
        endedAt[i] = t
      }
    }
    for (let p = 0; p < poolCount; p++) store[p][i * span + t] = st.values[pools[p].id] ?? 0
  }
}

// ── the synchronous reference ────────────────────────────────────────────
export function runMonteCarlo(
  nodes: LoopNode[],
  edges: LoopEdge[],
  config: RunConfig,
  options: RunOptions = {},
): MonteCarloResult {
  const { runs, steps } = config
  const { pools, dropped, span } = prepareRun(nodes, config)
  const { batchSize = 64, progressEvery = 64, onProgress, signal } = options

  const store = pools.map(() => new Float64Array(runs * span))
  const endedAt = new Int32Array(runs).fill(-1)
  const runSeeds = new Array<number>(runs)
  const fill: RunFill = { nodes, edges, config, pools, span, store, endedAt, runSeeds }

  let done = 0
  let lastProgressAt = 0
  for (let batchStart = 0; batchStart < runs; batchStart += batchSize) {
    if (signal?.aborted) throw abortError(done)
    const batchEnd = Math.min(batchStart + batchSize, runs)
    for (let i = batchStart; i < batchEnd; i++) fillOneRun(fill, i)
    done = batchEnd
    if (done - lastProgressAt >= progressEvery || done === runs) {
      onProgress?.({ provisional: true, completedRuns: done, totalRuns: runs, progress: done / runs })
      lastProgressAt = done
    }
  }

  return aggregateRuns({ pools, runs, steps, store, endedAt, runSeeds, droppedTracked: dropped, config })
}

// ── cooperative fallback (yields to the event loop between batches) ───────
export type CooperativeOptions = RunOptions & {
  batchSize?: number
  /** yield early if a batch of runs exceeds this many ms; 0 disables. Default 8. */
  frameBudgetMs?: number
}

const nowMs: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now()

/** One reusable macrotask yielder per run — a `MessageChannel` (no ~4ms
 *  `setTimeout` clamp), closed on `dispose()`. Falls back to `setTimeout(0)`. */
function makeYielder(): { yieldNow: () => Promise<void>; dispose: () => void } {
  if (typeof MessageChannel === 'function') {
    const ch = new MessageChannel()
    let resolveFn: (() => void) | null = null
    ch.port1.onmessage = () => {
      const r = resolveFn
      resolveFn = null
      r?.()
    }
    ch.port1.start?.()
    return {
      yieldNow: () =>
        new Promise<void>((res) => {
          resolveFn = res
          ch.port2.postMessage(null)
        }),
      dispose: () => {
        ch.port1.onmessage = null
        resolveFn = null
        ch.port1.close()
        ch.port2.close()
      },
    }
  }
  return {
    yieldNow: () => new Promise<void>((res) => setTimeout(res, 0)),
    dispose: () => {},
  }
}

/**
 * Same result as `runMonteCarlo` (byte-identical `MonteCarloResult`), but async:
 * it yields to the event loop between batches so a large `file://` / no-Worker
 * run keeps the UI (progress, Cancel) responsive. `loop-mc/1` is untouched —
 * this only interleaves `await` between whole runs.
 */
export async function runMonteCarloCooperative(
  nodes: LoopNode[],
  edges: LoopEdge[],
  config: RunConfig,
  options: CooperativeOptions = {},
): Promise<MonteCarloResult> {
  const { runs, steps } = config
  if (options.signal?.aborted) throw abortError(0) // before any validation / allocation
  const { pools, dropped, span } = prepareRun(nodes, config)
  if (options.signal?.aborted) throw abortError(0) // before the large arrays

  const { batchSize = 64, frameBudgetMs = 8, progressEvery = 64, onProgress, signal } = options
  const store = pools.map(() => new Float64Array(runs * span))
  const endedAt = new Int32Array(runs).fill(-1)
  const runSeeds = new Array<number>(runs)
  const fill: RunFill = { nodes, edges, config, pools, span, store, endedAt, runSeeds }

  const sched = makeYielder()
  try {
    let done = 0 // runs whose store rows are fully written
    let lastProgressAt = 0
    let sliceStart = nowMs()
    while (done < runs) {
      if (signal?.aborted) throw abortError(done)
      fillOneRun(fill, done)
      done++
      // after each run: check the batch size AND the frame budget — but never
      // yield after the final run (straight to final progress + aggregate)
      const boundary =
        done < runs &&
        (done % batchSize === 0 || (frameBudgetMs > 0 && nowMs() - sliceStart >= frameBudgetMs))
      if (boundary) {
        if (done - lastProgressAt >= progressEvery) {
          lastProgressAt = done
          onProgress?.({ provisional: true, completedRuns: done, totalRuns: runs, progress: done / runs })
        }
        await sched.yieldNow()
        if (signal?.aborted) throw abortError(done)
        sliceStart = nowMs()
      }
    }
    onProgress?.({ provisional: true, completedRuns: runs, totalRuns: runs, progress: 1 })
    return aggregateRuns({ pools, runs, steps, store, endedAt, runSeeds, droppedTracked: dropped, config })
  } finally {
    sched.dispose() // close the channel even on abort / progress-callback throw
  }
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
