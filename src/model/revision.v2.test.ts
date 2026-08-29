import { describe, expect, it } from 'vitest'
import {
  canonicalContent,
  computeRevisionDiff,
  computeThreeWay,
  fieldTag,
  InvalidRevisionContentError,
  isModelLayerContent,
  readProject,
} from './revision'
import type { LoopEdge, LoopNode } from './types'

// loop-revision/2 — SEMANTICS-R2.md §R2-1 / §R2-2 / §R2-3 / §R2-5.

const node = (id: string, data: Record<string, unknown>): LoopNode =>
  ({ id, type: data.kind as string, position: { x: 0, y: 0 }, data }) as unknown as LoopNode
const rEdge = (id: string, source: string, target: string, data: Record<string, unknown>): LoopEdge =>
  ({ id, type: 'loop', source, target, sourceHandle: 'out', targetHandle: 'in', data }) as unknown as LoopEdge

const pool = (id: string, extra: Record<string, unknown> = {}) =>
  node(id, { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny', ...extra })

const project = (nodes: LoopNode[], edges: LoopEdge[] = []) => canonicalContent({ nodes, edges })

describe('loop-revision/2 — the §R2-1 predicate', () => {
  it('is false for a pure v1 graph and true once a model element appears', () => {
    expect(isModelLayerContent({ nodes: [pool('p')], edges: [] })).toBe(false)
    expect(isModelLayerContent({ nodes: [node('x', { kind: 'parameter', value: 1 })], edges: [] })).toBe(true)
    expect(isModelLayerContent({ nodes: [pool('p', { resourceType: 'Gold' })], edges: [] })).toBe(true)
    // a resourceType that normalises away does NOT make it v2
    expect(isModelLayerContent({ nodes: [pool('p', { resourceType: '   ' })], edges: [] })).toBe(false)
    expect(
      isModelLayerContent({ nodes: [pool('a'), pool('b')], edges: [rEdge('e', 'a', 'b', { kind: 'resource', flow: '1', resourceType: 'XP' })] }),
    ).toBe(true)
  })
})

describe('loop-revision/2 — canonical projection (§R2-2)', () => {
  it('parameter row: fixed order, only surviving fields, never null', () => {
    const c = project([node('pm', { kind: 'parameter', label: 'Price', value: 5, min: 10, max: 1, step: 0, unit: '  ' })])
    // min>max ⇒ dropped; step 0 ⇒ dropped; unit blank ⇒ absent
    expect(c.nodes[0].data).toEqual({ kind: 'parameter', label: 'Price', value: 5 })
  })

  it('register row: expr stored in §X8 canonical form; bad format dropped', () => {
    const c = project([node('rg', { kind: 'register', label: 'P', expr: '@a+@b', format: 'money' })])
    expect(c.nodes[0].data).toEqual({ kind: 'register', label: 'P', expr: '@a + @b' })
  })

  it('pool / resource-edge resourceType is trailing and only when non-empty', () => {
    const typed = project([pool('p', { resourceType: '  Gold  ' })])
    expect(Object.keys(typed.nodes[0].data).at(-1)).toBe('resourceType')
    expect(typed.nodes[0].data.resourceType).toBe('Gold')
    const untyped = project([pool('p')])
    expect('resourceType' in untyped.nodes[0].data).toBe(false)
    const oversize = project([pool('p', { resourceType: 'A'.repeat(65) })])
    expect('resourceType' in oversize.nodes[0].data).toBe(false) // §M4.1 over-cap ⇒ dropped
  })

  it('an unseatable parameter / register shape is InvalidRevisionContentError (§R2-1.1)', () => {
    expect(() => project([node('pm', { kind: 'parameter', label: 'x', value: {} })])).toThrow(InvalidRevisionContentError)
    expect(() => project([node('rg', { kind: 'register', label: 'x', expr: '@a +' })])).toThrow(InvalidRevisionContentError)
  })
})

describe('loop-revision/2 — field tags (§R2-3)', () => {
  it('engine: parameter.value, register.expr; advisory: hints + resourceType', () => {
    expect(fieldTag('node', 'data.value')).toBe('engine')
    expect(fieldTag('node', 'data.expr')).toBe('engine')
    expect(fieldTag('node', 'data.min')).toBe('advisory')
    expect(fieldTag('node', 'data.step')).toBe('advisory')
    expect(fieldTag('node', 'data.unit')).toBe('advisory')
    expect(fieldTag('node', 'data.format')).toBe('advisory')
    expect(fieldTag('node', 'data.resourceType')).toBe('advisory')
    expect(fieldTag('edge', 'data.resourceType')).toBe('advisory')
    expect(fieldTag('node', 'data.label')).toBe('cosmetic')
  })

  it('an advisory-only change sets advisoryAffecting, not engineAffecting', () => {
    const base = project([pool('p', { resourceType: 'Gold' })])
    const proposed = project([pool('p', { resourceType: 'Silver' })])
    const d = computeRevisionDiff(base, proposed)
    expect(d.summary.engineAffecting).toBe(false)
    expect(d.summary.advisoryAffecting).toBe(true)
    expect(d.summary.empty).toBe(false)
    expect(d.nodes.changed[0].fields[0].tag).toBe('advisory')
  })

  it('changing parameter.value is engine-affecting', () => {
    const base = project([node('pm', { kind: 'parameter', label: 'x', value: 1 })])
    const proposed = project([node('pm', { kind: 'parameter', label: 'x', value: 2 })])
    const d = computeRevisionDiff(base, proposed)
    expect(d.summary.engineAffecting).toBe(true)
  })
})

describe('loop-revision/2 — advisory conflicts feed nConf (§R2-6.4)', () => {
  it('an advisory field with base/proposed/yours all different is a conflict', () => {
    const base = project([node('pm', { kind: 'parameter', label: 'x', value: 5, min: 0, max: 100 })])
    const target = project([node('pm', { kind: 'parameter', label: 'x', value: 5, min: 2, max: 100 })])
    const proposed = project([node('pm', { kind: 'parameter', label: 'x', value: 5, min: 9, max: 100 })])
    const plan = computeThreeWay(base, target, proposed)
    expect(plan.nConf).toBeGreaterThanOrEqual(1)
    const changeHunk = plan.hunks.find((h) => h.kind === 'change')!
    expect(changeHunk.fields!.find((f) => f.field === 'data.min')!.verdict).toBe('conflict')
    expect(changeHunk.fields!.find((f) => f.field === 'data.min')!.tag).toBe('advisory')
  })
})

describe('loop-revision/2 — malformed model payload is not promoted (§R2-5.1)', () => {
  it('readProject drops a base snapshot holding an unseatable register', () => {
    const badBase = {
      revisionId: 'rev_0000000000000000000000000A',
      contentDigest: 'f'.repeat(64),
      content: {
        nodes: [{ id: 'rg', position: { x: 0, y: 0 }, data: { kind: 'register', label: 'x', expr: 'min(@a,@b)' } }],
        edges: [],
      },
    }
    const raw = {
      schema: 'loop-revision/1',
      version: 1,
      projectId: 'proj_0000000000000000000000000A',
      revisionId: 'rev_0000000000000000000000000B',
      parentId: null,
      role: 'proposal',
      base: badBase,
    }
    const r = readProject(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.warning).toMatch(/base snapshot/i)
  })
})
