import { describe, expect, it } from 'vitest'
import generalDoc from '../../examples/gacha-general.json'
import { evaluate } from '../model/expr/evaluate'
import { parse } from '../model/expr/parse'
import type { LoopEdge, LoopNode } from '../model/types'
import { gateChances } from './gateChance'
import type { SimState } from './index'
import { initSim, step } from './index'

// docs/gacha-general.md — the shipped general gacha (examples/gacha-general.json)
// run by the engine: what its description says holds — the roll picks one
// result per ticket, the counts add up to the pulls made, the run stops when
// the pulls reach the target (changing the target moves that point), and the
// hit rate is counted against the target, not the pulls made so far.

const doc = generalDoc as unknown as { nodes: LoopNode[]; edges: LoopEdge[]; recommendedRunConfig: { steps: number; canvasLocked?: boolean } }

/** the document with the target set to `target` */
function graph(target?: number): { nodes: LoopNode[]; edges: LoopEdge[] } {
  const nodes = doc.nodes.map((n) => (n.id === 'target_pulls' && target != null ? ({ ...n, data: { ...n.data, value: target } } as LoopNode) : n))
  return { nodes, edges: doc.edges }
}

type Row = { step: number; v: Record<string, number>; ended: boolean }
function run(nodes: LoopNode[], edges: LoopEdge[], steps: number, seed: number): Row[] {
  let st: SimState = initSim(nodes)
  const rows: Row[] = [{ step: 0, v: { ...st.values }, ended: st.ended }]
  for (let i = 0; i < steps && !st.ended; i++) {
    st = step(nodes, edges, st, seed, 2).state
    rows.push({ step: st.step, v: { ...st.values }, ended: st.ended })
  }
  return rows
}

const hitRate = (nodes: LoopNode[], values: Record<string, number>): number => {
  const reg = nodes.find((n) => n.id === 'ssr_hit_rate')!
  const parsed = parse((reg.data as { expr: string }).expr)
  if (!parsed.ok) throw new Error('the hit rate does not parse')
  const r = evaluate(parsed.ast, (id: string) => {
    const n = nodes.find((x) => x.id === id)
    if (!n) return { ok: false as const, error: { code: 'unknown-ref' } as never }
    if (n.data.kind === 'parameter') return { ok: true as const, value: n.data.value }
    return { ok: true as const, value: values[id] ?? 0 }
  })
  if (!r.ok) throw new Error('the hit rate does not evaluate')
  return r.value
}

describe('the general gacha (examples/gacha-general.json)', () => {
  it('opens unlocked; the hit rate reads SSR count over the target', () => {
    expect(doc.recommendedRunConfig.canvasLocked).toBe(false)
    const reg = doc.nodes.find((n) => n.id === 'ssr_hit_rate')!
    expect((reg.data as { expr: string }).expr).toBe('@ssr_count / @target_pulls')
  })

  it('the roll picks SSR, SR or R by weight: 0.6 %, 5.1 %, 94.3 % of 1,000', () => {
    const c = gateChances(doc.nodes, doc.edges, 'roll', 2)!
    expect(c.status).toBe('fixed')
    expect(c.sum).toBe(1000)
    const byTarget = Object.fromEntries(c.branches.map((b) => [b.target, b.chance]))
    expect(byTarget).toEqual({ ssr_result: 0.006, sr_result: 0.051, r_result: 0.943 })
  })

  it.each([1, 2, 3, 4, 5])('seed %i: every step, SSR + SR + R counts equal the pulls made, and one ticket is rolled at most', (seed) => {
    const rows = run(doc.nodes, doc.edges, doc.recommendedRunConfig.steps, seed)
    for (let i = 1; i < rows.length; i++) {
      const v = rows[i].v
      expect(v.ssr_count + v.sr_count + v.r_count).toBe(v.pulls_made)
      expect(v.pulls_made - rows[i - 1].v.pulls_made).toBeGreaterThanOrEqual(0)
      expect(v.pulls_made - rows[i - 1].v.pulls_made).toBeLessThanOrEqual(1)
    }
  })

  it.each([200, 50, 7])('target %i: the run ends at step target + 2 with exactly the target pulled — not a step earlier', (target) => {
    const { nodes, edges } = graph(target)
    const rows = run(nodes, edges, target + 10, 1)
    const endAt = rows.findIndex((r) => r.ended)
    expect(endAt).toBe(target + 2)
    const last = rows[endAt].v
    expect(last.pulls_made).toBe(target)
    expect(last.ssr_count + last.sr_count + last.r_count).toBe(target)
    // the step before: the pulls have reached the target, the end has not fired yet
    expect(rows[endAt - 1].ended).toBe(false)
    expect(rows[endAt - 1].v.pulls_made).toBe(target)
    // the completion signal is what the end took
    expect(rows[endAt - 1].v.completion_signal).toBe(1)
    expect(last.completion_signal).toBe(0)
  })

  it('the default horizon (target 200 + 2) is the end step: a run of the recommended length ends', () => {
    expect(doc.recommendedRunConfig.steps).toBe(202)
    const rows = run(doc.nodes, doc.edges, 202, 1)
    expect(rows[rows.length - 1].ended).toBe(true)
  })

  it('the hit rate is SSR count ÷ the target at every step — mid-run it differs from SSR ÷ pulls made; at the end the two are equal', () => {
    // a seed whose run lands at least one SSR, so the two ratios can differ
    let rows: Row[] = []
    for (let seed = 1; seed <= 50; seed++) {
      rows = run(doc.nodes, doc.edges, 202, seed)
      if (rows[rows.length - 1].v.ssr_count > 0) break
    }
    const last = rows[rows.length - 1].v
    expect(last.ssr_count).toBeGreaterThan(0)
    let differed = false
    for (const r of rows) {
      const rate = hitRate(doc.nodes, r.v)
      expect(rate).toBeCloseTo(r.v.ssr_count / 200, 12)
      if (r.v.pulls_made > 0 && r.v.pulls_made < 200 && r.v.ssr_count > 0 && Math.abs(rate - r.v.ssr_count / r.v.pulls_made) > 1e-12) differed = true
    }
    expect(differed).toBe(true)
    expect(hitRate(doc.nodes, last)).toBeCloseTo(last.ssr_count / last.pulls_made, 12)
  })

  it('a changed target is the hit rate’s denominator too', () => {
    const { nodes, edges } = graph(50)
    const rows = run(nodes, edges, 60, 3)
    const last = rows[rows.length - 1].v
    expect(hitRate(nodes, last)).toBeCloseTo(last.ssr_count / 50, 12)
  })
})
