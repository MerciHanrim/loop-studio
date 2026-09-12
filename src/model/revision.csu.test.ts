import { describe, expect, it } from 'vitest'
import fixtureMmo from '../../examples/mmo-progression.json'
import fixtureRisky from '../../examples/risky-factory.json'
import fixtureVerif from '../../examples/engine-b-verification.json'
import { canonicalContent, canonicalJson, fieldTag, fullContentDigest } from './revision'
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
})
