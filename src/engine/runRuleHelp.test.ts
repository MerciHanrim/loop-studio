// The numbers of Help ▸ How a run rule reads a tank, read from the engine's own plan.
import { describe, expect, it } from 'vitest'
import type { ResourceKindDecl } from '../model/kinds'
import { planRuns } from '../model/runRule'
import type { Timetable } from '../model/timetable'
import type { LoopEdge, LoopNode } from '../model/types'
import type { DocTime } from '../model/units'

const kinds = [{ name: 'water', conserved: false, baseUnit: 'm³', rateUnits: [{ name: 'CMH', factor: '1', per: 'h' }] }] as ResourceKindDecl[]
const time = { step: { value: 1, unit: 'h' } } as DocTime
const tank = { id: 'tank', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'tank', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', resourceType: 'water' } } as unknown as LoopNode
const stage = (run: object) => ({ id: 'ro', type: 'converter', position: { x: 0, y: 0 }, data: { kind: 'converter', label: 'ro', activation: 'automatic', mode: 'pullAny', run } }) as unknown as LoopNode
const made = { id: 'made', source: 'ro', target: 'tank', data: { kind: 'resource', flow: '100', unit: 'CMH' } } as unknown as LoopEdge
const table: Timetable = { id: 'demand', label: 'Demand', source: 't', unit: 'CMH', timeUnit: 'h', read: 'hold', after: 'hold', end: '10', points: [['0', '25']] }

const target = (run: object, value: number) => planRuns([tank, stage(run)], [made], [table], kinds, time, { tank: value }, 1, 6).targets.ro

describe('the help text', () => {
  const fill = { tank: 'tank', level: '1500', band: '1500', side: 'fill' }

  it('a level of 1500 and a band of 1500: a tank at 750 asks for 50 %, an empty tank for 100 %', () => {
    expect(target(fill, 750)).toBe(0.5)
    expect(target(fill, 0)).toBe(1)
  })

  it('on the Empty side the run rises when the tank is above the level', () => {
    const empty = { ...fill, side: 'empty' }
    expect(target(empty, 2250)).toBe(0.5)
    expect(target(empty, 750)).toBe(0)
  })

  it('against a line of 100 per hour, a table at 25 per hour asks for 25 %', () => {
    expect(target({ table: 'demand', rated: 'made' }, 0)).toBe(0.25)
  })

  it('a Lowest run turns the stage off when the rule asks for less', () => {
    expect(target({ table: 'demand', rated: 'made', lowest: '0.5' }, 0)).toBe(0)
  })
})
