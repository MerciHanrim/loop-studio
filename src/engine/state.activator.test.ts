import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import type { SimState } from './index'
import { categorical, initSim, sample, step } from './index'

// SEMANTICS-S.md loop-state/1 — Slice 2: `activator` (continuous AND level gate).
// §S11 Case S-B / S-B2 are the acceptance vectors; I8-S is the determinism check.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const source = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const drain = (id: string, activation: 'automatic' | 'passive' | 'onStart' = 'automatic'): LoopNode => ({
  id, type: 'drain', position: XY,
  data: { kind: 'drain', label: id, activation, mode: 'pullAny' },
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
function run(nodes: LoopNode[], edges: LoopEdge[], steps: number): { frames: Frame[]; diags: string[] } {
  let st: SimState = initSim(nodes)
  const frames: Frame[] = [{ step: 0, values: { ...st.values }, fired: [...st.fired], stateEvents: [], queue: [...st.triggerQueue] }]
  const diags: string[] = []
  for (let i = 0; i < steps; i++) {
    const r = step(nodes, edges, st, 1)
    st = r.state
    diags.push(...r.report.diagnostics)
    frames.push({ step: st.step, values: { ...st.values }, fired: r.report.fired, stateEvents: r.report.stateEvents, queue: st.triggerQueue.map((q) => ({ ...q })) })
  }
  return { frames, diags }
}
const satisfied = (evs: unknown[], id: string) =>
  (evs.find((e) => (e as { edgeId: string }).edgeId === id) as { effect: { satisfied: boolean } } | undefined)?.effect.satisfied

// ── Case S-B — activator AND, one branch always false ─────────────────────
describe('S-B — GaugeA(6) & GaugeB(4) ┄activator ">= 5"┄> D(auto)', () => {
  const nodes = [source('Src'), pool('P'), drain('D'), pool('GA', 6), pool('GB', 4)]
  const edges = [res('e1', 'Src', 'P', '3'), res('e2', 'P', 'D', '2'), act('a1', 'GA', 'D', '>= 5'), act('a2', 'GB', 'D', '>= 5')]
  const { frames } = run(nodes, edges, 6)

  it('D never fires; P accumulates +3 every step', () => {
    expect(frames.map((f) => f.values.P)).toEqual([0, 3, 6, 9, 12, 15, 18])
    for (let s = 1; s <= 6; s++) expect(frames[s].fired).toEqual(['Src'])
  })
  it('stateEvents every step: a1 true, a2 false (ascending edgeId)', () => {
    for (let s = 1; s <= 6; s++) {
      expect(satisfied(frames[s].stateEvents, 'a1')).toBe(true)
      expect(satisfied(frames[s].stateEvents, 'a2')).toBe(false)
      expect(frames[s].stateEvents.map((e) => (e as { edgeId: string }).edgeId)).toEqual(['a1', 'a2'])
    }
  })
  it('activator does not create a trigger queue', () => {
    for (const f of frames) expect(f.queue).toEqual([])
  })
})

// ── Variant S-B2 — GaugeB open ──────────────────────────────────────────
describe('S-B2 — GaugeB(5): the gate is open', () => {
  const nodes = [source('Src'), pool('P'), drain('D'), pool('GA', 6), pool('GB', 5)]
  const edges = [res('e1', 'Src', 'P', '3'), res('e2', 'P', 'D', '2'), act('a1', 'GA', 'D', '>= 5'), act('a2', 'GB', 'D', '>= 5')]
  const { frames } = run(nodes, edges, 6)

  it('P = [0, 3, 4, 5, 6, 7, 8] — D drains 2/step once P has stock', () => {
    expect(frames.map((f) => f.values.P)).toEqual([0, 3, 4, 5, 6, 7, 8])
    expect(frames[1].fired).toEqual(['Src']) // S[P]=0
    expect(frames[2].fired).toEqual(['D', 'Src'])
  })
})

// ── activator count 0 / 1 / 2 ──────────────────────────────────────────
describe('activator count', () => {
  const main = (extra: LoopEdge[]) =>
    run([source('Src'), pool('P', 10), drain('D'), pool('G', 6)], [res('e2', 'P', 'D', '2'), ...extra], 2)

  it('0 activators → enabled (D drains normally)', () => {
    expect(main([]).frames[1].fired).toEqual(['D']) // S[P]=10
  })
  it('1 activator satisfied → enabled', () => {
    expect(main([act('a1', 'G', 'D', '>= 5')]).frames[1].fired).toEqual(['D'])
  })
  it('1 activator unsatisfied → disabled', () => {
    expect(main([act('a1', 'G', 'D', '>= 9')]).frames[1].fired).toEqual([])
  })
  it('2 activators, both satisfied → enabled', () => {
    expect(main([act('a1', 'G', 'D', '>= 5'), act('a2', 'G', 'D', '< 9')]).frames[1].fired).toEqual(['D'])
  })
  it('2 activators, one false → disabled (AND)', () => {
    expect(main([act('a1', 'G', 'D', '>= 5'), act('a2', 'G', 'D', '> 9')]).frames[1].fired).toEqual([])
  })
})

// ── automatic node: pause then re-open, and open then close ─────────────
describe('an automatic target follows its gate', () => {
  it('paused while the gauge is low, resumes when it crosses the threshold', () => {
    // Gauge starts at 2, filled +1/step ⇒ S[Gauge] = 2,3,4,5,6,…
    const nodes = [source('Src'), pool('P'), drain('D'), source('GSrc'), pool('G', 2)]
    const edges = [res('e1', 'Src', 'P', '3'), res('e2', 'P', 'D', '1'), res('eg', 'GSrc', 'G', '1'), act('a1', 'G', 'D', '>= 5')]
    const { frames } = run(nodes, edges, 6)
    for (let s = 1; s <= 3; s++) expect(frames[s].fired).not.toContain('D') // gauge 2,3,4
    expect(frames[4].fired).toContain('D') // S[G] = 5
    expect(frames[5].fired).toContain('D')
  })

  it('open then closed as the gauge drains below the threshold', () => {
    // Gauge init 6, drained 2/step, no feed ⇒ S[Gauge] = 6,4,2,0
    const nodes = [source('Src'), pool('P', 20), drain('D'), pool('G', 6), drain('GD')]
    const edges = [res('e2', 'P', 'D', '1'), res('egd', 'G', 'GD', '2'), act('a1', 'G', 'D', '>= 5')]
    const { frames } = run(nodes, edges, 4)
    expect(frames[1].fired).toContain('D') // S[G] = 6
    for (let s = 2; s <= 4; s++) expect(frames[s].fired).not.toContain('D') // S[G] = 4,2,0
  })
})

// ── passive: a pulse arriving while the gate is closed is lost ───────────
describe('a passive pulse is consumed by a closed gate and never re-runs', () => {
  // Src fires every step ⇒ a pulse is delivered to D at steps 2,3,4,…
  // Gauge low until step 5 ⇒ D is gated closed for the early pulses.
  const nodes = [source('Src'), pool('P'), drain('D', 'passive'), source('GSrc'), pool('G', 1)]
  const edges = [
    res('e1', 'Src', 'P', '3'), res('e2', 'P', 'D', '1'),
    res('eg', 'GSrc', 'G', '1'),
    act('a1', 'G', 'D', '>= 5'),
    trig('t1', 'Src', 'D', 0),
  ]
  const { frames } = run(nodes, edges, 7)

  it('D does not fire for the gated pulses (steps 1–4) and there is no backlog', () => {
    // S[G] read at step s = commit of step s-1 = 1 + (s-1); reaches 5 at step 5
    for (let s = 1; s <= 4; s++) expect(frames[s].fired).not.toContain('D')
    expect(frames[5].fired).toContain('D') // first fire — one current pulse, not a stack
    expect(frames[5].values.P).toBe(frames[4].values.P + 3 - 1) // +Src −1 (single pull)
  })
  it('a delivered-but-gated pulse reports applied: false', () => {
    const ev = frames[3].stateEvents.find((e) => (e as { edgeId: string }).edgeId === 't1') as
      | { effect: { applied: boolean } }
      | undefined
    expect(ev?.effect.applied).toBe(false)
  })
})

// ── onStart: gated closed at step 1 ⇒ never fires ──────────────────────
describe('an onStart target gated closed at step 1 never fires', () => {
  const nodes = [source('Src'), pool('P'), drain('D', 'onStart'), source('GSrc'), pool('G', 1)]
  const edges = [res('e1', 'Src', 'P', '3'), res('e2', 'P', 'D', '1'), res('eg', 'GSrc', 'G', '1'), act('a1', 'G', 'D', '>= 5')]
  const { frames } = run(nodes, edges, 8)
  it('D is absent from fired on every step even after the gauge opens', () => {
    for (let s = 1; s <= 8; s++) expect(frames[s].fired).not.toContain('D')
  })
})

// ── disabled router: upstream retention ───────────────────────────────
describe('a disabled Gate / Converter keeps its input upstream', () => {
  it('a disabled gate never pulls; the source pool grows unimpeded', () => {
    const nodes = [source('Src'), pool('P'), gate('G'), drain('D'), drain('E'), pool('Gauge', 0)]
    const edges = [
      res('e1', 'Src', 'P', '3'),
      res('eGa', 'G', 'D', '1'), res('eGb', 'G', 'E', '1'),
      res('e2', 'P', 'G', 'all'),
      act('a1', 'Gauge', 'G', '>= 100'), // never satisfied
    ]
    const { frames } = run(nodes, edges, 4)
    expect(frames.map((f) => f.values.P)).toEqual([0, 3, 6, 9, 12])
    for (let s = 1; s <= 4; s++) {
      expect(frames[s].values.D ?? 0).toBe(0)
      expect(frames[s].fired).toEqual(['Src'])
    }
  })

  it('conservation holds — nothing is orphaned in a disabled router inbox', () => {
    const nodes = [source('Src'), pool('P'), gate('G'), pool('Q', 0), drain('B'), pool('Gauge', 0)]
    const edges = [
      res('e1', 'Src', 'P', '3'),
      res('e2', 'P', 'G', 'all'),
      res('eGq', 'G', 'Q', '1'),
      res('eqb', 'Q', 'B', '1'),
      act('a1', 'Gauge', 'G', '>= 100'),
    ]
    const { frames } = run(nodes, edges, 5)
    // every unit the Source pushed is still in P (G disabled, so Q/B get nothing)
    for (let s = 1; s <= 5; s++) {
      expect(frames[s].values.P).toBe(3 * s)
      expect(frames[s].values.Q ?? 0).toBe(0)
    }
  })
})

// ── probabilistic Gate + an activator-disabled branch: no reroll ────────
// SEMANTICS-S.md §S4 + SEMANTICS-B1.md §B4. A resource edge into a disabled
// router is inert for *deterministic* re-splitting (a plain Gate / Converter
// re-normalises over the branches that are still active — conservation holds).
// A *probabilistic* Gate must NOT do that: it keeps its full branch set for the
// `gate-route` draw. When the draw lands on the disabled branch it accepts 0 —
// the resource stays upstream, with no redraw and no re-weighting (that would be
// the frozen loop-rng/1 spill / reroll the spec forbids: 17:3:1 picking the
// dead `1` does not become 17:3).
describe('a probabilistic Gate keeps a disabled branch in the draw (no reroll)', () => {
  const probGate = (id: string): LoopNode => ({
    id, type: 'gate', position: XY,
    data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'probabilistic', mode: 'pullAny' },
  })
  // Src ─4→ P ─4→ PG(prob 1:3) ─┬ eA w1 → GX  (disabled: Gauge >= 100, never true)
  //                             └ eB w3 → E   (drain)
  const build = () => ({
    nodes: [source('Src'), pool('P', 0), probGate('PG'), gate('GX'), drain('DX'), drain('E'), pool('Gauge', 0)],
    edges: [
      res('e_src', 'Src', 'P', '4'),
      res('e_in', 'P', 'PG', '4'),
      res('eA', 'PG', 'GX', '1'),
      res('eB', 'PG', 'E', '3'),
      res('eX', 'GX', 'DX', '1'),
      act('a1', 'Gauge', 'GX', '>= 100'),
    ],
  })

  type Rec = { values: Record<string, number>; fired: string[]; byEdge: Record<string, number> }
  const trace = (nodes: LoopNode[], edges: LoopEdge[], steps: number): Rec[] => {
    let st: SimState = initSim(nodes)
    const out: Rec[] = [{ values: { ...st.values }, fired: [], byEdge: {} }]
    for (let i = 1; i <= steps; i++) {
      const r = step(nodes, edges, st, 1)
      st = r.state
      const byEdge: Record<string, number> = {}
      for (const ev of r.report.events) byEdge[ev.edgeId] = (byEdge[ev.edgeId] ?? 0) + ev.amount
      out.push({ values: { ...st.values }, fired: r.report.fired, byEdge })
    }
    return out
  }

  const { nodes, edges } = build()
  const t = trace(nodes, edges, 12)
  // the seed-1 `gate-route` draw over the FULL weight set [eA:1, eB:3]
  const picksDead = (s: number) => categorical([1, 3], sample(1, s, 'PG', 'gate-route', 0).u) === 0
  const deadSteps = [1, 5, 7, 8, 9]

  it('the branch taken each step is the full-set categorical pick (weights not re-normalised)', () => {
    for (let s = 1; s <= 12; s++) expect(picksDead(s)).toBe(deadSteps.includes(s))
  })

  it('a draw landing on the disabled branch moves nothing — the resource stays in P', () => {
    for (const s of deadSteps) {
      expect(t[s].byEdge.eA ?? 0).toBe(0) // dead branch carries nothing
      expect(t[s].byEdge.eB ?? 0).toBe(0) // NOT rerouted to the open branch
      expect(t[s].byEdge.e_in ?? 0).toBe(0) // the gate pulled nothing from P
      expect(t[s].values.P - t[s - 1].values.P).toBe(4) // only the +4 Src push
      expect(t[s].fired).not.toContain('PG')
    }
  })

  it('a draw landing on the open branch routes the whole pulled amount down eB', () => {
    for (let s = 1; s <= 12; s++) {
      if (deadSteps.includes(s)) continue
      const pulled = t[s].byEdge.e_in ?? 0
      expect(pulled).toBeGreaterThan(0)
      expect(t[s].byEdge.eB ?? 0).toBeCloseTo(pulled)
      expect(t[s].byEdge.eA ?? 0).toBe(0)
    }
  })

  it('the disabled router never runs — GX absent from fired, DX / eX stay empty', () => {
    for (let s = 1; s <= 12; s++) {
      expect(t[s].fired).not.toContain('GX')
      expect(t[s].byEdge.eX ?? 0).toBe(0)
      expect(t[s].values.DX ?? 0).toBe(0)
    }
  })

  it('P trace is exactly [0, 4, 4, 4, 4, 8, 8, 12, 16, 20, 20, 20, 20]', () => {
    expect(t.map((f) => f.values.P)).toEqual([0, 4, 4, 4, 4, 8, 8, 12, 16, 20, 20, 20, 20])
  })

  it('conservation — every unit Src pushed is either still in P or drained through E', () => {
    const pushed = t.slice(1).reduce((a, f) => a + (f.byEdge.e_src ?? 0), 0)
    const drained = t.slice(1).reduce((a, f) => a + (f.byEdge.eB ?? 0), 0)
    expect(drained + t[12].values.P).toBeCloseTo(pushed)
  })

  it('I8-S — identical under node / edge array reversal', () => {
    const r = trace([...nodes].reverse(), [...edges].reverse(), 12)
    expect(r.map((f) => f.values.P)).toEqual(t.map((f) => f.values.P))
    for (let s = 1; s <= 12; s++) {
      expect(r[s].byEdge.eB ?? 0).toBeCloseTo(t[s].byEdge.eB ?? 0)
      expect(r[s].byEdge.eA ?? 0).toBe(t[s].byEdge.eA ?? 0)
    }
  })
})

// ── I8-S — reverse-array determinism with activators ─────────────────
describe('I8-S — array order does not change the result (activator graph)', () => {
  const nodes = [source('Src'), pool('P'), drain('D'), pool('GA', 6), pool('GB', 5), drain('GBd')]
  const edges = [
    res('e1', 'Src', 'P', '3'), res('e2', 'P', 'D', '2'),
    res('egb', 'GB', 'GBd', '1'), // GB drains 1/step ⇒ crosses the threshold mid-run
    act('a2', 'GB', 'D', '>= 5'), act('a1', 'GA', 'D', '>= 5'),
  ]
  const a = run(nodes, edges, 10)
  const b = run([...nodes].reverse(), [...edges].reverse(), 10)
  it('identical frames + diagnostics', () => {
    expect(b.frames).toEqual(a.frames)
    expect(b.diags).toEqual(a.diags)
  })
})

// ── inert activators ─────────────────────────────────────────────────
describe('non-Pool source and unparseable expr are inert + diagnostic', () => {
  it('a Source-node activator source is ignored (target stays enabled)', () => {
    const nodes = [source('Src'), pool('P', 10), drain('D')]
    const edges = [res('e2', 'P', 'D', '2'), act('a1', 'Src', 'D', '>= 5')]
    const { frames, diags } = run(nodes, edges, 2)
    expect(frames[1].fired).toEqual(['D']) // not disabled
    expect(diags.some((d) => /needs a Pool source/.test(d))).toBe(true)
  })
  it('an unparseable expression is ignored (target stays enabled)', () => {
    const nodes = [source('Src'), pool('P', 10), drain('D'), pool('G', 6)]
    const edges = [res('e2', 'P', 'D', '2'), act('a1', 'G', 'D', 'roughly five')]
    const { frames, diags } = run(nodes, edges, 2)
    expect(frames[1].fired).toEqual(['D'])
    expect(diags.some((d) => /is not a comparison/.test(d))).toBe(true)
  })
})
