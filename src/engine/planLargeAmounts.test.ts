import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// Found on 2026-11-16 while the rules of a step were checked at several scales.
//
// A planned group's numbers are multiples of one number, the amount (or the
// fraction) of the group's first router. A Converter behind a Gate has a
// coefficient that is a FRACTION PER AMOUNT: the share of the Gate's throughput
// that reaches it, over the rate of its connection. The plans asked `c >
// epsilon` of it before using it, with the engine's epsilon for AMOUNTS, an
// absolute 1e-9. From a rate of about 10^9 on, the coefficient of a Converter is
// below 1e-9 for no other reason than the size of the model's numbers, and
//   - the tree plan left out the bound "this Converter runs at most once": the
//     Gate was planned past it and handed the Converter more than a run takes.
//     What the Converter did not consume was gone, with no notice;
//   - the multi-supply plan left the Converter out of its piece's own bound,
//     and a piece with no other bound was given nothing: the group stood still.
//
// A model is the same model whatever unit its amounts are counted in. The
// tests below run one graph at several scales and ask for the same result,
// times the scale.

const P0 = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({ id, type: 'pool', position: P0, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } })
const conv = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'converter', position: P0, data: { kind: 'converter', label: id, activation: 'automatic', mode } })
const gate = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'gate', position: P0, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'] })
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })
type Graph = { nodes: LoopNode[]; edges: LoopEdge[] }

/** `text` × 10^n, digit for digit (no arithmetic, so no rounding) */
function shift(text: string, n: number): string {
  const [int, frac = ''] = text.split('.')
  let digits = int + frac
  let point = int.length + n
  if (point <= 0) { digits = '0'.repeat(1 - point) + digits; point = 1 }
  if (point > digits.length) digits += '0'.repeat(point - digits.length)
  return digits.slice(0, point).replace(/^0+(?=\d)/, '') + (point < digits.length ? `.${digits.slice(point)}` : '')
}
const times = (x: number, n: number) => Number(shift(String(x), n))
/** one step; what every connection moved and where every Pool stands, in units of 10^n */
function one(g: Graph, n: number, runTargets?: Record<string, number>) {
  const before = initSim(g.nodes)
  const r = step(g.nodes, g.edges, before, 7, 2, runTargets ? { runTargets } : {})
  const unit = times(1, n)
  const moved: Record<string, number> = {}
  for (const e of g.edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount / unit
  const after: Record<string, number> = {}
  for (const [id, v] of Object.entries(r.state.values)) after[id] = v / unit
  return { moved, after, notices: r.report.notices ?? [] }
}
function expectClose(got: Record<string, number>, want: Record<string, number>, what: string) {
  expect(Object.keys(got).sort(), what).toEqual(Object.keys(want).sort())
  for (const k of Object.keys(want)) expect(Math.abs(got[k] - want[k]), `${what} ${k}: ${got[k]} against ${want[k]}`).toBeLessThan(1e-9)
}

const SCALES = [0, 3, 6, 8, 9, 12, 15]

describe('tree plan: a Converter behind a Gate runs at most once, at every scale', () => {
  // P ─12→ g ─6→ c ─1→ out : a run of c takes 6, so g takes 6 of its 12
  const chain = (n: number): Graph => ({
    nodes: [pool('P', times(20, n)), pool('out', 0), gate('g'), conv('c')],
    edges: [res('Pg', 'P', 'g', shift('12', n)), res('gc', 'g', 'c', shift('6', n)), res('co', 'c', 'out', shift('1', n))],
  })
  it.each(SCALES)('× 10^%i: the Gate takes 6, the Converter consumes 6 and makes 1 (from 10^9 it took 12 and handed 12 over; 6 were gone)', (n) => {
    const r = one(chain(n), n)
    expectClose(r.moved, { Pg: 6, gc: 6, co: 1 }, 'moved')
    expectClose(r.after, { P: 14, out: 1 }, 'after')
  })

  // P ─12→ g ; g ─3→ c and g ─1→ side : c gets three quarters of what g takes. A run takes 3, so g takes 4.
  const shared = (n: number): Graph => ({
    nodes: [pool('P', times(20, n)), pool('side', 0), pool('out', 0), gate('g'), conv('c')],
    edges: [res('Pg', 'P', 'g', shift('12', n)), res('gc', 'g', 'c', shift('3', n)), res('gs', 'g', 'side', shift('1', n)), res('co', 'c', 'out', shift('1', n))],
  })
  it.each(SCALES)('× 10^%i, the Gate also feeds a Pool: it takes 4, 3 for the Converter and 1 for the Pool', (n) => {
    const r = one(shared(n), n)
    expectClose(r.moved, { Pg: 4, gc: 3, gs: 1, co: 1 }, 'moved')
  })

  // the Converter also takes from a Pool of its own, which holds half a run: f = 0.5 by that Pool, at every scale
  const held = (n: number): Graph => ({
    nodes: [pool('P', times(20, n)), pool('Q', times(1, n)), pool('out', 0), gate('g'), conv('c')],
    edges: [res('Pg', 'P', 'g', shift('12', n)), res('gc', 'g', 'c', shift('6', n)), res('Qc', 'Q', 'c', shift('2', n)), res('co', 'c', 'out', shift('1', n))],
  })
  it.each(SCALES)('× 10^%i, control: a Converter held to a half by its own Pool is fed 3 (right at every scale: that bound is a sum of amounts)', (n) => {
    const r = one(held(n), n)
    expectClose(r.moved, { Pg: 3, gc: 3, Qc: 1, co: 0.5 }, 'moved')
  })
})

describe('a run target on a Converter behind a Gate, at every scale', () => {
  // P ─12→ g ─6→ c ─1→ out, and c may run at half: g takes 3, c consumes 3 and makes a half.
  // The target is a ceiling on the Converter's fraction (`runTargets`, the engine's seam for a run
  // rule), so it is the same bound as "at most once", with a half in place of 1; and for a `pull
  // all` Converter the number the targets allow (the group's cap) is what it has to reach.
  const chain = (n: number, mode: Mode): Graph => ({
    nodes: [pool('P', times(20, n)), pool('out', 0), gate('g'), conv('c', mode)],
    edges: [res('Pg', 'P', 'g', shift('12', n)), res('gc', 'g', 'c', shift('6', n)), res('co', 'c', 'out', shift('1', n))],
  })
  it.each(SCALES)('× 10^%i, target 0.5: the Gate takes 3 and the Converter runs at a half (from 10^9 the Gate took 12 and the Converter ran once, past its target)', (n) => {
    const r = one(chain(n, 'pullAny'), n, { c: 0.5 })
    expectClose(r.moved, { Pg: 3, gc: 3, co: 0.5 }, 'moved')
    expectClose(r.after, { P: 17, out: 0.5 }, 'after')
  })
  it.each(SCALES)('× 10^%i, target 0.5 on a `pull all` Converter: reaching the target is reaching its whole run, so it runs at a half', (n) => {
    // with the fraction bound repaired and the cap not, the cap came out as "no cap", the
    // Converter was asked for a whole run where its target allows half, and the group moved nothing
    const r = one(chain(n, 'pullAll'), n, { c: 0.5 })
    expectClose(r.moved, { Pg: 3, gc: 3, co: 0.5 }, 'moved')
  })
  it.each(SCALES)('× 10^%i, control: the same Converter with no Gate before it runs at its target (right at every scale)', (n) => {
    const g: Graph = { nodes: [pool('P', times(20, n)), pool('out', 0), conv('c')], edges: [res('Pc', 'P', 'c', shift('6', n)), res('co', 'c', 'out', shift('1', n))] }
    expectClose(one(g, n, { c: 0.5 }).moved, { Pc: 3, co: 0.5 }, 'moved')
  })
})

describe('multi-supply plan: a group that runs at scale 1 runs at every scale', () => {
  // sweep seed 3055, written out: g0 (three Pool lines) feeds Converter c2; Converters c1 and c2 feed
  // Gate g3, which has two supplies. At scale 1 everything runs; from 10^9 the group stood still.
  const seed3055 = (n: number): Graph => {
    const f = (x: string) => shift(x, n)
    return {
      nodes: [pool('p0', times(5, n)), pool('p1', times(11, n)), pool('p2', times(13, n), times(17, n)), gate('g0'), conv('c1'), conv('c2'), gate('g3')],
      edges: [res('e0', 'p1', 'g0', f('7')), res('e1', 'p2', 'g0', f('8')), res('e2', 'p2', 'g0', f('3')), res('e3', 'p2', 'c1', f('1')), res('e4', 'p1', 'c1', f('1')), res('e5', 'p1', 'c1', f('8')), res('e6', 'g0', 'c2', f('8')), res('e7', 'p1', 'c2', f('4')), res('e8', 'c1', 'g3', f('8')), res('e9', 'c2', 'g3', f('2')), res('e10', 'c2', 'p0', f('3')), res('e11', 'g3', 'p2', f('8'))],
    }
  }
  it.each(SCALES.filter((n) => n > 0))('seed 3055 × 10^%i moves what it moves at scale 1, times the scale (from 10^9 the Gate g0 took nothing and c2 did not run)', (n) => {
    const base = one(seed3055(0), 0)
    const r = one(seed3055(n), n)
    expect(base.moved.e6, 'at scale 1 the Converter c2 is fed its 8').toBeCloseTo(8, 9)
    expectClose(r.moved, base.moved, 'moved')
    expectClose(r.after, base.after, 'after')
  })
})
