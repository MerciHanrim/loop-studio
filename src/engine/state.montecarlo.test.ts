import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import {
  initSim,
  runMonteCarlo,
  runMonteCarloCooperative,
  runMonteCarloParallel,
  runRange,
  runSeed,
  step,
  toMonteCarloJson,
  type RunConfig,
} from './index'

// SEMANTICS-S.md loop-state/1 — Slice 1: the state queue / `fired` must be
// fully isolated per Monte-Carlo run, and the result must not depend on the
// worker count, job size, or sync / cooperative path (I9-S, I11).

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const drain = (id: string, activation: 'automatic' | 'passive' = 'passive'): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation, mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const trig = (id: string, s: string, t: string, delay: number): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'trigger', expr: '', delay },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})
const lbl = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr },
})

// random inflow (so runs differ by seed) + a passive drain gated by a delayed
// trigger + a plain automatic drain on a second pool.
const nodes = [source('S'), pool('P', 0, null), drain('D', 'passive'), pool('Q', 0, null), drain('B', 'automatic')]
const edges = [
  res('e1', 'S', 'P', '2D6'),
  res('e2', 'P', 'D', '1-3'),
  res('e3', 'S', 'Q', '1-3'),
  res('e4', 'Q', 'B', '1'),
  trig('t1', 'S', 'D', 1),
]
const cfg: RunConfig = { baseSeed: 7, runs: 24, steps: 12, tracked: [] }

/** step the graph standalone for one run seed; return each Pool's terminal value */
function traceTerminal(seed: number): { P: number; Q: number } {
  let st = initSim(nodes)
  for (let t = 1; t <= cfg.steps; t++) st = step(nodes, edges, st, seed).state
  return { P: st.values.P ?? 0, Q: st.values.Q ?? 0 }
}

describe('per-run isolation (I9-S)', () => {
  const mc = runMonteCarlo(nodes, edges, cfg)

  it('each run\'s terminal matches a standalone trace of its own seed', () => {
    const standaloneP: number[] = []
    const standaloneQ: number[] = []
    for (let i = 0; i < cfg.runs; i++) {
      const { P, Q } = traceTerminal(runSeed(cfg.baseSeed, i))
      standaloneP.push(P)
      standaloneQ.push(Q)
    }
    expect(mc.final.P.values).toEqual(standaloneP)
    expect(mc.final.Q.values).toEqual(standaloneQ)
  })

  it('reordering the runs (reverse seeds) does not shift any run\'s outcome', () => {
    // run i in the MC == standalone(seed i); order independence is inherent
    // because fillOneRun re-inits per run. A leak would make run i depend on
    // run i-1; the equality above already rules that out.
    const rerun = runMonteCarlo(nodes, edges, cfg)
    expect(toMonteCarloJson(rerun)).toEqual(toMonteCarloJson(mc))
  })
})

describe('path invariance — sync / cooperative / worker envelope give one result', () => {
  const ref = toMonteCarloJson(runMonteCarlo(nodes, edges, cfg))

  it('runMonteCarloCooperative, any batchSize / frameBudgetMs', async () => {
    for (const batchSize of [1, 5, 64, 10_000]) {
      for (const frameBudgetMs of [0, 8]) {
        expect(
          toMonteCarloJson(await runMonteCarloCooperative(nodes, edges, cfg, { batchSize, frameBudgetMs })),
        ).toEqual(ref)
      }
    }
  })

  it('runMonteCarloParallel (sync fallback under node), varied workers / jobSize', async () => {
    for (const workers of [1, 3, 4]) {
      for (const jobSize of [1, 5, 100]) {
        expect(toMonteCarloJson(await runMonteCarloParallel(nodes, edges, cfg, { workers, jobSize }))).toEqual(ref)
      }
    }
  })

  it('an activator graph is also isolated + path-invariant', async () => {
    // a random gauge (so runs differ) gates a drain
    const g = [source('S'), pool('P', 0), drain('D', 'passive'), pool('G', 0), source('GS')]
    const e = [
      res('e1', 'S', 'P', '2D6'),
      res('e2', 'P', 'D', '1-3'),
      res('eg', 'GS', 'G', '1-3'),
      act('a1', 'G', 'D', '>= 8'),
      trig('t1', 'S', 'D', 0),
    ]
    const c: RunConfig = { baseSeed: 3, runs: 20, steps: 10, tracked: [] }
    const sync = runMonteCarlo(g, e, c)
    // per-run terminal == standalone trace of its own seed
    const standalone: number[] = []
    for (let i = 0; i < c.runs; i++) {
      let st = initSim(g)
      for (let t = 1; t <= c.steps; t++) st = step(g, e, st, runSeed(c.baseSeed, i)).state
      standalone.push(st.values.P ?? 0)
    }
    expect(sync.final.P.values).toEqual(standalone)
    // sync == cooperative == parallel(sync fallback)
    const ref = toMonteCarloJson(sync)
    expect(toMonteCarloJson(await runMonteCarloCooperative(g, e, c, { batchSize: 3 }))).toEqual(ref)
    expect(toMonteCarloJson(await runMonteCarloParallel(g, e, c, { workers: 4, jobSize: 3 }))).toEqual(ref)
  })

  it('a delayed-trigger ↔ activator interplay graph is isolated + path-invariant', async () => {
    // random feed (runs differ) + a delay-2 pulse onto a passive drain that is
    // also gated by a random gauge ⇒ the pulse lands open on some runs, closed
    // on others. loop-state/1 §S3/§S4: the outcome must be per-run only.
    const g = [
      source('S'), pool('P', 0), drain('D', 'passive'),
      source('KS'), pool('K', 0), source('GS'), pool('G', 0),
    ]
    const e = [
      res('e1', 'S', 'P', '2D6'),
      res('e2', 'P', 'D', '1-3'),
      res('ek', 'KS', 'K', '1'),
      res('eg', 'GS', 'G', '1-3'),
      act('a1', 'G', 'D', '>= 8'),
      trig('t1', 'KS', 'D', 2),
    ]
    const c: RunConfig = { baseSeed: 5, runs: 20, steps: 12, tracked: [] }
    const sync = runMonteCarlo(g, e, c)
    const standalone: number[] = []
    for (let i = 0; i < c.runs; i++) {
      let st = initSim(g)
      for (let t = 1; t <= c.steps; t++) st = step(g, e, st, runSeed(c.baseSeed, i)).state
      standalone.push(st.values.P ?? 0)
    }
    expect(sync.final.P.values).toEqual(standalone)
    const ref = toMonteCarloJson(sync)
    expect(toMonteCarloJson(await runMonteCarloCooperative(g, e, c, { batchSize: 7 }))).toEqual(ref)
    expect(toMonteCarloJson(await runMonteCarloParallel(g, e, c, { workers: 3, jobSize: 4 }))).toEqual(ref)
  })

  it('a label graph (per-run S[source] feeds the edit) is isolated + path-invariant', async () => {
    // random inflow into the label SOURCE pool ⇒ the "+S" edit differs by run.
    const g = [source('S'), pool('F', 0), pool('T', 0, 12), drain('D'), pool('P', 0)]
    const e = [
      res('e1', 'S', 'F', '2D6'),
      lbl('m1', 'F', 'T', '+S'),
      lbl('m2', 'F', 'T', '-3'),
      res('e2', 'T', 'D', '1-3'),
      res('e3', 'S', 'P', '1-3'),
    ]
    const c: RunConfig = { baseSeed: 9, runs: 20, steps: 12, tracked: [] }
    const sync = runMonteCarlo(g, e, c)
    const standalone: number[] = []
    for (let i = 0; i < c.runs; i++) {
      let st = initSim(g)
      for (let t = 1; t <= c.steps; t++) st = step(g, e, st, runSeed(c.baseSeed, i)).state
      standalone.push(st.values.T ?? 0)
    }
    expect(sync.final.T.values).toEqual(standalone)
    const ref = toMonteCarloJson(sync)
    expect(toMonteCarloJson(await runMonteCarloCooperative(g, e, c, { batchSize: 6 }))).toEqual(ref)
    expect(toMonteCarloJson(await runMonteCarloParallel(g, e, c, { workers: 4, jobSize: 3 }))).toEqual(ref)
  })

  it('runRange (the Worker compute fn) — full range and chunked ranges agree', () => {
    const poolIds = ['P', 'Q']
    const span = cfg.steps + 1
    const pc = poolIds.length
    const term = (env: { values: Float64Array }, localRun: number, p: number) =>
      env.values[(localRun * span + cfg.steps) * pc + p]

    const full = runRange(nodes, edges, cfg, poolIds, 0, cfg.runs)
    // three uneven chunks
    const chunks = [runRange(nodes, edges, cfg, poolIds, 0, 7), runRange(nodes, edges, cfg, poolIds, 7, 8), runRange(nodes, edges, cfg, poolIds, 8, cfg.runs)]
    const ranges = [[0, 7], [7, 8], [8, cfg.runs]] as const

    const sync = runMonteCarlo(nodes, edges, { ...cfg, tracked: poolIds })
    for (let r = 0; r < cfg.runs; r++) {
      expect(term(full, r, 0)).toBe(sync.final.P.values[r])
      expect(term(full, r, 1)).toBe(sync.final.Q.values[r])
    }
    for (let c = 0; c < chunks.length; c++) {
      const [lo, hi] = ranges[c]
      for (let r = lo; r < hi; r++) {
        expect(term(chunks[c], r - lo, 0)).toBe(sync.final.P.values[r]) // local index, global seed
        expect(term(chunks[c], r - lo, 1)).toBe(sync.final.Q.values[r])
      }
    }
  })
})
