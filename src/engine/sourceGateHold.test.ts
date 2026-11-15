import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { initSim, step } from './index'

// Issue #570 (found on 2026-11-15 by a sweep of random graphs).
//
// A planned group is planned at the turn of its FIRST router, and each member
// then moves its planned amounts (SEMANTICS.md §6, erratum part 2). The plan
// claimed the Converters' Pool inputs there, and a multi-supply Gate's own
// Pool amounts, but not what a SOURCE GATE of the group (a Gate fed from its
// own Pools) was planned to pull. A router outside the group that is ordered
// between the group's first router and that Gate took it: the Gate moved less
// than its plan, the Converter behind it was fed at different fractions on its
// connections, and no notice was given.
//
// The repair (erratum part 10): what the plan counts on a source Gate to pull
// is held for it until its own turn, and every other router reads the Pool net
// of it, as it reads a Pool net of a Converter's claim. The group's place in
// the order is its first router's, for all of its members.

const P0 = { x: 0, y: 0 }
type Mode = 'pullAny' | 'pullAll'
const pool = (id: string, initial: number, capacity: number | null = null): LoopNode => ({ id, type: 'pool', position: P0, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } })
const conv = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'converter', position: P0, data: { kind: 'converter', label: id, activation: 'automatic', mode } })
const gate = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'gate', position: P0, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode } as LoopNode['data'] })
const drain = (id: string, mode: Mode = 'pullAny'): LoopNode => ({ id, type: 'drain', position: P0, data: { kind: 'drain', label: id, activation: 'automatic', mode } as LoopNode['data'] })
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } })
type Graph = { nodes: LoopNode[]; edges: LoopEdge[] }

function one(g: Graph, state = initSim(g.nodes)) {
  const r = step(g.nodes, g.edges, state, 7, 2)
  const moved: Record<string, number> = {}
  for (const e of g.edges) moved[e.id] = 0
  for (const ev of r.report.events) moved[ev.edgeId] = (moved[ev.edgeId] ?? 0) + ev.amount
  return { moved, before: state.values, after: r.state.values, state: r.state, refused: r.report.diagnostics.some((d) => /^Can't run/.test(d)) }
}
/** every connection, to 1e-12 */
function expectExact(got: Record<string, number>, want: Record<string, number>) {
  expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort())
  for (const k of Object.keys(want)) expect(Math.abs(got[k] - want[k]), `${k}: ${got[k]} against ${want[k]}`).toBeLessThan(1e-12)
}
/** the rules a step keeps whatever the plan: Pools and their events agree, a Gate passes on what it takes, a Converter runs at ONE fraction */
function broken(g: Graph, r: ReturnType<typeof one>): string[] {
  const out: string[] = []
  for (const n of g.nodes) {
    let into = 0
    let from = 0
    const fs: number[] = []
    for (const e of g.edges) {
      if (e.target !== n.id && e.source !== n.id) continue
      if (e.target === n.id) into += r.moved[e.id]
      else from += r.moved[e.id]
      fs.push(r.moved[e.id] / Number((e.data as { flow: string }).flow))
    }
    if (n.data.kind === 'pool') {
      if (r.after[n.id] < 0) out.push(`${n.id} below 0`)
      if (Math.abs(r.after[n.id] - r.before[n.id] - (into - from)) >= 1e-9) out.push(`${n.id} against its events`)
    } else if (n.data.kind === 'gate') {
      if (Math.abs(into - from) >= 1e-9) out.push(`Gate ${n.id} in ${into} against out ${from}`)
    } else if (n.data.kind === 'converter') {
      if (fs.length && Math.max(...fs) - Math.min(...fs) >= 1e-9) out.push(`Converter ${n.id} off one fraction (${fs.join(', ')})`)
    }
  }
  return out
}
function rules(g: Graph, r: ReturnType<typeof one>, where: string) {
  expect(broken(g, r), where).toEqual([])
}

describe('a tree group: the source Gate’s planned pull is held against a router outside the group', () => {
  // the group: a ─1→ c0 ─1→ c3 ; x ─1→ g ─1→ c3 ; c3 ─1→ out.  Outside it: x ─5→ <outside> ─1→ y
  const shape = (outside: LoopNode, x = 5) => ({
    nodes: [pool('a', 100), pool('x', x), pool('y', 0), pool('out', 0), conv('c0'), outside, gate('g'), conv('c3')],
    edges: [res('a0', 'a', 'c0', '1'), res('03', 'c0', 'c3', '1'), res('xg', 'x', 'g', '1'), res('g3', 'g', 'c3', '1'), res('3o', 'c3', 'out', '1'), res('x1', 'x', outside.id, '5'), res('1y', outside.id, 'y', '1')],
  })
  it('the smallest case, ordered c0, c1, g, c3: the Gate takes its 1, the Converter runs once, the outside Converter gets the 4 left (was: it took all 5, the Gate got 0, c3 was fed 1 and 0 and made 0.5)', () => {
    const g = shape(conv('c1'))
    const r = one(g)
    expectExact(r.moved, { a0: 1, '03': 1, xg: 1, g3: 1, '3o': 1, x1: 4, '1y': 0.8 })
    expectExact(r.after, { a: 99, x: 0, y: 0.8, out: 1 })
    rules(g, r, 'smallest case')
  })
  it('the same as with the outside Converter ordered AFTER the group (z1): the order of ids inside the group’s span no longer decides', () => {
    expectExact(one(shape(conv('z1'))).moved, one(shape(conv('c1'))).moved)
  })
  it('an outside Gate between them (d1): it takes the 4 left and passes them on', () => {
    const g = shape(gate('d1'))
    const r = one(g)
    expectExact(r.moved, { a0: 1, '03': 1, xg: 1, g3: 1, '3o': 1, x1: 4, '1y': 4 })
    rules(g, r, 'outside Gate')
  })
  it('an outside `pull all` Converter between them asks for 5 and finds 4: it does not run, and the group does (was: it took 5 and the group broke)', () => {
    const g = shape(conv('c1', 'pullAll'))
    const r = one(g)
    expectExact(r.moved, { a0: 1, '03': 1, xg: 1, g3: 1, '3o': 1, x1: 0, '1y': 0 })
    rules(g, r, 'outside pull all')
  })
  it('an outside `pull all` Drain between them asks for 5 and finds 4: it takes nothing', () => {
    const base = shape(conv('c1'))
    const g: Graph = { nodes: [...base.nodes.filter((n) => n.id !== 'c1' && n.id !== 'y'), drain('d1', 'pullAll')], edges: [...base.edges.filter((e) => e.id !== 'x1' && e.id !== '1y'), res('x1', 'x', 'd1', '5')] }
    const r = one(g)
    expectExact(r.moved, { a0: 1, '03': 1, xg: 1, g3: 1, '3o': 1, x1: 0 })
  })

  // controls: what must NOT change
  it('control: the Pool holds enough for both (100): everything in full, as before', () => {
    const g = shape(conv('c1'), 100)
    const r = one(g)
    expectExact(r.moved, { a0: 1, '03': 1, xg: 1, g3: 1, '3o': 1, x1: 5, '1y': 1 })
  })
  it('control: an outside Converter ordered BEFORE the group’s first router (b1) keeps its priority: it takes the 5 and the group is planned on what is left, nothing', () => {
    const g = shape(conv('b1'))
    const r = one(g)
    expectExact(r.moved, { a0: 0, '03': 0, xg: 0, g3: 0, '3o': 0, x1: 5, '1y': 1 })
    rules(g, r, 'outside first')
  })
  it('the hold is what the plan pulls, not what the Gate could: a group held to a half by its other input holds half (was: the outside Converter took all 5)', () => {
    // a holds 0.5, so c0 runs at 0.5 and the plan's number is 0.5: g is to pull 0.5, and c1 gets 4.5
    const base = shape(conv('c1'))
    const g: Graph = { nodes: [pool('a', 0.5), ...base.nodes.slice(1)], edges: base.edges }
    const r = one(g)
    expectExact(r.moved, { a0: 0.5, '03': 0.5, xg: 0.5, g3: 0.5, '3o': 0.5, x1: 4.5, '1y': 0.9 })
    rules(g, r, 'half')
  })
  it('control: a group that moves nothing holds nothing (its `pull all` Converter is short): the outside Converter takes all 5', () => {
    // c3 is `pull all` and c0 can only run at a half, so the group stands still
    const base = shape(conv('c1'))
    const g: Graph = { nodes: [pool('a', 0.5), ...base.nodes.slice(1).map((n) => (n.id === 'c3' ? conv('c3', 'pullAll') : n))], edges: base.edges }
    const r = one(g)
    expectExact(r.moved, { a0: 0, '03': 0, xg: 0, g3: 0, '3o': 0, x1: 5, '1y': 1 })
  })
  it('the hold lasts one step: three steps of the smallest case with a Pool that is refilled keep the same amounts', () => {
    // s ─5→ x is a Source-like refill through a Pool with plenty: x gets back what was taken
    const base = shape(conv('c1'))
    const g: Graph = { nodes: [...base.nodes, pool('s', 1000), gate('zz')], edges: [...base.edges, res('sz', 's', 'zz', '5'), res('zx', 'zz', 'x', '5')] }
    let st = initSim(g.nodes)
    for (let i = 0; i < 3; i++) {
      const r = one(g, st)
      st = r.state
      expect(r.moved.xg, `step ${i + 1}`).toBe(1)
      expect(r.moved.x1, `step ${i + 1}`).toBe(4)
      rules(g, r, `step ${i + 1}`)
    }
  })
})

describe('two planned groups on one Pool: the later one is planned on what the first one’s Gate leaves', () => {
  // group 1: a ─1→ c0 ─1→ c3 ; x ─1→ g ─1→ c3 ; c3 ─1→ out
  // group 2: b ─1→ c1 ─1→ c2 ; x ─5→ e ─5→ c2 ; c2 ─1→ out2      (order c0, c1, e, g, c2, c3)
  const g: Graph = {
    nodes: [pool('a', 100), pool('b', 100), pool('x', 5), pool('out', 0), pool('out2', 0), conv('c0'), conv('c1'), conv('c2'), conv('c3'), gate('e'), gate('g')],
    edges: [res('a0', 'a', 'c0', '1'), res('03', 'c0', 'c3', '1'), res('xg', 'x', 'g', '1'), res('g3', 'g', 'c3', '1'), res('3o', 'c3', 'out', '1'), res('b1', 'b', 'c1', '1'), res('12', 'c1', 'c2', '1'), res('xe', 'x', 'e', '5'), res('e2', 'e', 'c2', '5'), res('2o', 'c2', 'out2', '1')],
  }
  it('group 1 runs once and group 2 at 0.8, each Converter at one fraction (was: group 2 was planned on the whole Pool, its Gate took 5, and group 1’s Converter was fed 1 and 0)', () => {
    const r = one(g)
    expectExact(r.moved, { a0: 1, '03': 1, xg: 1, g3: 1, '3o': 1, b1: 0.8, '12': 0.8, xe: 4, e2: 4, '2o': 0.8 })
    rules(g, r, 'two groups')
  })
})

describe('a multi-supply group: its source Gate’s planned pull is held too', () => {
  // a ─1→ c0 ─1→ k ; x ─1→ g ─1→ k ; k ─1→ j ; w ─1→ j ; j ─2→ out.  j has two supplies (k and its own Pool w).
  // Outside: x ─5→ c1 ─1→ y, ordered between c0 and g.
  const g: Graph = {
    nodes: [pool('a', 100), pool('x', 5), pool('w', 100), pool('y', 0), pool('out', 0), conv('c0'), conv('c1'), gate('g'), conv('k'), gate('j')],
    edges: [res('a0', 'a', 'c0', '1'), res('0k', 'c0', 'k', '1'), res('xg', 'x', 'g', '1'), res('gk', 'g', 'k', '1'), res('kj', 'k', 'j', '1'), res('wj', 'w', 'j', '1'), res('jo', 'j', 'out', '2'), res('x1', 'x', 'c1', '5'), res('1y', 'c1', 'y', '1')],
  }
  it('the Gate takes its 1 and the Converter k runs once (was: the outside Converter took all 5 and k was fed 1 and 0)', () => {
    const r = one(g)
    expectExact(r.moved, { a0: 1, '0k': 1, xg: 1, gk: 1, kj: 1, wj: 1, jo: 2, x1: 4, '1y': 0.8 })
    rules(g, r, 'multi-supply')
  })
})

describe('the five graphs of the sweep that showed it', () => {
  // the generator of the sweep (the same as in `fullPoolLoop.test.ts`)
  function build(seed0: number): Graph {
    let seed = seed0 >>> 0
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    const nodes: LoopNode[] = []
    const edges: LoopEdge[] = []
    const nPools = int(2, 5)
    for (let i = 0; i < nPools; i++) {
      const initial = int(0, 14)
      const capacity = rnd() < 0.35 ? initial + int(0, 8) : null
      nodes.push(pool(`p${i}`, initial, capacity))
    }
    const nR = int(1, 5)
    const routers: string[] = []
    for (let i = 0; i < nR; i++) {
      const isGate = rnd() < 0.6
      const id = `${isGate ? 'g' : 'c'}${i}`
      const mode = rnd() < 0.2 ? 'pullAll' : 'pullAny'
      routers.push(id)
      nodes.push(isGate ? gate(id, mode) : conv(id, mode))
    }
    let k = 0
    const add = (s: string, t: string) => edges.push(res(`e${k++}`, s, t, String(int(1, 8))))
    routers.forEach((r, i) => {
      const fromRouters = routers.slice(0, i).filter(() => rnd() < 0.45)
      for (const u of fromRouters) add(u, r)
      const lines = fromRouters.length === 0 ? int(1, 3) : int(0, 2)
      for (let j = 0; j < lines; j++) add(`p${int(0, nPools - 1)}`, r)
    })
    for (const r of routers) {
      const outs = edges.some((e) => e.source === r) ? int(0, 1) : int(1, 2)
      for (let j = 0; j < outs; j++) add(r, `p${int(0, nPools - 1)}`)
    }
    return { nodes, edges }
  }
  it.each([[2841], [2931], [4299], [5627], [6200]])('seed %i, three steps: every Converter runs at one fraction, and Pools and Gates keep their rules', (seed) => {
    const g = build(seed)
    let st = initSim(g.nodes)
    for (let i = 0; i < 3; i++) {
      const r = one(g, st)
      st = r.state
      rules(g, r, `seed ${seed}, step ${i + 1}`)
    }
  })
  it('6,000 random graphs, three steps each: no Converter off its one fraction, no Gate or Pool off its events', () => {
    let ran = 0
    const found: string[] = []
    for (let seed = 1000; seed < 7000; seed++) {
      const g = build(seed)
      let st = initSim(g.nodes)
      let refused = false
      for (let i = 0; i < 3; i++) {
        const r = one(g, st)
        st = r.state
        if (r.refused) { refused = true; break }
        for (const b of broken(g, r)) found.push(`seed ${seed}, step ${i + 1}: ${b}`)
      }
      if (!refused) ran++
    }
    expect(ran).toBe(5153)
    expect(found).toEqual([])
  }, 60_000)
})
