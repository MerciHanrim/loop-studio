import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'

// SEMANTICS-S.md loop-state/1 — Slice 4: `label` (non-conserving numeric edit
// on the target Pool's step-start balance). §S11 Case S-C is the acceptance
// vector; §S9 fixes `stateEvents` (`delta` raw, `applied` post single clamp);
// §S10 I1′ carries `Σ label applied` as the explicit external term.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const drain = (id: string, activation: 'automatic' | 'passive' = 'automatic'): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation, mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const label = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'label', expr },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})

type LabelEv = { edgeId: string; from: string; to: string; mode: string; effect: { kind: string; delta: number; applied: number } }
type Frame = {
  step: number
  values: Record<string, number>
  fired: string[]
  ended: boolean
  events: string[] // resource-event edge ids
  stateEvents: LabelEv[]
  queue: unknown[]
}
function run(nodes: LoopNode[], edges: LoopEdge[], steps: number): { frames: Frame[]; diags: string[][] } {
  let st: SimState = initSim(nodes)
  const frames: Frame[] = [
    { step: 0, values: { ...st.values }, fired: [], ended: false, events: [], stateEvents: [], queue: [...st.triggerQueue] },
  ]
  const diags: string[][] = [[]]
  for (let i = 0; i < steps; i++) {
    const r = step(nodes, edges, st, 1)
    st = r.state
    diags.push([...r.report.diagnostics])
    frames.push({
      step: st.step,
      values: { ...st.values },
      fired: r.report.fired,
      ended: st.ended,
      events: r.report.events.map((e) => e.edgeId),
      stateEvents: r.report.stateEvents as LabelEv[],
      queue: st.triggerQueue.map((q) => ({ ...q })),
    })
  }
  return { frames, diags }
}
const lev = (evs: LabelEv[], id: string) => evs.find((e) => e.edgeId === id)

// ════════════════════════════════════════════════════════════════════════
//  Case S-C — order + single clamp (the freeze target)
// ════════════════════════════════════════════════════════════════════════
describe('S-C — F(10) ┄m1:"-1"┄►T ; F ┄m2:"+S"┄►T (cap 8) ; T ─4→ D(auto)', () => {
  const nodes = [pool('F', 10), pool('T', 0, 8), drain('D')]
  const edges = [label('m1', 'F', 'T', '-1'), label('m2', 'F', 'T', '+S'), res('e1', 'T', 'D', '4')]
  const { frames } = run(nodes, edges, 5)

  it('T commits [0, 8, 4, 4, 4, 4] and F is never debited', () => {
    expect(frames.map((f) => f.values.T)).toEqual([0, 8, 4, 4, 4, 4])
    for (const f of frames) expect(f.values.F).toBe(10)
  })
  it('stateEvents each step: m1 {delta:-1, applied:-1}; m2 delta:+10, applied absorbs the clamp', () => {
    // step 1: before m2 the running value is -1, +10 → 9, clamp 8 ⇒ applied 8-(-1)=9
    expect(lev(frames[1].stateEvents, 'm1')!.effect).toEqual({ kind: 'label', delta: -1, applied: -1 })
    expect(lev(frames[1].stateEvents, 'm2')!.effect).toEqual({ kind: 'label', delta: 10, applied: 9 })
    // step 2: before m2 running is 7, +10 → 17, clamp 8 ⇒ applied 1
    expect(lev(frames[2].stateEvents, 'm2')!.effect).toEqual({ kind: 'label', delta: 10, applied: 1 })
    // step 3+: S[T]=4 → 3 → 13 → clamp 8 ⇒ applied 5
    expect(lev(frames[3].stateEvents, 'm2')!.effect).toEqual({ kind: 'label', delta: 10, applied: 5 })
  })
  it('label events are ascending by edgeId and never leak into report.events', () => {
    for (let s = 1; s <= 5; s++) {
      expect(frames[s].stateEvents.map((e) => e.edgeId)).toEqual(['m1', 'm2'])
      expect(frames[s].events).not.toContain('m1')
      expect(frames[s].events).not.toContain('m2')
    }
  })
  it('I1′ — per step ΔT == Σ(label applied) − Drain pull (pull = min(4, S[T]))', () => {
    for (let s = 1; s <= 5; s++) {
      const dT = frames[s].values.T - frames[s - 1].values.T
      const sumApplied = frames[s].stateEvents.reduce((a, e) => a + e.effect.applied, 0)
      const drainPull = Math.min(4, frames[s - 1].values.T)
      expect(dT).toBe(sumApplied - drainPull)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════
//  Grammar — the frozen assignment forms, and everything else inert
// ════════════════════════════════════════════════════════════════════════
describe('grammar — +N / -N / =N / +S / -S / =S only', () => {
  // one label edge onto an isolated Tank; read the step-1 commit.
  const oneShot = (expr: string, tInit = 0, cap: number | null = null, fInit = 6) =>
    run([pool('F', fInit), pool('T', tInit, cap)], [label('m1', 'F', 'T', expr)], 1)

  it('additive and assignment numerics', () => {
    expect(oneShot('+5').frames[1].values.T).toBe(5)
    expect(oneShot('-3', 10).frames[1].values.T).toBe(7)
    expect(oneShot('=7', 2).frames[1].values.T).toBe(7)
    expect(oneShot('+0', 4).frames[1].values.T).toBe(4)
    expect(oneShot('+2.5', 0).frames[1].values.T).toBe(2.5)
  })
  it('the S token reads S[source] (never debiting it)', () => {
    const a = oneShot('+S', 1, null, 6)
    expect(a.frames[1].values.T).toBe(7)
    expect(a.frames[1].values.F).toBe(6)
    expect(oneShot('-S', 10, null, 4).frames[1].values.T).toBe(6)
    expect(oneShot('=S', 99, null, 4).frames[1].values.T).toBe(4)
  })
  it('whitespace around the operator / ends is tolerated', () => {
    for (const e of ['+ 5', ' +5 ', '=  7', '\t-3\t']) {
      const t0 = e.includes('-') ? 10 : 0
      expect(oneShot(e, t0).diags[1].filter((d) => d.startsWith('Label'))).toHaveLength(0)
    }
  })
  it('=N reports delta = N − running', () => {
    const r = oneShot('=7', 2)
    expect(lev(r.frames[1].stateEvents, 'm1')!.effect).toEqual({ kind: 'label', delta: 5, applied: 5 })
  })

  const bad: [string, RegExp][] = [
    ['', /is empty/],
    ['   ', /is empty/],
    ['5', /is not a \+N/],
    ['+', /is not a \+N/],
    ['=', /is not a \+N/],
    ['++5', /is not a \+N/],
    ['+-5', /is not a \+N/],
    ['*5', /is not a \+N/],
    ['+NaN', /is not a \+N/],
    ['+Infinity', /is not a \+N/],
    ['-Infinity', /is not a \+N/],
    ['+1e3', /is not a \+N/],
    ['+.5', /is not a \+N/],
    ['+5.', /is not a \+N/],
    ['+s', /is not a \+N/],
    ['=S+1', /is not a \+N/],
    ['+5 apples', /is not a \+N/],
    ['-5;', /is not a \+N/],
  ]
  for (const [expr, msg] of bad) {
    it(`"${expr}" → inert (T unchanged) + exactly one diagnostic`, () => {
      const r = oneShot(expr, 3)
      expect(r.frames[1].values.T).toBe(3)
      const mine = r.diags[1].filter((d) => d.startsWith('Label "m1"'))
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatch(msg)
      expect(r.frames[1].stateEvents.some((e) => e.edgeId === 'm1')).toBe(false)
    })
  }

  it('the diagnostic repeats once per step with no backlog', () => {
    const { diags } = run([pool('F', 6), pool('T', 3)], [label('m1', 'F', 'T', 'junk')], 4)
    for (let s = 1; s <= 4; s++) expect(diags[s].filter((d) => d.startsWith('Label "m1"'))).toHaveLength(1)
  })
})

describe('endpoints — source and target must both be Pools', () => {
  it('a non-Pool source is inert + diagnostic', () => {
    const r = run([source('Src'), pool('T', 3)], [label('m1', 'Src', 'T', '+5')], 1)
    expect(r.frames[1].values.T).toBe(3)
    expect(r.diags[1].some((d) => /Label "m1" needs a Pool source/.test(d))).toBe(true)
  })
  it('a non-Pool target is inert + diagnostic', () => {
    const r = run([pool('F', 6), drain('D')], [label('m1', 'F', 'D', '+5')], 1)
    expect(r.diags[1].some((d) => /Label "m1" needs a Pool target/.test(d))).toBe(true)
    expect(r.frames[1].events).not.toContain('m1')
  })
})

// ════════════════════════════════════════════════════════════════════════
//  Clamp — one, at the end of Phase 0
// ════════════════════════════════════════════════════════════════════════
describe('a single clamp per target after every label edge', () => {
  it('uncapped Pool: floor at 0 only, no ceiling', () => {
    const lo = run([pool('F', 6), pool('T', 5)], [label('m1', 'F', 'T', '-10')], 1)
    expect(lo.frames[1].values.T).toBe(0)
    expect(lev(lo.frames[1].stateEvents, 'm1')!.effect).toEqual({ kind: 'label', delta: -10, applied: -5 })
    const hi = run([pool('F', 6), pool('T', 0)], [label('m1', 'F', 'T', '+1000')], 1)
    expect(hi.frames[1].values.T).toBe(1000)
  })
  it('capped Pool: overflow clamps to capacity, surfaced on applied', () => {
    const r = run([pool('F', 6), pool('T', 0, 8)], [label('m1', 'F', 'T', '+100')], 1)
    expect(r.frames[1].values.T).toBe(8)
    expect(lev(r.frames[1].stateEvents, 'm1')!.effect).toEqual({ kind: 'label', delta: 100, applied: 8 })
  })
  it('intermediate out-of-range values between two modifiers are allowed', () => {
    // m1 "+20" pushes past cap 8, m2 "-15" brings it back to 5 — no clamp between.
    const r = run([pool('F', 6), pool('T', 0, 8)], [label('m1', 'F', 'T', '+20'), label('m2', 'F', 'T', '-15')], 1)
    expect(r.frames[1].values.T).toBe(5)
    expect(lev(r.frames[1].stateEvents, 'm1')!.effect.applied).toBe(20) // full delta — no early clamp
    expect(lev(r.frames[1].stateEvents, 'm2')!.effect.applied).toBe(-15)
  })
  it('the last edge into a target absorbs the clamp; earlier edges keep their full delta', () => {
    const r = run([pool('F', 6), pool('T', 0, 8)], [label('m1', 'F', 'T', '+5'), label('m2', 'F', 'T', '+10')], 1)
    expect(r.frames[1].values.T).toBe(8)
    expect(lev(r.frames[1].stateEvents, 'm1')!.effect.applied).toBe(5)
    expect(lev(r.frames[1].stateEvents, 'm2')!.effect.applied).toBe(3) // 8 − 5
  })
})

// ════════════════════════════════════════════════════════════════════════
//  Ordering — ascending edge.id, independent of array order
// ════════════════════════════════════════════════════════════════════════
describe('multiple modifiers apply in ascending edge.id', () => {
  const build = () => ({
    // m1 "+2" then m2 "=5"  ⇒  0 → 2 → 5.   Reversed order would give 0 → 5 → 7.
    nodes: [pool('F', 6), pool('T', 0, 20)],
    edges: [label('m2', 'F', 'T', '=5'), label('m1', 'F', 'T', '+2')], // deliberately out of id order
  })
  it('T = 5 (m1 before m2), and m2 reports delta = 5 − 2 = 3', () => {
    const { nodes, edges } = build()
    const r = run(nodes, edges, 1)
    expect(r.frames[1].values.T).toBe(5)
    expect(lev(r.frames[1].stateEvents, 'm1')!.effect).toEqual({ kind: 'label', delta: 2, applied: 2 })
    expect(lev(r.frames[1].stateEvents, 'm2')!.effect).toEqual({ kind: 'label', delta: 3, applied: 3 })
  })
  it('I8-S — reversing the arrays does not change frames or diagnostics', () => {
    const { nodes, edges } = build()
    const a = run(nodes, edges, 4)
    const b = run([...nodes].reverse(), [...edges].reverse(), 4)
    expect(b.frames).toEqual(a.frames)
    expect(b.diags).toEqual(a.diags)
  })
})

// ════════════════════════════════════════════════════════════════════════
//  label never drives the queue or termination
// ════════════════════════════════════════════════════════════════════════
describe('a label edge creates no trigger queue entry and never ends the run', () => {
  const { frames } = run(
    [pool('F', 10), pool('T', 0, 8), drain('D')],
    [label('m1', 'F', 'T', '-1'), label('m2', 'F', 'T', '+S'), res('e1', 'T', 'D', '4')],
    6,
  )
  it('triggerQueue stays empty and ended stays false', () => {
    for (const f of frames) {
      expect(f.queue).toEqual([])
      expect(f.ended).toBe(false)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════
//  label + activator in the same step — independent (§S7)
// ════════════════════════════════════════════════════════════════════════
describe('label always applies; a co-located activator gates only the target\'s firing', () => {
  const scGraph = (gaugeVal: number) => {
    const nodes = [pool('F', 10), pool('T', 0, 8), drain('D'), pool('G', gaugeVal)]
    const edges = [
      label('m1', 'F', 'T', '-1'),
      label('m2', 'F', 'T', '+S'),
      res('e1', 'T', 'D', '4'),
      act('a1', 'G', 'D', '>= 5'),
    ]
    return run(nodes, edges, 5)
  }
  it('gauge open ⇒ exactly the S-C trace (D drains)', () => {
    const r = scGraph(10)
    expect(r.frames.map((f) => f.values.T)).toEqual([0, 8, 4, 4, 4, 4])
    expect(lev(r.frames[2].stateEvents, 'm2')!.effect.applied).toBe(1)
    for (let s = 1; s <= 5; s++) expect((r.frames[s].stateEvents.find((e) => e.edgeId === 'a1') as unknown as { effect: { satisfied: boolean } }).effect.satisfied).toBe(true)
  })
  it('gauge closed ⇒ label still edits T every step, D never drains ⇒ T holds at 8', () => {
    const r = scGraph(3)
    expect(r.frames.map((f) => f.values.T)).toEqual([0, 8, 8, 8, 8, 8])
    for (let s = 1; s <= 5; s++) {
      expect(r.frames[s].fired).not.toContain('D')
      expect(lev(r.frames[s].stateEvents, 'm1')).toBeDefined()
      expect(lev(r.frames[s].stateEvents, 'm2')).toBeDefined()
    }
  })
  it('stateEvents stay ascending by edgeId with the mix of modes (a1, m1, m2)', () => {
    const r = scGraph(10)
    for (let s = 1; s <= 5; s++) {
      expect(r.frames[s].stateEvents.map((e) => e.edgeId)).toEqual(['a1', 'm1', 'm2'])
    }
  })
})
