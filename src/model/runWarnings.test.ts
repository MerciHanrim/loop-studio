import { describe, expect, it } from 'vitest'
import type { ResourceKindDecl } from './kinds'
import { runWarnings, stagesNewlyWarned } from './runWarnings'
import type { Timetable } from './timetable'
import type { LoopEdge, LoopNode } from './types'
import type { DocTime } from './units'

// SEMANTICS-M6.md §M6-9, with design §4.3 and §4.4 as the cases.

const pool = (id: string, capacity: number | null = null, extra: object = {}) =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity, mode: 'pullAny', resourceType: 'water', ...extra } }) as unknown as LoopNode
const stage = (id: string, run: object | undefined, mode = 'pullAny') =>
  ({ id, type: 'converter', position: { x: 0, y: 0 }, data: { kind: 'converter', label: id, activation: 'automatic', mode, ...(run ? { run } : {}) } }) as unknown as LoopNode
const drain = (id: string) => ({ id, type: 'drain', position: { x: 0, y: 0 }, data: { kind: 'drain', label: id, activation: 'automatic', mode: 'pullAny' } }) as unknown as LoopNode
const line = (id: string, source: string, target: string, flow: string, unit?: string) =>
  ({ id, source, target, data: { kind: 'resource', flow, ...(unit ? { unit } : {}) } }) as unknown as LoopEdge

const kinds: ResourceKindDecl[] = [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }] as ResourceKindDecl[]
const hours = (value: number): DocTime => ({ step: { value, unit: 'h' } }) as DocTime
const table = (rate: string): Timetable => ({ id: 'demand', label: 'Demand', source: 't', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'hold', end: '10', points: [['0', '1'], ['5', rate]] })

const rule = (band: string, level = '1000') => ({ tank: 'store', level, band, side: 'fill' })
const plant = (run: object, mode = 'pullAny', feedCapacity: number | null = null): { nodes: LoopNode[]; edges: LoopEdge[] } => ({
  nodes: [pool('feed', feedCapacity), stage('ro', run, mode), pool('store'), drain('out')],
  edges: [line('in', 'feed', 'ro', '45', 'CMH'), line('made', 'ro', 'store', '45', 'CMH'), line('use', 'store', 'out', '~demand')],
})
const warnings = (p: { nodes: LoopNode[]; edges: LoopEdge[] }, step = 1, rate = '47') => runWarnings(p.nodes, p.edges, [table(rate)], kinds, hours(step), 'ro')

describe('a band under one full step', () => {
  it('passes at what the stage moves in a step, and warns below it', () => {
    expect(warnings(plant(rule('45')))).toEqual([])
    expect(warnings(plant(rule('44.9')))).toEqual([{ code: 'band-under-step', stage: 'ro', tank: 'store', band: 44.9, amount: 45 }])
  })

  it('moves with the step, so a rule that was fine can stop being', () => {
    expect(warnings(plant(rule('200')), 3)).toEqual([])
    expect(warnings(plant(rule('200')), 6).map((w) => w.code)).toEqual(['band-under-step'])
  })

  it('counts a stage that empties the tank as well', () => {
    const p = plant({ tank: 'feed', level: '100', band: '10', side: 'empty' })
    expect(warnings(p)).toEqual([{ code: 'band-under-step', stage: 'ro', tank: 'feed', band: 10, amount: 45 }])
  })

  it('says nothing of a tank the stage has no line to', () => {
    const p = plant({ tank: 'other', level: '100', band: '1', side: 'fill' })
    p.nodes.push(pool('other'))
    expect(warnings(p)).toEqual([])
  })
})

describe('a target level under one step of pull', () => {
  it('reads a table at its highest, and passes at that amount', () => {
    expect(warnings(plant(rule('300', '47')))).toEqual([])
    expect(warnings(plant(rule('300', '46.9')))).toEqual([{ code: 'level-under-pull', stage: 'ro', tank: 'store', level: 46.9, amount: 47 }])
  })

  it('is the case of §4.4: 47 an hour is 282 in six hours, against a level of 270', () => {
    expect(warnings(plant(rule('1000', '270')), 6).map((w) => [w.code, w.amount])).toEqual([['level-under-pull', 282]])
  })

  it('leaves out what the stage itself takes', () => {
    const p = plant({ tank: 'feed', level: '1', band: '100', side: 'empty' })
    expect(warnings(p)).toEqual([])
  })
})

describe('an input tank under one step of a pull all take', () => {
  it('is the panel of §4.4, and only under pull all', () => {
    const run = rule('1000')
    expect(warnings(plant(run, 'pullAll', 44.9))).toEqual([{ code: 'tank-under-take', stage: 'ro', tank: 'feed', capacity: 44.9, amount: 45 }])
    expect(warnings(plant(run, 'pullAny', 44.9))).toEqual([])
    expect(warnings(plant(run, 'pullAll', 45))).toEqual([])
  })

  it('never warns of a tank with no capacity', () => {
    expect(warnings(plant(rule('1000'), 'pullAll', null))).toEqual([])
  })
})

it('reads level and band in the tank’s own unit', () => {
  const litres: ResourceKindDecl[] = [{ ...kinds[0]!, units: [{ name: 'L', factor: '0.001' }] }] as ResourceKindDecl[]
  const p = plant(rule('44000', '1000000'))
  p.nodes[2] = pool('store', null, { unit: 'L' })
  expect(runWarnings(p.nodes, p.edges, [table('47')], litres, hours(1), 'ro')).toEqual([{ code: 'band-under-step', stage: 'ro', tank: 'store', band: 44, amount: 45 }])
})

it('a line with no one amount adds nothing', () => {
  const p = plant(rule('1'))
  p.edges = p.edges.map((e) => (e.id === 'made' ? line('made', 'ro', 'store', 'all') : e))
  expect(warnings(p)).toEqual([])
})

it('a stage with no rule has none', () => {
  const p = plant(rule('1'))
  p.nodes[1] = stage('ro', undefined)
  expect(warnings(p)).toEqual([])
})

describe('a step-length change', () => {
  it('names the stages that gain a warning, and no others', () => {
    const p = plant(rule('200'))
    expect(stagesNewlyWarned(p.nodes, p.edges, [table('47')], kinds, hours(1), hours(6))).toEqual(['ro'])
    expect(stagesNewlyWarned(p.nodes, p.edges, [table('47')], kinds, hours(6), hours(1))).toEqual([])
    expect(stagesNewlyWarned(p.nodes, p.edges, [table('47')], kinds, hours(6), hours(7))).toEqual([])
  })
})
