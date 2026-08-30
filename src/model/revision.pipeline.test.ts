import { describe, expect, it } from 'vitest'
import G0_JSON from '../../examples/revision-v2/G0.json'
import G1_JSON from '../../examples/revision-v2/G1.json'
import {
  canonicalContent,
  canonicalJson,
  digestOfCanonical,
  InvalidRevisionContentError,
  isModelLayerContent,
  readRevisionSide,
} from './revision'
import { deserialize, serialize } from './serialize'
import type { LoopEdge, LoopNode } from './types'

type Graph = { nodes: LoopNode[]; edges: LoopEdge[]; recommendedRunConfig?: Record<string, unknown> }

// SEMANTICS-R2.md §R2-5 — evidence that the read pipeline runs its steps in
// order: normalizeGraph → defensive read → version predicate → v1-projection
// digest verify → v2 lift. Not "the unified projection coincidentally emits the
// same bytes" — the v1 side is verified against the LITERAL `{ modelLayer:false }`
// projection, and the lift is asserted byte-identical.

const g0 = () => JSON.parse(JSON.stringify(G0_JSON)) as unknown as Graph
const g1 = () => JSON.parse(JSON.stringify(G1_JSON)) as unknown as Graph

const node = (id: string, data: Record<string, unknown>): LoopNode =>
  ({ id, type: data.kind as string, position: { x: 0, y: 0 }, data }) as unknown as LoopNode
const pool = (id: string, extra: Record<string, unknown> = {}): LoopNode =>
  node(id, { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...extra })

describe('§R2-5 pipeline — the literal v1 projection', () => {
  it('{ modelLayer:false } omits every loop-revision/2 addition and rejects a model node', () => {
    // a pool with a resourceType — v1 projection drops the key entirely
    const withType = canonicalContent({ nodes: [pool('p', { resourceType: 'Gold' })], edges: [] }, { modelLayer: false })
    expect('resourceType' in withType.nodes[0].data).toBe(false)
    // a parameter node — v1 projection cannot represent it
    expect(() =>
      canonicalContent({ nodes: [node('pm', { kind: 'parameter', label: 'x', value: 1 })], edges: [] }, { modelLayer: false }),
    ).toThrow(InvalidRevisionContentError)
  })

  it('for a genuine v1 graph the v1 and v2 projections are byte-identical (R2-INV-2)', () => {
    const G0 = g0()
    const v1 = canonicalContent(G0, { modelLayer: false })
    const v2 = canonicalContent(G0, { modelLayer: true })
    expect(canonicalJson(v1)).toBe(canonicalJson(v2))
  })
})

describe('§R2-5 pipeline — step order', () => {
  it('the version predicate runs on the NORMALISED graph (a resourceType that normalises away ⇒ v1)', () => {
    const wsOnly = { nodes: [pool('p', { resourceType: '   ' })], edges: [] }
    expect(isModelLayerContent(wsOnly as never)).toBe(false)
    const r = readRevisionSide(wsOnly)
    expect(r.ok && r.version).toBe('loop-revision/1')
  })

  it('the defensive read gates BEFORE projection / version inference', () => {
    // an unseatable parameter value — must fail at stage 'defensive-read',
    // not as a projection throw or a digest mismatch
    const bad = { nodes: [node('pm', { kind: 'parameter', label: 'x', value: {} })], edges: [] }
    const r = readRevisionSide(bad)
    expect(r).toEqual({ ok: false, stage: 'defensive-read', detail: expect.stringContaining('pm') })
  })

  it('a v1 side is verified against the { modelLayer:false } projection, then lifted', () => {
    const G0 = g0()
    const v1digest = digestOfCanonical(canonicalContent(G0, { modelLayer: false }))
    const r = readRevisionSide(G0, v1digest)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.version).toBe('loop-revision/1')
    expect(r.digestVerified).toBe(true)
    // the lifted content IS the common v2 compare model, byte-identical to v1
    expect(canonicalJson(r.content)).toBe(canonicalJson(canonicalContent(G0, { modelLayer: true })))
  })

  it('a v1 side whose stored digest was computed under the v2 projection still verifies (they are equal) — and a truly wrong digest is a stage:digest failure', () => {
    const G0 = g0()
    // v2-computed digest == v1-computed digest for v1 content, so this passes
    const v2digest = digestOfCanonical(canonicalContent(G0, { modelLayer: true }))
    expect(readRevisionSide(G0, v2digest).ok).toBe(true)
    // a genuinely wrong digest fails at the digest stage
    const wrong = readRevisionSide(G0, 'f'.repeat(64))
    expect(wrong).toEqual({ ok: false, stage: 'digest', detail: expect.stringContaining('loop-revision/1') })
  })

  it('a v2 side is classified v2 and verified against the { modelLayer:true } projection', () => {
    const G1 = g1()
    const v2digest = digestOfCanonical(canonicalContent(G1, { modelLayer: true }))
    const r = readRevisionSide(G1, v2digest)
    expect(r.ok && r.version).toBe('loop-revision/2')
    expect(r.ok && r.digestVerified).toBe(true)
  })
})

describe('§R2-5 pipeline — G1 through the real integration path, and its current limits', () => {
  it('G1 survives serialize → deserialize (normalizeGraph) and is still v2 content', () => {
    const G1 = g1()
    const round = deserialize(serialize(G1.nodes, G1.edges, G1.recommendedRunConfig))
    // parameter / register nodes and the edge resourceType round-trip intact
    const kinds = round.nodes.map((n) => (n.data as { kind: string }).kind).sort()
    expect(kinds).toContain('parameter')
    expect(kinds).toContain('register')
    const mintEdge = round.edges.find((e) => e.id === 'e_mint_gold')!
    expect((mintEdge.data as { resourceType?: string }).resourceType).toBe('Gold')
    expect(isModelLayerContent(round as never)).toBe(true)
  })

  it('readRevisionSide(round-tripped G1) reproduces G1’s v2 digest — the full path is exercised', () => {
    const G1 = g1()
    const directDigest = digestOfCanonical(canonicalContent(G1, { modelLayer: true }))
    const round = deserialize(serialize(G1.nodes, G1.edges, G1.recommendedRunConfig))
    const r = readRevisionSide(round, directDigest)
    expect(r.ok).toBe(true)
    if (r.ok) expect(digestOfCanonical(r.content)).toBe(directDigest)
  })

  it('normalizeGraph now default-fills / normalises a model node (limitation closed by the editor-wiring slice)', () => {
    // a parameter node with NO value and an incoherent range: normalizeNode
    // runs the loop-model/1 defensive read and folds its result into a new
    // object — `value` filled to 0, the bad min/max pair dropped.
    const raw = node('pm', { kind: 'parameter', label: 'x', min: 10, max: 1 })
    const round = deserialize(serialize([raw], []))
    const d = round.nodes[0].data as Record<string, unknown>
    expect(d.value).toBe(0)
    expect(d.min).toBeUndefined()
    expect(d.max).toBeUndefined()
    // the projection agrees
    const projected = canonicalContent({ nodes: round.nodes, edges: [] }, { modelLayer: true })
    expect(projected.nodes[0].data).toEqual({ kind: 'parameter', label: 'x', value: 0 })
  })
})
