// docs/example-gacha-simulator.md §GS11-D1 proved a hard-pity counter
// (increments per pull, resets on SSR, forces routing at the ceiling) was NOT
// expressible with `loop-state/1`. docs/conditional-state-update.md (CSU,
// `loop-state/3` — SEMANTICS-S3.md) closes that gap with a post-pull
// conditional `label` (`timing: "afterPull"`, `when: "source-fired"`,
// Phase 2.5). This file is the POSITIVE contract test the CSU design doc
// promised (CSU6): kept as a runnable tripwire — if a future engine change
// regresses either the same-frame reset or the no-double-fire property, this
// fails.
import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const gate = (id: string): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const afterPullLabel = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr, timing: 'afterPull', when: 'source-fired' },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})

function run(nodes: LoopNode[], edges: LoopEdge[], n: number) {
  let st: SimState = initSim(nodes)
  const rows: { step: number; v: Record<string, number>; fired: string[] }[] = [
    { step: 0, v: { ...st.values }, fired: [...st.fired] },
  ]
  for (let i = 0; i < n; i++) {
    const r = step(nodes, edges, st, 1)
    st = r.state
    rows.push({ step: st.step, v: { ...st.values }, fired: r.report.fired })
  }
  return rows
}

// A `HARD_PITY = 3` ceiling (CSU4/CSU5): `pity` counts consecutive non-SSR
// pulls; `roll_gate` (< 2) is the normal route, `forced_ssr` (>= 2) is the
// ceiling. `r_hit` / `ssr_hit` are single-output deterministic Gates so each
// carries its whole input through untouched (CSU4's "not Converters" note) —
// here every non-forced pull is a stand-in "non-SSR" result, so `r_hit` alone
// plays the role `sr_hit` + `r_hit` share in the full gacha model.
function hardPityGraph() {
  const nodes = [
    // `budget` already holds balance at the START of every step, so it can be
    // pulled the SAME step (a Source's Phase-1 push cannot — SEMANTICS.md §3:
    // "a resource a Source pushes ... is not pullable ... until step n+1").
    pool('budget', 1000),
    pool('pity', 0),
    gate('roll_gate'),
    gate('forced_ssr'),
    gate('r_hit'),
    gate('ssr_hit'),
    pool('r_count', 0),
    pool('ssr_count', 0),
  ]
  const edges = [
    res('e_roll_in', 'budget', 'roll_gate', '1'),
    act('a_roll', 'pity', 'roll_gate', '< 2'), // HARD_PITY - 1 (CSU9-D2)
    res('e_forced_in', 'budget', 'forced_ssr', '1'),
    act('a_forced', 'pity', 'forced_ssr', '>= 2'),
    res('e_r', 'roll_gate', 'r_hit', '1'),
    res('e_r_out', 'r_hit', 'r_count', '1'),
    res('e_ssr', 'forced_ssr', 'ssr_hit', '1'),
    res('e_ssr_out', 'ssr_hit', 'ssr_count', '1'),
    afterPullLabel('l_reset', 'ssr_hit', 'pity', '=0'),
    afterPullLabel('l_inc', 'r_hit', 'pity', '+1'),
  ]
  return { nodes, edges }
}

describe('§CSU5 — a hard pity IS expressible via a post-pull conditional label', () => {
  it('the forced-SSR route fires exactly once per ceiling hit, spaced exactly HARD_PITY apart', () => {
    const { nodes, edges } = hardPityGraph()
    const t = run(nodes, edges, 12) // 4 ceiling hits at steps 3, 6, 9, 12
    const forcedSteps = t.filter((r) => r.fired.includes('ssr_hit')).map((r) => r.step)
    expect(forcedSteps).toEqual([3, 6, 9, 12])
    for (let i = 1; i < forcedSteps.length; i++) {
      expect(forcedSteps[i] - forcedSteps[i - 1]).toBe(3) // no double-fire, no gap
    }
  })

  it('pity is 0 in the SAME frame the SSR lands — not the next (the rev-1 bug)', () => {
    const { nodes, edges } = hardPityGraph()
    const t = run(nodes, edges, 9)
    for (const s of [3, 6, 9]) expect(t[s].v.pity).toBe(0)
    // the step immediately after a reset starts counting from 0, not the
    // pre-reset ceiling value — this is exactly what routes step 4 to
    // `roll_gate` instead of re-forcing `forced_ssr`
    expect(t[4].fired).toContain('r_hit')
    expect(t[4].fired).not.toContain('ssr_hit')
  })

  it('pity rises by exactly 1 on every non-ceiling pull, and by 0 on a ceiling pull', () => {
    const { nodes, edges } = hardPityGraph()
    const t = run(nodes, edges, 12)
    for (let s = 1; s <= 12; s++) {
      if (t[s].fired.includes('ssr_hit')) {
        expect(t[s].v.pity).toBe(0)
      } else {
        expect(t[s].v.pity).toBe((t[s - 1].v.pity ?? 0) + 1)
      }
    }
  })

  it('one result per pull — ssr_count + r_count == pulls made, every step', () => {
    const { nodes, edges } = hardPityGraph()
    const t = run(nodes, edges, 12)
    for (let s = 1; s <= 12; s++) {
      expect((t[s].v.ssr_count ?? 0) + (t[s].v.r_count ?? 0)).toBe(s)
    }
  })
})
