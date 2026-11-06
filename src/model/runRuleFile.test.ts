import { describe, expect, it } from 'vitest'
import { extractModule, insertGraph } from './moduleGraph'
import { hasRunRules, modelSemanticsLabel } from './modelVersion'
import { canonicalContent } from './revision'
import { deserialize, modelVersionForSchema, schemaForModelVersion, serialize, SCHEMA_V6 } from './serialize'
import type { LoopEdge, LoopNode } from './types'
import { canonicalGraphString } from './workspace'

// SEMANTICS-M6.md §M6-1 — a run rule in the file, the digests and a module.

const RULE = { tank: 'tank', level: '100', band: '50', side: 'fill', lowest: '0.5' }
const file = (schema: string, run: unknown = RULE) =>
  JSON.stringify({
    schema,
    version: 1,
    nodes: [
      { id: 'tank', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 10, capacity: null, mode: 'pullAny' } },
      { id: 'ro', type: 'converter', position: { x: 200, y: 0 }, data: { kind: 'converter', label: 'RO', activation: 'automatic', mode: 'pullAny', ...(run === null ? {} : { run }) } },
      { id: 'store', type: 'pool', position: { x: 400, y: 0 }, data: { kind: 'pool', label: 'Store', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    ],
    edges: [
      { id: 'in', source: 'tank', target: 'ro', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      { id: 'out', source: 'ro', target: 'store', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    ],
  })
const runOf = (nodes: readonly LoopNode[], id = 'ro') => (nodes.find((n) => n.id === id)?.data as { run?: unknown }).run

describe('the version boundary', () => {
  it('/graph/6 is version 6, and a rule needs it', () => {
    expect(modelVersionForSchema(SCHEMA_V6)).toBe(6)
    expect(schemaForModelVersion(6)).toBe(SCHEMA_V6)
    expect(hasRunRules(6)).toBe(true)
    expect(hasRunRules(5)).toBe(false)
    expect(modelSemanticsLabel(6)).toBe('loop-model/6')
  })

  it('a rule on an earlier schema is not read', () => {
    expect(runOf(deserialize(file('loop-studio/graph/5')).nodes)).toBeUndefined()
  })

  it('writing a rule below version 6 is refused, never a silent drop', () => {
    const d = deserialize(file(SCHEMA_V6))
    expect(() => serialize(d.nodes, d.edges, undefined, undefined, undefined, 5)).toThrow(/run rule/)
  })
})

describe('the file', () => {
  it('round-trips a rule in its canonical form', () => {
    const d = deserialize(file(SCHEMA_V6))
    expect(runOf(d.nodes)).toEqual(RULE)
    const again = deserialize(serialize(d.nodes, d.edges, undefined, undefined, undefined, 6))
    expect(runOf(again.nodes)).toEqual(RULE)
    expect(again.modelVersion).toBe(6)
  })

  it('a rule that means nothing refuses the file, with the stage named', () => {
    for (const bad of [{}, { ...RULE, band: '0' }, { ...RULE, side: 'up' }, { ...RULE, lowest: '2' }, 'run']) {
      expect(() => deserialize(file(SCHEMA_V6, bad))).toThrow(/"ro"/)
    }
  })

  it('a key a rule does not hold is dropped by the read', () => {
    expect(runOf(deserialize(file(SCHEMA_V6, { ...RULE, extra: 1 })).nodes)).toEqual(RULE)
  })

  it('a document with no rule writes no `run` key', () => {
    const d = deserialize(file(SCHEMA_V6, null))
    expect(serialize(d.nodes, d.edges, undefined, undefined, undefined, 6)).not.toContain('"run"')
  })
})

describe('the digests', () => {
  const graph = (run: unknown) => {
    const d = deserialize(file(SCHEMA_V6, run))
    return { nodes: d.nodes, edges: d.edges }
  }

  it('a rule moves the engine digest, and a different rule moves it again', () => {
    const none = canonicalGraphString(graph(null), 6)
    const one = canonicalGraphString(graph(RULE), 6)
    const other = canonicalGraphString(graph({ ...RULE, level: '200' }), 6)
    expect(one).not.toBe(none)
    expect(other).not.toBe(one)
  })

  it('a document with no rule keeps its bytes at version 6, but for the label', () => {
    const six = canonicalGraphString(graph(null), 6)
    const five = canonicalGraphString(graph(null), 5)
    expect(six.replace('loop-model/6', 'loop-model/5')).toBe(five)
  })

  it('the rule is in the revision content', () => {
    const g = graph(RULE)
    expect(JSON.stringify(canonicalContent(g, { modelVersion: 6 }))).toContain('"run"')
  })
})

describe('a module', () => {
  const host = { nodes: [] as LoopNode[], edges: [] as LoopEdge[], modelVersion: 6 as const }
  const mod = (rule: unknown) => {
    const d = deserialize(file(SCHEMA_V6, rule))
    return { nodes: d.nodes, edges: d.edges, modelVersion: 6 as const }
  }

  it('an insert gives a rule’s tank and line their new ids', () => {
    const r = insertGraph(host, mod({ ...RULE, table: undefined }), { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const stage = r.nodes.find((n) => n.data.kind === 'converter')!
    const tank = r.nodes.find((n) => n.data.label === 'Tank')!
    expect((stage.data as unknown as { run: { tank: string } }).run.tank).toBe(tank.id)
  })

  it('a rule that reads outside the module refuses the insert', () => {
    const r = insertGraph(host, mod({ ...RULE, tank: 'elsewhere' }), { at: { x: 0, y: 0 } })
    expect(r.ok).toBe(false)
  })

  it('a selection with a rule is a version 6 module', () => {
    const d = deserialize(file(SCHEMA_V6))
    const r = extractModule({ nodes: d.nodes, edges: d.edges, modelVersion: 6 }, d.nodes.map((n) => n.id))
    expect(r.ok && r.modelVersion).toBe(6)
  })
})
