// CSU / loop-state/3 (docs/conditional-state-update.md, SEMANTICS-S3.md) —
// the post-pull conditional `label`: `timing: "afterPull"` (Phase 2.5, after
// the Phase-2 pull) gated by `when: "source-fired"` (this step's `fired`, not
// `fired(t-1)`). Engine-contract tests for CSU3 / CSU6, independent of the
// gacha content (that lands with GS10-3). See also
// `gacha-pity-timing.probe.test.ts` for the end-to-end hard-pity trace.
import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState, StepResult } from './index'
import { initSim, step } from './index'

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const drain = (id: string): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' },
})
const gate = (id: string): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})
// `timing` / `when` are deliberately `unknown` here (not the engine's real
// `StateEdgeData` types) — several tests below construct intentionally
// malformed values (CSU3-5) that a correctly-typed builder couldn't express.
type LabelOpts = { timing?: unknown; when?: unknown }
const label = (id: string, s: string, t: string, expr: string, opts: LabelOpts = {}): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr, ...opts } as unknown as LoopEdge['data'],
})
const afterPull = (id: string, s: string, t: string, expr: string): LoopEdge =>
  label(id, s, t, expr, { timing: 'afterPull', when: 'source-fired' })

function run(nodes: LoopNode[], edges: LoopEdge[], n: number): StepResult[] {
  let st: SimState = initSim(nodes)
  const results: StepResult[] = []
  for (let i = 0; i < n; i++) {
    const r = step(nodes, edges, st, 1)
    st = r.state
    results.push(r)
  }
  return results
}

const labelEffectFor = (r: StepResult, edgeId: string) =>
  r.report.stateEvents.find((e) => e.edgeId === edgeId)?.effect

describe('CSU3-5 — validation is fail-closed: exactly one diagnostic, no state effect', () => {
  // a router that fires every step (resource path `src -> g -> sink`,
  // unrelated to the label target `tgt`, so `tgt` moves ONLY if the label
  // under test actually applies)
  const nodes = [pool('src', 100), gate('g'), pool('sink', 0), pool('tgt', 5), drain('d')]
  const edges = [res('e_in', 'src', 'g', '1'), res('e_out', 'g', 'sink', '1'), res('e_drain', 'sink', 'd', '1')]

  it('unknown `timing` — inert, one diagnostic, no stateEvent', () => {
    const bad = label('L', 'g', 'tgt', '+1', { timing: 'nope' })
    const r = run(nodes, [...edges, bad], 1)[0]
    expect(r.report.diagnostics.filter((d) => /timing/.test(d) && /"L"/.test(d))).toHaveLength(1)
    expect(labelEffectFor(r, 'L')).toBeUndefined()
    expect(r.state.values.tgt).toBe(5) // untouched
  })

  it('`phase0` + a `when` — the WHOLE edge is inert (never falls back to unconditional)', () => {
    const bad = label('L', 'g', 'tgt', '+1', { when: 'source-fired' }) // timing absent = phase0
    const r = run(nodes, [...edges, bad], 1)[0]
    expect(r.report.diagnostics.filter((d) => /"when"/.test(d) && /"L"/.test(d))).toHaveLength(1)
    expect(labelEffectFor(r, 'L')).toBeUndefined()
    expect(r.state.values.tgt).toBe(5)
  })

  it('`afterPull` with no `when` — inert, one diagnostic', () => {
    const bad = label('L', 'g', 'tgt', '+1', { timing: 'afterPull' })
    const r = run(nodes, [...edges, bad], 1)[0]
    expect(r.report.diagnostics.filter((d) => /needs when/.test(d) && /"L"/.test(d))).toHaveLength(1)
    expect(labelEffectFor(r, 'L')).toBeUndefined()
    expect(r.state.values.tgt).toBe(5)
  })

  it('`afterPull` with an unsupported `when` value — inert, one diagnostic', () => {
    const bad = label('L', 'g', 'tgt', '+1', { timing: 'afterPull', when: 'level>=5' })
    const r = run(nodes, [...edges, bad], 1)[0]
    expect(r.report.diagnostics.filter((d) => /when "level>=5" is not supported/.test(d))).toHaveLength(1)
    expect(labelEffectFor(r, 'L')).toBeUndefined()
    expect(r.state.values.tgt).toBe(5)
  })

  it('`afterPull` source is a Pool, not a Phase-2 router — inert, one diagnostic', () => {
    const bad = afterPull('L', 'src', 'tgt', '+1') // src is a Pool
    const r = run(nodes, [...edges, bad], 1)[0]
    expect(
      r.report.diagnostics.filter((d) => /needs a Gate \/ Converter \/ Drain \/ End source/.test(d)),
    ).toHaveLength(1)
    expect(labelEffectFor(r, 'L')).toBeUndefined()
    expect(r.state.values.tgt).toBe(5)
  })

  it('`afterPull` expr reads `S` — inert, one diagnostic (no Pool source to read)', () => {
    const bad = afterPull('L', 'g', 'tgt', '+S')
    const r = run(nodes, [...edges, bad], 1)[0]
    expect(r.report.diagnostics.filter((d) => /cannot read S/.test(d))).toHaveLength(1)
    expect(labelEffectFor(r, 'L')).toBeUndefined()
    expect(r.state.values.tgt).toBe(5)
  })

  it('a Source is rejected too (it fires in Phase 1, not a per-pull result)', () => {
    const nodes2 = [source('s'), pool('p', 0), pool('tgt', 5), drain('d')]
    const edges2 = [res('e1', 's', 'p', '1'), res('e2', 'p', 'd', '0'), afterPull('L', 's', 'tgt', '+1')]
    const r = run(nodes2, edges2, 1)[0]
    expect(
      r.report.diagnostics.filter((d) => /needs a Gate \/ Converter \/ Drain \/ End source/.test(d)),
    ).toHaveLength(1)
    expect(r.state.values.tgt).toBe(5)
  })
})

describe('CSU3-4 / CSU9-D5 — report shape: `applied` only on afterPull, legacy shape untouched', () => {
  it('a `phase0` (untyped) label effect has NO `applied` key, ever', () => {
    const nodes = [pool('a', 3), pool('b', 0)]
    const edges = [label('m', 'a', 'b', '+1')]
    const r = run(nodes, edges, 1)[0]
    const eff = labelEffectFor(r, 'm')!
    expect(eff).toEqual({ kind: 'label', delta: 1, clampAdjustment: 0 })
    expect('applied' in eff).toBe(false)
  })

  it('an `afterPull` label that fires this step: `applied:true`, real delta', () => {
    const nodes = [pool('src', 100), gate('g'), pool('tgt', 0), drain('d')]
    const edges = [res('e1', 'src', 'g', '1'), res('e2', 'g', 'd', '1'), afterPull('L', 'g', 'tgt', '+2')]
    const r = run(nodes, edges, 1)[0]
    expect(labelEffectFor(r, 'L')).toEqual({ kind: 'label', applied: true, delta: 2, clampAdjustment: 0 })
    expect(r.state.values.tgt).toBe(2)
  })

  it('an `afterPull` label whose source did NOT fire: `applied:false`, delta 0, clampAdjustment 0, NO diagnostic', () => {
    // `g` is gated closed (activator never satisfied) so it never fires
    const nodes = [pool('src', 100), pool('gate_ctrl', 0), gate('g'), pool('tgt', 5), drain('d')]
    const edges = [
      res('e1', 'src', 'g', '1'),
      res('e2', 'g', 'd', '1'),
      act('a', 'gate_ctrl', 'g', '>= 999'), // never true
      afterPull('L', 'g', 'tgt', '+1'),
    ]
    const r = run(nodes, edges, 1)[0]
    expect(r.report.fired).not.toContain('g')
    expect(labelEffectFor(r, 'L')).toEqual({ kind: 'label', applied: false, delta: 0, clampAdjustment: 0 })
    expect(r.state.values.tgt).toBe(5) // untouched
    expect(r.report.diagnostics).toEqual([]) // inert-by-`when` is expected, not an error
  })
})

describe('CSU3-6 — clamp attribution: only the target\'s LAST APPLIED afterPull edge', () => {
  it('two applied edges into one capped Pool: only the later id carries the correction', () => {
    // g1 and g2 both fire this step; both push +10 into `tgt` (cap 12) via
    // afterPull labels m1 (id < m2). Unclamped 0+10+10=20, clamp to 12 ⇒ -8.
    const nodes = [
      pool('src', 100), gate('g1'), gate('g2'), pool('tgt', 0, 12), drain('d1'), drain('d2'),
    ]
    const edges = [
      res('a1', 'src', 'g1', '1'), res('o1', 'g1', 'd1', '1'),
      res('a2', 'src', 'g2', '1'), res('o2', 'g2', 'd2', '1'),
      afterPull('m1', 'g1', 'tgt', '+10'),
      afterPull('m2', 'g2', 'tgt', '+10'),
    ]
    const r = run(nodes, edges, 1)[0]
    expect(r.state.values.tgt).toBe(12)
    expect(labelEffectFor(r, 'm1')).toEqual({ kind: 'label', applied: true, delta: 10, clampAdjustment: 0 })
    expect(labelEffectFor(r, 'm2')).toEqual({ kind: 'label', applied: true, delta: 10, clampAdjustment: -8 })
  })

  it('an inert edge is never the attribution target, even if it has the highest id', () => {
    // m2 (higher id) never fires (its source g2 is gated off); the clamp must
    // land on m1, the last edge that actually APPLIED.
    const nodes = [
      pool('src', 100), pool('never', 0), gate('g1'), gate('g2'), pool('tgt', 0, 5), drain('d1'), drain('d2'),
    ]
    const edges = [
      res('a1', 'src', 'g1', '1'), res('o1', 'g1', 'd1', '1'),
      res('a2', 'src', 'g2', '1'), res('o2', 'g2', 'd2', '1'),
      act('gate_off', 'never', 'g2', '>= 999'),
      afterPull('m1', 'g1', 'tgt', '+9'),
      afterPull('m2', 'g2', 'tgt', '+9'),
    ]
    const r = run(nodes, edges, 1)[0]
    expect(r.report.fired).not.toContain('g2')
    expect(r.state.values.tgt).toBe(5)
    expect(labelEffectFor(r, 'm1')).toEqual({ kind: 'label', applied: true, delta: 9, clampAdjustment: -4 })
    expect(labelEffectFor(r, 'm2')).toEqual({ kind: 'label', applied: false, delta: 0, clampAdjustment: 0 })
  })
})

describe('CSU6-10 — I1\' three-term decomposition', () => {
  it('resource movement + Phase-0 label term + Phase-2.5 label term = final - start', () => {
    // `tgt`: Source pushes +5 (resource), a Drain pulls -2 (resource), a
    // phase0 label edits +3, an afterPull label (gated on the Drain firing)
    // edits -1. All four kinds of change on ONE Pool in ONE step.
    const nodes = [
      source('feed'), pool('tgt', 10), drain('sink'), pool('phaseSrc', 100),
    ]
    const edges = [
      res('r_in', 'feed', 'tgt', '5'), // NOTE: lands in `working`, pulled next step (§3) —
      // so `report.events` this step reflects only the DRAIN side; see below.
      res('r_out', 'tgt', 'sink', '2'),
      label('m0', 'phaseSrc', 'tgt', '+3'), // phase0, unconditional
      afterPull('m1', 'sink', 'tgt', '-1'), // afterPull, gated on `sink` firing
    ]
    const before = initSim(nodes)
    const r = step(nodes, edges, before, 1)
    const resourceIn = r.report.events.filter((e) => e.to === 'tgt').reduce((s, e) => s + e.amount, 0)
    const resourceOut = r.report.events.filter((e) => e.from === 'tgt').reduce((s, e) => s + e.amount, 0)
    const phase0Term =
      (labelEffectFor(r, 'm0') as { delta: number; clampAdjustment: number }).delta +
      (labelEffectFor(r, 'm0') as { delta: number; clampAdjustment: number }).clampAdjustment
    const ap = labelEffectFor(r, 'm1') as { applied: boolean; delta: number; clampAdjustment: number }
    const afterPullTerm = ap.applied ? ap.delta + ap.clampAdjustment : 0
    const start = before.values.tgt ?? 0
    const final = r.state.values.tgt
    expect(final - start).toBe(resourceIn - resourceOut + phase0Term + afterPullTerm)
    // and the Drain really did fire this step, so the afterPull term is live
    expect(r.report.fired).toContain('sink')
    expect(ap.applied).toBe(true)
  })

  it('the single-equation form (Σ delta + clampAdjustment = final - start) holds for a Pool with NO resource edges', () => {
    const nodes = [pool('pity', 5), gate('g'), pool('src', 100), drain('d')]
    const edges = [
      res('a', 'src', 'g', '1'),
      res('o', 'g', 'd', '1'),
      afterPull('m', 'g', 'pity', '=0'),
    ]
    const before = initSim(nodes)
    const r = step(nodes, edges, before, 1)
    const ap = labelEffectFor(r, 'm') as { applied: boolean; delta: number; clampAdjustment: number }
    expect(ap.delta + ap.clampAdjustment).toBe(r.state.values.pity - (before.values.pity ?? 0))
  })
})

describe('CSU3-2 — `when: "source-fired"` reads THIS step, not fired(t-1)', () => {
  it('a Gate gated permanently closed never fires and its afterPull label never applies', () => {
    // control case: `g` can never fire (its activator is never satisfied), so
    // `when: "source-fired"` must never see it in ANY step's `fired` set.
    const nodes = [pool('ctrl', 0), pool('src', 100), gate('g'), pool('tgt', 0), drain('d')]
    const edges = [
      res('a', 'src', 'g', '1'),
      res('o', 'g', 'd', '1'),
      act('gate', 'ctrl', 'g', '>= 1'), // ctrl never reaches 1 — no feed
      afterPull('m', 'g', 'tgt', '+1'),
    ]
    const rows = run(nodes, edges, 4)
    expect(rows.every((r) => !r.report.fired.includes('g') && r.state.values.tgt === 0)).toBe(true)
  })

  it('same-step visibility, directly: the afterPull edit is present in THIS step\'s commit, not the next', () => {
    const nodes = [pool('src', 100), gate('g'), pool('tgt', 0), drain('d')]
    const edges = [res('a', 'src', 'g', '1'), res('o', 'g', 'd', '1'), afterPull('m', 'g', 'tgt', '+7')]
    const before = initSim(nodes)
    const r1 = step(nodes, edges, before, 1)
    expect(r1.report.fired).toContain('g') // fired THIS step
    expect(r1.state.values.tgt).toBe(7) // ...and already committed THIS step
  })
})

describe('CSU — determinism, Reset, and order invariance', () => {
  const nodes = [pool('src', 100), gate('g'), pool('tgt', 0), pool('pity', 3), drain('d')]
  const edges = [
    res('a', 'src', 'g', '1'),
    res('o', 'g', 'd', '1'),
    afterPull('m1', 'g', 'tgt', '+1'),
    afterPull('m2', 'g', 'pity', '=0'),
  ]

  it('same seed twice from Reset (fresh initSim) ⇒ identical trajectory', () => {
    const a = run(nodes, edges, 5).map((r) => ({ v: r.state.values, se: r.report.stateEvents, f: r.report.fired }))
    const b = run(nodes, edges, 5).map((r) => ({ v: r.state.values, se: r.report.stateEvents, f: r.report.fired }))
    expect(b).toEqual(a)
  })

  it('reversing the node / edge arrays does not change the result', () => {
    const fwd = run(nodes, edges, 5)
    const rev = run([...nodes].reverse(), [...edges].reverse(), 5)
    // `toEqual` is key-order-independent — only reversed array CONSTRUCTION
    // order differs (object key insertion order), never a computed value.
    expect(rev.map((r) => r.state.values)).toEqual(fwd.map((r) => r.state.values))
    expect(rev.map((r) => r.report.stateEvents)).toEqual(fwd.map((r) => r.report.stateEvents))
  })
})
