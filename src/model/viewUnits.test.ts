// SEMANTICS-M4.md §M4-8 — the Timeline's view unit: screen state over an engine
// value. The document, the run and the plain file must not know it exists.
import { beforeEach, describe, expect, it } from 'vitest'
import { buildRunCsv, buildShownRunCsv } from '../components/timelineCsv'
import { useGraphStore } from '../store/graphStore'
import { useSimStore } from '../store/simStore'
import { useViewUnitsStore } from '../store/viewUnitsStore'
import type { ResourceKindDecl } from './kinds'
import { serialize } from './serialize'
import type { LoopNode } from './types'
import { fieldUnitText, resolveFieldUnit, type DocTime } from './units'
import {
  NO_VIEW_UNITS,
  axisMark,
  axisPad,
  axisUnit,
  chartNumber,
  compactText,
  fieldHint,
  fullShown,
  fullText,
  outflowOptions,
  outflowReading,
  outflowShown,
  poolViews,
  shownNumber,
  stockReading,
  viewIsOn,
  viewUnitChoices,
  type ViewUnits,
} from './viewUnits'

const pool = (id: string, resourceType?: string): LoopNode =>
  ({ id, type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: id, resourceType } }) as unknown as LoopNode

const KINDS: ResourceKindDecl[] = [
  { name: 'water', conserved: true, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }], rateUnits: [{ name: 'MLD', factor: '1000', per: 'd' }] },
  { name: 'power', conserved: false, baseUnit: 'kWh' },
]
const NODES = [pool('feed', 'water'), pool('power', 'power'), pool('free')]
const inL = poolViews(NODES, KINDS, { water: 'L' })
const base = poolViews(NODES, KINDS, NO_VIEW_UNITS)

describe('how a Pool reads (§M4-8)', () => {
  it('starts in the base unit, and a Pool that names no unit has no entry', () => {
    expect(base.get('feed')).toEqual({ unit: 'm³', ratio: 1 })
    expect(base.get('power')).toEqual({ unit: 'kWh', ratio: 1 })
    expect(base.has('free')).toBe(false)
  })

  it('a kind has one view unit, and another kind is untouched', () => {
    expect(inL.get('feed')?.unit).toBe('L')
    expect(inL.get('feed')?.ratio).toBe(0.001)
    expect(inL.get('power')).toEqual({ unit: 'kWh', ratio: 1 })
  })

  it('a unit removed from the kind reads as the base unit at once', () => {
    const removed = KINDS.map((k) => (k.name === 'water' ? { ...k, units: undefined } : k))
    expect(poolViews(NODES, removed, { water: 'L' }).get('feed')).toEqual({ unit: 'm³', ratio: 1 })
  })

  it('an edited factor applies at once; a stale one is never kept', () => {
    const edited = KINDS.map((k) => (k.name === 'water' ? { ...k, units: [{ name: 'L', factor: '0.002' }] } : k))
    expect(poolViews(NODES, edited, { water: 'L' }).get('feed')?.ratio).toBe(0.002)
  })

  it('a rate unit never applies to a stock', () => {
    expect(poolViews(NODES, KINDS, { water: 'MLD' }).get('feed')).toEqual({ unit: 'm³', ratio: 1 })
  })

  it('a kind is offered with an amount unit and a Pool, and only then', () => {
    expect(viewUnitChoices(NODES, KINDS, { water: 'L' })).toEqual([{ kind: 'water', baseUnit: 'm³', value: 'L', options: ['L'] }])
    expect(viewUnitChoices([pool('p', 'power')], KINDS, NO_VIEW_UNITS)).toEqual([])
    expect(viewUnitChoices([pool('free')], KINDS, NO_VIEW_UNITS)).toEqual([])
  })
})

describe('the text of a number (§M4-8, R≈)', () => {
  const v = inL.get('feed')

  it('the table of the design', () => {
    expect([compactText(200, v), fullText(200, v)]).toEqual(['200000 L', '200000 L'])
    expect([compactText(499.99999999999994, v), fullText(499.99999999999994, v)]).toEqual(['≈ 500000 L', '≈ 500000 L'])
    expect([compactText(22.916666666666668, v), fullText(22.916666666666668, v)]).toEqual(['≈ 22916.7 L', '≈ 22916.6666666667 L'])
    expect([compactText(1699.999999999984, v), fullText(1699.999999999984, v)]).toEqual(['≈ 1700000 L', '≈ 1699999.99999998 L'])
  })

  it('compact keeps the whole integer part', () => {
    expect(compactText(1234.5678, v)).toBe('≈ 1234568 L')
  })

  it('a base view keeps the chart format and names the unit; no unit, no text', () => {
    expect(compactText(499.99999999999994, base.get('feed'))).toBe('500.0 m³')
    expect(fullText(125, base.get('power'))).toBe('125 kWh')
    expect(compactText(22.916666666666668, undefined)).toBe('22.9')
    expect(fullText(22.916666666666668, undefined)).toBe(chartNumber(22.916666666666668))
  })

  it('an axis mark is plain, with no residue and no ≈', () => {
    expect(axisMark(600000)).toBe('600000')
    expect(axisMark(3 * 0.1)).toBe('0.3')
    expect(axisMark(0.00000025)).toBe('0.00000025')
  })
})

describe('the chart (§M4-8)', () => {
  it('a height is the shown number; a Pool with no view is its value exactly', () => {
    expect(shownNumber(250, inL.get('feed'))).toBeCloseTo(250000, 6)
    expect(shownNumber(499.99999999999994, base.get('feed'))).toBe(499.99999999999994)
    expect(shownNumber(499.99999999999994, undefined)).toBe(499.99999999999994)
  })

  it('the axis names one shared unit, says when units differ, and is silent with none', () => {
    expect(axisUnit(['feed'], inL)).toEqual({ kind: 'one', unit: 'L' })
    expect(axisUnit(['feed', 'power'], base)).toEqual({ kind: 'mixed' })
    expect(axisUnit(['feed', 'power'], inL)).toEqual({ kind: 'mixed' })
    expect(axisUnit(['feed', 'free'], base)).toEqual({ kind: 'mixed' })
    expect(axisUnit(['free'], base)).toEqual({ kind: 'none' })
    expect(axisUnit([], base)).toEqual({ kind: 'none' })
  })

  it('the view is on only for a Pool it re-expresses', () => {
    expect(viewIsOn(['feed'], inL)).toBe(true)
    expect(viewIsOn(['power'], inL)).toBe(false)
    expect(viewIsOn(['feed', 'power'], base)).toBe(false)
  })

  it('the pad never goes below today\'s and grows for a long mark', () => {
    expect(axisPad(['0', '600'], 40)).toBe(40)
    expect(axisPad(['600000000'], 40)).toBe(71)
  })
})

describe('the two run files (§M4-8)', () => {
  const series = [
    { step: 0, values: { feed: 500, power: 125, free: 1 } },
    { step: 1, values: { feed: 499.99999999999994, power: 125, free: 1 } },
  ]
  const pools = [
    { id: 'feed', label: 'feed', unit: 'm³' },
    { id: 'power', label: 'power', unit: 'kWh' },
    { id: 'free', label: 'free' },
  ]
  const withView = (views: typeof inL) => pools.map((p) => ({ ...p, view: views.get(p.id) }))
  const rows = (csv: string) => csv.trim().split('\r\n').map((r) => r.split(','))

  it('names the added columns; the last bracket stays the id', () => {
    expect(rows(buildShownRunCsv(withView(inL), series))[0]).toEqual([
      'step',
      'feed [m³] [feed]',
      'feed (shown) [L] [feed]',
      'feed (approx) [feed]',
      'power [kWh] [power]',
      'free [free]',
    ])
  })

  it('holds the number, the step reading\'s text and the flag; no cell is blank', () => {
    const r = rows(buildShownRunCsv(withView(inL), series))
    expect(r[1]).toEqual(['0', '500', '500000', 'false', '125', '1'])
    expect(r[2]).toEqual(['1', '499.99999999999994', '≈ 500000', 'true', '125', '1'])
    expect(r.flat()).not.toContain('')
    const v = inL.get('feed')!
    expect(`${r[2][2]} L`).toBe(fullText(499.99999999999994, v))
    expect(r[2][3]).toBe(String(fullShown(499.99999999999994, v.fu!).approx))
  })

  it('without its added columns it is the plain file, byte for byte', () => {
    const shown = rows(buildShownRunCsv(withView(inL), series)).map((r) => r.filter((_, i) => i !== 2 && i !== 3).join(','))
    expect(`${shown.join('\r\n')}\r\n`).toBe(buildRunCsv(pools, series))
  })

  it('with no view on it adds nothing', () => {
    expect(buildShownRunCsv(withView(base), series)).toBe(buildRunCsv(pools, series))
  })
})

describe('the view touches nothing stored (§M4-8)', () => {
  const stored = () => {
    const g = useGraphStore.getState()
    const s = useSimStore.getState()
    return {
      file: serialize(g.nodes, g.edges, undefined, undefined, undefined, g.modelVersion, undefined, undefined, g.kinds, g.time),
      past: g.past.length,
      rev: g.simulationRev,
      series: JSON.stringify(s.series),
      values: JSON.stringify(s.values),
      step: s.stepIndex,
      status: s.status,
    }
  }

  beforeEach(() => {
    useGraphStore.setState({ nodes: NODES, edges: [], kinds: KINDS, modelVersion: 4 })
    useViewUnitsStore.setState({ views: NO_VIEW_UNITS })
  })

  it('changing it changes no document, no history and no run', () => {
    const before = stored()
    useViewUnitsStore.getState().setViewUnit('water', 'L')
    expect(useViewUnitsStore.getState().views).toEqual({ water: 'L' })
    expect(stored()).toEqual(before)
    useViewUnitsStore.getState().setViewUnit('water', '')
    expect(useViewUnitsStore.getState().views).toEqual({})
    expect(stored()).toEqual(before)
  })

  it('an ordinary edit keeps it and a whole-graph swap drops it', () => {
    useViewUnitsStore.getState().setViewUnit('water', 'L')
    useGraphStore.setState({ simulationRev: useGraphStore.getState().simulationRev + 1 })
    expect(useViewUnitsStore.getState().views).toEqual({ water: 'L' })
    useGraphStore.setState({ loadRev: useGraphStore.getState().loadRev + 1 })
    expect(useViewUnitsStore.getState().views).toEqual(NO_VIEW_UNITS)
  })
})

// SEMANTICS-M4.md §M4-9 — the Kinds panel's reading of a boundary outflow.
describe('the outflow reading', () => {
  const water = KINDS[0]!
  const hourly: DocTime = { step: { value: 1, unit: 'h' } }
  const daily: DocTime = { step: { value: 1, unit: 'd' } }
  const shown = (raw: number, reading: string, time: DocTime | undefined) =>
    outflowShown(raw, raw, outflowReading({ water: reading }, water, time), water, time)

  it('offers the rate list and the base unit per time, and with no step length only the amounts', () => {
    expect(outflowOptions(water, hourly).map(fieldUnitText)).toEqual(['', 'm³/s', 'm³/min', 'm³/h', 'm³/d', 'L', 'L/s', 'L/min', 'L/h', 'L/d', 'MLD'])
    expect(outflowOptions(water, undefined).map(fieldUnitText)).toEqual(['', 'L'])
    expect(outflowOptions({ name: 'ore', conserved: false }, hourly).map(fieldUnitText)).toEqual([''])
  })

  it('starts from time.display, and a chosen base reading stays chosen', () => {
    const shownPerDay: DocTime = { ...hourly, display: 'd' }
    expect(fieldUnitText(outflowReading({}, water, shownPerDay))).toBe('m³/d')
    expect(fieldUnitText(outflowReading({}, water, hourly))).toBe('')
    expect(fieldUnitText(outflowReading({ water: '' }, water, shownPerDay))).toBe('')
    // with no base unit name there is no base-per-time option to start from
    const unnamed: ResourceKindDecl = { name: 'ore', conserved: false, units: [{ name: 'kg', factor: '2' }] }
    expect(fieldUnitText(outflowReading({}, unnamed, shownPerDay))).toBe('')
  })

  it('reads a name no option carries as the base unit per step', () => {
    expect(fieldUnitText(outflowReading({ water: 'gal' }, water, hourly))).toBe('')
    expect(fieldUnitText(outflowReading({ water: 'MLD' }, water, undefined))).toBe('')
  })

  it('the design cases, under the §M4-5 rule', () => {
    expect(shown(100, 'L/d', hourly)).toEqual({ number: '2400000', unit: 'L/d', perStep: false })
    // 0.06 is not exact as a double, so the row is honest about it
    expect(shown(0.06, 'L/min', hourly)).toEqual({ number: '≈ 1', unit: 'L/min', perStep: false })
    expect(shown(100, 'm³/h', hourly)).toEqual({ number: '100', unit: 'm³/h', perStep: false })
    expect(shown(100, 'm³/h', daily)).toEqual({ number: '≈ 4.16666666666667', unit: 'm³/h', perStep: false })
  })

  it('re-expresses the raw sum, never the rounded amount, whose error a conversion would multiply', () => {
    const fu = outflowReading({ water: 'MLD' }, water, hourly)
    expect(outflowShown(16.666666667, 16.666666666666668, fu, water, hourly)?.number).toBe('≈ 0.4')
    expect(outflowShown(16.666666667, 16.666666667, fu, water, hourly)?.number).toBe('≈ 0.400000000008')
  })

  it('says per step where the unit is an amount, keeps the report number in the base reading, and leaves an unnamed row alone', () => {
    const base = outflowReading({}, water, hourly)
    expect(outflowShown(16.666666667, 16.666666666666668, base, water, hourly)).toEqual({ number: '16.666666667', unit: 'm³', perStep: true })
    expect(shown(2, 'L', hourly)).toEqual({ number: '2000', unit: 'L', perStep: true })
    expect(outflowShown(2, 2, { kind: 'base' }, undefined, hourly)).toBeNull()
    expect(outflowShown(2, 2, { kind: 'base' }, { name: 'ore', conserved: false }, hourly)).toBeNull()
  })

  it('is session state: another graph drops it and the Timeline choice is separate', () => {
    useViewUnitsStore.getState().setOutflowView('water', 'MLD')
    expect(useViewUnitsStore.getState().views).toEqual({})
    useGraphStore.setState({ loadRev: useGraphStore.getState().loadRev + 1 })
    expect(useViewUnitsStore.getState().outflowViews).toEqual(NO_VIEW_UNITS)
  })
})

describe('the hint under a field (§M4-10)', () => {
  const water = KINDS[0]!
  const hour: DocTime = { step: { value: 1, unit: 'h' } }
  const stock = (text: string) => resolveFieldUnit(text, water, hour, 'stock')
  const rate = (text: string) => resolveFieldUnit(text, water, hour, 'rate')
  const stockHint = (value: number | null, field: string, views: ViewUnits) => fieldHint(value, stock(field), stockReading(views, water), water, hour, 'stock')
  const rateHint = (flow: string, field: string, reading: string) => fieldHint(flow, rate(field), rate(reading), water, hour, 'rate')

  it('a stock reads in the Timeline view unit, exactly from its decimal', () => {
    expect(stockHint(200, '', { water: 'L' })).toEqual({ number: '= 200000', unit: 'L', perStep: false })
    expect(stockHint(0.1, '', { water: 'L' })).toEqual({ number: '= 100', unit: 'L', perStep: false })
  })

  it('a field in another unit reads in the base unit when no view unit is on', () => {
    expect(stockHint(200000, 'L', NO_VIEW_UNITS)).toEqual({ number: '= 200', unit: 'm³', perStep: false })
  })

  it('says nothing when the reading is the field\'s own unit', () => {
    expect(stockHint(200, '', NO_VIEW_UNITS)).toBeNull()
    expect(stockHint(200000, 'L', { water: 'L' })).toBeNull()
  })

  it('says nothing when the reading is the same scale under another name', () => {
    const named: ResourceKindDecl = { ...water, units: [{ name: 'm³', factor: '1' }], rateUnits: [{ name: 'CMD', factor: '1', per: 'd' }] }
    const cmd = resolveFieldUnit('CMD', named, hour, 'rate')
    const perDay = resolveFieldUnit('m³/d', named, hour, 'rate')
    expect(fieldHint('21000', cmd, perDay, named, hour, 'rate')).toBeNull()
  })

  it('a rate carries the time, and a value no decimal holds is marked', () => {
    expect(rateHint('0.4', 'MLD', 'L/min')).toEqual({ number: '≈ 277.777777777778', unit: 'L/min', perStep: false })
  })

  it('a rate starts from the display time, as the Kinds panel does', () => {
    const daily: DocTime = { ...hour, display: 'd' }
    expect(fieldHint('0.4', rate('MLD'), outflowReading(NO_VIEW_UNITS, water, daily), water, daily, 'rate')).toEqual({ number: '= 400', unit: 'm³/d', perStep: false })
  })

  it('an amount per step names the step, the base unit included', () => {
    expect(rateHint('0.4', 'MLD', 'L')).toEqual({ number: '≈ 16666.6666666667', unit: 'L', perStep: true })
    expect(fieldHint('0.48', rate('MLD'), { kind: 'base' }, water, hour, 'rate')).toEqual({ number: '= 20', unit: 'm³', perStep: true })
  })

  it('says nothing for a reading with no name', () => {
    const unnamed: ResourceKindDecl = { name: 'water', conserved: true, units: [{ name: 'L', factor: '0.001' }] }
    expect(fieldHint(5, resolveFieldUnit('L', unnamed, hour, 'stock'), { kind: 'base' }, unnamed, hour, 'stock')).toBeNull()
  })

  it('says nothing for what a run does not read as that number', () => {
    for (const flow of ['all', '25%', '1-3', '2D6', '@rate', '~table', '', '1e3', '-5']) expect(rateHint(flow, '', 'L/min')).toBeNull()
    expect(stockHint(null, '', { water: 'L' })).toBeNull()
  })

  it('a view unit removed from the kind reads as the base unit', () => {
    expect(stockReading({ water: 'gone' }, water)).toEqual({ kind: 'base' })
    expect(stockReading({ water: 'MLD' }, water)).toEqual({ kind: 'base' })
  })
})
