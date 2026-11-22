// Review M1 — what content needs of its model-semantics version is one rule,
// `modelVersionNeeds`: `serialize` refuses below it, and `minimumModelVersion`
// (the extract's choice) is exactly the lowest version `serialize` accepts.
import { describe, expect, it } from 'vitest'
import { minimumModelVersion, serialize, type ModelSemanticsVersion } from './serialize'
import type { Timetable } from './timetable'
import type { LoopEdge, LoopNode } from './types'

const nodes = [
  { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'src', activation: 'automatic' } },
  { id: 'tank', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'tank', initial: 0, capacity: null, activation: 'automatic', resourceType: 'water' } },
] as unknown as LoopNode[]
const plainEdges = [{ id: 'in', source: 'src', target: 'tank', data: { kind: 'resource', flow: '3' } }] as unknown as LoopEdge[]
const tableEdges = [{ id: 'in', source: 'src', target: 'tank', data: { kind: 'resource', flow: '~intake' } }] as unknown as LoopEdge[]
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
const kinds = [{ name: 'water', conserved: false }]

type Content = Parameters<typeof minimumModelVersion>[0]
const write = (c: Content, v: ModelSemanticsVersion) =>
  serialize([...c.nodes], [...c.edges], undefined, undefined, undefined, v, undefined, undefined, c.kinds, c.time, c.timetables)

const CASES: { name: string; content: Content; version: ModelSemanticsVersion }[] = [
  { name: 'a plain graph', content: { nodes, edges: plainEdges }, version: 1 },
  { name: 'a kinds table', content: { nodes, edges: plainEdges, kinds }, version: 3 },
  { name: 'a step length', content: { nodes, edges: plainEdges, kinds, time: { step: { value: 1, unit: 'h' } } }, version: 4 },
  { name: 'a plan timetable', content: { nodes, edges: tableEdges, timetables: [table()] }, version: 5 },
  { name: 'a table of what a line can move', content: { nodes, edges: tableEdges, timetables: [table({ means: 'available' })] }, version: 7 },
]

describe('minimumModelVersion is the lowest version serialize writes', () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.version}`, () => {
      expect(minimumModelVersion(c.content)).toBe(c.version)
      expect(() => write(c.content, c.version)).not.toThrow()
      if (c.version > 1) expect(() => write(c.content, (c.version - 1) as ModelSemanticsVersion)).toThrow(/needs? model-semantics version/)
    })
  }

  it('the floor a caller passes is kept when the content needs less', () => {
    expect(minimumModelVersion({ nodes, edges: plainEdges }, 2)).toBe(2)
    expect(minimumModelVersion({ nodes, edges: tableEdges, timetables: [table({ means: 'available' })] }, 2)).toBe(7)
  })
})
