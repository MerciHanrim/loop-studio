import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../model/types'
import { __resetRouteCache, __syncFullGeneration, besideBox, currentRouteGeneration, LABEL_END_ROOM, routeDiagnostics, setRecordLabels, setRouteLabelSize } from './routeMap'

// docs/edge-routing.md §ER15.3 — a chip that prints a unit is wider than its number,
// and on a short line it can cover the arrow. The last pass moves only such a chip:
// what counts is what the chip prints, reported with its size, and never the `unit`
// key, so a chip that prints no unit keeps its place.

const node = (id: string, x: number, y: number): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, data: { kind: 'pool', label: id, activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } }) as unknown as LoopNode
const flow = (id: string, s: string, t: string, unit?: string): LoopEdge =>
  ({ id, type: 'loop', source: s, target: t, sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '21000', route: 'orthogonal', ...(unit ? { unit } : {}) } }) as unknown as LoopEdge

const SIZE = { w: 90, h: 19 }
const generate = (nodes: LoopNode[], edges: LoopEdge[], showsUnit: boolean) => {
  for (const e of edges) setRouteLabelSize(e.id, SIZE.w, SIZE.h, showsUnit)
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
  it('a chip that prints a unit and covers its short line goes beside it, and the line does not move', () => {
    const bare = generate(near(), [flow('e', 'a', 'b')], false).get('e')!
    __resetRouteCache()
    const moved = generate(near(), [flow('e', 'a', 'b', 'CMD')], true).get('e')!
    expect(moved.d).toBe(bare.d)
    expect(moved.beside).toBeDefined()
    const box = besideBox(moved.label!, moved.beside!.side, SIZE, 'e')
    // clear of its own line: nothing of it is left to cover
    const y = moved.points[0]!.y
    expect(box.y + box.h <= y || box.y >= y).toBe(true)
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: ['e'], kept: [] })
  })

  it('the same chip with no unit stays where it was', () => {
    const r = generate(near(), [flow('e', 'a', 'b')], false).get('e')!
    expect(r.beside).toBeUndefined()
    expect(r.label).toEqual(r.mid)
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: [], kept: [] })
  })

  it('a `unit` key on a chip that prints none moves nothing: a stale unit, `all`, a range', () => {
    const bare = generate(near(), [flow('e', 'a', 'b')], false).get('e')!
    __resetRouteCache()
    const keyed = generate(near(), [flow('e', 'a', 'b', 'gone')], false).get('e')!
    expect(keyed.label).toEqual(bare.label)
    expect(keyed.beside).toBeUndefined()
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: [], kept: [] })
  })

  it('a chip that stops printing its unit goes back in the next full generation', () => {
    const nodes = near()
    const edges = [flow('e', 'a', 'b', 'CMD')]
    expect(generate(nodes, edges, true).get('e')!.beside).toBeDefined()
    setRouteLabelSize('e', SIZE.w, SIZE.h, false)
    expect(__syncFullGeneration(nodes, edges).get('e')!.beside).toBeUndefined()
  })

  it('a chip that leaves both ends showing is not moved', () => {
    const r = generate(far(), [flow('e', 'a', 'b', 'CMD')], true).get('e')!
    expect(r.beside).toBeUndefined()
    expect(r.label).toEqual(r.mid)
    expect(Math.abs(r.points[r.points.length - 1]!.x - r.points[0]!.x) / 2 - SIZE.w / 2).toBeGreaterThanOrEqual(LABEL_END_ROOM)
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: [], kept: [] })
  })

  it('a record keeps its recorded label places (§ER15.1)', () => {
    setRecordLabels(true)
    const r = generate(near(), [flow('e', 'a', 'b', 'CMD')], true).get('e')!
    expect(r.beside).toBeUndefined()
    expect(routeDiagnostics().runForm.endRoom).toEqual({ moved: [], kept: [] })
  })
})
