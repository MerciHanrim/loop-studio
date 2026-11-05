// loop-model/5 (SEMANTICS-M5.md) — a timetable through the file, the digests, a
// module and the run CSV.
import { describe, expect, it } from 'vitest'
import { buildRunCsv } from '../components/timelineCsv'
import { insertGraph, extractModule } from './moduleGraph'
import { canonicalContent, canonicalJson } from './revision'
import { deserialize, GraphFileError, serialize } from './serialize'
import type { Timetable } from './timetable'
import type { LoopEdge, LoopNode } from './types'
import { canonicalGraphString } from './workspace'

const table = (over: Partial<Timetable> = {}): Timetable => ({
  id: 'intake',
  label: 'Intake',
  source: 'Example assumption',
  unit: 'CMH',
  timeUnit: 'h',
  read: 'hold',
  end: '6',
  after: 'stop',
  points: [['0', '10.50'], ['3', '20']],
  ...over,
})

const nodes = [
  { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'src', activation: 'automatic' } },
  { id: 'tank', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'tank', initial: 0, capacity: null, activation: 'automatic' } },
] as unknown as LoopNode[]
const edges = [{ id: 'in', source: 'src', target: 'tank', data: { kind: 'resource', flow: '~intake' } }] as unknown as LoopEdge[]

const write = (tables: Timetable[] | undefined, version: 4 | 5 = 5) =>
  serialize(nodes, edges, undefined, undefined, undefined, version, undefined, undefined, undefined, undefined, tables)

describe('the file', () => {
  it('writes /graph/5 with the table, decimal text kept as typed, and reads it back', () => {
    const text = write([table()])
    const raw = JSON.parse(text)
    expect(raw.schema).toBe('loop-studio/graph/5')
    expect(raw.timetables[0].points[0]).toEqual(['0', '10.50'])
    expect(deserialize(text).timetables).toEqual([table()])
  })

  it('refuses to write a table under an earlier version', () => {
    expect(() => write([table()], 4)).toThrow(/version 5/)
  })

  it('writes no key for a document with no table', () => {
    expect(JSON.parse(write(undefined)).timetables).toBeUndefined()
    expect(write(undefined, 4)).toBe(write([], 4))
  })

  it('does not read a timetables key from an earlier schema', () => {
    const raw = JSON.parse(write([table()]))
    raw.schema = 'loop-studio/graph/4'
    expect(deserialize(JSON.stringify(raw)).timetables).toEqual([])
  })

  it('an older reader has no schema to accept: /graph/6 fails closed here as /graph/5 does there', () => {
    const raw = JSON.parse(write([table()]))
    raw.schema = 'loop-studio/graph/6'
    expect(() => deserialize(JSON.stringify(raw))).toThrow(GraphFileError)
  })

  it('refuses a file with a bad table whole, naming the table and the row', () => {
    const raw = JSON.parse(write([table()]))
    raw.timetables[0].points[1][0] = '0'
    try {
      deserialize(JSON.stringify(raw))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(GraphFileError)
      expect((e as GraphFileError).code).toBe('bad-timetable')
      expect((e as GraphFileError).table).toEqual({ id: 'intake', row: 2 })
    }
  })
})

describe('the digests', () => {
  const content = (t: Timetable[], modelVersion: 4 | 5 = 5) => canonicalJson(canonicalContent({ nodes, edges, timetables: t }, { modelVersion }))

  it('a table is content: another point is another digest', () => {
    expect(content([table()])).not.toBe(content([table({ end: '7' })]))
    expect(canonicalGraphString({ nodes, edges, timetables: [table()] }, 5)).not.toBe(canonicalGraphString({ nodes, edges, timetables: [table({ end: '7' })] }, 5))
  })

  it('an earlier version and a document with no table are byte-identical to before', () => {
    expect(content([table()], 4)).toBe(content([], 4))
    expect(canonicalGraphString({ nodes, edges, timetables: [table()] }, 4)).toBe(canonicalGraphString({ nodes, edges }, 4))
    expect(content([])).not.toContain('timetables')
  })
})

describe('a module', () => {
  const host = { nodes: [], edges: [], modelVersion: 5 as const, timetables: [table()] }
  const mod = (t: Timetable) => ({ nodes, edges, modelVersion: 5 as const, timetables: [t] })

  it('joins a new table, and takes a table the host holds identically', () => {
    const fresh = insertGraph(host, mod(table({ id: 'other' })), { at: { x: 0, y: 0 } })
    expect(fresh.ok && fresh.timetables.map((t) => t.id)).toEqual(['intake', 'other'])
    const same = insertGraph(host, mod(table()), { at: { x: 0, y: 0 } })
    expect(same.ok && same.timetables.length).toBe(1)
  })

  it('is refused when an id already exists with different content', () => {
    const r = insertGraph(host, mod(table({ end: '7' })), { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('intake')
  })

  it('an extract carries the tables its lines read, and is a /graph/5 file', () => {
    const r = extractModule({ nodes, edges, modelVersion: 5, timetables: [table(), table({ id: 'unused' })] }, ['src', 'tank'])
    expect(r.ok && r.modelVersion).toBe(5)
    expect(r.ok && r.timetables?.map((t) => t.id)).toEqual(['intake'])
  })
})

describe('the run CSV', () => {
  const pools = [{ id: 'tank', label: 'tank' }]
  const series = [
    { step: 0, values: { tank: 0 } },
    { step: 1, values: { tank: 0.1 }, timetableLines: [{ edgeId: 'in', tableId: 'intake', planned: 0.30000000000000004, moved: 0.1 }] },
    { step: 2, values: { tank: 0.1 }, timetableLines: [{ edgeId: 'in', tableId: 'intake', planned: 1e-7, moved: 0 }] },
  ]

  it('adds (planned) and (moved) in the base unit per step, each the double itself', () => {
    const rows = buildRunCsv(pools, series, [{ edgeId: 'in', label: 'Intake', unit: 'm³' }]).trim().split('\r\n')
    expect(rows[0]).toBe('step,tank [tank],Intake (planned) [m³] [in],Intake (moved) [m³] [in]')
    expect(rows[1]).toBe('0,0,0,0')
    expect(rows[2]).toBe('1,0.1,0.30000000000000004,0.1')
    expect(rows[3]).toBe('2,0.1,0.0000001,0')
    expect(Number('0.30000000000000004')).toBe(series[1].timetableLines![0].planned)
  })

  it('a document with no table line keeps its file byte for byte', () => {
    expect(buildRunCsv(pools, series.slice(0, 1))).toBe(buildRunCsv(pools, series.slice(0, 1), []))
    expect(buildRunCsv(pools, series.slice(0, 1))).not.toContain('planned')
  })
})
