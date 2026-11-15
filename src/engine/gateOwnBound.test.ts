import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// A Gate fed by several Pool lines takes each line up to its own bound, and
// passes on what it took (whole-code review of 2026-11-15, finding E1).
//
// Before: the Gate sized its throughput from the SUM of what its Pools held
// (`inputAvail += availOf(pool)` for every line), then pulled each line capped
// by that line's own amount, and still sent the full throughput on. A Gate
// with Pool A = 100 and Pool B = 0, "5" from each, took 5 and delivered 10:
// the model's total went from 100 to 105 with no notice. One Pool of 8 with
// two "5" lines gave 10 out of 8.
//
// The conservation sweep gives every router exactly one Pool input, and every
// two-supply Gate of the other suites sits in a planned group (whose `reach`
// already takes min(want, available) per line), so nothing covered the shape.

const P = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({
  id, type: 'pool', position: P,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' },
})
const gate = (id: string, mode: Mode = 'pullAny'): LoopNode => ({
  id, type: 'gate', position: P,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'],
})
const res = (id: string, source: string, target: string, flow: string): LoopEdge => ({
  id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in',
  data: { kind: 'resource', flow },
})
type Graph = { nodes: LoopNode[]; edges: LoopEdge[] }

function run({ nodes, edges }: Graph) {
  const before = initSim(nodes)
  const r = step(nodes, edges, before, 1, 2)
  const moved: Record<string, number> = {}
  for (const e of edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  const sum = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0)
  return { moved, before: before.values, after: r.state.values, totalBefore: sum(before.values), totalAfter: sum(r.state.values), gates: r.report.gates, report: r.report }
}

describe('a Gate fed by several Pool lines: each line up to its own bound (E1)', () => {
  it('two Pools, one of them empty: the Gate takes 5 and passes on 5 (was: took 5, passed on 10)', () => {
    const r = run({ nodes: [pool('A', 100), pool('B', 0), gate('G'), pool('Q', 0)], edges: [res('a', 'A', 'G', '5'), res('b', 'B', 'G', '5'), res('o', 'G', 'Q', '1')] })
    expect(r.moved).toEqual({ a: 5, b: 0, o: 5 })
    expect(r.after).toEqual({ A: 95, B: 0, Q: 5 })
    expect(r.totalAfter).toBe(r.totalBefore)
    // the state it reports is the one it had: 10 asked for, 5 there, 5 moved
    const g = r.gates.find((x) => x.nodeId === 'G')!
    expect({ state: g.state, why: g.why, demand: g.demand, available: g.available, moved: g.moved }).toEqual({ state: 'partial', why: 'supply', demand: 10, available: 5, moved: 5 })
  })

  it('two Pools, the second short: 5 from the first, 1 from the second, 6 passed on', () => {
    const r = run({ nodes: [pool('a', 100), pool('b', 1), gate('g'), pool('x', 0)], edges: [res('ea', 'a', 'g', '5'), res('eb', 'b', 'g', '20'), res('o', 'g', 'x', '1')] })
    expect(r.moved).toEqual({ ea: 5, eb: 1, o: 6 })
    expect(r.totalAfter).toBe(r.totalBefore)
  })

  it('two lines off ONE Pool of 8: 5 on the first, 3 on the second, 8 passed on (was: 10 out of 8)', () => {
    const r = run({ nodes: [pool('P', 8), gate('G'), pool('Q', 0)], edges: [res('a', 'P', 'G', '5'), res('b', 'P', 'G', '5'), res('o', 'G', 'Q', '1')] })
    expect(r.moved).toEqual({ a: 5, b: 3, o: 8 })
    expect(r.after).toEqual({ P: 0, Q: 8 })
    // and the Gate says so: the two lines have 8 between them, not 10, so it
    // is short of supply, not of room (it read `available 10 … room` while
    // the moved amount was already right)
    const g = r.gates.find((x) => x.nodeId === 'G')!
    expect({ state: g.state, why: g.why, demand: g.demand, available: g.available, moved: g.moved }).toEqual({ state: 'partial', why: 'supply', demand: 10, available: 8, moved: 8 })
  })

  it('two lines off one Pool that holds enough for both: available is their sum, the Gate is full', () => {
    const r = run({ nodes: [pool('P', 20), gate('G'), pool('Q', 0)], edges: [res('a', 'P', 'G', '5'), res('b', 'P', 'G', '5'), res('o', 'G', 'Q', '1')] })
    expect(r.moved).toEqual({ a: 5, b: 5, o: 10 })
    const g = r.gates.find((x) => x.nodeId === 'G')!
    expect({ state: g.state, demand: g.demand, available: g.available, moved: g.moved }).toEqual({ state: 'full', demand: 10, available: 10, moved: 10 })
  })

  it('`pull all` with one line short moves nothing (10 asked for, 5 there)', () => {
    const r = run({ nodes: [pool('A', 100), pool('B', 0), gate('G', 'pullAll'), pool('Q', 0)], edges: [res('a', 'A', 'G', '5'), res('b', 'B', 'G', '5'), res('o', 'G', 'Q', '1')] })
    expect(r.moved).toEqual({ a: 0, b: 0, o: 0 })
    expect(r.after).toEqual({ A: 100, B: 0, Q: 0 })
  })

  it('both lines met: unchanged (5 + 5 taken, 10 passed on)', () => {
    const r = run({ nodes: [pool('A', 100), pool('B', 100), gate('G'), pool('Q', 0)], edges: [res('a', 'A', 'G', '5'), res('b', 'B', 'G', '5'), res('o', 'G', 'Q', '1')] })
    expect(r.moved).toEqual({ a: 5, b: 5, o: 10 })
  })

  it('a capped target still bounds the Gate, and the lines fill in their order', () => {
    // Q has room for 7: 5 from A, 2 from B
    const r = run({ nodes: [pool('A', 100), pool('B', 100), gate('G'), pool('Q', 0, 7)], edges: [res('a', 'A', 'G', '5'), res('b', 'B', 'G', '5'), res('o', 'G', 'Q', '1')] })
    expect(r.moved).toEqual({ a: 5, b: 2, o: 7 })
  })

  // a sweep over Gates fed by Pools only (no plan owns them): 1 to 3 Pool
  // lines, sometimes two off one Pool, into one or two targets
  it('sweep: whatever the lines and the Pools hold, the Gate passes on exactly what it took, no line above its amount, no Pool below 0', () => {
    let seed = 20261115
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    for (let c = 0; c < 400; c++) {
      const nPools = int(1, 3)
      const nodes: LoopNode[] = []
      for (let i = 0; i < nPools; i++) nodes.push(pool(`p${i}`, int(0, 12)))
      nodes.push(gate('G', rnd() < 0.25 ? 'pullAll' : 'pullAny'))
      const nOut = int(1, 2)
      for (let i = 0; i < nOut; i++) nodes.push(pool(`q${i}`, 0, rnd() < 0.4 ? int(0, 9) : null))
      const edges: LoopEdge[] = []
      const nLines = int(1, 3)
      for (let i = 0; i < nLines; i++) edges.push(res(`in${i}`, `p${int(0, nPools - 1)}`, 'G', String(int(1, 8))))
      for (let i = 0; i < nOut; i++) edges.push(res(`out${i}`, 'G', `q${i}`, String(int(1, 3))))
      const r = run({ nodes, edges })
      const tag = `case ${c}: ${JSON.stringify(edges.map((e) => [e.id, e.source, e.target, (e.data as { flow: string }).flow]))} pools ${JSON.stringify(r.before)}`
      const taken = edges.filter((e) => e.target === 'G').reduce((s, e) => s + r.moved[e.id], 0)
      const passed = edges.filter((e) => e.source === 'G').reduce((s, e) => s + r.moved[e.id], 0)
      expect(passed, `passed on against taken — ${tag}`).toBeCloseTo(taken, 9)
      expect(r.totalAfter, `the model's total — ${tag}`).toBeCloseTo(r.totalBefore, 9)
      for (const e of edges.filter((x) => x.target === 'G')) expect(r.moved[e.id], `${e.id} against its amount — ${tag}`).toBeLessThanOrEqual(Number((e.data as { flow: string }).flow) + 1e-9)
      for (const [id, v] of Object.entries(r.after)) expect(v, `${id} — ${tag}`).toBeGreaterThanOrEqual(0)
    }
  })
})
