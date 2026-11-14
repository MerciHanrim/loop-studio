// SEMANTICS-R14.md — the kinds table, the step length and the timetables as units of a
// three-way plan and of a chosen Apply.
import { describe, expect, it } from 'vitest'
import { splitEngineChanges } from './applyDiagnostics'
import type { DocPhase } from './phases'
import { buildSelectiveApply, canonicalContent, computeThreeWay, defaultGraphChoices, phaseTimingSplit, type HunkSelection } from './revision'
import type { Timetable } from './timetable'
import type { LoopEdge, LoopNode } from './types'

const nodes: LoopNode[] = [
  { id: 'a', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'A', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: 'mass' } },
  { id: 'b', type: 'drain', position: { x: 200, y: 0 }, data: { kind: 'drain', label: 'B', activation: 'automatic', mode: 'pullAny' } },
] as LoopNode[]
const line = (flow: string): LoopEdge => ({ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow, route: 'orthogonal' } }) as LoopEdge
const P = (id: string, label: string, from: number, to: number): DocPhase => ({ id, label, from, to })
const OLD = [P('dry', 'Drying', 2, 5), P('brown', 'Browning', 6, 9)]
const NEW = [P('dry', 'Drying', 2, 7), P('brown', 'Browning', 8, 9)]
const table = (at: string): Timetable => ({ id: 't', label: 'T', source: 's', unit: 'kg per min', timeUnit: 'min', read: 'hold', end: '13', after: 'zero', points: [['0', '0'], ['1', '1.2'], [at, '0.25']] })
const MIN = { step: { value: 1, unit: 'min' as const } }
const HALF = { step: { value: 30, unit: 's' as const } }
const KINDS = [{ name: 'mass', conserved: true, baseUnit: 'kg', rateUnits: [{ name: 'kg per min', factor: '1', per: 'min' as const }] }]
const KINDS_BAG = [{ ...KINDS[0]!, units: [{ name: 'bag', factor: '60' }] }]
type Over = { at?: string; time?: typeof MIN | typeof HALF; kinds?: typeof KINDS; phases?: DocPhase[]; flow?: string }
/** the content of a document at model version 6, where tables and a step length are read */
const doc = (o: Over = {}) =>
  canonicalContent({ nodes, edges: [line(o.flow ?? '~t')], kinds: o.kinds ?? KINDS, time: o.time ?? MIN, timetables: [table(o.at ?? '5')], ...(o.phases ? { phases: o.phases } : {}) }, { modelVersion: 6 })

describe('R14-2 — the three units in a three-way plan', () => {
  it('each is absent when base and proposed agree, and present with a verdict against the target when they differ', () => {
    const plan = computeThreeWay(doc(), doc(), doc({ at: '7', time: HALF, kinds: KINDS_BAG }))
    expect([plan.timetables?.verdict, plan.time?.verdict, plan.kinds?.verdict]).toEqual(['clean', 'clean', 'clean'])
    expect(plan.nConf).toBe(0)
    const same = computeThreeWay(doc(), doc({ at: '9' }), doc())
    expect([same.timetables, same.time, same.kinds]).toEqual([undefined, undefined, undefined])
  })

  it('a target that already holds the proposed unit is a noop; one that holds a third value is a conflict and is counted', () => {
    const theirs = doc({ at: '7', time: HALF, kinds: KINDS_BAG })
    expect(computeThreeWay(doc(), theirs, theirs)).toMatchObject({ timetables: { verdict: 'noop' }, time: { verdict: 'noop' }, kinds: { verdict: 'noop' }, nConf: 0 })
    const mine = doc({ at: '6', time: { step: { value: 2, unit: 'min' } } as never, kinds: [{ ...KINDS[0]!, conserved: false }] as never })
    expect(computeThreeWay(doc(), mine, theirs)).toMatchObject({ timetables: { verdict: 'conflict' }, time: { verdict: 'conflict' }, kinds: { verdict: 'conflict' }, nConf: 3 })
  })

  it('a unit carries the three whole values', () => {
    const plan = computeThreeWay(doc(), doc(), doc({ time: HALF }))
    expect(plan.time).toEqual({ kind: 'time', verdict: 'clean', base: MIN, proposed: HALF, yours: MIN })
  })
})

describe('R14-3 — what a chosen Apply returns for the units', () => {
  const proposedFull = { nodes, edges: [line('~t')], kinds: KINDS_BAG, time: { ...HALF, display: 'min' as const }, timetables: [table('7')] }
  const build = (selection: HunkSelection, full: typeof proposedFull | Omit<typeof proposedFull, 'time'> = proposedFull) =>
    buildSelectiveApply({ target: { nodes, edges: [line('~t')] }, proposedFull: full, plan: computeThreeWay(doc(), doc(), doc({ at: '7', time: HALF, kinds: KINDS_BAG })), selection })

  it('a unit is returned only when its line is taken', () => {
    const none = build({ accept: {}, fieldChoices: {} })
    expect(none).toMatchObject({ ok: true })
    expect(none.ok && [none.kinds, none.time, none.timetables]).toEqual([undefined, undefined, undefined])
    const all = build({ accept: {}, fieldChoices: {}, kinds: 'proposed', time: 'proposed', timetables: 'proposed' })
    expect(all.ok && all.kinds).toEqual(KINDS_BAG)
    expect(all.ok && all.time).toEqual({ ...HALF, display: 'min' })
    expect(all.ok && all.timetables).toEqual([table('7')])
    const one = build({ accept: {}, fieldChoices: {}, kinds: 'yours', time: 'yours', timetables: 'proposed' })
    expect(one.ok && [one.kinds, one.time]).toEqual([undefined, undefined])
  })

  it('taking the step length of a proposal that declares none clears it: `null`, never "not taken"', () => {
    const { time: _t, ...noTime } = proposedFull
    const r = build({ accept: {}, fieldChoices: {}, time: 'proposed' }, noTime)
    expect(r.ok && r.time).toBeNull()
  })
})

describe('R14-4 — phase names and timing, judged on the result', () => {
  const mine = doc({ phases: OLD })
  const both = doc({ phases: NEW, at: '7' })
  const tablesOnly = doc({ phases: OLD, at: '7' })
  const stepAndPhases = doc({ phases: NEW, time: HALF })

  it('a whole Apply is every line taken', () => {
    expect(phaseTimingSplit(mine, both, { mode: 'whole' })).toBeNull()
    expect(phaseTimingSplit(mine, tablesOnly, { mode: 'whole' })).toBe('timing-only')
  })

  it('the four choices of timetables × phases', () => {
    const split = (timetables: 'proposed' | 'yours', phases: 'proposed' | 'yours') => phaseTimingSplit(mine, both, { mode: 'hunks', timetables, phases })
    expect(split('proposed', 'proposed')).toBeNull()
    expect(split('yours', 'yours')).toBeNull()
    expect(split('yours', 'proposed')).toBe('phases-only')
    expect(split('proposed', 'yours')).toBe('timing-only')
  })

  it('the step length is timing too: phases count steps', () => {
    const split = (time: 'proposed' | 'yours', phases: 'proposed' | 'yours') => phaseTimingSplit(mine, stepAndPhases, { mode: 'hunks', time, phases })
    expect(split('proposed', 'proposed')).toBeNull()
    expect(split('yours', 'proposed')).toBe('phases-only')
    expect(split('proposed', 'yours')).toBe('timing-only')
  })

  it('half of the proposal’s timing is not the proposal’s timing', () => {
    const theirs = doc({ phases: NEW, at: '7', time: HALF })
    expect(phaseTimingSplit(mine, theirs, { mode: 'hunks', timetables: 'proposed', time: 'yours', phases: 'proposed' })).toBe('phases-only')
    expect(phaseTimingSplit(mine, theirs, { mode: 'hunks', timetables: 'proposed', time: 'proposed', phases: 'proposed' })).toBeNull()
  })

  it('nothing is said of a document that ends with no phases', () => {
    expect(phaseTimingSplit(doc(), doc({ at: '7' }), { mode: 'whole' })).toBeNull()
    expect(phaseTimingSplit(mine, doc({ at: '7' }), { mode: 'hunks', timetables: 'proposed', phases: 'proposed' })).toBeNull()
  })
})

describe('R14-5 — the lines "choose changes" starts with', () => {
  it('clean units are taken, and the phases with them', () => {
    const base = doc({ phases: OLD })
    const theirs = doc({ phases: NEW, at: '7', kinds: KINDS_BAG })
    expect(defaultGraphChoices(computeThreeWay(base, base, theirs), base, theirs)).toEqual({ kinds: 'proposed', time: 'yours', timetables: 'proposed', phases: 'proposed' })
  })

  it('a conflicting unit is not, and then clean phases are not either', () => {
    const base = doc({ phases: OLD })
    const mine = doc({ phases: OLD, at: '6' })
    const theirs = doc({ phases: NEW, at: '7' })
    expect(defaultGraphChoices(computeThreeWay(base, mine, theirs), mine, theirs)).toEqual({ kinds: 'yours', time: 'yours', timetables: 'yours', phases: 'yours' })
  })

  it('phases the user changed differently are never pre-taken, whatever the timing', () => {
    const base = doc({ phases: OLD })
    const mine = doc({ phases: [P('dry', 'Drying', 2, 4), P('brown', 'Browning', 5, 9)] })
    const theirs = doc({ phases: NEW })
    expect(defaultGraphChoices(computeThreeWay(base, mine, theirs), mine, theirs).phases).toBe('yours')
  })
})

describe('the changes a selection splits from the other side', () => {
  const base = doc({ flow: '1' })
  const plan = computeThreeWay(base, base, doc({ flow: '2' }))

  it('a taken engine field is `taken`; the same field kept is `kept`', () => {
    expect(splitEngineChanges(plan, { accept: {}, fieldChoices: { e: { 'data.flow': 'proposed' } } })).toEqual({ taken: [{ elementType: 'edge', id: 'e' }], kept: [] })
    expect(splitEngineChanges(plan, { accept: {}, fieldChoices: {} })).toEqual({ taken: [], kept: [{ elementType: 'edge', id: 'e' }] })
  })

  it('a field the target already holds as proposed is on both sides, and is neither', () => {
    const theirs = doc({ flow: '2' })
    expect(splitEngineChanges(computeThreeWay(base, theirs, theirs), { accept: {}, fieldChoices: {} })).toEqual({ taken: [], kept: [] })
  })
})
