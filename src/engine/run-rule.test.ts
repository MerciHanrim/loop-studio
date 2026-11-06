import { describe, expect, it } from 'vitest'
import type { ResourceKindDecl } from '../model/kinds'
import { planRuns, readRunRule, runFindings, runGroupOf, type RunRule } from '../model/runRule'
import type { Timetable } from '../model/timetable'
import type { LoopEdge, LoopNode } from '../model/types'
import type { DocTime } from '../model/units'
import { initSim, step } from './step'
import type { StepResult } from './types'

// SEMANTICS-M6.md — a run rule, through the real `step()`. A rule's wanted fraction comes
// from a tank here: `sig` holds 0, so (level − 0) ÷ band is the fraction asked for.
//
// The stage takes 100 feed and 300 power per run, and makes 45 product and 55 brine.

type Mode = 'pullAny' | 'pullAll'
const MV = 6
const HOUR: DocTime = { step: { value: 1, unit: 'h' } }
const WATER: ResourceKindDecl[] = [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }, { name: 'CMD', factor: '1', per: 'd' }] }]

const DEMAND: Timetable = { id: 'demand', label: 'Demand', source: 'test', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'hold', end: '10', points: [['0', '50']] }

const pool = (id: string, initial: number, capacity: number | null = null, resourceType?: string): LoopNode =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, activation: 'passive', initial, capacity, mode: 'pullAny', ...(resourceType ? { resourceType } : {}) } }) as unknown as LoopNode
const stage = (id: string, mode: Mode, run?: RunRule): LoopNode =>
  ({ id, type: 'converter', position: { x: 0, y: 0 }, data: { kind: 'converter', label: id, activation: 'automatic', mode, ...(run ? { run } : {}) } }) as unknown as LoopNode
const gate = (id: string): LoopNode =>
  ({ id, type: 'gate', position: { x: 0, y: 0 }, data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' } }) as unknown as LoopNode
const line = (id: string, source: string, target: string, flow: string, extra: Record<string, unknown> = {}): LoopEdge =>
  ({ id, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow, ...extra } }) as unknown as LoopEdge
const activator = (id: string, source: string, target: string, expr: string): LoopEdge =>
  ({ id, source, target, sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop', data: { kind: 'state', mode: 'activator', expr } }) as unknown as LoopEdge

/** a rule asking for `wanted`: `level ÷ band`, with `sig` at 0 */
const asks = (wanted: string, extra: Partial<RunRule> = {}): RunRule => ({ tank: 'sig', level: wanted, band: '1', side: 'fill', ...extra })

const plant = (mode: Mode, rule: RunRule, o: { feed?: number; power?: number; room?: number | null } = {}) => ({
  nodes: [pool('sig', 0), pool('tank', o.feed ?? 1e6), pool('panel', o.power ?? 1e6), stage('ro', mode, rule), pool('store', 0, o.room ?? null), pool('waste', 0)],
  edges: [line('feed', 'tank', 'ro', '100'), line('power', 'panel', 'ro', '300'), line('product', 'ro', 'store', '45'), line('brine', 'ro', 'waste', '55')],
})
const chain = (a: Mode, b: Mode, ruleA?: RunRule, ruleB?: RunRule, power = 1e6) => ({
  nodes: [pool('sig', 0), pool('tank', 1e6), pool('panel', power), stage('a', a, ruleA), stage('b', b, ruleB), pool('store', 0)],
  edges: [line('in', 'tank', 'a', '100'), line('mid', 'a', 'b', '100'), line('pw', 'panel', 'b', '300'), line('out', 'b', 'store', '100')],
})

type G = { nodes: LoopNode[]; edges: LoopEdge[] }
const go = (g: G, o: { kinds?: ResourceKindDecl[]; time?: DocTime; timetables?: Timetable[] } = {}): StepResult => step(g.nodes, g.edges, initSim(g.nodes, o), 1, MV, o)
const report = (g: G) => go(g).report.runs![0]!

describe('a rule sets the run', () => {
  it('a Fill rule raises the run as the tank falls, and an Empty rule as it rises', () => {
    const fill = plant('pullAny', { tank: 'sig', level: '30', band: '100', side: 'fill' })
    expect(report(fill).target).toBeCloseTo(0.3, 12)
    const nodes = fill.nodes.map((n) => (n.id === 'sig' ? pool('sig', 80) : n))
    const empty = { ...fill, nodes: nodes.map((n) => (n.id === 'ro' ? stage('ro', 'pullAny', { tank: 'sig', level: '30', band: '100', side: 'empty' }) : n)) }
    expect(report(empty).target).toBeCloseTo(0.5, 12)
  })

  it('the rule reads the step’s start state, and the run moves what it asks', () => {
    const r = go(plant('pullAny', asks('0.5')))
    expect(Object.fromEntries(r.report.events.map((e) => [e.edgeId, e.amount]))).toEqual({ feed: 50, power: 150, product: 22.5, brine: 27.5 })
  })

  it('a table asks for its share of the 100 % line, on one time base', () => {
    const table = DEMAND
    const g = {
      nodes: [pool('tank', 1e6, null, 'water'), stage('ro', 'pullAny', { table: 'demand', rated: 'feed' }), pool('store', 0, null, 'water')],
      edges: [line('feed', 'tank', 'ro', '100', { unit: 'CMH' }), line('product', 'ro', 'store', '100', { unit: 'CMH' })],
    }
    const r = go(g, { kinds: WATER, time: HOUR, timetables: [table] })
    expect(r.report.diagnostics).toEqual([])
    expect(r.report.runs![0]!.target).toBe(0.5)
    expect(r.report.runs![0]!.state).toBe('met')
  })

  it('a document with no rule has no `runs` key, at any version', () => {
    const g = { nodes: [pool('t', 10), pool('s', 0)], edges: [line('e', 't', 's', '1')] }
    expect('runs' in go(g).report).toBe(false)
  })

  it('a rule on an earlier model version is not read', () => {
    const g = plant('pullAny', asks('0.5'))
    const r = step(g.nodes, g.edges, initSim(g.nodes), 1, 5)
    expect('runs' in r.report).toBe(false)
    expect(r.report.events.find((e) => e.edgeId === 'feed')?.amount).toBe(100)
  })
})

describe('a group with a Gate is refused, before any target exists (§M6-3)', () => {
  // a target does not hold a router-fed Converter's take from its Pools, so no rule may
  // reach that path: each of these must refuse the step, and move nothing
  const shapes: [string, G][] = [
    [
      'a Gate feeding the stage',
      {
        nodes: [pool('sig', 0), pool('tank', 1000), gate('g'), stage('ro', 'pullAny', asks('0.5')), pool('side', 1000), pool('store', 0)],
        edges: [line('in', 'tank', 'g', '100'), line('gr', 'g', 'ro', '100'), line('own', 'side', 'ro', '50'), line('out', 'ro', 'store', '100')],
      },
    ],
    [
      'a Gate after the stage',
      {
        nodes: [pool('sig', 0), pool('tank', 1000), stage('ro', 'pullAny', asks('0.5')), gate('g'), pool('store', 0)],
        edges: [line('in', 'tank', 'ro', '100'), line('rg', 'ro', 'g', '100'), line('out', 'g', 'store', '100')],
      },
    ],
    [
      'a Gate on the far end of a chain',
      {
        nodes: [pool('sig', 0), pool('tank', 1000), gate('g'), stage('a', 'pullAny'), stage('ro', 'pullAny', asks('0.5')), pool('store', 0)],
        edges: [line('in', 'tank', 'g', '100'), line('ga', 'g', 'a', '100'), line('ab', 'a', 'ro', '100'), line('out', 'ro', 'store', '100')],
      },
    ],
    [
      'a Gate with two supplies',
      {
        nodes: [pool('sig', 0), pool('t1', 1000), pool('t2', 1000), stage('a', 'pullAny'), stage('b', 'pullAny'), gate('g'), stage('ro', 'pullAny', asks('0.5')), pool('store', 0)],
        edges: [line('i1', 't1', 'a', '10'), line('i2', 't2', 'b', '10'), line('ag', 'a', 'g', '10'), line('bg', 'b', 'g', '10'), line('gr', 'g', 'ro', '20'), line('out', 'ro', 'store', '20')],
      },
    ],
  ]

  for (const [name, g] of shapes) {
    it(name, () => {
      const id = g.nodes.find((n) => (n.data as { run?: unknown }).run)!.id
      expect(runGroupOf(g.nodes, g.edges, id).ok).toBe(false)
      expect(runFindings(g.nodes, g.edges, [], [], undefined, MV)).toEqual([{ code: 'group-shape', stage: id }])
      const r = go(g)
      expect(r.report.events).toEqual([])
      expect(r.report.diagnostics).toHaveLength(1)
      expect(r.state.step).toBe(0)
      expect(r.state.values).toEqual(initSim(g.nodes).values)
    })
  }

  it('the refusal comes before a target is worked out', () => {
    const g = shapes[0]![1]
    expect(go(g).report.runs).toBeUndefined()
  })

  it('a chain of Converters with no Gate is accepted', () => {
    const g = chain('pullAny', 'pullAny', asks('0.5'))
    expect(runGroupOf(g.nodes, g.edges, 'a')).toEqual({ members: ['a', 'b'], ok: true })
  })
})

describe('the group’s report: the design’s boundary table (§M6-5)', () => {
  const state = (g: G) => {
    const r = report(g)
    return [r.state, r.why]
  }

  it('B1 target 0 is off, by the rule', () => {
    expect(state(plant('pullAny', asks('0')))).toEqual(['off', 'rule'])
  })

  it('B2–B4 a target at or below the engine’s floor stops, and says so', () => {
    expect(state(plant('pullAny', asks('0.0000000005')))).toEqual(['stopped', 'floor'])
    expect(state(plant('pullAll', asks('0.0000000005')))).toEqual(['stopped', 'floor'])
    expect(state(plant('pullAny', asks('0.000000001')))).toEqual(['stopped', 'floor'])
  })

  it('B5 a target just above the floor is met', () => {
    expect(state(plant('pullAny', asks('0.000000002')))).toEqual(['met', null])
  })

  it('B7, B8 feed for less than a small target: `pull any` is short, `pull all` stops', () => {
    expect(state(plant('pullAny', asks('0.000000002'), { feed: 1.5e-7 }))).toEqual(['short', 'supply'])
    const r = report(plant('pullAll', asks('0.000000002'), { feed: 1.5e-7 }))
    expect([r.state, r.why, r.cause]).toEqual(['stopped', 'pullAll', 'supply'])
  })

  it('B10–B12 either side of the ratio', () => {
    expect(state(plant('pullAny', asks('0.5'), { feed: 50 * (1 - 5e-10) }))).toEqual(['met', null])
    expect(state(plant('pullAny', asks('0.5'), { feed: 50 * (1 - 2e-9) }))).toEqual(['short', 'supply'])
    expect(state(plant('pullAll', asks('0.5'), { feed: 50 * (1 - 2e-9) }))).toEqual(['stopped', 'pullAll'])
  })

  it('B14 a target of 1 keeps today’s `pull all` tolerance', () => {
    expect(state(plant('pullAll', asks('1'), { feed: 100 * (1 - 5e-10) }))).toEqual(['met', null])
  })

  it('names the limit: what the target needed, and what was there', () => {
    const feed = report(plant('pullAny', asks('0.5'), { feed: 30 }))
    expect([feed.state, feed.why, feed.pool, feed.needed, feed.had]).toEqual(['short', 'supply', 'tank', 50, 30])
    expect(feed.moved).toBeCloseTo(0.3, 12)
    const power = report(plant('pullAny', asks('0.5'), { power: 60 }))
    expect([power.pool, power.needed, power.had]).toEqual(['panel', 150, 60])
    const room = report(plant('pullAny', asks('0.5'), { room: 9 }))
    expect([room.why, room.pool, room.needed, room.had]).toEqual(['room', 'store', 22.5, 9])
  })

  it('both short: the tighter names the limit, and on a tie supply comes first', () => {
    expect(report(plant('pullAny', asks('0.5'), { feed: 30, room: 9 })).pool).toBe('store')
    expect(report(plant('pullAny', asks('0.5'), { feed: 20, room: 9 })).why).toBe('supply')
  })

  it('a rule asking for less than 0, below its lowest run, or above 1', () => {
    const empty = plant('pullAny', { tank: 'sig', level: '0', band: '1', side: 'empty' })
    const nodes = empty.nodes.map((n) => (n.id === 'sig' ? pool('sig', 0.2) : n))
    const negative = { ...empty, nodes: nodes.map((n) => (n.id === 'ro' ? stage('ro', 'pullAny', { tank: 'sig', level: '1', band: '1', side: 'fill' }) : n)) }
    expect(report(negative).target).toBeCloseTo(0.8, 12)
    expect(state(plant('pullAny', asks('0.3', { lowest: '0.5' })))).toEqual(['off', 'lowest'])
    const capped = report(plant('pullAny', asks('1.3')))
    expect([capped.target, capped.capped, capped.state]).toEqual([1, true, 'met'])
  })

  it('an activator wins, in either mode', () => {
    for (const mode of ['pullAll', 'pullAny'] as const) {
      const g = plant(mode, asks('0.5'))
      const held = { nodes: [...g.nodes, pool('flag', 0)], edges: [...g.edges, activator('off', 'flag', 'ro', '>= 1')] }
      expect(state(held)).toEqual(['off', 'activator'])
    }
  })

  it('a met group names no limit', () => {
    const r = report(plant('pullAny', asks('0.5'), { feed: 60 }))
    expect([r.state, r.pool, r.needed, r.had]).toEqual(['met', null, null, null])
  })

  it('the basis is the largest line, and moved reads it', () => {
    const r = report(plant('pullAny', asks('0.5')))
    expect(r.basis).toBe('power')
    expect(r.moved).toBe(0.5)
  })
})

describe('a chain holds one number', () => {
  it('the smaller of two rules decides, and both stay listed', () => {
    const r = report(chain('pullAny', 'pullAny', asks('0.6'), asks('0.4')))
    expect(r.target).toBe(0.4)
    expect(r.decidedBy).toBe('b')
    expect(r.rules.map((x) => [x.stage, x.target])).toEqual([['a', 0.6], ['b', 0.4]])
    expect(r.state).toBe('met')
  })

  it('on a tie the lowest id decides', () => {
    expect(report(chain('pullAny', 'pullAny', asks('0.4'), asks('0.4'))).decidedBy).toBe('a')
  })

  it('a second member’s short power holds the group', () => {
    const r = report(chain('pullAny', 'pullAny', asks('0.5'), undefined, 60))
    expect([r.state, r.why, r.pool, r.needed, r.had]).toEqual(['short', 'supply', 'panel', 150, 60])
    expect(r.moved).toBeCloseTo(0.2, 12)
  })

  it('under `pull all` it stops', () => {
    const r = report(chain('pullAll', 'pullAll', asks('0.5'), undefined, 60))
    expect([r.state, r.why, r.cause]).toEqual(['stopped', 'pullAll', 'supply'])
    expect(report(chain('pullAny', 'pullAll', asks('0.5'), undefined, 60)).state).toBe('stopped')
  })

  it('an activator on either member holds the whole chain off', () => {
    for (const member of ['a', 'b']) {
      const g = chain('pullAny', 'pullAny', asks('0.5'))
      const held = { nodes: [...g.nodes, pool('flag', 0)], edges: [...g.edges, activator('off', 'flag', member, '>= 1')] }
      const r = go(held)
      expect([r.report.runs![0]!.state, r.report.runs![0]!.why, r.report.runs![0]!.moved]).toEqual(['off', 'activator', 0])
      expect(r.report.events).toEqual([])
    }
  })

  it('a rule on a chain never runs it above the target, at any step', () => {
    const g = chain('pullAny', 'pullAny', asks('0.25'))
    let st = initSim(g.nodes)
    for (let i = 0; i < 12; i++) {
      const r = step(g.nodes, g.edges, st, 1, MV)
      for (const e of r.report.events) expect(e.amount / Number((g.edges.find((x) => x.id === e.edgeId)!.data as { flow: string }).flow)).toBeLessThanOrEqual(0.25)
      st = r.state
    }
  })
})

describe('findings refuse the step', () => {
  const rated = (rule: Partial<RunRule>, flow = '100', unit?: string, opts: { time?: DocTime; kinds?: ResourceKindDecl[]; tables?: Timetable[] } = {}) => {
    const table = DEMAND
    const nodes = [pool('tank', 1000, null, 'water'), stage('ro', 'pullAny', { table: 'demand', rated: 'feed', ...rule }), pool('store', 0, null, 'water'), pool('elsewhere', 0, null, 'water')]
    const edges = [line('feed', 'tank', 'ro', flow, unit ? { unit } : {}), line('product', 'ro', 'store', '100'), line('other', 'store', 'elsewhere', '1', { unit: 'CMH' })]
    return runFindings(nodes, edges, opts.tables ?? [table], opts.kinds ?? WATER, 'time' in opts ? opts.time : HOUR, MV).map((f) => f.code)
  }

  it('accepts a line with a rate unit, and an amount per time', () => {
    expect(rated({}, '100', 'CMH')).toEqual([])
  })

  it('each §M6-3 refusal', () => {
    expect(rated({ rated: 'other' }, '100', 'CMH')).toEqual(['rated-outside'])
    expect(rated({ rated: 'gone' }, '100', 'CMH')).toEqual(['rated-missing'])
    expect(rated({ rated: undefined }, '100', 'CMH')).toEqual(['rated-needed'])
    expect(rated({ table: 'gone' }, '100', 'CMH')).toEqual(['unknown-table'])
    expect(rated({}, '0', 'CMH')).toEqual(['rated-zero'])
    expect(rated({}, '0.0', 'CMH')).toEqual(['rated-zero'])
    for (const flow of ['', 'all', '50%', '1-3', '2D6', '@p', '~t']) expect(rated({}, flow, 'CMH')).toEqual(['rated-not-a-number'])
    expect(rated({}, '100')).toEqual(['rated-no-time'])
    expect(rated({}, '100', 'CMH', { time: undefined })).toEqual(['no-step'])
  })

  it('the refusals that need the rest of the document', () => {
    expect(rated({ table: undefined, tank: 'tank', level: '1', band: '1', side: 'fill' }, '100', 'CMH')).toEqual(['rated-unused'])
    expect(rated({}, '100', 'CMH', { kinds: [] })).toEqual(['bad-unit'])
    const huge = `1${'0'.repeat(400)}`
    expect(rated({}, huge, 'CMH')).toEqual(['rated-out-of-range'])
  })

  it('a table read by a line of another kind', () => {
    const power: ResourceKindDecl[] = [...WATER, { name: 'power', conserved: false, baseUnit: 'kWh', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }]
    const nodes = [pool('tank', 1000, null, 'water'), stage('ro', 'pullAny', { table: 'demand', rated: 'feed' }), pool('store', 0, null, 'water'), pool('grid', 0, null, 'power')]
    const edges = [line('feed', 'tank', 'ro', '100', { unit: 'CMH' }), line('product', 'ro', 'store', '100'), line('reads', 'grid', 'ro', '~demand')]
    expect(runFindings(nodes, edges, [DEMAND], power, HOUR, MV).map((f) => f.code)).toEqual(['two-kinds'])
  })

  it('a line with no kind', () => {
    const nodes = [pool('tank', 1000), stage('ro', 'pullAny', { table: 'demand', rated: 'feed' }), pool('store', 0)]
    const edges = [line('feed', 'tank', 'ro', '100', { unit: 'CMH' }), line('product', 'ro', 'store', '100')]
    expect(runFindings(nodes, edges, [DEMAND], WATER, HOUR, MV).map((f) => f.code)).toEqual(['no-kind'])
  })

  it('a `stop` table a rule reads ends the run before the rule is used', () => {
    const table: Timetable = { ...DEMAND, after: 'stop', end: '1' }
    const g = {
      nodes: [pool('tank', 1e6, null, 'water'), stage('ro', 'pullAny', { table: 'demand', rated: 'feed' }), pool('store', 0, null, 'water')],
      edges: [line('feed', 'tank', 'ro', '100', { unit: 'CMH' }), line('product', 'ro', 'store', '100', { unit: 'CMH' })],
    }
    const o = { kinds: WATER, time: HOUR, timetables: [table] }
    const first = step(g.nodes, g.edges, initSim(g.nodes, o), 1, MV, o)
    expect(first.state.ended).toBe(false)
    const second = step(g.nodes, g.edges, first.state, 1, MV, o)
    expect(second.state.ended).toBe(true)
    expect(second.report.notices).toEqual([{ kind: 'timetableEnded', tableId: 'demand', label: 'Demand' }])
  })

  it('a tiny rate is not refused at a short step: the test is on the exact value', () => {
    const second: DocTime = { step: { value: 1, unit: 's' } }
    expect(rated({}, '0.00000001', 'CMD', { time: second })).toEqual([])
  })

  it('a tank that is gone, or not a Pool', () => {
    const g = plant('pullAny', asks('0.5', { tank: 'gone' }))
    expect(runFindings(g.nodes, g.edges, [], [], undefined, MV)).toEqual([{ code: 'unknown-tank', stage: 'ro' }])
    const h = plant('pullAny', asks('0.5', { tank: 'ro' }))
    expect(runFindings(h.nodes, h.edges, [], [], undefined, MV)).toEqual([{ code: 'bad-tank', stage: 'ro' }])
  })

  it('a rule on a node that is not a Converter', () => {
    const n = { ...pool('t', 1), data: { ...pool('t', 1).data, run: asks('0.5') } } as unknown as LoopNode
    expect(runFindings([n], [], [], [], undefined, MV)).toEqual([{ code: 'not-a-converter', stage: 't' }])
  })

  it('a rate that is not finite refuses the step, and moves nothing', () => {
    const g = plant('pullAny', { tank: 'sig', level: '1', band: '0.' + '0'.repeat(320) + '1', side: 'fill' })
    const r = go(g)
    expect(r.report.events).toEqual([])
    expect(r.report.diagnostics).toHaveLength(1)
    expect(r.state.step).toBe(0)
  })
})

describe('the read of a stored rule', () => {
  const bad = (raw: unknown) => readRunRule(raw).ok
  it('refuses what cannot mean anything', () => {
    expect(bad({})).toBe(false)
    expect(bad({ tank: 'a', level: '1', band: '0', side: 'fill' })).toBe(false)
    expect(bad({ tank: 'a', level: '-1', band: '1', side: 'fill' })).toBe(false)
    expect(bad({ tank: 'a', level: '1', band: '1', side: 'up' })).toBe(false)
    expect(bad({ tank: 'a', level: '1e3', band: '1', side: 'fill' })).toBe(false)
    expect(bad({ level: '1' })).toBe(false)
    expect(bad({ table: 't', lowest: '1.5' })).toBe(false)
  })
  it('reads a tank rule, a table rule, and both', () => {
    expect(bad({ tank: 'a', level: '1', band: '1', side: 'fill' })).toBe(true)
    expect(bad({ table: 't', rated: 'e' })).toBe(true)
    expect(bad({ tank: 'a', level: '1', band: '1', side: 'empty', table: 't', rated: 'e', lowest: '0.5' })).toBe(true)
  })
  it('a step’s plan takes no memory: it is a function of the values and the step', () => {
    const g = plant('pullAny', asks('0.5'))
    const a = planRuns(g.nodes, g.edges, [], [], undefined, { sig: 0 }, 1, MV)
    const b = planRuns(g.nodes, g.edges, [], [], undefined, { sig: 0 }, 1, MV)
    expect(a).toEqual(b)
  })
})
