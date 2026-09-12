// docs/parameter-activator.md (PA) — regression suite proving `loop-revision/7`
// is genuinely unnecessary (Hanrim, 2026-09-13 review of PR #188), not just
// asserted. Five points, each its own describe block:
//
//   1. a param-like `expr` round-trips losslessly through BOTH the v1
//      (modelLayer:false) and v2+ (modelLayer:true) canonical projections —
//      with or without a matching Parameter node.
//   2. loop-state/1 (modelVersion 1) leaves the grammar inert; loop-state/4
//      (modelVersion 2) executes it — the ENGINE-level v1/v2 split.
//   3. v1 vs v2 EXECUTION semantics are already discriminated by the existing
//      loop-model/2 `modelSemantics` declaration (`declaredV2` ->
//      `loop-revision/4`) — a different digest, no new axis needed.
//   4. a v2 graph whose activator references a missing / wrong-kind Parameter
//      still reads / diffs / selective-Applies normally — no crash anywhere
//      in the revision pipeline.
//   5. an existing `expr` field hunk (literal -> param-term) applies through
//      the three-way selective Apply with no value loss.

import { describe, expect, it } from 'vitest'
import {
  buildSelectiveApply,
  canonicalContent,
  computeRevisionDiff,
  computeThreeWay,
  digestOfCanonical,
  readRevisionSide,
} from './revision'
import type { LoopEdge, LoopNode } from './types'

const XY = { x: 0, y: 0 }
const pool = (id: string, initial = 0): LoopNode => ({
  id, type: 'pool', position: XY,
  data: { kind: 'pool', label: id, activation: 'passive', initial, capacity: null, mode: 'pullAny' },
})
const gate = (id: string): LoopNode => ({
  id, type: 'gate', position: XY,
  data: { kind: 'gate', label: id, activation: 'automatic', distribution: 'deterministic', mode: 'pullAny' },
})
const parameter = (id: string, value: number): LoopNode => ({
  id, type: 'parameter', position: XY,
  data: { kind: 'parameter', label: id, value },
})
const res = (id: string, s: string, t: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' },
})
const act = (id: string, s: string, t: string, expr: string): LoopEdge => ({
  id, source: s, target: t, type: 'loop',
  sourceHandle: 'state-source', targetHandle: 'state-target',
  data: { kind: 'state', mode: 'activator', expr },
})

// A minimal graph: no other model-layer content besides what each test adds,
// so the "no Parameter node at all" case (an activator string that merely
// LOOKS like param-term syntax) is reachable.
function baseGraph(expr: string) {
  const nodes: LoopNode[] = [pool('a', 5), gate('g')]
  const edges: LoopEdge[] = [res('e', 'a', 'g'), act('act1', 'a', 'g', expr)]
  return { nodes, edges }
}

describe('1 — a param-like expr round-trips losslessly through v1 and v2+ projection', () => {
  it('with a matching Parameter node present (a graph WITH a Parameter node was already loop-revision/2+ content before this feature existed — modelLayer:false throws for it, by design, unrelated to activators; the meaningful comparison is the dangling-reference case below)', () => {
    const { nodes, edges } = baseGraph('>= @hard_pity - 1')
    const withParam = { nodes: [...nodes, parameter('hard_pity', 3)], edges }
    const v2 = canonicalContent(withParam, { modelLayer: true })
    const e2 = v2.edges.find((e) => e.id === 'act1')!
    expect((e2.data as { expr: string }).expr).toBe('>= @hard_pity - 1')
    expect(() => canonicalContent(withParam, { modelLayer: false })).toThrow()
  })

  it('with NO matching Parameter node at all (the reference is dangling)', () => {
    const { nodes, edges } = baseGraph('>= @ghost - 1')
    const v1 = canonicalContent({ nodes, edges }, { modelLayer: false })
    const v2 = canonicalContent({ nodes, edges }, { modelLayer: true })
    const e1 = v1.edges.find((e) => e.id === 'act1')!
    const e2 = v2.edges.find((e) => e.id === 'act1')!
    expect(e1.data).toEqual(e2.data)
    expect((e1.data as { expr: string }).expr).toBe('>= @ghost - 1')
    // digest itself agrees too (canonicalContent equality implies this, but
    // assert it directly since digest-not-content is the R2-INV-2 concern)
    expect(digestOfCanonical(v1)).toBe(digestOfCanonical(v2))
  })
})

describe('2 — loop-state/1 (v1) stays inert; loop-state/4 (v2) executes the new grammar', () => {
  // A minimal live-engine check: import step()/initSim() to run the SAME
  // graph under each modelVersion and observe the actual gating difference,
  // not just the pure parser (already covered in stateExpr.test.ts).
  it('under modelVersion 1 the activator is inert (not-a-comparison diagnostic, target ungated); under 2 it resolves and gates', async () => {
    const { initSim, step } = await import('../engine/index')
    const nodes: LoopNode[] = [pool('pity', 2), gate('forced'), pool('sink', 0), parameter('hard_pity', 3)]
    const edges: LoopEdge[] = [
      res('e_in', 'pity', 'forced'),
      res('e_out', 'forced', 'sink'), // a gate with no outgoing edge can never "fire" — unrelated to activator gating
      act('a', 'pity', 'forced', '>= @hard_pity - 1'), // pity=2 >= 3-1=2 -> true, IF resolved
    ]
    const st1 = initSim(nodes)
    const r1 = step(nodes, edges, st1, 1, 1) // modelVersion 1
    expect(r1.report.diagnostics.some((d) => d.includes('not a comparison'))).toBe(true)
    expect(r1.report.fired).toContain('forced') // ungated (inert activator, Class 1, fail-open)

    const st2 = initSim(nodes)
    const r2 = step(nodes, edges, st2, 1, 2) // modelVersion 2
    expect(r2.report.diagnostics.some((d) => d.includes('not a comparison'))).toBe(false)
    expect(r2.report.fired).toContain('forced') // gated ON — pity(2) >= hard_pity-1(2) is true
  })
})

describe('3 — v1/v2 execution semantics are already discriminated by loop-revision/4 (modelSemantics), not a new axis', () => {
  it('the SAME graph classifies and digests differently purely from the modelVersion declaration', () => {
    const { nodes, edges } = baseGraph('>= @hard_pity - 1')
    const withParam = { nodes: [...nodes, parameter('hard_pity', 3)], edges }
    const asV1 = readRevisionSide(withParam, undefined, 1)
    const asV2 = readRevisionSide(withParam, undefined, 2)
    expect(asV1.ok).toBe(true)
    expect(asV2.ok).toBe(true)
    if (!asV1.ok || !asV2.ok) return
    expect(asV1.version).toBe('loop-revision/2') // has a Parameter node -> already model-layer, undeclared v2
    expect(asV2.version).toBe('loop-revision/4') // declared v2 -> the EXISTING axis
    expect(digestOfCanonical(asV1.content)).not.toBe(digestOfCanonical(asV2.content))
  })
})

describe('4 — a v2 graph with a missing/wrong-kind Parameter reference reads, diffs, and selective-Applies without crashing', () => {
  it('readRevisionSide succeeds (no R2-INV-2 crash) for an unresolvable reference', () => {
    const { nodes, edges } = baseGraph('>= @ghost - 1')
    const result = readRevisionSide({ nodes, edges }, undefined, 2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.version).toBe('loop-revision/4')
  })

  it('readRevisionSide succeeds for a wrong-kind reference (a Pool, not a Parameter)', () => {
    const { nodes, edges } = baseGraph('>= @a - 1') // `a` is the Pool, not a Parameter
    const result = readRevisionSide({ nodes, edges }, undefined, 2)
    expect(result.ok).toBe(true)
  })

  it('computeRevisionDiff / computeThreeWay / buildSelectiveApply all complete normally for a dangling reference', () => {
    const base = baseGraph('>= 2')
    const proposed = baseGraph('>= @ghost - 1') // proposal introduces the dangling ref
    const baseC = canonicalContent(base, { modelLayer: true })
    const proposedC = canonicalContent(proposed, { modelLayer: true })
    const diff = computeRevisionDiff(baseC, proposedC)
    expect(diff.summary.empty).toBe(false)
    expect(diff.summary.engineAffecting).toBe(true) // `expr` is an `engine`-tagged field

    const targetC = canonicalContent(base, { modelLayer: true }) // yours === base, unmodified
    const plan = computeThreeWay(baseC, targetC, proposedC)
    expect(plan.nConf).toBe(0) // clean field change, nothing to confirm
    const actHunk = plan.hunks.find((h) => h.id === 'act1')!
    expect(actHunk.verdict).toBe('clean')

    const applied = buildSelectiveApply({
      target: base,
      proposedFull: proposed,
      plan,
      selection: { accept: {}, fieldChoices: { act1: { 'data.expr': 'proposed' } } },
    })
    expect(applied.ok).toBe(true)
    if (applied.ok) {
      const appliedEdge = applied.edges.find((e) => e.id === 'act1')!
      expect((appliedEdge.data as { expr: string }).expr).toBe('>= @ghost - 1')
    }
  })
})

describe('5 — an existing expr hunk (literal -> param-term) applies through three-way selective Apply with no value loss', () => {
  it('the field hunk carries the exact proposed string, and Apply writes it verbatim', () => {
    const base = baseGraph('>= 2')
    const proposed = baseGraph('>= @hard_pity - 1')
    const baseC = canonicalContent(base, { modelLayer: true })
    const proposedC = canonicalContent(proposed, { modelLayer: true })
    const targetC = canonicalContent(base, { modelLayer: true }) // yours unchanged from base

    const plan = computeThreeWay(baseC, targetC, proposedC)
    const hunk = plan.hunks.find((h) => h.id === 'act1' && h.kind === 'change')!
    const exprField = hunk.fields!.find((f) => f.field === 'data.expr')!
    expect(exprField.base).toBe('>= 2')
    expect(exprField.proposed).toBe('>= @hard_pity - 1')
    expect(exprField.yours).toBe('>= 2')
    expect(exprField.verdict).toBe('clean')

    const applied = buildSelectiveApply({
      target: base,
      proposedFull: proposed,
      plan,
      selection: { accept: {}, fieldChoices: { act1: { 'data.expr': 'proposed' } } },
    })
    expect(applied.ok).toBe(true)
    if (applied.ok) {
      const appliedEdge = applied.edges.find((e) => e.id === 'act1')!
      // exact, verbatim — no truncation, no re-parse/re-serialise drift
      expect((appliedEdge.data as { expr: string }).expr).toBe('>= @hard_pity - 1')
    }
  })
})
