import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from './types'
import { deserialize, modelVersionForSchema, SCHEMA_V2, SCHEMA_V3, schemaForModelVersion, serialize } from './serialize'
import { canonicalContent, canonicalJson, digestOfCanonical, readRevisionSide } from './revision'
import { canonicalGraphString } from './workspace'
import { extractModule, insertGraph } from './moduleGraph'

// loop-model/3 (SEMANTICS-M3.md §M3-1, §M3-6) — the file and digest boundary of
// the kinds table: `loop-studio/graph/3` reads and writes it, an earlier
// schema never reads it, the projections carry it only at version 3, and a
// module brings its declared kinds into the host.

const XY = { x: 0, y: 0 }
const pool = (id: string, resourceType?: string): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...(resourceType ? { resourceType } : {}) } as LoopNode['data'],
})
const res = (id: string, s: string, t: string, flow = '1'): LoopEdge => ({
  id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow } } as LoopEdge)
const KINDS = [{ name: 'water', conserved: true, baseUnit: 'm³' }, { name: 'power', conserved: false }]
const graph = () => ({ nodes: [pool('a', 'water'), pool('b', 'water')], edges: [res('e', 'a', 'b', '2')] })

describe('the envelope (§M3-1)', () => {
  it('schema 3 is readable and writable; a table is written after dataImports, in its read form, and round-trips', () => {
    expect(modelVersionForSchema(SCHEMA_V3)).toBe(3)
    expect(schemaForModelVersion(3)).toBe(SCHEMA_V3)
    const g = graph()
    const text = serialize(g.nodes, g.edges, undefined, undefined, undefined, 3, undefined, undefined, [
      { name: ' water ', conserved: true, baseUnit: 'm³' },
      { name: 'power', conserved: false },
    ])
    const keys = Object.keys(JSON.parse(text) as object)
    expect(keys.indexOf('kinds')).toBeGreaterThan(keys.indexOf('edges'))
    const back = deserialize(text)
    expect(back.modelVersion).toBe(3)
    expect(back.kinds).toEqual(KINDS)
  })

  it('an empty table writes no key, and a version-2 file is byte-identical with or without the argument', () => {
    const g = graph()
    const plain = serialize(g.nodes, g.edges, undefined, undefined, undefined, 2)
    expect(serialize(g.nodes, g.edges, undefined, undefined, undefined, 2, undefined, undefined, [])).toBe(plain)
    expect(serialize(g.nodes, g.edges, undefined, undefined, undefined, 3, undefined, undefined, [])).not.toContain('"kinds"')
  })

  it('a non-empty table under version 2 is refused, not dropped (M3-INV-1)', () => {
    const g = graph()
    expect(() => serialize(g.nodes, g.edges, undefined, undefined, undefined, 2, undefined, undefined, KINDS)).toThrow(/version 3/)
  })

  it('a `kinds` key on a /graph/2 file is not read; a /graph/3 file without one has an empty table', () => {
    const g = graph()
    const v2 = JSON.parse(serialize(g.nodes, g.edges, undefined, undefined, undefined, 2)) as Record<string, unknown>
    v2.kinds = KINDS
    const back = deserialize(JSON.stringify(v2))
    expect(back.modelVersion).toBe(2)
    expect(back.kinds).toEqual([])
    const v3 = deserialize(serialize(g.nodes, g.edges, undefined, undefined, undefined, 3))
    expect(v3.modelVersion).toBe(3)
    expect(v3.kinds).toEqual([])
    expect(JSON.parse(serialize(g.nodes, g.edges, undefined, undefined, undefined, 2)).schema).toBe(SCHEMA_V2)
  })
})

describe('the projections (§M3-6)', () => {
  it('canonicalContent carries `kinds` before `modelSemantics` at version 3 only; two tables hash differently', () => {
    const g = graph()
    const v3 = canonicalContent({ ...g, kinds: KINDS }, { modelVersion: 3 })
    const keys = Object.keys(v3)
    expect(keys.slice(-2)).toEqual(['kinds', 'modelSemantics'])
    expect(v3.modelSemantics).toBe('loop-model/3')
    expect(v3.kinds).toEqual(KINDS)
    expect(canonicalContent({ ...g, kinds: KINDS }, { modelVersion: 2 }).kinds).toBeUndefined()
    expect(canonicalContent({ ...g, kinds: [] }, { modelVersion: 3 }).kinds).toBeUndefined()
    const other = canonicalContent({ ...g, kinds: [{ name: 'water', conserved: false }] }, { modelVersion: 3 })
    expect(digestOfCanonical(other)).not.toBe(digestOfCanonical(v3))
    // the v3 projection without a table differs from v2 only by the discriminator
    expect(canonicalJson(canonicalContent(g, { modelVersion: 3 }))).toBe(
      canonicalJson(canonicalContent(g, { modelVersion: 2 })).replace('loop-model/2', 'loop-model/3'),
    )
  })

  it('canonicalGraphString (the Workspace / Monte Carlo digest) carries the table at version 3 only', () => {
    const g = graph()
    expect(canonicalGraphString({ ...g, kinds: KINDS }, 3)).toContain('"kinds":')
    expect(canonicalGraphString({ ...g, kinds: KINDS }, 2)).toBe(canonicalGraphString(g, 2))
    expect(canonicalGraphString({ ...g, kinds: KINDS }, 3)).not.toBe(canonicalGraphString(g, 3))
  })

  it('a /graph/3 revision side verifies against the digest projected at its declared version, table included', () => {
    const g = { ...graph(), kinds: KINDS }
    const digest = digestOfCanonical(canonicalContent(g, { modelVersion: 3 }))
    const side = readRevisionSide(g, digest, 3)
    expect(side.ok).toBe(true)
    if (!side.ok) return
    expect(side.digestVerified).toBe(true)
    expect(side.content.kinds).toEqual(KINDS)
    expect(side.content.modelSemantics).toBe('loop-model/3')
    // projected at 2 it would never match — the declared version is what verifies
    const at2 = digestOfCanonical(canonicalContent(g, { modelVersion: 2 }))
    expect(readRevisionSide(g, at2, 3).ok).toBe(false)
  })
})

describe('modules (docs/module-system.md §MS3.4 under loop-model/3)', () => {
  it('a /graph/3 module lifts a v2 host to 3 and brings the kinds the host did not declare; a v3 host is not promoted', () => {
    const host = { nodes: [pool('h', 'power')], edges: [], modelVersion: 2 as const, kinds: [] }
    const mod = { ...graph(), modelVersion: 3 as const, kinds: KINDS }
    const r = insertGraph(host, mod, { at: XY })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.modelVersion).toBe(3)
    expect(r.promotedTo).toBe(3)
    expect(r.kinds).toEqual(KINDS)
    const host3 = { ...host, modelVersion: 3 as const, kinds: [{ name: 'water', conserved: false }] }
    const r3 = insertGraph(host3, mod, { at: XY })
    expect(r3.ok).toBe(true)
    if (!r3.ok) return
    expect(r3.promotedTo).toBe(null)
    expect(r3.kinds).toEqual([{ name: 'water', conserved: false }, { name: 'power', conserved: false }]) // the host's word wins
  })

  it('extracting a selection keeps only the declared kinds it names, and such a module is a /graph/3 file', () => {
    const src = { nodes: [pool('a', 'water'), pool('b', 'water'), pool('c', 'power')], edges: [res('e', 'a', 'b')], modelVersion: 3 as const, kinds: KINDS }
    const r = extractModule(src, ['a', 'b'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.kinds).toEqual([KINDS[0]])
    expect(r.modelVersion).toBe(3)
    const power = extractModule(src, ['c'])
    expect(power.ok && power.kinds).toEqual([KINDS[1]]) // the selection names power only
    const bare = extractModule({ ...src, nodes: [...src.nodes, pool('d')] }, ['d'])
    expect(bare.ok && bare.kinds).toEqual([])
    expect(bare.ok && bare.modelVersion).toBe(1)
  })
})
