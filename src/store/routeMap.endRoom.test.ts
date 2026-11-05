import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { __resetRouteCache, __syncFullGeneration, besideBox, currentRouteGeneration, LABEL_END_ROOM, routeDiagnostics, setRecordLabels, setRouteLabelSize } from './routeMap'

// docs/edge-routing.md §ER15.3 — a chip with a unit is wider than its number, and
// on a short line it can cover the arrow. The last pass moves only such a chip,
// and a document with no unit keeps every label where it was.

const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const flow = (id: string, s: string, t: string, unit?: string): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '21000', route: 'orthogonal', ...(unit ? { unit } : {}) } }) as unknown as LoopEdge

const SIZE = { w: 90, h: 19 }
const generate = (nodes: LoopNode[], edges: LoopEdge[]) => {
  for (const e of edges) setRouteLabelSize(e.id, SIZE.w, SIZE.h)
  __syncFullGeneration(nodes, edges)
  return currentRouteGeneration(nodes, edges).map
}
const near = () => [node('a', 0, 0), node('b', 170, 0)]
const far = () => [node('a', 0, 0), node('b', 640, 0)]

beforeEach(() => {
  __resetRouteCache()
})
afterEach(() => {
  setRecordLabels(false)
})

describe('the end-room pass (§ER15.3)', () => {
  it('a chip with a unit that covers its short line goes beside it, and the line does not move', () => {
    const bare = generate(near(), [flow('e', 'a', 'b')]).get('e')!
    __resetRouteCache()
    const moved = generate(near(), [flow('e', 'a', 'b', 'CMD')]).get('e')!
    expect(moved.d).toBe(bare.d)
    expect(moved.beside).toBeDefined()
    const box = besideBox(moved.label!, moved.beside!.side, SIZE, 'e')
    // clear of its own line: nothing of it is left to cover
    const y = moved.points[0]!.y
    expect(box.y + box.h <= y || box.y >= y).toBe(true)
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: ['e'], kept: [] })
  })

  it('the same chip with no unit stays where it was', () => {
    const r = generate(near(), [flow('e', 'a', 'b')]).get('e')!
    expect(r.beside).toBeUndefined()
    expect(r.label).toEqual(r.mid)
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: [], kept: [] })
  })

  it('a chip that leaves both ends showing is not moved', () => {
    const r = generate(far(), [flow('e', 'a', 'b', 'CMD')]).get('e')!
    expect(r.beside).toBeUndefined()
    expect(r.label).toEqual(r.mid)
    expect(Math.abs(r.points[r.points.length - 1]!.x - r.points[0]!.x) / 2 - SIZE.w / 2).toBeGreaterThanOrEqual(LABEL_END_ROOM)
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: [], kept: [] })
  })

  it('a record keeps its recorded label places (§ER15.1)', () => {
    setRecordLabels(true)
    const r = generate(near(), [flow('e', 'a', 'b', 'CMD')]).get('e')!
    expect(r.beside).toBeUndefined()
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: [], kept: [] })
  })
})
