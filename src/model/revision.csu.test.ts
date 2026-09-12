import { describe, expect, it } from 'vitest'
import fixtureMmo from '../../examples/mmo-progression.json'
import fixtureRisky from '../../examples/risky-factory.json'
import fixtureVerif from '../../examples/engine-b-verification.json'
import {
  canonicalContent,
  canonicalJson,
  digestOfCanonical,
  fieldTag,
  fullContentDigest,
  isCsuContent,
  readRevisionSide,
} from './revision'
import { normalizeGraph } from './serialize'
import type { LoopEdge, LoopNode } from './types'
import { canonicalGraphString, semanticDigest } from './workspace'

// docs/conditional-state-update.md (CSU) CSU9-D4 — `timing` / `when` on a
// `label` edge are ENGINE-AFFECTING document content, unlike the `route` /
// `waypoints` cosmetic precedent: they change what a step computes, so they
// must move both the `loop-revision/*` content digest and the workspace
// engine / semantic digest. Absent (or the legacy `timing: "phase0"`)
// normalises away so a fully-legacy graph's bytes are untouched.

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' },
})
const gate = (id: string): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' },
})
const res = (id: string, s: string, t: string, flow: string): LoopEdge => ({
  id, source: s, target: t, sourceHandle: 'out', targetHandle: 'in', type: 'loop',
  data: { kind: 'resource', flow },
})
const legacyLabel = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop',
  data: { kind: 'state', mode: 'label', expr },
})
const afterPullLabel = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop',
  data: { kind: 'state', mode: 'label', expr, timing: 'afterPull', when: 'source-fired' },
})

const legacyGraph = {
  nodes: [pool('a', 5), gate('g'), pool('b', 0)],
  edges: [res('r', 'a', 'g', '1'), legacyLabel('m', 'a', 'b', '+1')],
}
const csuGraph = {
  nodes: legacyGraph.nodes,
  edges: [res('r', 'a', 'g', '1'), afterPullLabel('m', 'g', 'b', '+1')],
}

describe('CSU9-D4 — fieldTag classifies timing / when as `engine`, never `cosmetic`', () => {
  it('unlike route / waypoints (cosmetic), timing and when are the engine default', () => {
    expect(fieldTag('edge', 'data.timing')).toBe('engine')
    expect(fieldTag('edge', 'data.when')).toBe('engine')
    expect(fieldTag('edge', 'data.route')).toBe('cosmetic') // control — the precedent they are NOT following
    expect(fieldTag('edge', 'data.waypoints')).toBe('cosmetic')
  })
})

describe('CSU9-D4 — loop-revision content digest (src/model/revision.ts)', () => {
  it('a `phase0` (legacy) label edge never emits `timing` / `when` in the projection', () => {
    const c = canonicalContent(legacyGraph)
    const edge = c.edges.find((e) => e.id === 'm')!
    expect('timing' in edge.data).toBe(false)
    expect('when' in edge.data).toBe(false)
  })

  it('an `afterPull` label edge emits both, verbatim', () => {
    const c = canonicalContent(csuGraph)
    const edge = c.edges.find((e) => e.id === 'm')!
    expect(edge.data.timing).toBe('afterPull')
    expect(edge.data.when).toBe('source-fired')
  })

  it('the SAME edge id/expr with vs without CSU fields digests DIFFERENTLY', async () => {
    const withCsu = await fullContentDigest(csuGraph)
    const withoutCsu = await fullContentDigest(legacyGraph)
    expect(withCsu).not.toBe(withoutCsu)
  })

  it('an explicit `timing: "phase0"` normalises to the same bytes as absent', () => {
    const explicitPhase0: LoopEdge = {
      id: 'm', source: 'a', target: 'b', sourceHandle: 'state-source', targetHandle: 'state-target', type: 'loop',
      data: { kind: 'state', mode: 'label', expr: '+1', timing: 'phase0' },
    }
    const explicit = { nodes: legacyGraph.nodes, edges: [res('r', 'a', 'g', '1'), explicitPhase0] }
    expect(canonicalJson(canonicalContent(explicit))).toBe(canonicalJson(canonicalContent(legacyGraph)))
  })

  it('every existing bundled fixture (no CSU fields) projects byte-identically to before', async () => {
    for (const raw of [fixtureMmo, fixtureRisky, fixtureVerif]) {
      const g = normalizeGraph(raw as unknown as { nodes: LoopNode[]; edges: LoopEdge[] })
      const c = canonicalContent(g)
      for (const e of c.edges) {
        expect('timing' in e.data).toBe(false)
        expect('when' in e.data).toBe(false)
      }
    }
  })
})

describe('CSU9-D4 — workspace semantic / engine digest (src/model/workspace.ts)', () => {
  it('the SAME edge id/expr with vs without CSU fields hashes DIFFERENTLY', async () => {
    expect(await semanticDigest(csuGraph)).not.toBe(await semanticDigest(legacyGraph))
  })

  it('a fully-legacy graph is untouched: the canonical graph string carries no timing/when key', () => {
    expect(canonicalGraphString(legacyGraph)).not.toMatch(/"timing"|"when"/)
    expect(canonicalGraphString(csuGraph)).toMatch(/"timing":"afterPull"/)
    expect(canonicalGraphString(csuGraph)).toMatch(/"when":"source-fired"/)
  })

  it('an unrecognised timing / when still moves the semantic digest, and differs from every other variant', async () => {
    const invalidTiming = { nodes: csuGraph.nodes, edges: [res('r', 'a', 'g', '1'), afterPullLabel('m', 'g', 'b', '+1')] }
    ;(invalidTiming.edges[1].data as unknown as { timing?: string }).timing = 'nope'
    const invalidWhen = { nodes: csuGraph.nodes, edges: [res('r', 'a', 'g', '1'), afterPullLabel('m', 'g', 'b', '+1')] }
    ;(invalidWhen.edges[1].data as unknown as { when?: string }).when = 'level>=5'
    const [dLegacy, dCsu, dInvalidTiming, dInvalidWhen] = await Promise.all([
      semanticDigest(legacyGraph),
      semanticDigest(csuGraph),
      semanticDigest(invalidTiming),
      semanticDigest(invalidWhen),
    ])
    const all = [dLegacy, dCsu, dInvalidTiming, dInvalidWhen]
    expect(new Set(all).size).toBe(all.length) // every variant hashes distinctly
    expect(canonicalGraphString(invalidTiming)).toMatch(/"timing":"nope"/)
    expect(canonicalGraphString(invalidWhen)).toMatch(/"when":"level>=5"/)
  })
})

// SEMANTICS-R6.md — the `loop-revision/6` CSU content predicate + verbatim
// (not re-validated) projection of an unrecognised `timing` / `when`.
describe('SEMANTICS-R6.md §R6-1 — isCsuContent predicate', () => {
  it('a legacy phase0 label (no timing, no when) is NOT csu content', () => {
    expect(isCsuContent(legacyGraph)).toBe(false)
  })
  it('an explicit timing: "phase0" (no when) is still NOT csu content', () => {
    const g = { edges: [{ data: { kind: 'state', mode: 'label', expr: '+1', timing: 'phase0' } }] }
    expect(isCsuContent(g)).toBe(false)
  })
  it('a valid afterPull label IS csu content', () => {
    expect(isCsuContent(csuGraph)).toBe(true)
  })
  it('an unrecognised timing value IS csu content', () => {
    const g = { edges: [{ data: { kind: 'state', mode: 'label', expr: '+1', timing: 'nope' } }] }
    expect(isCsuContent(g)).toBe(true)
  })
  it('a phase0 label with a stray `when` (CSU3-5 row 2 — fail-closed) IS csu content', () => {
    const g = { edges: [{ data: { kind: 'state', mode: 'label', expr: '+1', when: 'source-fired' } }] }
    expect(isCsuContent(g)).toBe(true)
  })
  it('a non-state edge with a stray timing/when field is ignored', () => {
    const g = { edges: [{ data: { kind: 'resource', flow: '1', timing: 'afterPull' } }] }
    expect(isCsuContent(g)).toBe(false)
  })
})

describe('SEMANTICS-R6.md §R6-2 — unrecognised timing / when are projected VERBATIM, not dropped', () => {
  const withTiming = (t: string) => {
    const edges = [res('r', 'a', 'g', '1'), afterPullLabel('m', 'g', 'b', '+1')]
    ;(edges[1].data as unknown as { timing?: string }).timing = t
    return { nodes: legacyGraph.nodes, edges }
  }
  const withWhen = (w: string) => {
    const edges = [res('r', 'a', 'g', '1'), afterPullLabel('m', 'g', 'b', '+1')]
    ;(edges[1].data as unknown as { when?: string }).when = w
    return { nodes: legacyGraph.nodes, edges }
  }

  it('an unrecognised timing is carried verbatim in the projection', () => {
    const c = canonicalContent(withTiming('nope'))
    expect(c.edges.find((e) => e.id === 'm')!.data.timing).toBe('nope')
  })
  it('an unrecognised when is carried verbatim in the projection', () => {
    const c = canonicalContent(withWhen('level>=5'))
    expect(c.edges.find((e) => e.id === 'm')!.data.when).toBe('level>=5')
  })
  it('an invalid timing digests DIFFERENTLY from legacy AND from a valid afterPull edit', async () => {
    const [dLegacy, dValid, dInvalid] = await Promise.all([
      fullContentDigest(legacyGraph),
      fullContentDigest(csuGraph),
      fullContentDigest(withTiming('nope')),
    ])
    expect(new Set([dLegacy, dValid, dInvalid]).size).toBe(3)
  })
  it('two different invalid timing strings digest differently from each other', async () => {
    const [a, b] = await Promise.all([fullContentDigest(withTiming('nope')), fullContentDigest(withTiming('later'))])
    expect(a).not.toBe(b)
  })
  it('a phase0 label with a stray `when` projects the `when` even though `timing` stays absent', () => {
    const edges = [res('r', 'a', 'g', '1'), legacyLabel('m', 'a', 'b', '+1')]
    ;(edges[1].data as unknown as { when?: string }).when = 'source-fired'
    const c = canonicalContent({ nodes: legacyGraph.nodes, edges })
    const edge = c.edges.find((e) => e.id === 'm')!
    expect('timing' in edge.data).toBe(false)
    expect(edge.data.when).toBe('source-fired')
  })
})

describe('SEMANTICS-R6.md §R6-1 / R6-5 — readRevisionSide on a PURE engine-only CSU graph', () => {
  // The bug this document fixes: before the `loop-revision/6` predicate, a
  // graph with an `afterPull` label but NO Parameter/Register/routing/frames
  // was mis-inferred as `loop-revision/1`; verifying it with the literal v1
  // projection, then lifting into `{ modelLayer: true }` (which DOES include
  // `timing`/`when`), produced different bytes and threw the R2-INV-2
  // assertion. This must now succeed and correctly report v6.
  it('a pure CSU graph (no model/routing/frames) infers as loop-revision/6, not v1 — and does not throw', () => {
    const digest = digestOfCanonical(canonicalContent(csuGraph))
    expect(() => readRevisionSide(csuGraph, digest)).not.toThrow()
    const side = readRevisionSide(csuGraph, digest)
    expect(side.ok && side.version).toBe('loop-revision/6')
    expect(side.ok && side.digestVerified).toBe(true)
  })
  it('the same graph with an unrecognised timing ALSO infers as v6 and verifies', () => {
    const edges = [res('r', 'a', 'g', '1'), afterPullLabel('m', 'g', 'b', '+1')]
    ;(edges[1].data as unknown as { timing?: string }).timing = 'nope'
    const invalid = { nodes: legacyGraph.nodes, edges }
    const digest = digestOfCanonical(canonicalContent(invalid))
    const side = readRevisionSide(invalid, digest)
    expect(side.ok && side.version).toBe('loop-revision/6')
  })
  it('a fully-legacy graph (no CSU) still infers v1, unaffected', () => {
    const digest = digestOfCanonical(canonicalContent(legacyGraph))
    const side = readRevisionSide(legacyGraph, digest)
    expect(side.ok && side.version).toBe('loop-revision/1')
  })
})
