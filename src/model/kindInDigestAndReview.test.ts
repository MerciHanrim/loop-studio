import { describe, expect, it } from 'vitest'
import { initSim, step } from '../engine'
import { canonicalContent, computeRevisionDiff, fieldTag } from './revision'
import { modelKey } from './runGuide'
import { deserialize } from './serialize'
import { canonicalGraphString } from './workspace'

// Review finding M2 (2026-11-15; reproduced 2026-11-21 on main d928365a):
// the engine reads a Pool's kind (`resourceType`) and a resource connection's
// kind from loop-model/3 (SEMANTICS-M3.md §M3-2: a Pool end gives the line its
// kind, else the line's own annotation), and a Pool's unit from loop-model/4.
// A kind change can refuse a run (a conserved kind no longer balances) or make
// the same unit mean another amount. But the engine-relevant projection
// (`canonicalGraphString`, behind the semantic digest that binds a Monte Carlo
// result and behind `modelKey`) left `resourceType` out, and the review tagged
// a Pool's kind, a Pool's unit and a connection's kind `advisory` — "changes
// no computed value" — whatever the version.
//
// The rule (Lumi, 2026-11-21): the digest and the review tags follow what the
// engine reads at the document's version. From 3: a Pool's and a resource
// connection's kind. From 4: a Pool's unit (already in the projection). Before
// that they stay as they were. A Source's kind (no layer reads it) and a
// Parameter's display unit stay out.

type Kind = { name: string; conserved: boolean; baseUnit?: string; units?: { name: string; factor: string }[] }
const KINDS: Kind[] = [
  { name: 'water', conserved: false, baseUnit: 'm³', units: [{ name: 'L', factor: '0.001' }] },
  { name: 'juice', conserved: false, baseUnit: 'L' },
]

/** Pool T (500, unit L) drained by 1 per step; a Parameter P; one Source S feeding T */
function doc(o: { version: number; poolKind?: string; poolUnit?: string; lineKind?: string; sourceKind?: string; paramUnit?: string }): string {
  const schema = o.version === 1 ? 'loop-studio/graph' : `loop-studio/graph/${o.version}`
  return JSON.stringify({
    schema,
    version: 1,
    layoutVersion: 1,
    ...(o.version >= 3 ? { kinds: KINDS } : {}),
    nodes: [
      { id: 'T', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Tank', activation: 'passive', initial: 500, capacity: null, mode: 'pullAny', ...(o.poolKind ? { resourceType: o.poolKind } : {}), ...(o.poolUnit ? { unit: o.poolUnit } : {}) } },
      { id: 'D', type: 'drain', position: { x: 200, y: 0 }, data: { kind: 'drain', label: 'Tap', activation: 'automatic', mode: 'pullAny' } },
      { id: 'S', type: 'source', position: { x: -200, y: 0 }, data: { kind: 'source', label: 'Spring', activation: 'automatic', mode: 'pullAny', ...(o.sourceKind ? { resourceType: o.sourceKind } : {}) } },
      { id: 'P', type: 'parameter', position: { x: 0, y: 200 }, data: { kind: 'parameter', label: 'Rate', value: 1, ...(o.paramUnit ? { unit: o.paramUnit } : {}) } },
    ],
    edges: [
      { id: 'e', source: 'T', target: 'D', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
      { id: 'f', source: 'S', target: 'D', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '0', ...(o.lineKind ? { resourceType: o.lineKind } : {}) } },
    ],
  })
}

const read = (text: string) => deserialize(text)
const graphOf = (d: ReturnType<typeof read>) => ({ nodes: d.nodes, edges: d.edges, kinds: d.kinds, time: d.time, timetables: d.timetables })
const projection = (text: string) => { const d = read(text); return canonicalGraphString(graphOf(d), d.modelVersion as never) }
const key = (text: string) => { const d = read(text); return modelKey(graphOf(d), d.modelVersion as never) }
const content = (text: string) => { const d = read(text); return canonicalContent(d as never, { modelVersion: d.modelVersion as never }) }
const review = (a: string, b: string) => {
  const diff = computeRevisionDiff(content(a), content(b))
  return {
    tags: [...diff.nodes.changed, ...diff.edges.changed].flatMap((c) => c.fields.map((f) => `${c.id}.${f.field}=${f.tag}`)),
    engineAffecting: diff.summary.engineAffecting,
    advisoryAffecting: diff.summary.advisoryAffecting,
  }
}
/** the Pool's value after `n` steps, through the real engine */
function tankAfter(text: string, n = 5): number {
  const d = read(text)
  const o = { kinds: d.kinds, time: d.time, timetables: d.timetables }
  let s = initSim(d.nodes, o)
  for (let i = 0; i < n; i++) s = step(d.nodes, d.edges, s, 1, d.modelVersion as never, o).state
  return s.values.T
}

describe('a Pool\'s kind, where the engine reads it (loop-model/3 and later)', () => {
  const water = doc({ version: 4, poolKind: 'water', poolUnit: 'L' })
  const juice = doc({ version: 4, poolKind: 'juice', poolUnit: 'L' })

  it('precondition: the engine computes another run (the same 500 L is 0.5 m³ of water, 500 L of juice)', () => {
    expect(tankAfter(water)).toBe(0)
    expect(tankAfter(juice)).toBe(495)
  })

  it('the engine-relevant projection (semantic digest) and modelKey see it', () => {
    expect(projection(juice)).not.toBe(projection(water))
    expect(key(juice)).not.toBe(key(water))
  })

  it('the review tags it engine, and the change is engine-affecting', () => {
    expect(review(water, juice)).toEqual({ tags: ['T.data.resourceType=engine'], engineAffecting: true, advisoryAffecting: false })
  })

  it('at loop-model/3 too (kinds read, no units)', () => {
    const a = doc({ version: 3, poolKind: 'water' })
    const b = doc({ version: 3, poolKind: 'juice' })
    expect(projection(b)).not.toBe(projection(a))
    expect(review(a, b)).toEqual({ tags: ['T.data.resourceType=engine'], engineAffecting: true, advisoryAffecting: false })
  })

  it('a kind written with other spacing is the same kind: the projection does not move', () => {
    const a = doc({ version: 3, poolKind: 'water' })
    const b = doc({ version: 3, poolKind: '  water ' })
    expect(projection(b)).toBe(projection(a))
  })
})

describe('a resource connection\'s kind, where the engine reads it (loop-model/3 and later)', () => {
  it('the projection and modelKey see it; the review tags it engine', () => {
    const a = doc({ version: 3, lineKind: 'water' })
    const b = doc({ version: 3, lineKind: 'juice' })
    expect(projection(b)).not.toBe(projection(a))
    expect(key(b)).not.toBe(key(a))
    expect(review(a, b)).toEqual({ tags: ['f.data.resourceType=engine'], engineAffecting: true, advisoryAffecting: false })
  })
})

describe('fieldTag: only a Pool\'s and a RESOURCE connection\'s kind become engine (Lumi, #598 review)', () => {
  it('a resource connection\'s kind is engine from 3; a connection with no data kind reads as a resource line, as the engine reads it', () => {
    expect(fieldTag('edge', 'data.resourceType', { modelVersion: 3, dataKind: 'resource' })).toBe('engine')
    expect(fieldTag('edge', 'data.resourceType', { modelVersion: 4 })).toBe('engine')
  })

  it('a state connection\'s kind is not: it stays advisory at every version', () => {
    for (const modelVersion of [1, 2, 3, 4, 7]) expect(fieldTag('edge', 'data.resourceType', { modelVersion, dataKind: 'state' }), `v${modelVersion}`).toBe('advisory')
  })

  it('a node that is not a Pool: its kind and its unit stay advisory', () => {
    for (const dataKind of ['source', 'drain', 'gate', 'converter', 'parameter', 'register']) {
      expect(fieldTag('node', 'data.resourceType', { modelVersion: 7, dataKind }), dataKind).toBe('advisory')
      expect(fieldTag('node', 'data.unit', { modelVersion: 7, dataKind }), dataKind).toBe('advisory')
    }
  })

  it('below 3, and with no version given, a resource connection\'s and a Pool\'s kind stay advisory', () => {
    expect(fieldTag('edge', 'data.resourceType', { modelVersion: 2, dataKind: 'resource' })).toBe('advisory')
    expect(fieldTag('node', 'data.resourceType', { modelVersion: 2, dataKind: 'pool' })).toBe('advisory')
    expect(fieldTag('edge', 'data.resourceType')).toBe('advisory')
    expect(fieldTag('node', 'data.unit')).toBe('advisory')
  })
})

describe('a Pool\'s unit, where the engine reads it (loop-model/4 and later)', () => {
  it('the review tags it engine (the projection already carried it)', () => {
    const a = doc({ version: 4, poolKind: 'water', poolUnit: 'L' })
    const b = doc({ version: 4, poolKind: 'water' })
    expect(projection(b)).not.toBe(projection(a))
    expect(review(a, b)).toEqual({ tags: ['T.data.unit=engine'], engineAffecting: true, advisoryAffecting: false })
  })
})

describe('what stays as it was', () => {
  it('before loop-model/3 a Pool\'s and a connection\'s kind are not read: the projection does not move, the review says advisory', () => {
    for (const version of [1, 2]) {
      const a = doc({ version, poolKind: 'water', lineKind: 'water' })
      const b = doc({ version, poolKind: 'juice', lineKind: 'juice' })
      expect(projection(b), `v${version}`).toBe(projection(a))
      expect(review(a, b), `v${version}`).toEqual({ tags: ['T.data.resourceType=advisory', 'f.data.resourceType=advisory'], engineAffecting: false, advisoryAffecting: true })
    }
  })

  it('a document with no kind on any Pool or line keeps its projection bytes (nothing is added)', () => {
    const text = doc({ version: 4 })
    expect(projection(text)).not.toContain('resourceType')
  })

  it('a Parameter\'s display unit stays advisory', () => {
    const a = doc({ version: 4, paramUnit: 'L' })
    const b = doc({ version: 4, paramUnit: 'kg' })
    expect(projection(b)).toBe(projection(a))
    expect(review(a, b)).toEqual({ tags: ['P.data.unit=advisory'], engineAffecting: false, advisoryAffecting: true })
  })

  it('a Source\'s kind is read by no layer: no projection, no review change, the same run', () => {
    const a = doc({ version: 4, sourceKind: 'water' })
    const b = doc({ version: 4, sourceKind: 'juice' })
    expect(projection(b)).toBe(projection(a))
    expect(review(a, b)).toEqual({ tags: [], engineAffecting: false, advisoryAffecting: false })
    expect(tankAfter(b)).toBe(tankAfter(a))
  })
})
