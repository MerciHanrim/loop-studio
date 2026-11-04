import { describe, expect, it } from 'vitest'
import { runMonteCarlo, toFinalCsv, toFinalSummaryCsv, toMonteCarloJson, toSeriesCsv } from '../engine'
import { CSV_EOL, parseDelimitedText } from './csv'
import { exportUnits, NO_EXPORT_UNITS, shownCells, shownQuantity, unitsHeader, withUnit } from './exportUnits'
import type { ResourceKindDecl } from './kinds'
import { deserialize } from './serialize'
import type { LoopEdge, LoopNode } from './types'
import { readDocTime, type DocTime } from './units'
import { readWorkspace, WORKSPACE_SCHEMA, WORKSPACE_VERSION } from './workspace'

// SEMANTICS-M4.md §M4-6 (D6) — an export keeps calculation values as numbers in
// the base unit per step, names the unit beside them, and carries a re-expressed
// value and its approximation flag separately.

const pool = (id: string, extra: Record<string, unknown> = {}): LoopNode =>
  ({
    id,
    type: 'pool',
    position: { x: 0, y: 0 },
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...extra },
  }) as unknown as LoopNode

const WATER: ResourceKindDecl = { name: 'water', conserved: false, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }] }
const HOUR: DocTime = readDocTime({ step: { value: 1, unit: 'h' } })!

describe('exportUnits — the table of a document', () => {
  it('a Pool of a kind with a base unit is in it, with its authored unit when that is not the base', () => {
    const u = exportUnits([pool('a', { resourceType: 'water' }), pool('b', { resourceType: 'water', unit: 'L' })], [WATER], HOUR)
    expect(u.pools.get('a')).toEqual({ base: 'm³' })
    expect(u.pools.get('b')?.base).toBe('m³')
    expect(u.pools.get('b')?.field).toMatchObject({ kind: 'amount' })
  })

  it('a Pool of no kind, of an undeclared kind, or of a kind with no unit is not', () => {
    const u = exportUnits(
      [pool('a'), pool('b', { resourceType: 'gold' }), pool('c', { resourceType: 'iron' })],
      [WATER, { name: 'iron', conserved: false }],
      undefined,
    )
    expect(u.pools.size).toBe(0)
  })

  it('a unit name the kind does not declare reads as the base unit (§M4-2.2)', () => {
    const u = exportUnits([pool('a', { resourceType: 'water', unit: 'gal' })], [WATER], undefined)
    expect(u.pools.get('a')).toEqual({ base: 'm³' })
  })

  it('a kind with amount units but no base unit keeps the authored unit and names no base', () => {
    const kind: ResourceKindDecl = { name: 'water', conserved: false, units: [{ name: 'L', factor: '0.001' }] }
    const u = exportUnits([pool('a', { resourceType: 'water', unit: 'L' })], [kind], undefined)
    expect(u.pools.get('a')?.base).toBe('')
    expect(shownQuantity(2, 'a', u)).toEqual({ value: 2, unit: '', approx: false, display: '2000 L' })
  })
})

describe('the shown form (§M4-5, §M4-6)', () => {
  const u = exportUnits([pool('a', { resourceType: 'water', unit: 'L' }), pool('b', { resourceType: 'water' })], [WATER], HOUR)

  it('keeps the number and its unit, and adds the R≈ text in the authored unit', () => {
    expect(shownQuantity(200, 'a', u)).toEqual({ value: 200, unit: 'm³', approx: false, display: '200000 L' })
  })

  it('marks a float residue as an approximation and never prints an exponent', () => {
    const q = shownQuantity(1699.999999999984, 'a', u)!
    expect(q.value).toBe(1699.999999999984)
    expect(q.approx).toBe(true)
    expect(q.display).toBe('≈ 1699999.99999998 L')
  })

  it('a Pool in the base unit has no shown form: its number already is the value', () => {
    expect(shownQuantity(200, 'b', u)).toBeNull()
    expect(shownCells(200, 'b', u)).toEqual(['', ''])
  })

  it('the flag is a separate cell, so the text is the only place `≈` appears', () => {
    expect(shownCells(1699.999999999984, 'a', u)).toEqual(['≈ 1699999.99999998 L', 'true'])
    expect(shownCells(200, 'a', u)).toEqual(['200000 L', 'false'])
  })
})

describe('the header', () => {
  it('`withUnit` leaves a name alone when no unit is named', () => {
    expect(withUnit('feed', 'm³')).toBe('feed [m³]')
    expect(withUnit('feed', '')).toBe('feed')
    expect(withUnit('feed', undefined)).toBe('feed')
  })

  it('`unitsHeader` names each Pool once by id, and the step length without the display unit', () => {
    const time = readDocTime({ step: { value: 1, unit: 'h' }, display: 'd' })!
    const u = exportUnits([pool('a', { resourceType: 'water' }), pool('b')], [WATER], time)
    expect(unitsHeader(u, ['a', 'b'])).toEqual({ units: { a: 'm³' }, time: { step: { value: 1, unit: 'h' } } })
  })

  it('has no key with nothing to say', () => {
    expect(unitsHeader(NO_EXPORT_UNITS, ['a'])).toEqual({})
  })
})

// a Source feeding 500 L a step into a Pool authored in L: the engine reads
// 0.5 m³, so every exported number below is in m³
const source: LoopNode = {
  id: 'src',
  type: 'source',
  position: { x: 0, y: 0 },
  data: { kind: 'source', label: 'src', activation: 'automatic', mode: 'pushAny' },
} as unknown as LoopNode
const feed: LoopEdge = {
  id: 'e',
  source: 'src',
  target: 'tank',
  sourceHandle: 'out',
  targetHandle: 'in',
  type: 'loop',
  data: { kind: 'resource', flow: '500', unit: 'L', resourceType: 'water' },
} as unknown as LoopEdge

function plantResult(nodes: LoopNode[]) {
  return runMonteCarlo([source, ...nodes], [feed], { runs: 3, steps: 4, baseSeed: 1, tracked: [], kinds: [WATER], time: HOUR })
}

describe('the Monte Carlo exports of a document with units', () => {
  const tank = pool('tank', { label: 'Tank', resourceType: 'water', unit: 'L', initial: 1000 })
  const plain = pool('plain', { label: 'Plain' })
  const nodes = [tank, plain]
  const r = plantResult(nodes)
  const u = exportUnits(nodes, [WATER], HOUR)
  const table = (csv: string): string[][] => {
    const parsed = parseDelimitedText(csv, ',')
    if (!parsed.ok) throw new Error('unreadable CSV')
    return parsed.rows
  }

  it('reads the premise: the engine holds base units', () => {
    expect(r.final.tank.summary.max).toBe(3)
  })

  it('summary: a `unit` column, numbers in the base unit, each figure beside its shown form', () => {
    const rows = table(toFinalSummaryCsv(r, u))
    expect(rows[0].slice(0, 5)).toEqual(['pool', 'unit', 'p10', 'p10 (shown)', 'p10 (approx)'])
    expect(rows[0]).toHaveLength(2 + 6 * 3)
    const tankRow = rows.find((x) => x[0] === 'Tank')!
    const max = rows[0].indexOf('max')
    expect(tankRow.slice(1, 2)).toEqual(['m³'])
    expect(tankRow.slice(max, max + 3)).toEqual(['3', '3000 L', 'false'])
  })

  it('summary: a Pool in the base unit in the same file has blank shown cells and a blank unit', () => {
    const rows = table(toFinalSummaryCsv(r, u))
    const plainRow = rows.find((x) => x[0] === 'Plain')!
    expect(plainRow[1]).toBe('')
    expect(plainRow[rows[0].indexOf('max (shown)')]).toBe('')
    expect(plainRow[rows[0].indexOf('max (approx)')]).toBe('')
  })

  it('series: a `unit` column and no shown form, because a series stays plain values', () => {
    const rows = table(toSeriesCsv(r, u))
    expect(rows[0]).toEqual(['step', 'pool', 'unit', 'p10', 'p50', 'p90', 'mean', 'min', 'max'])
    expect(rows.find((x) => x[0] === '4' && x[1] === 'Tank')?.slice(2, 4)).toEqual(['m³', '3'])
  })

  it('runs: the unit is in the column name and the cells stay numbers', () => {
    const rows = table(toFinalCsv(r, u))
    expect(rows[0]).toEqual(['run', 'seed', 'Tank [m³]', 'Plain'])
    expect(rows[1][2]).toBe('3')
  })

  it('no numeric cell of any CSV carries `≈` or a unit', () => {
    for (const csv of [toSeriesCsv(r, u), toFinalCsv(r, u), toFinalSummaryCsv(r, u)]) {
      const rows = table(csv)
      rows[0].forEach((name, c) => {
        if (/^(p10|p50|p90|mean|min|max)$/.test(name) || /\[m³\]$/.test(name)) {
          for (const row of rows.slice(1)) expect(row[c], `${name}: ${row[c]}`).toMatch(/^-?[\d.]+(e[+-]?\d+)?$/)
        }
      })
    }
  })

  it('JSON: the `loop-mc/1` numbers stay numbers, with a header and a shown object beside them', () => {
    const j = JSON.parse(toMonteCarloJson(r, 6, u))
    expect(j.final.tank.summary.max).toBe(3)
    expect(j.final.tank.values).toEqual([3, 3, 3])
    expect(j.series.tank.p50.every((v: unknown) => typeof v === 'number')).toBe(true)
    expect(j.units).toEqual({ tank: 'm³' })
    expect(j.time).toEqual({ step: { value: 1, unit: 'h' } })
    expect(j.shown.tank.max).toEqual({ value: 3, unit: 'm³', approx: false, display: '3000 L' })
    expect(Object.keys(j.shown)).toEqual(['tank'])
  })

  it('JSON: the added keys follow the frozen fields', () => {
    const keys = Object.keys(JSON.parse(toMonteCarloJson(r, 6, u)))
    expect(keys.slice(keys.indexOf('engineRevision'))).toEqual(['engineRevision', 'units', 'time', 'shown'])
    expect(keys.indexOf('final')).toBeLessThan(keys.indexOf('engineRevision'))
  })

  it('a label that repeats keeps its own unit: the table is by id', () => {
    const a = pool('tank', { label: 'Same', resourceType: 'water', unit: 'L' })
    const b = pool('b', { label: 'Same' })
    const rows = table(toFinalSummaryCsv(plantResult([a, b]), exportUnits([a, b], [WATER], HOUR)))
    expect(rows.slice(1).map((x) => x[1])).toEqual(['m³', ''])
  })

  it('a label holding a comma, a quote or a newline survives beside the unit', () => {
    const label = 'a, "b"\nc'
    const a = pool('tank', { label, resourceType: 'water' })
    const rows = table(toFinalCsv(plantResult([a]), exportUnits([a], [WATER], HOUR)))
    expect(rows[0][2]).toBe(`${label} [m³]`)
  })
})

// Nothing in the app reads this file back: the workspace saves the store's result,
// not this export. These pin what a reader of either file sees.
describe('the readers of a Monte Carlo result file', () => {
  const tank = pool('tank', { label: 'Tank', resourceType: 'water', unit: 'L', initial: 1000 })
  const nodes = [tank]
  const r = plantResult(nodes)
  const u = exportUnits(nodes, [WATER], HOUR)
  const added = toMonteCarloJson(r, 6, u)
  const before = toMonteCarloJson(r, 6)

  it('without the added keys the file is the old file, byte for byte', () => {
    const j = JSON.parse(added)
    delete j.units
    delete j.time
    delete j.shown
    expect(JSON.stringify(j, null, 2)).toBe(before)
  })

  it('writing it leaves the result as it was, so the workspace saves what it always saved', () => {
    const snapshot = JSON.stringify(r)
    toMonteCarloJson(r, 6, u)
    toFinalSummaryCsv(r, u)
    expect(JSON.stringify(r)).toBe(snapshot)
    expect(r).not.toHaveProperty('units')
    expect(r).not.toHaveProperty('shown')
  })

  it('File ▸ Open refuses the old file and the new one the same way: neither is a graph', () => {
    const refusal = (text: string) => {
      try {
        deserialize(text)
      } catch (e) {
        return (e as Error).message
      }
      return null
    }
    expect(refusal(before)).not.toBeNull()
    expect(refusal(added)).toBe(refusal(before))
  })

  it('a workspace holding the file as its result reads the same numbers: the added keys are ignored', () => {
    const digest = 'a'.repeat(64)
    const read = (text: string) =>
      readWorkspace(
        { schema: WORKSPACE_SCHEMA, version: WORKSPACE_VERSION, mc: { config: r.config, result: JSON.parse(text), resultGraphDigest: digest, engineRevision: 6 } },
        { nodes: [source, ...nodes], edges: [feed] },
        digest,
        6,
      )
    const a = read(added)
    expect(a.warnings).toEqual(read(before).warnings)
    expect(a.restored?.result?.stale).toBe(false)
    expect((a.restored?.result?.result as typeof r).final.tank.summary.max).toBe(3)
  })
})

describe('a document that names no unit writes what it always wrote', () => {
  const nodes = [pool('tank', { label: 'Tank' })]
  const r = runMonteCarlo(
    [source, ...nodes],
    [{ ...feed, data: { kind: 'resource', flow: '2' } } as unknown as LoopEdge],
    { runs: 3, steps: 2, baseSeed: 1, tracked: [] },
  )
  const u = exportUnits(nodes, [], undefined)

  it('every writer gives the same bytes with the empty table as with no argument', () => {
    expect(toSeriesCsv(r, u)).toBe(toSeriesCsv(r))
    expect(toFinalCsv(r, u)).toBe(toFinalCsv(r))
    expect(toFinalSummaryCsv(r, u)).toBe(toFinalSummaryCsv(r))
    expect(toMonteCarloJson(r, 6, u)).toBe(toMonteCarloJson(r, 6))
  })

  it('the headers are the ones this product has always written', () => {
    expect(toSeriesCsv(r).split(CSV_EOL)[0]).toBe('step,pool,p10,p50,p90,mean,min,max')
    expect(toFinalCsv(r).split(CSV_EOL)[0]).toBe('run,seed,Tank')
    expect(toFinalSummaryCsv(r).split(CSV_EOL)[0]).toBe('pool,p10,p50,p90,mean,min,max')
  })

  it('the JSON has none of the added keys', () => {
    const j = JSON.parse(toMonteCarloJson(r, null))
    expect(Object.keys(j)).not.toEqual(expect.arrayContaining(['units']))
    expect(j).not.toHaveProperty('time')
    expect(j).not.toHaveProperty('shown')
    expect(j).not.toHaveProperty('engineRevision')
  })
})
