import { describe, expect, it } from 'vitest'
import { runMonteCarlo, toFinalCsv, toFinalSummaryCsv, toMonteCarloJson, toSeriesCsv } from '../engine'
import { CSV_EOL, parseDelimitedText } from './csv'
import { exportUnits, namesAUnit, NO_EXPORT_UNITS, unitsHeader, withUnit } from './exportUnits'
import type { ResourceKindDecl } from './kinds'
import { deserialize } from './serialize'
import type { LoopEdge, LoopNode } from './types'
import { readDocTime, type DocTime } from './units'
import { readWorkspace, WORKSPACE_SCHEMA, WORKSPACE_VERSION } from './workspace'

// SEMANTICS-M4.md §M4-6 (D6) — an export keeps calculation values as numbers in
// the base unit per step and names the unit beside them. The step length of a
// result file is read at `config.time.step`.

const pool = (id: string, extra: Record<string, unknown> = {}): LoopNode =>
  ({
    id,
    type: 'pool',
    position: { x: 0, y: 0 },
    data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...extra },
  }) as unknown as LoopNode

const WATER: ResourceKindDecl = { name: 'water', conserved: false, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }] }
const HOUR: DocTime = readDocTime({ step: { value: 1, unit: 'h' }, display: 'd' })!

describe('exportUnits — the table of a document', () => {
  it('a Pool of a kind with a base unit is in it, whatever unit the Pool is authored in', () => {
    const u = exportUnits([pool('a', { resourceType: 'water' }), pool('b', { resourceType: 'water', unit: 'L' })], [WATER])
    expect([...u]).toEqual([['a', 'm³'], ['b', 'm³']])
  })

  it('a Pool of no kind, of an undeclared kind, or of a kind with no base unit is not', () => {
    const u = exportUnits(
      [pool('a'), pool('b', { resourceType: 'gold' }), pool('c', { resourceType: 'iron' }), pool('d', { resourceType: 'salt', unit: 'g' })],
      [WATER, { name: 'iron', conserved: false }, { name: 'salt', conserved: false, units: [{ name: 'g', factor: '0.001' }] }],
    )
    expect(u.size).toBe(0)
  })
})

describe('the header', () => {
  it('`withUnit` leaves a name alone when no unit is named', () => {
    expect(withUnit('feed', 'm³')).toBe('feed [m³]')
    expect(withUnit('feed', '')).toBe('feed')
    expect(withUnit('feed', undefined)).toBe('feed')
  })

  it('`namesAUnit` looks only at the Pools it is given', () => {
    const u = exportUnits([pool('a', { resourceType: 'water' }), pool('b')], [WATER])
    expect(namesAUnit(u, ['a', 'b'])).toBe(true)
    expect(namesAUnit(u, ['b'])).toBe(false)
  })

  it('`unitsHeader` names each Pool once, by id', () => {
    const u = exportUnits([pool('a', { resourceType: 'water' }), pool('b')], [WATER])
    expect(unitsHeader(u, ['a', 'b'])).toEqual({ units: { a: 'm³' } })
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

const table = (csv: string): string[][] => {
  const parsed = parseDelimitedText(csv, ',')
  if (!parsed.ok) throw new Error('unreadable CSV')
  return parsed.rows
}

describe('the Monte Carlo exports of a document with units', () => {
  const tank = pool('tank', { label: 'Tank', resourceType: 'water', unit: 'L', initial: 1000 })
  const plain = pool('plain', { label: 'Plain' })
  const nodes = [tank, plain]
  const r = plantResult(nodes)
  const u = exportUnits(nodes, [WATER])

  it('reads the premise: the engine holds base units', () => {
    expect(r.final.tank.summary.max).toBe(3)
  })

  it('summary: a `unit` column and numbers in the base unit, and no other column', () => {
    const rows = table(toFinalSummaryCsv(r, u))
    expect(rows[0]).toEqual(['pool', 'unit', 'p10', 'p50', 'p90', 'mean', 'min', 'max'])
    expect(rows.find((x) => x[0] === 'Tank')).toEqual(['Tank', 'm³', '3', '3', '3', '3', '3', '3'])
  })

  it('summary and series: a Pool that names no unit in the same file has a blank unit', () => {
    expect(table(toFinalSummaryCsv(r, u)).find((x) => x[0] === 'Plain')?.[1]).toBe('')
    expect(table(toSeriesCsv(r, u)).find((x) => x[1] === 'Plain')?.[2]).toBe('')
  })

  it('series: a `unit` column', () => {
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

  it('JSON: the `loop-mc/1` numbers stay numbers, with `units` beside them by node id', () => {
    const j = JSON.parse(toMonteCarloJson(r, 6, u))
    expect(j.final.tank.summary.max).toBe(3)
    expect(j.final.tank.values).toEqual([3, 3, 3])
    expect(j.series.tank.p50.every((v: unknown) => typeof v === 'number')).toBe(true)
    expect(j.units).toEqual({ tank: 'm³' })
  })

  it('JSON: `units` is the one added key, after the frozen fields', () => {
    const keys = Object.keys(JSON.parse(toMonteCarloJson(r, 6, u)))
    expect(keys.slice(keys.indexOf('engineRevision'))).toEqual(['engineRevision', 'units'])
    expect(keys.indexOf('final')).toBeLessThan(keys.indexOf('engineRevision'))
  })

  it('JSON: the step length has one home, `config.time.step`', () => {
    const j = JSON.parse(toMonteCarloJson(r, 6, u))
    expect(j.config.time.step).toEqual({ value: 1, unit: 'h' })
    expect(j).not.toHaveProperty('time')
  })

  it('a label that repeats keeps its own unit: the table is by id', () => {
    const a = pool('tank', { label: 'Same', resourceType: 'water', unit: 'L' })
    const b = pool('b', { label: 'Same' })
    const rows = table(toFinalSummaryCsv(plantResult([a, b]), exportUnits([a, b], [WATER])))
    expect(rows.slice(1).map((x) => x[1])).toEqual(['m³', ''])
  })

  it('a label holding a comma, a quote or a newline survives beside the unit', () => {
    const label = 'a, "b"\nc'
    const a = pool('tank', { label, resourceType: 'water' })
    const rows = table(toFinalCsv(plantResult([a]), exportUnits([a], [WATER])))
    expect(rows[0][2]).toBe(`${label} [m³]`)
  })
})

// Nothing in the app reads this file back: the workspace saves the store's result,
// not this export. These pin what a reader of either file sees.
describe('the readers of a Monte Carlo result file', () => {
  const tank = pool('tank', { label: 'Tank', resourceType: 'water', unit: 'L', initial: 1000 })
  const nodes = [tank]
  const r = plantResult(nodes)
  const u = exportUnits(nodes, [WATER])
  const added = toMonteCarloJson(r, 6, u)
  const before = toMonteCarloJson(r, 6)

  it('without `units` the file is the old file, byte for byte', () => {
    const j = JSON.parse(added)
    delete j.units
    expect(JSON.stringify(j, null, 2)).toBe(before)
  })

  it('writing it leaves the result as it was, so the workspace saves what it always saved', () => {
    const snapshot = JSON.stringify(r)
    toMonteCarloJson(r, 6, u)
    toFinalSummaryCsv(r, u)
    expect(JSON.stringify(r)).toBe(snapshot)
    expect(r).not.toHaveProperty('units')
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

  it('a workspace holding the file as its result reads it as current: the added key is ignored', () => {
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
  const u = exportUnits(nodes, [])

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

  it('the JSON has neither added key', () => {
    const j = JSON.parse(toMonteCarloJson(r, null))
    expect(j).not.toHaveProperty('units')
    expect(j).not.toHaveProperty('engineRevision')
  })
})
