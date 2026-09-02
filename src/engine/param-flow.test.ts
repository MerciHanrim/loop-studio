import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { parseFlow } from './flow'
import { runMonteCarlo } from './montecarlo'
import { initSim, step } from './step'

// SEMANTICS-M2.md (loop-model/2) — a `resource` edge `flow` may be a single
// `@id` parameter reference IN A V2 DOCUMENT. `parseFlow(raw, 1)` is unchanged;
// `step(nodes, edges, prev, seed, 2)` resolves references once per step (§M2-3).

const XY = { x: 0, y: 0 }
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const pool = (id: string, initial = 0): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' },
})
const param = (id: string, value: unknown): LoopNode => ({
  id, type: 'parameter', position: XY,
  data: { kind: 'parameter', label: id, value } as unknown as LoopNode['data'],
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})

/** one step from a fresh init; return the pool values. */
const run1 = (nodes: LoopNode[], edges: LoopEdge[], mv: 1 | 2 = 2) => {
  const r = step(nodes, edges, initSim(nodes), 1, mv)
  return { values: r.state.values, diagnostics: r.report.diagnostics }
}

describe('parseFlow — modelVersion gate (§M2-2)', () => {
  it('v1 (default): a leading @ is an unparseable literal ⇒ const 1', () => {
    expect(parseFlow('@daily_roast')).toEqual({ kind: 'const', value: 1 })
    expect(parseFlow('@{visitor')).toEqual({ kind: 'const', value: 1 })
    expect(parseFlow('@daily_roast', 1)).toEqual({ kind: 'const', value: 1 })
  })
  it('v1: every non-@ literal is byte-identical to today', () => {
    for (const [s, want] of [
      ['2', { kind: 'const', value: 2 }],
      ['', { kind: 'const', value: 1 }],
      ['all', { kind: 'all' }],
      ['25%', { kind: 'percent', frac: 0.25 }],
      ['1-3', { kind: 'range', lo: 1, hi: 3 }],
      ['2D6', { kind: 'dice', count: 2, sides: 6 }],
      ['garbage', { kind: 'const', value: 1 }],
    ] as const) {
      expect(parseFlow(s, 1)).toEqual(want)
      expect(parseFlow(s, 2)).toEqual(want) // non-@ strings are identical in v2
    }
  })
  it('v2: a well-formed @id ⇒ {param, id}; anything else with a leading @ ⇒ {paramBad}', () => {
    expect(parseFlow('@daily_roast', 2)).toEqual({ kind: 'param', id: 'daily_roast' })
    expect(parseFlow('  @daily_roast  ', 2)).toEqual({ kind: 'param', id: 'daily_roast' })
    expect(parseFlow('@{daily roast}', 2)).toEqual({ kind: 'param', id: 'daily roast' })
    for (const bad of ['@', '@ x', '@{visitor', '@p%', '@p*2', '@p-@q', '@p 2', '@1']) {
      expect(parseFlow(bad, 2)).toEqual({ kind: 'paramBad', raw: bad })
    }
  })
})

describe('step() resolve pass (§M2-3)', () => {
  const graph = (flow: string, value: unknown) => ({
    nodes: [source('src'), pool('sink'), param('p', value)],
    edges: [res('e', 'src', 'sink', flow)],
  })

  it('resolves @p to a finite value ≥ 0 (incl. 0 and a decimal), no diagnostic', () => {
    for (const v of [0, 2, 2.5, 100]) {
      const g = graph('@p', v)
      const { values, diagnostics } = run1(g.nodes, g.edges)
      expect(values['sink']).toBe(v)
      expect(diagnostics).toEqual([])
    }
  })

  it('a negative value resolves exactly as the literal "-2" does (⇒ 1), no diagnostic (§M2-3.1)', () => {
    const g = graph('@p', -2)
    const ref = { nodes: [source('src'), pool('sink')], edges: [res('e', 'src', 'sink', '-2')] }
    const a = run1(g.nodes, g.edges)
    const b = run1(ref.nodes, ref.edges, 1)
    expect(a.values['sink']).toBe(b.values['sink']) // identical-literal
    expect(a.values['sink']).toBe(1)
    expect(a.diagnostics).toEqual([])
  })

  it('every unresolved @… contributes 0 + exactly one deduped diagnostic', () => {
    // unknown id
    let g = { nodes: [source('src'), pool('sink')], edges: [res('e', 'src', 'sink', '@nope')] }
    let r = run1(g.nodes, g.edges)
    expect(r.values['sink']).toBe(0)
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toContain('unknown parameter')

    // wrong kind (a pool)
    g = { nodes: [source('src'), pool('sink'), pool('notparam', 5)], edges: [res('e', 'src', 'sink', '@notparam')] }
    r = run1(g.nodes, g.edges)
    expect(r.values['sink']).toBe(0)
    expect(r.diagnostics[0]).toContain('must reference a parameter node (got pool)')

    // non-finite value
    g = { nodes: [source('src'), pool('sink'), param('p', Number.NaN)], edges: [res('e', 'src', 'sink', '@p')] }
    r = run1(g.nodes, g.edges)
    expect(r.values['sink']).toBe(0)
    expect(r.diagnostics[0]).toContain('not a finite number')

    // malformed reference
    g = { nodes: [source('src'), pool('sink')], edges: [res('e', 'src', 'sink', '@{visitor')] }
    r = run1(g.nodes, g.edges)
    expect(r.values['sink']).toBe(0)
    expect(r.diagnostics[0]).toContain('not a valid parameter reference')
  })

  it('is a no-op under modelVersion 1 — @p is just an unparseable literal ⇒ 1', () => {
    const g = graph('@p', 7)
    const r = run1(g.nodes, g.edges, 1)
    expect(r.values['sink']).toBe(1)
    expect(r.diagnostics).toEqual([])
  })

  it('one parameter, many edges — all read the same value in one step', () => {
    const nodes = [source('a'), source('b'), pool('pa'), pool('pb'), param('p', 3)]
    const edges = [res('ea', 'a', 'pa', '@p'), res('eb', 'b', 'pb', '@p')]
    const r = run1(nodes, edges)
    expect(r.values['pa']).toBe(3)
    expect(r.values['pb']).toBe(3)
  })
})

describe('determinism (§M2-INV-7)', () => {
  const nodes = [source('src'), pool('sink'), param('p', 4)]
  const edges = [res('e', 'src', 'sink', '@p')]
  const trace = (seed: number) => {
    let st = initSim(nodes)
    const rows: number[] = []
    for (let i = 0; i < 8; i++) {
      st = step(nodes, edges, st, seed, 2).state
      rows.push(st.values['sink'])
    }
    return JSON.stringify(rows)
  }
  it('same seed ⇒ identical trajectory with a @param edge', () => {
    expect(trace(7)).toBe(trace(7))
  })
  it('Monte-Carlo over a @param graph is byte-identical across two runs', () => {
    const cfg = { baseSeed: 1, runs: 20, steps: 6, tracked: [], modelVersion: 2 as const }
    const a = runMonteCarlo(nodes, edges, cfg)
    const b = runMonteCarlo(nodes, edges, cfg)
    expect(b.series).toEqual(a.series)
    expect(b.endedRuns).toEqual(a.endedRuns)
    expect(b.final).toEqual(a.final)
    // and changing the parameter moves the result
    const c = runMonteCarlo([source('src'), pool('sink'), param('p', 9)], edges, cfg)
    expect(c.final['sink'].summary.mean).not.toBe(a.final['sink'].summary.mean)
  })
})
