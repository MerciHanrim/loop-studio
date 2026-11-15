import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { gateChances, routerOrder } from './gateChance'
import { initSim, step } from './index'

// A probabilistic Gate's chances read from the document (gateChance.ts): the
// engine's own rules, and a run's frequencies agree with them.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' },
})
const gate = (id: string, distribution: 'deterministic' | 'probabilistic' = 'probabilistic'): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution, mode: 'pullAny' },
})
const converter = (id: string): LoopNode => ({
  id, type: 'converter', position: XY,
  data: { kind: 'converter', label: id, activation: 'automatic', mode: 'pullAny' },
})
const param = (id: string, value: number): LoopNode => ({
  id, type: 'parameter', position: XY,
  data: { kind: 'parameter', label: id, value },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow },
})

/** the general gacha's roll: tickets → roll → three results, weights by reference */
function roll(weights: [string, string, string], extra: LoopNode[] = []) {
  const nodes = [pool('tickets', 1), gate('roll'), pool('ssr'), pool('sr'), pool('r'), ...extra]
  const edges = [res('e_in', 'tickets', 'roll', '1'), res('e_a', 'roll', 'ssr', weights[0]), res('e_b', 'roll', 'sr', weights[1]), res('e_c', 'roll', 'r', weights[2])]
  return { nodes, edges }
}

describe('gateChances', () => {
  it('weights by Parameter reference (v2): each chance is its weight over the sum', () => {
    const { nodes, edges } = roll(['@w_ssr', '@w_sr', '@w_r'], [param('w_ssr', 6), param('w_sr', 51), param('w_r', 943)])
    const c = gateChances(nodes, edges, 'roll', 2)!
    expect(c.status).toBe('fixed')
    expect(c.sum).toBe(1000)
    expect(c.branches.map((b) => [b.edgeId, b.weight, b.chance])).toEqual([
      ['e_a', 6, 0.006],
      ['e_b', 51, 0.051],
      ['e_c', 943, 0.943],
    ])
  })

  it('a v1 document reads `@id` as an unparseable literal, weight 1 — as the engine does', () => {
    const { nodes, edges } = roll(['@w_ssr', '@w_sr', '@w_r'], [param('w_ssr', 6), param('w_sr', 51), param('w_r', 943)])
    const c = gateChances(nodes, edges, 'roll', 1)!
    expect(c.branches.map((b) => b.weight)).toEqual([1, 1, 1])
    expect(c.branches.map((b) => b.chance)).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  it('a reference the engine cannot resolve weighs 0; a negative Parameter weighs 1 (the literal rule)', () => {
    const { nodes, edges } = roll(['@missing', '@neg', '3'], [param('neg', -5)])
    const c = gateChances(nodes, edges, 'roll', 2)!
    expect(c.branches.map((b) => b.weight)).toEqual([0, 1, 3])
    expect(c.branches.map((b) => b.chance)).toEqual([0, 0.25, 0.75])
  })

  it('all, a percentage and a weight of 0', () => {
    const { nodes, edges } = roll(['all', '50%', '0'])
    const c = gateChances(nodes, edges, 'roll', 1)!
    expect(c.branches.map((b) => b.weight)).toEqual([1, 0.5, 0])
    expect(c.branches.map((b) => b.chance)).toEqual([1 / 1.5, 0.5 / 1.5, 0])
  })

  it('a random weight makes every chance a run-time draw; the fixed weights are still read', () => {
    const { nodes, edges } = roll(['1-3', '2', '2D6'])
    const c = gateChances(nodes, edges, 'roll', 1)!
    expect(c.status).toBe('runtime')
    expect(c.reason).toBe('random')
    expect(c.sum).toBeNull()
    expect(c.branches.map((b) => [b.weight, b.chance])).toEqual([[null, null], [2, null], [null, null]])
  })

  it('weights that sum to 0: the gate takes no branch (inert)', () => {
    const { nodes, edges } = roll(['0', '0', '0'])
    const c = gateChances(nodes, edges, 'roll', 1)!
    expect(c.status).toBe('inert')
    expect(c.sum).toBe(0)
    expect(c.branches.every((b) => b.chance === null)).toBe(true)
  })

  it('a line on a router-only cycle is decided at run time', () => {
    const nodes = [pool('tickets', 1), gate('roll'), converter('back'), pool('out')]
    const edges = [res('e_in', 'tickets', 'roll', '1'), res('e_a', 'roll', 'back', '1'), res('e_b', 'back', 'roll', '1'), res('e_c', 'roll', 'out', '1')]
    const c = gateChances(nodes, edges, 'roll', 1)!
    expect(c.status).toBe('runtime')
    expect(c.reason).toBe('cycle')
  })

  // review of 2026-11-15, E4: the routers BELOW a cycle were taken as on it
  it('a Gate below a router-only cycle is not on it: its chances are fixed (was: decided at run time)', () => {
    const nodes = [pool('tickets', 1), gate('on', 'deterministic'), gate('back', 'deterministic'), gate('roll'), pool('ssr'), pool('r')]
    const edges = [res('l1', 'on', 'back', '1'), res('l2', 'back', 'on', '1'), res('down', 'on', 'roll', '1'), res('e_in', 'tickets', 'roll', '1'), res('e_a', 'roll', 'ssr', '1'), res('e_b', 'roll', 'r', '3')]
    const c = gateChances(nodes, edges, 'roll', 1)!
    expect(c.status).toBe('fixed')
    expect(c.branches.map((b) => b.chance)).toEqual([0.25, 0.75])
  })
  it('a Gate ON the cycle, and a Gate with a line INTO a router on it, are still decided at run time', () => {
    const nodes = [pool('tickets', 1), gate('on'), gate('back', 'deterministic'), gate('above'), pool('out')]
    const edges = [res('l1', 'on', 'back', '1'), res('l2', 'back', 'on', '1'), res('o', 'on', 'out', '1'), res('e_in', 'tickets', 'above', '1'), res('into', 'above', 'on', '1'), res('side', 'above', 'out', '1')]
    expect(gateChances(nodes, edges, 'on', 1)).toMatchObject({ status: 'runtime', reason: 'cycle' })
    expect(gateChances(nodes, edges, 'above', 1)).toMatchObject({ status: 'runtime', reason: 'cycle' })
  })

  it('not a probabilistic Gate: null; no outgoing line: none', () => {
    const { nodes, edges } = roll(['1', '1', '1'])
    expect(gateChances(nodes, edges, 'tickets', 1)).toBeNull()
    expect(gateChances([...nodes.filter((n) => n.id !== 'roll'), gate('roll', 'deterministic')], edges, 'roll', 1)).toBeNull()
    expect(gateChances([gate('lone')], [], 'lone', 1)).toEqual({ status: 'none', sum: null, branches: [] })
  })

  it('a line touching a Parameter is not a branch (the engine ignores it)', () => {
    const { nodes, edges } = roll(['1', '1', '1'], [param('p', 1)])
    const c = gateChances(nodes, [...edges, res('e_bad', 'roll', 'p', '5')], 'roll', 1)!
    expect(c.branches.map((b) => b.edgeId)).toEqual(['e_a', 'e_b', 'e_c'])
  })

  it('reading the chances draws nothing: the run that follows is the same as without the reading', () => {
    const { nodes, edges } = roll(['1', '2', '7'])
    const a = step(nodes, edges, initSim(nodes), 7)
    gateChances(nodes, edges, 'roll', 1)
    const b = step(nodes, edges, initSim(nodes), 7)
    expect(b).toEqual(a)
  })

  it('a run over many seeds lands on each branch at its chance', () => {
    // a Pool feeds the Gate one ticket a step (a Source pushes only to a Pool)
    const nodes = [pool('tickets', 4000), gate('roll'), pool('a'), pool('b'), pool('c')]
    const edges = [res('e_in', 'tickets', 'roll', '1'), res('e_a', 'roll', 'a', '1'), res('e_b', 'roll', 'b', '2'), res('e_c', 'roll', 'c', '7')]
    const c = gateChances(nodes, edges, 'roll', 1)!
    expect(c.status).toBe('fixed')
    let st = initSim(nodes)
    for (let i = 0; i < 4000; i++) st = step(nodes, edges, st, 11).state
    const total = st.values.a + st.values.b + st.values.c
    expect(total).toBe(4000)
    expect(st.values.a / total).toBeCloseTo(c.branches[0].chance!, 1)
    expect(st.values.b / total).toBeCloseTo(c.branches[1].chance!, 1)
    expect(st.values.c / total).toBeCloseTo(c.branches[2].chance!, 1)
  })
})

describe('routerOrder: the routers on a cycle, and the ones below it', () => {
  const pairs = (list: [string, string][]): LoopEdge[] => list.map(([s, t], i) => res(`e${i}`, s, t, '1'))
  it('no cycle: the order is the walk, nothing is cyclic', () => {
    expect(routerOrder(['c', 'a', 'b'], pairs([['a', 'b'], ['b', 'c']]))).toEqual({ order: ['a', 'b', 'c'], cyclic: [] })
  })
  it('A ⇄ B, B → C → D: only A and B are cyclic; C and D are ordered (was: all four cyclic)', () => {
    expect(routerOrder(['A', 'B', 'C', 'D'], pairs([['A', 'B'], ['B', 'A'], ['B', 'C'], ['C', 'D']]))).toEqual({ order: ['C', 'D'], cyclic: ['A', 'B'] })
  })
  it('routers above the cycle keep their place, and one fed from above and from the cycle comes after the one above', () => {
    // U → A ⇄ B → X ; U → X
    expect(routerOrder(['X', 'U', 'A', 'B'], pairs([['U', 'A'], ['A', 'B'], ['B', 'A'], ['B', 'X'], ['U', 'X']]))).toEqual({ order: ['U', 'X'], cyclic: ['A', 'B'] })
  })
  it('a router between two cycles is on neither', () => {
    const r = routerOrder(['A', 'B', 'M', 'N', 'X'], pairs([['A', 'B'], ['B', 'A'], ['B', 'X'], ['X', 'M'], ['M', 'N'], ['N', 'M']]))
    expect(r).toEqual({ order: ['X'], cyclic: ['A', 'B', 'M', 'N'] })
  })
  it('a connection from a router to itself is a cycle of one; a longer cycle is found whole', () => {
    expect(routerOrder(['S', 'T'], pairs([['S', 'S'], ['S', 'T']]))).toEqual({ order: ['T'], cyclic: ['S'] })
    expect(routerOrder(['a', 'b', 'c', 'd'], pairs([['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd']]))).toEqual({ order: ['d'], cyclic: ['a', 'b', 'c'] })
  })
  it('a long chain below a cycle is ordered without recursion (5,000 routers)', () => {
    const ids = ['A', 'B', ...Array.from({ length: 5000 }, (_, i) => `n${String(i).padStart(4, '0')}`)]
    const list: [string, string][] = [['A', 'B'], ['B', 'A'], ['B', ids[2]]]
    for (let i = 2; i < ids.length - 1; i++) list.push([ids[i], ids[i + 1]])
    const r = routerOrder(ids, pairs(list))
    expect(r.cyclic).toEqual(['A', 'B'])
    expect(r.order).toEqual(ids.slice(2))
  })
})
