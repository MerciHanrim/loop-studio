import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initSim, step } from '../src/engine/step'
import { runWarnings, stagesNewlyStalled, stagesNewlyWarned } from '../src/model/runWarnings'
import { deserialize } from '../src/model/serialize'
import type { LoopEdge, LoopNode } from '../src/model/types'

// #520 — a `pull all` group that only it can refill, with a start under one step's take.
// Each shape is run through the real engine, so the warning is held to what the run does.

const pool = (id: string, initial: number, capacity: number | null = 1000) =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny' } }) as unknown as LoopNode
const stage = (id: string, mode: string, run?: object) =>
  ({ id, type: 'converter', position: { x: 0, y: 0 }, data: { kind: 'converter', label: id, activation: 'automatic', mode, ...(run ? { run } : {}) } }) as unknown as LoopNode
const source = (id: string) => ({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' } }) as unknown as LoopNode
const line = (id: string, from: string, to: string, flow: string) =>
  ({ id, type: 'loop', source: from, target: to, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } }) as unknown as LoopEdge

type Shape = { nodes: LoopNode[]; edges: LoopEdge[] }
/** feed → a → b → store, and b sends 5 back to `own`, which a takes 5 from */
const loop = (start: number, a = 'pullAll', b = 'pullAny', run?: object): Shape => ({
  nodes: [pool('feed', 100000, null), pool('own', start), pool('store', 0, null), pool('tank', 500), stage('a', a, run), stage('b', b)],
  edges: [line('i', 'feed', 'a', '10'), line('o', 'own', 'a', '5'), line('ab', 'a', 'b', '15'), line('back', 'b', 'own', '5'), line('out', 'b', 'store', '10')],
})
const fired = ({ nodes, edges }: Shape, id: string) => {
  let st = initSim(nodes, {})
  let n = 0
  for (let t = 0; t < 40; t++) {
    const r = step(nodes, edges, st, 1, 6, {})
    st = r.state
    if ([...r.report.fired].includes(id)) n++
  }
  return n
}
const warned = ({ nodes, edges }: Shape, id: string) => runWarnings(nodes, edges, [], [], undefined, id).filter((w) => w.code === 'start-under-take')

describe('a pull all group that only it can refill', () => {
  it('never runs when it starts under one step’s take, and every member of the group says so', () => {
    const s = loop(1)
    expect(fired(s, 'a')).toBe(0)
    expect(warned(s, 'a')).toEqual([{ code: 'start-under-take', stage: 'a', taker: 'a', tank: 'own', start: 1, amount: 5 }])
    expect(warned(s, 'b')).toEqual([{ code: 'start-under-take', stage: 'b', taker: 'a', tank: 'own', start: 1, amount: 5 }])
  })

  it('needs no warning at exactly one step’s take, or above', () => {
    for (const start of [5, 6]) {
      expect(fired(loop(start), 'a')).toBe(40)
      expect(warned(loop(start), 'a')).toEqual([])
    }
  })

  it('stalls the same with pull all on the member that does not take from the Pool', () => {
    const s = loop(1, 'pullAny', 'pullAll')
    expect(fired(s, 'a')).toBe(0)
    expect(warned(s, 'a')).toHaveLength(1)
  })

  it('stalls on a Pool nothing refills', () => {
    const s = { nodes: [pool('p', 1), stage('a', 'pullAll'), pool('s', 0, null)], edges: [line('i', 'p', 'a', '5'), line('o', 'a', 's', '5')] }
    expect(fired(s, 'a')).toBe(0)
    expect(warned(s, 'a')).toHaveLength(1)
  })

  it('adds up what two members take from one Pool', () => {
    const s = loop(6)
    s.edges.push(line('o2', 'own', 'b', '4'))
    expect(warned(s, 'a').map((w) => w.amount)).toEqual([9])
  })
})

describe('a low start that is no deadlock', () => {
  it('with an outside supply the group waits a few steps and then runs', () => {
    const s = loop(1)
    s.nodes.push(source('sup'))
    s.edges.push(line('s', 'sup', 'own', '1'))
    expect(fired(s, 'a')).toBeGreaterThan(30)
    expect(warned(s, 'a')).toEqual([])
  })

  it('pull any runs at what it has', () => {
    const s = loop(1, 'pullAny', 'pullAny')
    expect(fired(s, 'a')).toBe(40)
    expect(warned(s, 'a')).toEqual([])
  })
})

// #527 review: being connected is not being supplied. Each outside connection is run
// through the engine, and the warning has to agree with what the tank really got.
describe('what comes into the Pool from outside the group', () => {
  const state = (id: string, from: string, to: string, mode: string, expr = '') =>
    ({ id, type: 'loop', source: from, target: to, sourceHandle: 'state-source', targetHandle: 'state-target', data: { kind: 'state', mode, expr } }) as unknown as LoopEdge
  const passive = { ...source('s'), data: { ...source('s').data, activation: 'passive' } } as LoopNode
  const interactive = { ...source('s'), data: { ...source('s').data, activation: 'interactive' } } as LoopNode
  const up = pool('up', 500)
  const sw = pool('sw', 5)
  const added = (nodes: LoopNode[], edges: LoopEdge[]): Shape => {
    const s = loop(1)
    return { nodes: [...s.nodes, ...nodes], edges: [...s.edges, ...edges] }
  }

  const NOT_A_SUPPLY: [string, Shape][] = [
    ['a line from a Source at 0', added([source('s')], [line('x', 's', 'own', '0')])],
    ['a passive Source nothing triggers', added([passive], [line('x', 's', 'own', '1')])],
    ['a passive Converter nothing triggers', added([pool('f2', 500), { ...stage('c', 'pullAny'), data: { ...stage('c', 'pullAny').data, activation: 'passive' } } as LoopNode], [line('c1', 'f2', 'c', '3'), line('x', 'c', 'own', '3')])],
    ['a line from a Pool, which moves nothing by itself', added([up], [line('x', 'up', 'own', '10')])],
    ['an activator', added([sw], [state('x', 'sw', 'own', 'activator', '>= 1')])],
    ['a trigger', added([source('s')], [line('t', 's', 'store', '1'), state('x', 's', 'own', 'trigger')])],
    ['a label that takes away', added([sw], [state('x', 'sw', 'own', 'label', '-1')])],
    ['a label of +0', added([sw], [state('x', 'sw', 'own', 'label', '+0')])],
    ['a label that sets under one step', added([sw], [state('x', 'sw', 'own', 'label', '=3')])],
    ['a label from a Source, which is inert', added([source('s')], [state('x', 's', 'own', 'label', '+5')])],
    ['a label that does not parse', added([sw], [state('x', 'sw', 'own', 'label', 'nonsense')])],
  ]
  for (const [name, shape] of NOT_A_SUPPLY) {
    it(`${name}: the group never runs, and the warning stays`, () => {
      expect(fired(shape, 'a')).toBe(0)
      expect(warned(shape, 'a')).toHaveLength(1)
    })
  }

  const A_SUPPLY: [string, Shape][] = [
    ['a Source above 0', added([source('s')], [line('x', 's', 'own', '1')])],
    ['a Converter outside the group', added([pool('f2', 500), stage('c', 'pullAny')], [line('c1', 'f2', 'c', '3'), line('x', 'c', 'own', '3')])],
    ['a passive Source with a trigger', added([passive, source('t')], [line('x', 's', 'own', '1'), line('t2', 't', 'store', '1'), state('y', 't', 's', 'trigger')])],
    ['a label that adds', added([sw], [state('x', 'sw', 'own', 'label', '+5')])],
    ['a label that sets one step or more', added([sw], [state('x', 'sw', 'own', 'label', '=10')])],
    ['a label that sets from a stocked Pool', added([sw], [state('x', 'sw', 'own', 'label', '=S')])],
    [
      'a label that adds after an outside Converter runs',
      added([pool('f2', 500), stage('c', 'pullAny'), pool('s2', 0, null)], [line('c1', 'f2', 'c', '3'), line('c2', 'c', 's2', '3'), { ...state('x', 'c', 'own', 'label', '+5'), data: { kind: 'state', mode: 'label', expr: '+5', timing: 'afterPull', when: 'source-fired' } } as unknown as LoopEdge]),
    ],
  ]
  for (const [name, shape] of A_SUPPLY) {
    it(`${name}: the group runs, and nothing is raised`, () => {
      expect(fired(shape, 'a')).toBeGreaterThan(30)
      expect(warned(shape, 'a')).toEqual([])
    })
  }

  // #520, measured on main 776c0870: #527 counted these three as supplies, one hop deep,
  // and each stalled for good with no warning. Nothing in the app presses a node, so an
  // interactive Source is a passive one; what feeds a supply is now followed to the end.
  const STALLED: [string, Shape][] = [
    ['an interactive Source nothing triggers: nothing in the app presses a node', added([interactive], [line('x', 's', 'own', '1')])],
    ['an outside Converter whose input is empty and nothing refills', added([pool('f2', 0), stage('c', 'pullAny')], [line('c1', 'f2', 'c', '3'), line('x', 'c', 'own', '3')])],
    ['two hops: an empty Pool, a Converter, an empty Pool, a Converter', added([pool('f3', 0), stage('c2', 'pullAny'), pool('f2', 0), stage('c', 'pullAny')], [line('c3', 'f3', 'c2', '3'), line('c2o', 'c2', 'f2', '3'), line('c1', 'f2', 'c', '3'), line('x', 'c', 'own', '3')])],
    ['an outside Converter that takes only from the group’s own store', added([stage('c', 'pullAny')], [line('c1', 'store', 'c', '3'), line('x', 'c', 'own', '3')])],
    ['a label `=S` reading an empty Pool nothing refills', added([pool('sw', 0)], [state('x', 'sw', 'own', 'label', '=S')])],
    ['a label `=S` reading the group’s own store', added([], [state('x', 'store', 'own', 'label', '=S')])],
  ]
  for (const [name, shape] of STALLED) {
    it(`${name}: the group never runs, and the warning is raised`, () => {
      expect(fired(shape, 'a')).toBe(0)
      expect(warned(shape, 'a')).toHaveLength(1)
    })
  }

  // the same shapes with one Source further up: each runs within a few steps, and the
  // warning has to go
  const RESCUED: [string, Shape][] = [
    ['an interactive Source with a trigger from an automatic Source', added([interactive, source('t'), pool('sink', 0, null)], [line('x', 's', 'own', '1'), line('t1', 't', 'sink', '1'), state('y', 't', 's', 'trigger')])],
    ['an outside Converter whose input a Source refills', added([pool('f2', 0), stage('c', 'pullAny'), source('s2')], [line('c1', 'f2', 'c', '3'), line('x', 'c', 'own', '3'), line('s2f', 's2', 'f2', '1')])],
    ['two hops, the far Pool refilled by a Source', added([pool('f3', 0), stage('c2', 'pullAny'), pool('f2', 0), stage('c', 'pullAny'), source('s3')], [line('c3', 'f3', 'c2', '3'), line('c2o', 'c2', 'f2', '3'), line('c1', 'f2', 'c', '3'), line('x', 'c', 'own', '3'), line('s3f', 's3', 'f3', '1')])],
    ['a label `=S` reading an empty Pool a Source refills', added([pool('sw', 0), source('s')], [state('x', 'sw', 'own', 'label', '=S'), line('sf', 's', 'sw', '1')])],
  ]
  for (const [name, shape] of RESCUED) {
    it(`${name}: the group runs, and nothing is raised`, () => {
      expect(fired(shape, 'a')).toBeGreaterThan(30)
      expect(warned(shape, 'a')).toEqual([])
    })
  }
})

// #520 — two pull all groups that refill each other through Pools. Each sees the other as
// a supply one hop out; neither can start without the other.
describe('two groups that refill each other', () => {
  const mutual = (s1: number, s2: number, more: Shape = { nodes: [], edges: [] }): Shape => ({
    nodes: [pool('f1', 100000, null), pool('f2', 100000, null), pool('own1', s1), pool('own2', s2), pool('out1', 0, null), pool('out2', 0, null), stage('g1', 'pullAll'), stage('g2', 'pullAll'), ...more.nodes],
    edges: [
      line('g1f', 'f1', 'g1', '10'), line('g1o', 'own1', 'g1', '5'), line('g1x', 'g1', 'own2', '5'), line('g1y', 'g1', 'out1', '10'),
      line('g2f', 'f2', 'g2', '10'), line('g2o', 'own2', 'g2', '5'), line('g2x', 'g2', 'own1', '5'), line('g2y', 'g2', 'out2', '10'),
      ...more.edges,
    ],
  })

  it('both under one step: neither ever runs, and each is warned about the tank it waits on', () => {
    const s = mutual(1, 1)
    expect([fired(s, 'g1'), fired(s, 'g2')]).toEqual([0, 0])
    expect(warned(s, 'g1').map((w) => w.tank)).toEqual(['own1'])
    expect(warned(s, 'g2').map((w) => w.tank)).toEqual(['own2'])
  })

  it('one at a full step: both run, and nothing is raised', () => {
    const s = mutual(5, 1)
    expect(fired(s, 'g1')).toBeGreaterThan(15)
    expect(fired(s, 'g2')).toBeGreaterThan(15)
    expect([...warned(s, 'g1'), ...warned(s, 'g2')]).toEqual([])
  })

  it('both under, with a Source into one tank: both run, and nothing is raised', () => {
    const s = mutual(1, 1, { nodes: [source('s')], edges: [line('s1', 's', 'own1', '1')] })
    expect(fired(s, 'g1')).toBeGreaterThan(30)
    expect(fired(s, 'g2')).toBeGreaterThan(30)
    expect([...warned(s, 'g1'), ...warned(s, 'g2')]).toEqual([])
  })
})

describe('a rule', () => {
  it('asking for a full run stalls the same', () => {
    const s = loop(1, 'pullAll', 'pullAny', { tank: 'store', level: '100000', band: '1', side: 'fill' })
    expect(fired(s, 'a')).toBe(0)
    expect(warned(s, 'a')).toHaveLength(1)
  })

  // #520 review of the e2e: a rule the run refuses (here a table with no 100 % line) has no
  // plan, so the first share falls back to the full step, and nothing throws
  it('a refused rule: no first share, the full step is the test, and nothing throws', () => {
    const s = loop(1, 'pullAll', 'pullAny', { table: 'demand' })
    expect(() => warned(s, 'a')).not.toThrow()
    expect(warned(s, 'a')).toHaveLength(1)
  })

  // #520 — the rule reads its tank as the run starts, so its first share is known: on main
  // all 36 of these were warned and 20 ran. A case runs exactly when that share of one
  // step's take is within the start, and the warning now says so case by case.
  it('asking for a small first run: warned exactly when the first share of the take is over the start', () => {
    const rows: string[] = []
    for (const start of [1, 2, 3, 4]) {
      for (const level of [501, 505, 510, 520, 540, 560, 580, 600, 700]) {
        const s = loop(start, 'pullAll', 'pullAny', { tank: 'tank', level: String(level), band: '100', side: 'fill' })
        const runs = fired(s, 'a') > 0
        if (runs === (warned(s, 'a').length > 0)) rows.push(`start ${start}, level ${level}: runs ${runs}, warned ${!runs}`)
      }
    }
    expect(rows).toEqual([])
  })
})

describe('the step length', () => {
  const doc = deserialize(readFileSync(resolve(import.meta.dirname, '..', 'examples', 'desalination.json'), 'utf8'))
  const hours = (value: number) => ({ ...doc.time!, step: { value, unit: 'h' as const } })
  const stalled = (from: number, to: number) => stagesNewlyStalled(doc.nodes, doc.edges, doc.timetables, doc.kinds, hours(from), hours(to))

  it('names the stage that takes from the tank once, and only when the change causes it', () => {
    expect(stalled(1, 3), 'Recovered energy starts at 2,500 and 3 h takes 1,875').toEqual([])
    // #520: at 6 h remin takes 2,250 from Permeate, which starts at 1,500 and is refilled
    // only by reverse osmosis, which waits on hp. One hop counted RO as a supply.
    expect(stalled(1, 6), '6 h: hp takes 3,750 of Recovered energy, remin 2,250 of Permeate').toEqual(['hp', 'remin'])
    // at 12 h the delivery pump's first take, 6,000 at its rule's share, is over Product
    // water's 1,500, which only remin refills; at 6 h its first share fit, so it ran once
    expect(stalled(6, 12), 'hp and remin already short at 6 h; dpump newly at 12 h').toEqual(['dpump'])
    expect(stalled(6, 1), 'a shorter step gains nothing').toEqual([])
  })

  it('agrees with the engine over 120 steps: what is named never runs, and all three run at 1 h', () => {
    const count = (value: number) => {
      const opts = { kinds: doc.kinds, time: hours(value), timetables: doc.timetables }
      let st = initSim(doc.nodes, opts)
      const n = { hp: 0, remin: 0, dpump: 0 }
      for (let k = 1; k <= 120; k++) {
        const r = step(doc.nodes, doc.edges, st, 1, doc.modelVersion, opts)
        st = r.state
        for (const id of ['hp', 'remin', 'dpump'] as const) if ([...r.report.fired].includes(id)) n[id]++
      }
      return n
    }
    expect(count(1)).toEqual({ hp: 120, remin: 120, dpump: 120 })
    // at 6 h the pump's first share fits and it runs once, then waits on remin, which is named
    expect(count(6)).toEqual({ hp: 0, remin: 0, dpump: 1 })
    expect(count(12)).toEqual({ hp: 0, remin: 0, dpump: 0 })
  })

  it('stays out of the rule announcement, which says something else', () => {
    const rules = stagesNewlyWarned(doc.nodes, doc.edges, doc.timetables, doc.kinds, hours(1), hours(6))
    const only = rules.filter((id) => !runWarnings(doc.nodes, doc.edges, doc.timetables, doc.kinds, hours(6), id).some((w) => w.code !== 'start-under-take'))
    expect(only).toEqual([])
  })
})

describe('the bundled examples', () => {
  const dir = resolve(import.meta.dirname, '..', 'examples')
  it('raise it nowhere, at the step they ship with', () => {
    const hits: string[] = []
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('.expected.json'))) {
      let doc
      try {
        doc = deserialize(readFileSync(resolve(dir, f), 'utf8'))
      } catch {
        continue
      }
      for (const n of doc.nodes) for (const w of runWarnings(doc.nodes, doc.edges, doc.timetables, doc.kinds, doc.time, n.id)) if (w.code === 'start-under-take') hits.push(`${f} ${n.id} ${w.tank} ${w.start} ${w.amount}`)
    }
    expect(hits).toEqual([])
  })
})
