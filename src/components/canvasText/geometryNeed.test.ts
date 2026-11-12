import { describe, expect, it } from 'vitest'
import { nodesMoved, type NodeBox } from './geometryNeed'

// docs/canvas-text-layer.md §CTL5 — a selection, a drag flag or a data change
// alone does not make the layer read the nodes again; a move, a resize, an added
// or a removed node does. (`needOf` reads DOM records: the browser spec covers it.)
const n = (id: string, x = 0, y = 0, w = 100, h = 60, extra: Partial<NodeBox> & Record<string, unknown> = {}) => ({ id, position: { x, y }, measured: { width: w, height: h }, ...extra })

describe('nodesMoved', () => {
  it('the same list, or the same boxes in new objects (a selection, a data change), is not a move', () => {
    const a = [n('a'), n('b', 200)]
    expect(nodesMoved(a, a)).toBe(false)
    expect(nodesMoved([n('a', 0, 0, 100, 60, { selected: true }), a[1]], a)).toBe(false)
    expect(nodesMoved([n('a', 0, 0, 100, 60, { data: { label: 'x' }, dragging: true }), a[1]], a)).toBe(false)
  })
  it('a moved, resized, added, removed, replaced or hidden node is', () => {
    const a = [n('a'), n('b', 200)]
    expect(nodesMoved([n('a', 1), a[1]], a)).toBe(true)
    expect(nodesMoved([n('a', 0, 1), a[1]], a)).toBe(true)
    expect(nodesMoved([n('a', 0, 0, 101), a[1]], a)).toBe(true)
    expect(nodesMoved([n('a', 0, 0, 100, 61), a[1]], a)).toBe(true)
    expect(nodesMoved([...a, n('c')], a)).toBe(true)
    expect(nodesMoved([a[0]], a)).toBe(true)
    expect(nodesMoved([n('c'), a[1]], a)).toBe(true)
    expect(nodesMoved([n('a', 0, 0, 100, 60, { hidden: true }), a[1]], a)).toBe(true)
    expect(nodesMoved([n('a', 0, 0, 100, 60, { width: 120 }), a[1]], a)).toBe(true)
  })
})
