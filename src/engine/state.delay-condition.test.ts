import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { initSim, step } from './index'

// SEMANTICS-S.md loop-state/1 — Slice 3: `activator` comparison-grammar
// hardening + `activator` ↔ delayed-`trigger` interplay. Slice 3 must NOT
// change any Slice 2 meaning: a valid comparison evaluates exactly as before,
// an invalid one is inert (dropped from the AND) + one diagnostic per step.
// The queue-clear / Monte-Carlo-isolation regressions live in Slice 1's net.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
/** a Source that fires only on the 0→1 advance */
const srcOnce = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'onStart', mode: 'pushAny' },
})
const drain = (id: string, activation: 'automatic' | 'passive' | 'onStart' = 'automatic'): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation, mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', data: { kind: 'resource', flow },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})
const trig = (id: string, s: string, t: string, delay = 0): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'trigger', expr: '', delay },
})

type Frame = {
  step: number
  values: Record<string, number>
  fired: string[]
  stateEvents: unknown[]
  queue: unknown[]
}
function run(nodes: LoopNode[], edges: LoopEdge[], steps: number): { frames: Frame[]; diags: string[][] } {
  let st: SimState = initSim(nodes)
  const frames: Frame[] = [
    { step: 0, values: { ...st.values }, fired: [...st.fired], stateEvents: [], queue: [...st.triggerQueue] },
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
      stateEvents: r.report.stateEvents,
      queue: st.triggerQueue.map((q) => ({ ...q })),
    })
  }
  return { frames, diags }
}
const evFor = (evs: unknown[], id: string) =>
  evs.find((e) => (e as { edgeId: string }).edgeId === id) as
    | { edgeId: string; effect: { satisfied?: boolean; delivered?: boolean; applied?: boolean } }
    | undefined

// ════════════════════════════════════════════════════════════════════════
//  A.  activator comparison-grammar hardening (§S6)
// ════════════════════════════════════════════════════════════════════════

// P has 10 in stock; D drains 2/step when enabled. One activator off Gauge G.
const gaugeGraph = (expr: string, gaugeVal = 6) =>
  run(
    [source('Src'), pool('P', 10), drain('D'), pool('G', gaugeVal)],
    [res('e2', 'P', 'D', '2'), act('a1', 'G', 'D', expr)],
    1,
  )
const enabled = (expr: string, gaugeVal: number) => gaugeGraph(expr, gaugeVal).frames[1].fired.includes('D')

describe('A1 — every frozen comparison form still evaluates with its exact meaning', () => {
  it('the six operators at S[G] = 5 vs threshold 5 (exact boundary)', () => {
    expect(enabled('>= 5', 5)).toBe(true)
    expect(enabled('> 5', 5)).toBe(false)
    expect(enabled('<= 5', 5)).toBe(true)
    expect(enabled('< 5', 5)).toBe(false)
    expect(enabled('== 5', 5)).toBe(true)
    expect(enabled('!= 5', 5)).toBe(false)
  })
  it('one off the boundary each way', () => {
    expect(enabled('> 5', 6)).toBe(true)
    expect(enabled('< 5', 4)).toBe(true)
    expect(enabled('== 5', 6)).toBe(false)
    expect(enabled('!= 5', 6)).toBe(true)
    expect(enabled('>= 5', 4)).toBe(false)
  })
  it('whitespace: leading / trailing / around the operator is tolerated (frozen — not an extension)', () => {
    for (const e of ['>=5', '  >= 5', '>= 5   ', '>=  5', '\t>=\t5\t']) expect(enabled(e, 6)).toBe(true)
  })
  it('negative threshold (a Pool gauge is never itself negative)', () => {
    expect(enabled('>= -3', 0)).toBe(true)
    expect(enabled('> -1', 0)).toBe(true)
    expect(enabled('< -3', 0)).toBe(false)
    expect(enabled('<= -0.5', 0)).toBe(false)
  })
  it('fractional threshold on the exact boundary', () => {
    expect(enabled('>= 2.5', 2)).toBe(false) // gauge 2 (int) < 2.5
    expect(enabled('<= 2.5', 2)).toBe(true)
    expect(enabled('== 2', 2)).toBe(true)
  })
  it('-0 threshold behaves as 0', () => {
    expect(enabled('== -0', 0)).toBe(true)
    expect(enabled('>= -0', 0)).toBe(true)
    expect(enabled('<= -0', 0)).toBe(true)
  })
  it('a very large finite threshold', () => {
    expect(enabled('< 999999999999', 10)).toBe(true)
    expect(enabled('> 999999999999', 10)).toBe(false)
  })
})

describe('A2 — everything the frozen grammar rejects is inert + one diagnostic / step', () => {
  const cases: [string, RegExp][] = [
    ['', /is empty/],
    ['   ', /is empty/],
    ['>=', /has no comparison value/],
    ['  <  ', /has no comparison value/],
    ['>= NaN', /is not a comparison/],
    ['>= Infinity', /is not a comparison/],
    ['< -Infinity', /is not a comparison/],
    ['+5', /is not a comparison/],
    ['5', /is not a comparison/],
    ['>= .5', /is not a comparison/],
    ['>= 5.', /is not a comparison/],
    ['>= 1e3', /is not a comparison/],
    ['>= 5 apples', /is not a comparison/],
    ['>= 5;', /is not a comparison/],
    ['=> 5', /is not a comparison/],
    ['roughly five', /is not a comparison/],
  ]
  for (const [expr, msg] of cases) {
    it(`"${expr}" → target stays enabled, exactly one matching diagnostic`, () => {
      const { frames, diags } = gaugeGraph(expr, 6)
      expect(frames[1].fired).toContain('D') // inert ⇒ NOT disabled
      const mine = diags[1].filter((d) => d.startsWith('Activator "a1"'))
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatch(msg)
      expect(frames[1].stateEvents.some((e) => (e as { edgeId: string }).edgeId === 'a1')).toBe(false)
    })
  }

  it('the diagnostic repeats once per step, never accumulating a backlog', () => {
    const { diags } = run(
      [source('Src'), pool('P', 10), drain('D'), pool('G', 6)],
      [res('e2', 'P', 'D', '2'), act('a1', 'G', 'D', 'nope')],
      4,
    )
    for (let s = 1; s <= 4; s++) {
      expect(diags[s].filter((d) => d.startsWith('Activator "a1"'))).toHaveLength(1)
    }
  })
})

describe('A3 — an invalid activator is dropped from the AND; a valid sibling alone decides', () => {
  const twoAct = (exprBad: string, gaugeGood: number) =>
    run(
      [source('Src'), pool('P', 10), drain('D'), pool('GG', gaugeGood), pool('GB', 0)],
      [res('e2', 'P', 'D', '2'), act('a1', 'GG', 'D', '>= 5'), act('a2', 'GB', 'D', exprBad)],
      1,
    )
  it('valid says enabled, invalid is inert → D fires', () => {
    const { frames, diags } = twoAct('garbage', 9)
    expect(frames[1].fired).toContain('D')
    expect(diags[1].some((d) => /Activator "a2".*is not a comparison/.test(d))).toBe(true)
  })
  it('valid says disabled → D stays gated regardless of the invalid edge', () => {
    const { frames } = twoAct('garbage', 3)
    expect(frames[1].fired).not.toContain('D')
  })
  it('the invalid edge emits no activator stateEvent', () => {
    const { frames } = twoAct('garbage', 9)
    expect(evFor(frames[1].stateEvents, 'a2')).toBeUndefined()
    expect(evFor(frames[1].stateEvents, 'a1')?.effect.satisfied).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════
//  B.  activator ↔ delayed-trigger interplay (§S3 / §S4 / §S7)
// ════════════════════════════════════════════════════════════════════════
//
// Common shape: Feed ─3→ P ─2→ D(passive); a one-shot Kick schedules a pulse
// on D with some delay; Gauge G drives one activator ">= 5" on D. `srcOnce`
// fires only at step 1, so exactly ONE pulse is ever scheduled.
//   delay 2  ⇒ scheduled at step 1, delivered at step 4 (t + delay + 1).
//   delay 0  ⇒ scheduled at step 1, delivered at step 2.

type GaugeSpec = { init: number; feed?: number; drain?: number }
function interplay(delay: number, g: GaugeSpec, steps = 8, expr = '>= 5') {
  const nodes: LoopNode[] = [
    source('Feed'), pool('P', 0), drain('D', 'passive'),
    srcOnce('Kick'), pool('K', 0),
    pool('G', g.init),
  ]
  const edges: LoopEdge[] = [
    res('e_feed', 'Feed', 'P', '3'),
    res('e2', 'P', 'D', '2'),
    res('e_kick', 'Kick', 'K', '1'),
    trig('t1', 'Kick', 'D', delay),
    act('a1', 'G', 'D', expr),
  ]
  if (g.feed) { nodes.push(source('GRamp')); edges.push(res('e_gr', 'GRamp', 'G', String(g.feed))) }
  if (g.drain) { nodes.push(drain('GDrn')); edges.push(res('e_gd', 'G', 'GDrn', String(g.drain))) }
  return run(nodes, edges, steps)
}
const firedAt = (f: { frames: Frame[] }, id: string) =>
  f.frames.map((fr, s) => (fr.fired.includes(id) ? s : -1)).filter((s) => s > 0)

// S[G] read at step s == commit of step s-1.

describe('B1 — delay 2, gate CLOSED at delivery ⇒ the pulse is consumed and permanently lost', () => {
  // G: init 1, +1/step ⇒ S[G] at step s = s. Step 4: S[G] = 4 (< 5). Opens at step 5+, but no pulse remains.
  const t = interplay(2, { init: 1, feed: 1 })
  it('D never fires — not at delivery, not after the gauge opens', () => {
    expect(firedAt(t, 'D')).toEqual([])
  })
  it('step 4: the trigger is delivered but applied:false, the activator reports not-satisfied', () => {
    expect(evFor(t.frames[4].stateEvents, 't1')?.effect).toEqual({ kind: 'trigger', delivered: true, applied: false })
    expect(evFor(t.frames[4].stateEvents, 'a1')?.effect.satisfied).toBe(false)
  })
  it('the queue is empty from step 5 on (the entry was consumed at step 4, not re-held)', () => {
    for (let s = 5; s <= 8; s++) expect(t.frames[s].queue).toEqual([])
  })
})

describe('B2 — delay 2, gate OPEN at delivery ⇒ the passive target fires exactly once, at delivery', () => {
  const t = interplay(2, { init: 10 }) // static gauge, always ≥ 5
  it('D fires only at step 4', () => {
    expect(firedAt(t, 'D')).toEqual([4])
  })
  it('step 4: trigger applied:true; P drops by the drain amount', () => {
    expect(evFor(t.frames[4].stateEvents, 't1')?.effect.applied).toBe(true)
    expect(t.frames[4].values.P).toBe(t.frames[3].values.P + 3 - 2)
  })
})

describe('B3 — gate CLOSED when the pulse is scheduled, OPEN when it is delivered ⇒ it fires', () => {
  // scheduling never consults the activator. G: init 1, +2/step ⇒ S[G] step 1 = 1 (closed),
  // step 4 = 1 + 2*3 = 7 (open).
  const t = interplay(2, { init: 1, feed: 2 })
  it('the pulse is queued at step 1 despite the closed gate', () => {
    expect(t.frames[1].queue).toEqual([{ edgeId: 't1', target: 'D', deliveryStep: 4 }])
  })
  it('D fires at step 4', () => {
    expect(firedAt(t, 'D')).toEqual([4])
  })
})

describe('B4 — gate OPEN at schedule, CLOSED at delivery ⇒ the pulse is lost', () => {
  // G: init 10, −2/step ⇒ S[G] step 1 = 10 (open), step 4 = 10 − 2*3 = 4 (closed).
  const t = interplay(2, { init: 10, drain: 2 })
  it('D never fires', () => {
    expect(firedAt(t, 'D')).toEqual([])
  })
  it('step 4: delivered but applied:false', () => {
    expect(evFor(t.frames[4].stateEvents, 't1')?.effect.applied).toBe(false)
  })
})

describe('B5 — two activators, one false at delivery ⇒ AND fails, the pulse is lost', () => {
  const nodes = [
    source('Feed'), pool('P', 0), drain('D', 'passive'),
    srcOnce('Kick'), pool('K', 0), pool('GA', 10), pool('GB', 3),
  ]
  const edges = [
    res('e_feed', 'Feed', 'P', '3'), res('e2', 'P', 'D', '2'),
    res('e_kick', 'Kick', 'K', '1'), trig('t1', 'Kick', 'D', 2),
    act('a1', 'GA', 'D', '>= 5'), act('a2', 'GB', 'D', '>= 5'),
  ]
  const t = run(nodes, edges, 6)
  it('D never fires; step 4 reports a1 true, a2 false, t1 applied:false, all ascending by edgeId', () => {
    expect(firedAt(t, 'D')).toEqual([])
    expect(t.frames[4].stateEvents.map((e) => (e as { edgeId: string }).edgeId)).toEqual(['a1', 'a2', 't1'])
    expect(evFor(t.frames[4].stateEvents, 'a1')?.effect.satisfied).toBe(true)
    expect(evFor(t.frames[4].stateEvents, 'a2')?.effect.satisfied).toBe(false)
    expect(evFor(t.frames[4].stateEvents, 't1')?.effect.applied).toBe(false)
  })
})

describe('B6 — one invalid + one valid activator: invalid is inert, valid alone gates the pulse', () => {
  const build = (gaugeGood: number) => {
    const nodes = [
      source('Feed'), pool('P', 0), drain('D', 'passive'),
      srcOnce('Kick'), pool('K', 0), pool('GG', gaugeGood), pool('GB', 0),
    ]
    const edges = [
      res('e_feed', 'Feed', 'P', '3'), res('e2', 'P', 'D', '2'),
      res('e_kick', 'Kick', 'K', '1'), trig('t1', 'Kick', 'D', 2),
      act('a1', 'GG', 'D', '>= 5'), act('a2', 'GB', 'D', 'not-a-comparison'),
    ]
    return run(nodes, edges, 6)
  }
  it('valid satisfied ⇒ D fires at delivery; the invalid edge only adds its per-step diagnostic', () => {
    const t = build(9)
    expect(firedAt(t, 'D')).toEqual([4])
    for (let s = 1; s <= 6; s++) {
      expect(t.diags[s].filter((d) => d.startsWith('Activator "a2"'))).toHaveLength(1)
    }
  })
  it('valid unsatisfied ⇒ pulse lost, invalid edge does not rescue it', () => {
    const t = build(3)
    expect(firedAt(t, 'D')).toEqual([])
  })
})

describe('B7 — delay 0 obeys the same rule: consumed-on-delivery, gate-closed ⇒ lost', () => {
  // delay 0 ⇒ delivered at step 2. G: init 1, +1/step ⇒ S[G] step 2 = 2 (closed); opens step 5+, no pulse left.
  const t = interplay(0, { init: 1, feed: 1 })
  it('the pulse delivers at step 2, is applied:false, and D never fires', () => {
    expect(evFor(t.frames[2].stateEvents, 't1')?.effect).toEqual({ kind: 'trigger', delivered: true, applied: false })
    expect(firedAt(t, 'D')).toEqual([])
  })

  it('delay 0 with an open gate fires at step 2', () => {
    const open = interplay(0, { init: 10 })
    expect(firedAt(open, 'D')).toEqual([2])
  })
})

describe('B8 — several pulses due the same step: one execution, every edge reported, ascending edgeId', () => {
  // two trigger edges, delay 0, both from the one-shot Kick ⇒ both due at step 2.
  // a permissive activator (">= 0") is present so the whole stateEvents array mixes modes.
  const nodes = [
    source('Feed'), pool('P', 0), drain('D', 'passive'),
    srcOnce('Kick'), pool('K', 0), pool('G', 3),
  ]
  const edges = [
    res('e_feed', 'Feed', 'P', '3'), res('e2', 'P', 'D', '2'),
    res('e_kick', 'Kick', 'K', '1'),
    trig('t1', 'Kick', 'D', 0), trig('t2', 'Kick', 'D', 0),
    act('a1', 'G', 'D', '>= 0'),
  ]
  const t = run(nodes, edges, 4)
  it('D fires exactly once (step 2) and drains a single 2, not 4', () => {
    expect(firedAt(t, 'D')).toEqual([2])
    expect(t.frames[2].values.P).toBe(t.frames[1].values.P + 3 - 2)
  })
  it('stateEvents at step 2 are [a1, t1, t2]; both triggers delivered + applied', () => {
    expect(t.frames[2].stateEvents.map((e) => (e as { edgeId: string }).edgeId)).toEqual(['a1', 't1', 't2'])
    for (const id of ['t1', 't2']) {
      expect(evFor(t.frames[2].stateEvents, id)?.effect).toEqual({ kind: 'trigger', delivered: true, applied: true })
    }
  })
})

describe('B9 — I8-S: an interplay graph is identical under node / edge array reversal', () => {
  const nodes = [
    source('Feed'), pool('P', 0), drain('D', 'passive'),
    srcOnce('Kick'), pool('K', 0),
    pool('G', 1), source('GRamp'), drain('GDrn'),
  ]
  const edges = [
    res('e_feed', 'Feed', 'P', '3'), res('e2', 'P', 'D', '2'),
    res('e_kick', 'Kick', 'K', '1'), trig('t1', 'Kick', 'D', 2),
    res('e_gr', 'GRamp', 'G', '2'), res('e_gd', 'G', 'GDrn', '1'), // net +1/step
    act('a1', 'G', 'D', '>= 5'),
  ]
  const a = run(nodes, edges, 12)
  const b = run([...nodes].reverse(), [...edges].reverse(), 12)
  it('identical frames and diagnostics', () => {
    expect(b.frames).toEqual(a.frames)
    expect(b.diags).toEqual(a.diags)
  })
})
