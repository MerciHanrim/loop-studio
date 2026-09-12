// docs/parameter-activator.md (PA) / SEMANTICS-S4.md (loop-state/4) — engine
// resolution tests. `parseActivatorExpr`'s pure grammar is covered in
// stateExpr.test.ts; this file proves `step()`'s RESOLUTION of a `param-term`
// RHS against real Parameter nodes: Class 2 fail-closed gating, one
// diagnostic per edge per step, live re-resolution every step, and the
// headline acceptance test (a hard-pity ceiling of 3 forces SSR on exactly
// the 3rd pull) — mirroring `gacha-pity-timing.probe.test.ts`'s minimal
// binary model, with the literal `HARD_PITY - 1` replaced by
// `@hard_pity - 1` against a real Parameter node.

import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'
import { digestOfCanonical, canonicalContent } from '../model/revision'

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' },
})
const gate = (id: string): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' },
})
const parameter = (id: string, value: number): LoopNode => ({
  id, type: 'parameter', position: XY,
  data: { kind: 'parameter', label: id, value },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})
const afterPullLabel = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr, timing: 'afterPull', when: 'source-fired' },
})

type Row = { step: number; v: Record<string, number>; fired: string[]; diagnostics: string[] }

function run(nodes: LoopNode[], edges: LoopEdge[], n: number, modelVersion: 1 | 2 = 2, seed = 1): Row[] {
  let st: SimState = initSim(nodes)
  const rows: Row[] = [{ step: 0, v: { ...st.values }, fired: [...st.fired], diagnostics: [] }]
  for (let i = 0; i < n; i++) {
    const r = step(nodes, edges, st, seed, modelVersion)
    st = r.state
    rows.push({ step: st.step, v: { ...st.values }, fired: r.report.fired, diagnostics: r.report.diagnostics })
  }
  return rows
}

// The same shape as gacha-pity-timing.probe.test.ts's hardPityGraph, with the
// literal ceiling replaced by a Parameter reference. `rollExpr`/`forcedExpr`
// default to the headline `@hard_pity - 1` pair; individual tests override
// one side to exercise a specific resolution failure.
function hardPityGraph(opts: {
  hardPityValue?: number
  rollExpr?: string
  forcedExpr?: string
} = {}) {
  const { hardPityValue = 3, rollExpr = '< @hard_pity - 1', forcedExpr = '>= @hard_pity - 1' } = opts
  const nodes: LoopNode[] = [
    pool('budget', 1000),
    pool('pity', 0),
    gate('roll_gate'),
    gate('forced_ssr'),
    gate('r_hit'),
    gate('ssr_hit'),
    pool('r_count', 0),
    pool('ssr_count', 0),
    parameter('hard_pity', hardPityValue),
  ]
  const edges: LoopEdge[] = [
    res('e_roll_in', 'budget', 'roll_gate', '1'),
    act('a_roll', 'pity', 'roll_gate', rollExpr),
    res('e_forced_in', 'budget', 'forced_ssr', '1'),
    act('a_forced', 'pity', 'forced_ssr', forcedExpr),
    res('e_r', 'roll_gate', 'r_hit', '1'),
    res('e_r_out', 'r_hit', 'r_count', '1'),
    res('e_ssr', 'forced_ssr', 'ssr_hit', '1'),
    res('e_ssr_out', 'ssr_hit', 'ssr_count', '1'),
    afterPullLabel('l_reset', 'ssr_hit', 'pity', '=0'),
    afterPullLabel('l_inc', 'r_hit', 'pity', '+1'),
  ]
  return { nodes, edges }
}

describe('§PA10-3 — the headline test: hard_pity = 3 forces SSR on exactly the 3rd pull', () => {
  it('via a real Parameter (not a literal): ceiling fires at steps 3, 6, 9, 12, no double-fire', () => {
    const { nodes, edges } = hardPityGraph({ hardPityValue: 3 })
    const t = run(nodes, edges, 12)
    const forcedSteps = t.filter((r) => r.fired.includes('ssr_hit')).map((r) => r.step)
    expect(forcedSteps).toEqual([3, 6, 9, 12])
    for (let i = 1; i < forcedSteps.length; i++) expect(forcedSteps[i] - forcedSteps[i - 1]).toBe(3)
  })

  it('pity is 0 in the SAME frame the SSR lands, and step 4 rolls normally (no re-force)', () => {
    const { nodes, edges } = hardPityGraph({ hardPityValue: 3 })
    const t = run(nodes, edges, 9)
    for (const s of [3, 6, 9]) expect(t[s].v.pity).toBe(0)
    expect(t[4].fired).toContain('r_hit')
    expect(t[4].fired).not.toContain('ssr_hit')
  })

  it('a DIFFERENT hard_pity value (5) shifts the ceiling accordingly — this is the whole point of tunability', () => {
    const { nodes, edges } = hardPityGraph({ hardPityValue: 5 })
    const t = run(nodes, edges, 10)
    const forcedSteps = t.filter((r) => r.fired.includes('ssr_hit')).map((r) => r.step)
    expect(forcedSteps).toEqual([5, 10])
  })

  it('a literal `HARD_PITY - 1` graph and this Parameter-based graph agree exactly, for the same value', () => {
    const literal = hardPityGraph({ hardPityValue: 3, rollExpr: '< 2', forcedExpr: '>= 2' })
    const viaParam = hardPityGraph({ hardPityValue: 3 })
    const a = run(literal.nodes, literal.edges, 12)
    const b = run(viaParam.nodes, viaParam.edges, 12)
    expect(a.map((r) => ({ v: r.v, fired: r.fired }))).toEqual(b.map((r) => ({ v: r.v, fired: r.fired })))
  })
})

describe('§PA5 — Class 2 resolution failure: fail-CLOSED, not fail-open (the reversal from draft 1)', () => {
  it('an unknown parameter id blocks its target forever — the simulation visibly stalls rather than rolling unbounded', () => {
    const { nodes, edges } = hardPityGraph({ forcedExpr: '>= @ghost - 1' })
    const t = run(nodes, edges, 9)
    // forced_ssr can NEVER fire — its only activator can never resolve to
    // satisfied. roll_gate (the real `< @hard_pity - 1` = `< 2`) keeps
    // working on its own terms and fires while pity < 2 (steps 1-2)...
    expect(t[1].fired).toContain('r_hit')
    expect(t[2].fired).toContain('r_hit')
    expect(t[1].v.pity).toBe(1)
    expect(t[2].v.pity).toBe(2)
    // ...but once pity reaches 2, roll_gate's OWN condition (`< 2`) also goes
    // false, and forced_ssr can never pick up the slack — the whole pull
    // pipeline stalls, visibly, from step 3 onward. This is the concrete
    // danger PA5/PA11-D3 names: fail-open here would have let roll_gate (or
    // some other route) continue unbounded past a ceiling that stopped
    // being enforced; fail-closed instead makes the graph stop advancing
    // at all, which is immediately visible rather than silently wrong.
    for (let s = 3; s <= 9; s++) {
      expect(t[s].fired).not.toContain('r_hit')
      expect(t[s].fired).not.toContain('ssr_hit')
      expect(t[s].v.pity).toBe(2) // stuck — neither route ever fires again
    }
    expect(t.some((r) => r.fired.includes('ssr_hit'))).toBe(false)
    // one diagnostic every step — the broken reference is evaluated (and
    // fails) unconditionally, regardless of whether pity has even reached
    // the ceiling yet.
    for (let s = 1; s <= 9; s++) {
      expect(t[s].diagnostics.some((d) => d.includes('unknown parameter "@ghost"'))).toBe(true)
    }
  })

  it('a reference to a non-Parameter node (a Pool) blocks its target, with the "must be a parameter node" diagnostic', () => {
    const { nodes, edges } = hardPityGraph({ forcedExpr: '>= @pity - 1' }) // `pity` is a Pool, not a Parameter
    const t = run(nodes, edges, 6)
    expect(t.some((r) => r.fired.includes('ssr_hit'))).toBe(false)
    expect(t[1].diagnostics.some((d) => d.includes('must be a parameter node (got pool)'))).toBe(true)
  })

  it('a non-finite Parameter value blocks its target, with the "not a finite number" diagnostic', () => {
    const { nodes, edges } = hardPityGraph({ hardPityValue: Number.NaN })
    const t = run(nodes, edges, 6)
    // BOTH activators reference the same broken parameter — nothing fires
    expect(t.some((r) => r.fired.includes('r_hit') || r.fired.includes('ssr_hit'))).toBe(false)
    expect(t[1].diagnostics.some((d) => d.includes('is not a finite number'))).toBe(true)
  })

  it('editing the referenced Parameter mid-run changes the effective threshold on the VERY NEXT step, no stale cache', () => {
    const { nodes, edges } = hardPityGraph({ hardPityValue: 3 })
    let st: SimState = initSim(nodes)
    const paramNode = nodes.find((n) => n.id === 'hard_pity')!
    const forcedAt: number[] = []
    for (let i = 1; i <= 6; i++) {
      if (i === 4) (paramNode.data as { value: number }).value = 2 // ceiling drops mid-run
      const r = step(nodes, edges, st, 1, 2)
      st = r.state
      if (r.report.fired.includes('ssr_hit')) forcedAt.push(st.step)
    }
    // with hard_pity=3 the first ceiling would be step 3; dropping it to 2 at
    // step 4 changes the SECOND ceiling's timing relative to the unmodified
    // run (which would force again at step 6) — proves the new value took
    // effect on step 4 onward, not cached from step 1-3's resolution.
    expect(forcedAt[0]).toBe(3) // unaffected — already forced+reset before the edit
    expect(forcedAt[1]).toBeLessThan(6) // ceiling=2 forces sooner than ceiling=3 would have
  })
})

describe('§PA5 / §S4-3 — digest and simulationRev: already-existing behaviour, confirmed unregressed', () => {
  it("a Parameter's value is unconditionally part of the canonical revision digest, with or without any @id reference", () => {
    const { nodes, edges } = hardPityGraph({ hardPityValue: 3 })
    const before = canonicalContent({ nodes, edges }, { modelLayer: true })
    const bumped = nodes.map((n) => (n.id === 'hard_pity' ? { ...n, data: { ...n.data, value: 4 } } : n))
    const after = canonicalContent({ nodes: bumped, edges }, { modelLayer: true })
    expect(digestOfCanonical(before)).not.toBe(digestOfCanonical(after))
  })

  it('a plain literal activator (no @param) produces byte-identical digest content before and after this feature — §S4 (PA11-D1)', () => {
    const { nodes, edges } = hardPityGraph({ rollExpr: '< 2', forcedExpr: '>= 2' })
    const c = canonicalContent({ nodes, edges }, { modelLayer: true })
    const forced = c.edges.find((e) => e.id === 'a_forced')!
    expect(forced.data).toEqual({ kind: 'state', mode: 'activator', expr: '>= 2', delay: 0 })
  })
})
