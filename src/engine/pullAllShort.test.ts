import { describe, expect, it } from 'vitest'
import { cmp, exactDouble, parseDecimal, sub, type Rational } from '../model/rational'
import { conv, drain, end, gate, plainGraph, pool, res, shift, source, type Graph } from './generatedGraphs.fixture'
import { runAndRead, same, ZERO } from './recordChecks.fixture'

// What a `pull all` node may be short of, and what it records when it is (SEMANTICS-E.md §E11,
// §E11a, §E11b; issue #572).
//
//   §E11   a node that asks more than 1e-9 in all may be short by 1e-9, an absolute amount
//   §E11a  a node that asks 1e-9 or less in all may be short by 1e-9 OF WHAT IT ASKS
//   §E11b  a node that runs short takes what its Pools hold and no more: the record never
//          takes a Pool under 0 (a Drain and an End as a Gate)
//
// Every case is stated at ordinary size and with every amount under 1e-9, where the node is to
// do the same thing times the scale.

const dec = (text: string) => parseDecimal(text)!
const f = (x: string, n: number) => shift(x, n)
const held = (x: string, n: number) => Number(f(x, n))
const SMALL = -12
/** `x` (a decimal) times 10^n, as the exact fraction */
const at = (x: string, n: number): Rational => dec(f(x, n))
const moves = (r: ReturnType<typeof runAndRead>[number]) => r.movedLines

describe('§E11b: a `pull all` Drain or End that runs short takes what the Pool holds, as a Gate does', () => {
  const terminal = (kind: 'drain' | 'end') => (kind === 'drain' ? drain('d', 'pullAll') : end('d', 'pullAll'))

  it.each(['drain', 'end'] as const)('one line, a Pool of 2.9999999995 and a %s that asks 3: it takes 2.9999999995, and the Pool is at 0, not under it', (kind) => {
    const [s] = runAndRead({ nodes: [pool('A', 2.9999999995), terminal(kind)], edges: [res('a', 'A', 'd', '3')] })
    expect(same(s.moved('a'), exactDouble(2.9999999995))).toBe(true)
    expect(s.outside).toEqual([])
    expect(s.values.A).toBe(0)
    expect(s.result.report.events).toEqual([{ edgeId: 'a', from: 'A', to: 'd', amount: 2.9999999995 }])
    expect(s.result.report.fired).toEqual(['d'])
    expect(s.result.state.ended).toBe(kind === 'end')
  })

  it('the same boundary as a `pull all` Gate: a Pool of 2.9999999995 and a line of 3', () => {
    const [s] = runAndRead({ nodes: [pool('A', 2.9999999995), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', '3'), res('o', 'g', 'Q', '1')] })
    expect(same(s.moved('a'), exactDouble(2.9999999995))).toBe(true)
    expect(s.outside).toEqual([])
  })

  it('a Pool that holds all its line asks: the Drain takes the 3, as before', () => {
    const [s] = runAndRead({ nodes: [pool('A', 5), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', '3')] })
    expect(same(s.moved('a'), dec('3'))).toBe(true)
    expect(s.values.A).toBe(2)
  })

  it('short by more than the epsilon (a Pool of 2.99999999 and a line of 3): nothing moves', () => {
    const [s] = runAndRead({ nodes: [pool('A', 2.99999999), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', '3')] })
    expect(moves(s)).toEqual([])
    expect(s.values.A).toBe(2.99999999)
  })

  it('two lines off one Pool whose rates` doubles sum to more than it holds (0.1 and 0.2 off 0.3): the lines take in their order, the second what is left; no Pool under 0', () => {
    const [s] = runAndRead({ nodes: [pool('A', 0.3), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', '0.1'), res('b', 'A', 'd', '0.2')] })
    expect(same(s.moved('a'), exactDouble(0.1))).toBe(true)
    // what is left of the Pool for the second line: at most `0.3 − 0.1` exactly, and within a last place of it
    const left = sub(exactDouble(0.3), exactDouble(0.1))
    expect(cmp(s.moved('b'), left)).toBeLessThanOrEqual(0)
    expect(cmp(sub(left, s.moved('b')), exactDouble(1e-16))).toBeLessThan(0)
    expect(s.outside).toEqual([])
    expect(s.values.A).toBeGreaterThanOrEqual(0)
    expect(s.values.A).toBeLessThan(1e-16)
  })

  it('two lines off two Pools, one of them 5e-10 short: the full line in full, the short one what its Pool holds', () => {
    const [s] = runAndRead({ nodes: [pool('A', 4), pool('B', 2.9999999995), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', '4'), res('b', 'B', 'd', '3')] })
    expect(same(s.moved('a'), dec('4'))).toBe(true)
    expect(same(s.moved('b'), exactDouble(2.9999999995))).toBe(true)
    expect(s.outside).toEqual([])
  })

  it('two lines of 5 off a Pool of 8: asked of it together, 2 short: nothing moves (unchanged)', () => {
    const [s] = runAndRead({ nodes: [pool('A', 8), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', '5'), res('b', 'A', 'd', '5')] })
    expect(moves(s)).toEqual([])
  })

  it.each(['drain', 'end'] as const)('every amount under 1e-9: a %s that asks 3e-13 of a Pool that holds the double of 3e-13 takes it, and the Pool is at 0', (kind) => {
    const [s] = runAndRead({ nodes: [pool('A', held('0.3', SMALL)), terminal(kind)], edges: [res('a', 'A', 'd', f('0.3', SMALL))] })
    expect(same(s.moved('a'), exactDouble(held('0.3', SMALL)))).toBe(true)
    expect(s.outside).toEqual([])
    expect(s.values.A).toBe(0)
    expect(s.result.state.ended).toBe(kind === 'end')
  })

  it('every amount under 1e-9, two lines off one Pool (1e-13 and 2e-13 off 3e-13): both lines take, no Pool under 0', () => {
    const [s] = runAndRead({ nodes: [pool('A', held('0.3', SMALL)), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', f('0.1', SMALL)), res('b', 'A', 'd', f('0.2', SMALL))] })
    expect(cmp(s.moved('a'), ZERO)).toBe(1)
    expect(cmp(s.moved('b'), ZERO)).toBe(1)
    expect(s.outside).toEqual([])
    expect(s.values.A).toBeGreaterThanOrEqual(0)
    expect(s.values.A).toBeLessThan(1e-27)
  })
})

describe('§E11a: a `pull all` node that asks 1e-9 or less in all may be short by 1e-9 of what it asks, and by no more', () => {
  // Each graph is one that stops at ordinary size (the node is a third short, or the room is).
  // Under 1e-9 it is to stop as well: an absolute 1e-9 would let every one of them through.
  const SHORT: [string, (n: number) => Graph][] = [
    ['a Gate on its own, its Pool holding 2 of the 3 its line asks', (n) => ({ nodes: [pool('A', held('2', n)), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] })],
    ['a Gate on its own, its Pool holding 5, the Pool below with room for 1 of the 3', (n) => ({ nodes: [pool('A', held('5', n)), pool('Q', held('4', n), held('5', n)), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] })],
    ['a Gate into a Converter (a planned group), its Pool holding 2 of 3', (n) => ({ nodes: [pool('A', held('2', n)), pool('Q', 0), gate('g', 'pullAll'), conv('c')], edges: [res('a', 'A', 'g', f('3', n)), res('gc', 'g', 'c', f('3', n)), res('o', 'c', 'Q', f('1', n))] })],
    ['a Converter fed by a `pull any` Gate and by a `pull all` Gate whose Pool holds 2 of 3', (n) => ({ nodes: [pool('A', held('2', n)), pool('B', held('9', n)), pool('Q', 0), gate('g', 'pullAll'), gate('h'), conv('c')], edges: [res('a', 'A', 'g', f('3', n)), res('b', 'B', 'h', f('3', n)), res('gc', 'g', 'c', f('3', n)), res('hc', 'h', 'c', f('3', n)), res('o', 'c', 'Q', f('1', n))] })],
    ['a Drain, its Pool holding 2 of 3', (n) => ({ nodes: [pool('A', held('2', n)), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', f('3', n))] })],
    ['an End, its Pool holding 2 of 3', (n) => ({ nodes: [pool('A', held('2', n)), end('d', 'pullAll')], edges: [res('a', 'A', 'd', f('3', n))] })],
    ['a `push all` Source, the Pool with room for 2 of the 3', (n) => ({ nodes: [source('s', 'pushAll'), pool('Q', held('3', n), held('5', n))], edges: [res('p', 's', 'Q', f('3', n))] })],
    ['a `pull all` Converter, its Pool holding 2 of the 3 a run takes', (n) => ({ nodes: [pool('A', held('2', n)), pool('Q', 0), conv('c', 'pullAll')], edges: [res('a', 'A', 'c', f('3', n)), res('o', 'c', 'Q', f('1', n))] })],
  ]
  it.each(SHORT)('a third short: %s: nothing moves, at scale 1, at 10^-3 and at 10^-12', (_name, make) => {
    for (const n of [0, -3, SMALL]) {
      const [s] = runAndRead(make(n))
      expect(moves(s), `at 10^${n}`).toEqual([])
      expect(s.result.report.fired, `at 10^${n}`).toEqual([])
      expect(s.result.state.ended).toBe(false)
    }
  })

  it('generated graph, seed 793: a `pull all` Gate that can bring none of what it asks; nothing of its group moves, at scale 1 and at 10^-12', () => {
    for (const n of [0, SMALL]) {
      const [s] = runAndRead(plainGraph(793, n))
      expect(moves(s), `at 10^${n}`).toEqual([])
    }
  })

  // A node that CAN have all it asks runs at every size. Where a Pool holds the double of what
  // its line writes, the double can be a hair under the decimal (3e-13 is): that hair is far
  // inside 1e-9 of the demand, and is what the allowance is for.
  const FULL: [string, (n: number) => Graph, string[]][] = [
    ['a Gate on its own; the Pool holds the 0.3 its line asks', (n) => ({ nodes: [pool('A', held('0.3', n)), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('0.3', n)), res('o', 'g', 'Q', '1')] }), ['a', 'o']],
    ['a Gate on its own; the Pool holds the 0.7 its line asks', (n) => ({ nodes: [pool('A', held('0.7', n)), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('0.7', n)), res('o', 'g', 'Q', '1')] }), ['a', 'o']],
    ['a Gate on its own; the Pool holds the 3 its line asks', (n) => ({ nodes: [pool('A', held('3', n)), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('3', n)), res('o', 'g', 'Q', '1')] }), ['a', 'o']],
    ['a Gate into a Converter (a planned group); the Pool holds the 0.3', (n) => ({ nodes: [pool('A', held('0.3', n)), pool('Q', 0), gate('g', 'pullAll'), conv('c')], edges: [res('a', 'A', 'g', f('0.3', n)), res('gc', 'g', 'c', f('0.3', n)), res('o', 'c', 'Q', f('1', n))] }), ['a', 'gc', 'o']],
    ['a Gate with two Pool lines; each Pool holds what its line asks (0.3, 0.7)', (n) => ({ nodes: [pool('A', held('0.3', n)), pool('B', held('0.7', n)), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('0.3', n)), res('b', 'B', 'g', f('0.7', n)), res('o', 'g', 'Q', '1')] }), ['a', 'b', 'o']],
    ['a Gate with two supplies (a Gate above it and a Pool line of its own), each exactly enough', (n) => ({ nodes: [pool('A', held('0.3', n)), pool('B', held('0.7', n)), pool('Q', 0), gate('h'), gate('g', 'pullAll')], edges: [res('a', 'A', 'h', f('0.3', n)), res('hg', 'h', 'g', '1'), res('b', 'B', 'g', f('0.7', n)), res('o', 'g', 'Q', '1')] }), ['a', 'hg', 'b', 'o']],
    ['a Drain; the Pool holds the 0.3', (n) => ({ nodes: [pool('A', held('0.3', n)), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', f('0.3', n))] }), ['a']],
    ['an End; the Pool holds the 0.3', (n) => ({ nodes: [pool('A', held('0.3', n)), end('d', 'pullAll')], edges: [res('a', 'A', 'd', f('0.3', n))] }), ['a']],
    ['a `push all` Source; the Pool has room for the 0.3 (holds 0.7 of 1)', (n) => ({ nodes: [source('s', 'pushAll'), pool('Q', held('0.7', n), held('1', n))], edges: [res('p', 's', 'Q', f('0.3', n))] }), ['p']],
    ['a Drain with two lines off one Pool that holds their sum (0.1 + 0.2 of 0.3)', (n) => ({ nodes: [pool('A', held('0.3', n)), drain('d', 'pullAll')], edges: [res('a', 'A', 'd', f('0.1', n)), res('b', 'A', 'd', f('0.2', n))] }), ['a', 'b']],
  ]
  it.each(FULL)('all it asks is there: %s: every line moves, at scale 1 and at 10^-12, and no Pool leaves its bounds', (_name, make, lines) => {
    for (const n of [0, SMALL]) {
      const [s] = runAndRead(make(n))
      expect([...moves(s)].sort(), `at 10^${n}`).toEqual([...lines].sort())
      expect(s.outside, `at 10^${n}`).toEqual([])
    }
  })

  it('short by less than 1e-9 of what it asks (a Pool a 5e-10th under the 3e-12 its line asks): the Gate runs on what the Pool holds', () => {
    const holds = 3e-12 * (1 - 5e-10)
    const [s] = runAndRead({ nodes: [pool('A', holds), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('3', SMALL)), res('o', 'g', 'Q', '1')] })
    expect(same(s.moved('a'), exactDouble(holds))).toBe(true)
    expect(s.outside).toEqual([])
  })

  it('short by more than 1e-9 of what it asks (a Pool a millionth under the 3e-12): nothing moves', () => {
    const [s] = runAndRead({ nodes: [pool('A', 3e-12 * (1 - 1e-6)), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', f('3', SMALL)), res('o', 'g', 'Q', '1')] })
    expect(moves(s)).toEqual([])
  })
})

describe('§E11, the edge of the absolute epsilon: a node that asks a little MORE than 1e-9 may be short by 1e-9', () => {
  // The absolute allowance is kept above 1e-9 as it was, so close above it the allowance is a
  // large part of the demand. Stated as it is: this is the rule's edge, not a case to mend.
  const asks = (holds: number): Graph => ({ nodes: [pool('A', holds), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', '0.0000000014'), res('o', 'g', 'Q', '1')] })

  it('a Gate that asks 1.4e-9 of a Pool that holds 5e-10: 9e-10 short, within the absolute epsilon: it takes the 5e-10 (before revision 16 an amount under 1e-9 was 0 and the Gate stopped)', () => {
    const [s] = runAndRead(asks(5e-10))
    expect(same(s.moved('a'), exactDouble(5e-10))).toBe(true)
    expect(s.result.report.events).toEqual([]) // under the display threshold
    expect(s.result.report.fired).toEqual(['g'])
  })

  it('the same Gate with 1.2e-9 in the Pool: 2e-10 short: it takes the 1.2e-9, as it did before revision 16', () => {
    const [s] = runAndRead(asks(1.2e-9))
    expect(same(s.moved('a'), exactDouble(1.2e-9))).toBe(true)
  })

  it('the same Gate with 3e-10 in the Pool: 1.1e-9 short, more than the epsilon: nothing moves', () => {
    const [s] = runAndRead(asks(3e-10))
    expect(moves(s)).toEqual([])
  })

  it('a Gate that asks exactly 1e-9 is on the other side of the edge: a Pool that holds half of it is short by more than 1e-9 of 1e-9, and nothing moves', () => {
    const [s] = runAndRead({ nodes: [pool('A', 5e-10), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', '0.000000001'), res('o', 'g', 'Q', '1')] })
    expect(moves(s)).toEqual([])
  })
})

describe('a `pull all` Converter is tested on a part of a run, and so runs at every size where it can have all it asks (§E19)', () => {
  // Alone, behind a Gate and in front of a Gate. In front of another CONVERTER it does not, under
  // 1e-9: that is E-open 4 (exactMovesOpen.test.ts).
  const CONVERTERS: [string, (n: number) => Graph, string[]][] = [
    ['alone', (n) => ({ nodes: [pool('A', held('3', n)), pool('Q', 0), conv('c', 'pullAll')], edges: [res('a', 'A', 'c', f('3', n)), res('o', 'c', 'Q', f('1', n))] }), ['a', 'o']],
    ['behind a Gate', (n) => ({ nodes: [pool('A', held('3', n)), pool('Q', 0), gate('g'), conv('c', 'pullAll')], edges: [res('a', 'A', 'g', f('3', n)), res('gc', 'g', 'c', f('3', n)), res('o', 'c', 'Q', f('1', n))] }), ['a', 'gc', 'o']],
    ['in front of a Gate', (n) => ({ nodes: [pool('A', held('8', n)), pool('Q', 0), conv('c', 'pullAll'), gate('g')], edges: [res('a', 'A', 'c', f('8', n)), res('cg', 'c', 'g', f('3', n)), res('o', 'g', 'Q', '1')] }), ['a', 'cg', 'o']],
  ]
  it.each(CONVERTERS)('%s: every line moves at scale 1, at 10^-9, at 10^-10 and at 10^-12, the same amounts times the scale', (_name, make, lines) => {
    const at1 = runAndRead(make(0))[0]
    expect([...at1.movedLines].sort()).toEqual([...lines].sort())
    for (const n of [-9, -10, SMALL]) {
      const [s] = runAndRead(make(n))
      expect([...moves(s)].sort(), `at 10^${n}`).toEqual([...lines].sort())
      expect(s.outside, `at 10^${n}`).toEqual([])
      // the same amounts times the scale, to one part in 10^9
      for (const id of lines) {
        const want = Number(at1.moved(id).num) / Number(at1.moved(id).den)
        const got = Number(s.moved(id).num) / Number(s.moved(id).den) / 10 ** n
        expect(Math.abs(got - want), `${id} at 10^${n}`).toBeLessThan(1e-9 * want)
      }
    }
  })

  it('and where its Pool holds 7 of the 8 it asks, it stops with its group at every size', () => {
    for (const n of [0, -9, -10, SMALL]) {
      const [s] = runAndRead({ nodes: [pool('A', held('7', n)), pool('B', held('12', n)), pool('Q', 0), conv('c0', 'pullAll'), conv('c1')], edges: [res('a', 'A', 'c0', f('8', n)), res('cc', 'c0', 'c1', f('3', n)), res('b', 'B', 'c1', f('3', n)), res('o', 'c1', 'Q', f('4', n))] })
      expect(moves(s), `at 10^${n}`).toEqual([])
    }
  })
})

describe('at ordinary sizes nothing of this changes what a `pull all` node does', () => {
  it('a Gate 5e-10 short of the 3 its line asks runs on what the Pool holds; one 2e-9 short does not', () => {
    const run = (holds: number) => runAndRead({ nodes: [pool('A', holds), pool('Q', 0), gate('g', 'pullAll')], edges: [res('a', 'A', 'g', '3'), res('o', 'g', 'Q', '1')] })[0]
    expect(same(run(2.9999999995).moved('a'), exactDouble(2.9999999995))).toBe(true)
    expect(moves(run(2.999999998))).toEqual([])
  })
  it('a `push all` Source into a Pool with room for 2.9999999995 of its 3 pushes the room; with room for 2.999999998 it pushes nothing', () => {
    const run = (holds: number) => runAndRead({ nodes: [source('s', 'pushAll'), pool('Q', holds, 5)], edges: [res('p', 's', 'Q', '3')] })[0]
    const short = run(2.0000000005)
    expect(short.movedLines).toEqual(['p'])
    expect(short.outside).toEqual([])
    expect(short.values.Q).toBe(5)
    expect(moves(run(2.000000002))).toEqual([])
  })
})

void at
