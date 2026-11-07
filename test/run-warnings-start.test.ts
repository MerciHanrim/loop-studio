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

  it('an interactive Source counts, because a person can press it', () => {
    const s = added([interactive], [line('x', 's', 'own', '1')])
    expect(fired(s, 'a'), 'not pressed here').toBe(0)
    expect(warned(s, 'a')).toEqual([])
  })

  it('a Converter outside with nothing to run on still counts: the check stops at one hop', () => {
    const s = added([pool('f2', 0), stage('c', 'pullAny')], [line('c1', 'f2', 'c', '3'), line('x', 'c', 'own', '3')])
    expect(fired(s, 'a')).toBe(0)
    expect(warned(s, 'a')).toEqual([])
  })

  it('a label reading an empty Pool still counts: its stock can change', () => {
    const s = added([pool('sw', 0)], [state('x', 'sw', 'own', 'label', '=S')])
    expect(fired(s, 'a')).toBe(0)
    expect(warned(s, 'a')).toEqual([])
  })
})

describe('a rule', () => {
  it('asking for a full run stalls the same', () => {
    const s = loop(1, 'pullAll', 'pullAny', { tank: 'store', level: '100000', band: '1', side: 'fill' })
    expect(fired(s, 'a')).toBe(0)
    expect(warned(s, 'a')).toHaveLength(1)
  })

  it('asking for a small first run can still start, which is why the warning says may', () => {
    const s = loop(1, 'pullAll', 'pullAny', { tank: 'tank', level: '505', band: '100', side: 'fill' })
    expect(fired(s, 'a')).toBe(40)
    expect(warned(s, 'a')).toHaveLength(1)
  })
})

describe('the step length', () => {
  const doc = deserialize(readFileSync(resolve(import.meta.dirname, '..', 'examples', 'desalination.json'), 'utf8'))
  const hours = (value: number) => ({ ...doc.time!, step: { value, unit: 'h' as const } })
  const stalled = (from: number, to: number) => stagesNewlyStalled(doc.nodes, doc.edges, doc.timetables, doc.kinds, hours(from), hours(to))

  it('names the stage that takes from the tank once, and only when the change causes it', () => {
    expect(stalled(1, 3), 'Recovered energy starts at 2,500 and 3 h takes 1,875').toEqual([])
    expect(stalled(1, 6), '6 h takes 3,750').toEqual(['hp'])
    expect(stalled(6, 12), 'already short at 6 h').toEqual([])
    expect(stalled(6, 1), 'a shorter step gains nothing').toEqual([])
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
