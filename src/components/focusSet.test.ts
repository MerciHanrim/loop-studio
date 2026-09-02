import { describe, expect, it } from 'vitest'
import { computeFocusSet } from './focusSet'

// docs/large-graph-readability.md §LGR2.2 — the focus set is the anchor + its
// 1-hop DRAWN-EDGE neighbours (either direction) + the joining edges. Fixed
// 1 hop; no expression `depends-on` traversal (LGR-D2 / LGR-D3).

type E = { id: string; source: string; target: string }

const edges: E[] = [
  { id: 'e1', source: 'a', target: 'b' }, // a → b
  { id: 'e2', source: 'c', target: 'a' }, // c → a  (incoming to a)
  { id: 'e3', source: 'b', target: 'd' }, // b → d  (2 hops from a)
  { id: 'e4', source: 'x', target: 'y' }, // unrelated
]

describe('computeFocusSet', () => {
  it('returns null with no anchor (nothing is de-emphasised)', () => {
    expect(computeFocusSet(null, edges)).toBeNull()
  })

  it('collects the anchor + 1-hop neighbours in both directions', () => {
    const fs = computeFocusSet('a', edges)!
    expect([...fs.nodes].sort()).toEqual(['a', 'b', 'c'])
    expect([...fs.edges].sort()).toEqual(['e1', 'e2'])
  })

  it('does not reach 2 hops', () => {
    const fs = computeFocusSet('a', edges)!
    expect(fs.nodes.has('d')).toBe(false)
    expect(fs.edges.has('e3')).toBe(false)
  })

  it('ignores edges not incident to the anchor', () => {
    const fs = computeFocusSet('a', edges)!
    expect(fs.nodes.has('x')).toBe(false)
    expect(fs.nodes.has('y')).toBe(false)
    expect(fs.edges.has('e4')).toBe(false)
  })

  it('an isolated anchor is its own singleton set', () => {
    const fs = computeFocusSet('lonely', edges)!
    expect([...fs.nodes]).toEqual(['lonely'])
    expect(fs.edges.size).toBe(0)
  })

  it('handles a self-loop without duplicating the anchor', () => {
    const fs = computeFocusSet('s', [{ id: 'sl', source: 's', target: 's' }])!
    expect([...fs.nodes]).toEqual(['s'])
    expect([...fs.edges]).toEqual(['sl'])
  })
})
