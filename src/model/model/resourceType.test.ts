import { describe, expect, it } from 'vitest'
import {
  normalizeResourceType,
  resourceTypeMismatches,
  sameResourceType,
} from './resourceType'

// SEMANTICS-M.md §M4.

describe('loop-model/1 resourceType — normalisation & identity (§M4.1)', () => {
  it('trims Unicode White_Space; empty ⇒ untyped', () => {
    expect(normalizeResourceType('  Gold  ')).toEqual({ value: 'Gold' })
    expect(normalizeResourceType('   ')).toEqual({ value: null })
    expect(normalizeResourceType('')).toEqual({ value: null })
    expect(normalizeResourceType(undefined)).toEqual({ value: null })
    expect(normalizeResourceType(123)).toEqual({ value: null })
  })

  it('is case-sensitive — "Gold" ≠ "gold"', () => {
    expect(sameResourceType(normalizeResourceType('Gold').value, normalizeResourceType('gold').value)).toBe(false)
    expect(sameResourceType(normalizeResourceType('Gold').value, normalizeResourceType(' Gold ').value)).toBe(true)
  })

  it('applies NFC so equivalent sequences compare equal', () => {
    const composed = 'é' // é
    const decomposed = 'é' // e + combining acute
    expect(normalizeResourceType(decomposed).value).toBe(composed)
  })

  it('drops (does not truncate) a value over 64 UTF-8 bytes, with RTYPE_TOO_LONG', () => {
    const long = 'A'.repeat(65)
    expect(normalizeResourceType(long)).toEqual({ value: null, notice: 'RTYPE_TOO_LONG' })
    expect(normalizeResourceType('A'.repeat(64)).value).toBe('A'.repeat(64))
  })
})

describe('loop-model/1 resourceType — mismatch findings (§M4.3)', () => {
  const view = (
    nodes: Record<string, { kind: string; resourceType?: string }>,
    resourceEdges: { id: string; source: string; target: string; resourceType?: string }[],
  ) => ({
    resourceEdges,
    nodeKind: (id: string) => nodes[id]?.kind,
    nodeResourceType: (id: string) => nodes[id]?.resourceType,
  })

  it('emits nothing when types agree or an element is untyped', () => {
    const v = view(
      { a: { kind: 'pool', resourceType: 'Gold' }, b: { kind: 'pool', resourceType: 'Gold' } },
      [{ id: 'e1', source: 'a', target: 'b', resourceType: 'Gold' }],
    )
    expect(resourceTypeMismatches(v)).toEqual([])

    const untyped = view(
      { a: { kind: 'pool' }, b: { kind: 'pool', resourceType: 'Gold' } },
      [{ id: 'e1', source: 'a', target: 'b', resourceType: 'Gold' }],
    )
    expect(resourceTypeMismatches(untyped)).toEqual([])
  })

  it('emits one finding per mismatched typed pool endpoint, deterministically ordered', () => {
    const v = view(
      {
        a: { kind: 'pool', resourceType: 'Energy' },
        b: { kind: 'pool', resourceType: 'XP' },
      },
      [
        { id: 'e2', source: 'a', target: 'b', resourceType: 'Gold' },
        { id: 'e1', source: 'a', target: 'b', resourceType: 'Gold' },
      ],
    )
    const f = resourceTypeMismatches(v)
    expect(f.map((x) => `${x.edgeId}:${x.endpoint}`)).toEqual([
      'e1:source',
      'e1:target',
      'e2:source',
      'e2:target',
    ])
    expect(f[0]).toEqual({ edgeId: 'e1', endpoint: 'source', nodeId: 'a', edgeType: 'Gold', nodeType: 'Energy' })
  })

  it('does not check non-pool endpoints (§M10-4)', () => {
    const v = view(
      { s: { kind: 'source' }, p: { kind: 'pool', resourceType: 'Gold' } },
      [{ id: 'e1', source: 's', target: 'p', resourceType: 'Gold' }],
    )
    expect(resourceTypeMismatches(v)).toEqual([])
  })
})
