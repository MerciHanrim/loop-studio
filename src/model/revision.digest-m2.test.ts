import { describe, expect, it } from 'vitest'
import fixtureMmo from '../../examples/mmo-progression.json'
import fixtureRisky from '../../examples/risky-factory.json'
import fixtureVerif from '../../examples/engine-b-verification.json'
import {
  canonicalContent,
  canonicalJson,
  digestOfCanonical,
  fullContentDigest,
  readRevisionSide,
} from './revision'
import { normalizeGraph } from './serialize'
import type { LoopEdge, LoopNode } from './types'
import { canonicalGraphString, semanticDigest } from './workspace'

// SEMANTICS-M2.md §M2-8 — the model-semantics discriminator in the revision /
// workspace engine digest. v1 documents are byte-identical; a v2 document with
// the same payload + `@p` hashes differently.

const XY = { x: 0, y: 0 }
const src = (id: string): LoopNode => ({
  id, type: 'source', position: XY,
  data: { kind: 'source', label: id, activation: 'automatic', mode: 'pushAny' },
})
const pool = (id: string): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
})
const param = (id: string, value: number): LoopNode => ({
  id, type: 'parameter', position: XY,
  data: { kind: 'parameter', label: id, value } as unknown as LoopNode['data'],
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, sourceHandle: 'out', targetHandle: 'in', type: 'loop',
  data: { kind: 'resource', flow },
})

const graph = { nodes: [src('a'), pool('b'), param('p', 5)], edges: [res('e', 'a', 'b', '@p')] }

describe('§M2-8 — model-semantics discriminator in the engine digest', () => {
  it('a v2 projection carries a trailing modelSemantics; a v1 projection does not', () => {
    const v1 = canonicalContent(graph)
    const v2 = canonicalContent(graph, { modelVersion: 2 })
    expect(v1.modelSemantics).toBeUndefined()
    expect(v2.modelSemantics).toBe('loop-model/2')
    // the discriminator is the LAST key (stable JSON)
    expect(canonicalJson(v2).endsWith('"modelSemantics":"loop-model/2"}')).toBe(true)
  })

  it('same {nodes, edges} + "@p" ⇒ DIFFERENT digest for v1 vs v2 (M2-INV-10)', async () => {
    expect(await fullContentDigest(graph, 1)).not.toBe(await fullContentDigest(graph, 2))
    expect(await semanticDigest(graph, 1)).not.toBe(await semanticDigest(graph, 2))
    // and v1 == the un-versioned default (byte identity)
    expect(await fullContentDigest(graph)).toBe(await fullContentDigest(graph, 1))
    expect(await semanticDigest(graph)).toBe(await semanticDigest(graph, 1))
  })

  it('every existing v1 fixture digests byte-identically to the un-versioned projection (M2-INV-9)', async () => {
    for (const raw of [fixtureMmo, fixtureRisky, fixtureVerif]) {
      const g = normalizeGraph(raw as unknown as { nodes: LoopNode[]; edges: LoopEdge[] })
      expect(canonicalJson(canonicalContent(g, { modelVersion: 1 }))).toBe(
        canonicalJson(canonicalContent(g)),
      )
      expect(canonicalGraphString(g, 1)).toBe(canonicalGraphString(g))
    }
  })

  it('a v2 digest is stable across a re-project (round-trip surrogate, M2-INV-11)', () => {
    const once = digestOfCanonical(canonicalContent(graph, { modelVersion: 2 }))
    // re-run the projection from the same input, as a reload would
    const twice = digestOfCanonical(canonicalContent(graph, { modelVersion: 2 }))
    expect(twice).toBe(once)
  })

  it('a v2 graph with NO live reference still carries the discriminator (one-way latch, M2-INV-2)', () => {
    const noRef = { nodes: [src('a'), pool('b')], edges: [res('e', 'a', 'b', '1')] }
    const asV1 = canonicalJson(canonicalContent(noRef))
    const asV2 = canonicalJson(canonicalContent(noRef, { modelVersion: 2 }))
    expect(asV2).not.toBe(asV1) // declared v2 ⇒ different identity even though the run matches
    expect(canonicalContent(noRef, { modelVersion: 2 }).modelSemantics).toBe('loop-model/2')
  })

  it('readRevisionSide classifies a declared-v2 side as loop-revision/4 and verifies its digest', () => {
    const canon = canonicalContent(graph, { modelVersion: 2 })
    const stored = digestOfCanonical(canon)
    const side = readRevisionSide(graph, stored, 2)
    expect(side.ok).toBe(true)
    if (side.ok) {
      expect(side.version).toBe('loop-revision/4')
      expect(side.digestVerified).toBe(true)
      expect(side.content.modelSemantics).toBe('loop-model/2')
    }
    // the same bytes verified with modelVersion 1 (or omitted) ⇒ digest mismatch
    const asV1 = readRevisionSide(graph, stored)
    expect(asV1.ok).toBe(false)
  })
})
