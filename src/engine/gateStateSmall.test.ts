import { describe, expect, it } from 'vitest'
import { gate, pool, res, shift, type Graph } from './generatedGraphs.fixture'
import { initSim, step } from './index'

// A Gate's reported state (`report.gates`, issue #477: the LED and the Inspector's line) and
// whether it fired never contradict each other (SEMANTICS-E.md §E9, §E16): a Gate that passed
// anything on reads `full` or `partial`, never `idle` ("nothing to pass on") or `held`
// ("nothing passed on"), however small the amount. The state's tolerance of 1e-6 is the
// precision of what is reported; where a Gate's own amounts are at or under it, the tolerance
// is that part of them.

const f = (x: string, n: number) => shift(x, n)
const held = (x: string, n: number) => Number(f(x, n))
function one(g: Graph) {
  const r = step(g.nodes, g.edges, initSim(g.nodes), 7, 2)
  const s = r.report.gates.find((x) => x.nodeId === 'g')
  return { state: s ? `${s.state}${s.why ? '/' + s.why : ''}` : 'off', entry: s, fired: r.report.fired.includes('g'), moves: (r.report.moves ?? []).length }
}
const SCALES = [0, -3, -8, -12]

describe('a Gate that passes something on never reads idle or held, at any size', () => {
  it.each(SCALES)('× 10^%i: all it asks (its Pool holds the 3 its line asks): full', (n) => {
    const s = one({ nodes: [pool('A', held('3', n)), pool('Q', 0), gate('g')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] })
    expect(s.fired).toBe(true)
    expect(s.state).toBe('full')
  })

  it.each(SCALES)('× 10^%i: its Pool holds 2 of the 3 its line asks (`pull any`): a part, for its supply', (n) => {
    const s = one({ nodes: [pool('A', held('2', n)), pool('Q', 0), gate('g')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] })
    expect(s.fired).toBe(true)
    expect(s.state).toBe('partial/supply')
  })

  it.each(SCALES)('× 10^%i: the Pool below has room for 1 of the 3: a part, for the room', (n) => {
    const s = one({ nodes: [pool('A', held('5', n)), pool('Q', held('4', n), held('5', n)), gate('g')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] })
    expect(s.fired).toBe(true)
    expect(s.state).toBe('partial/room')
  })

  it('a Gate that passes 5e-10 on beside nothing else: full, and its numbers are the amount, not 0', () => {
    const s = one({ nodes: [pool('A', 1), pool('Q', 0), gate('g')], edges: [res('a', 'A', 'g', '0.0000000005'), res('o', 'g', 'Q', '1')] })
    expect(s.fired).toBe(true)
    expect(s.state).toBe('full')
    expect(s.entry).toMatchObject({ demand: 5e-10, available: 5e-10, moved: 5e-10 })
  })
})

describe('a Gate that passes nothing on never reads full or partial, at any size', () => {
  it.each(SCALES)('× 10^%i: an empty Pool: idle', (n) => {
    const s = one({ nodes: [pool('A', 0), pool('Q', 0), gate('g')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] })
    expect(s.fired).toBe(false)
    expect(s.state).toBe('idle')
  })

  it.each(SCALES)('× 10^%i: `pull all`, its Pool holding 2 of the 3: held, for its all-or-nothing demand', (n) => {
    const s = one({ nodes: [pool('A', held('2', n)), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] })
    expect(s.fired).toBe(false)
    expect(s.state).toBe('held/pullAll')
  })

  it.each(SCALES)('× 10^%i: the Pool below is full: held, for the room', (n) => {
    const s = one({ nodes: [pool('A', held('5', n)), pool('Q', held('5', n), held('5', n)), gate('g')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] })
    expect(s.fired).toBe(false)
    expect(s.state).toBe('held/room')
  })
})

describe('at ordinary sizes the reported numbers keep their six decimals', () => {
  it('a third of 10 is reported as 3.333333', () => {
    const s = one({ nodes: [pool('A', 10), pool('Q', 0), gate('g')], edges: [res('a', 'A', 'g', '3.3333333333'), res('o', 'g', 'Q', '1')] })
    expect(s.entry).toMatchObject({ state: 'full', demand: 3.333333, moved: 3.333333 })
  })
})
