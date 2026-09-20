import { describe, expect, it } from 'vitest'
import type { LoopEdge, LoopNode } from '../../model/types'
import type { Frame } from '../../store/frameStore'
import { applyMoveDelta, captureMoveOrigin, moveTargets } from './frameMoveGesture'

// docs/large-graph-readability.md §LGR6.5 / LGR-D9 (2026-09-20) — a frame drag
// CARRIES its contents, derived at the moment the drag starts: every node whose
// measured box is FULLY inside the frame rect, every MANUAL frame fully inside
// it (and, through the rect, that frame's nodes), and the manual waypoints of
// an edge whose BOTH endpoints are carried. Nothing is stored; the wire shape
// stays `{ id, label, rect, color? }` (SEMANTICS-R5.md R5-D3).

const N = (id: string, x: number, y: number, w = 150, h = 40): LoopNode =>
  ({ id, type: 'pool', position: { x, y }, measured: { width: w, height: h }, data: { kind: 'pool', label: id } }) as unknown as LoopNode
const E = (id: string, source: string, target: string, waypoints?: { x: number; y: number }[]): LoopEdge =>
  ({
    id,
    type: 'loop',
    source,
    target,
    data: waypoints ? { kind: 'resource', flow: '1', route: 'orthogonal', waypoints } : { kind: 'resource', flow: '1' },
  }) as unknown as LoopEdge
const F = (id: string, x: number, y: number, w: number, h: number, n = 1): Frame => ({ id, n, label: '', rect: { x, y, w, h } })

const outer = F('outer', -40, -40, 720, 300)
const inner = F('inner', -20, -20, 200, 100) // fully inside `outer`, holds `a`
const straddling = F('straddle', 600, -20, 200, 100) // crosses outer's right edge
const nodes = [N('a', 0, 0), N('b', 260, 0), N('c', 520, 0), N('d', 780, 0), N('edge', 600, 0)] // `edge` straddles x=680
const edges = [E('ab', 'a', 'b', [{ x: 200, y: 80 }]), E('cd', 'c', 'd', [{ x: 700, y: 80 }]), E('bc', 'b', 'c')]

describe('frameMoveGesture — moveTargets (derived, drag-time, full containment)', () => {
  it('carries the fully-contained nodes, the fully-contained MANUAL frames, and the waypointed edges with BOTH ends carried', () => {
    const t = moveTargets(outer.rect, 'outer', [outer, inner, straddling], nodes, edges)
    expect(t.nodeIds).toEqual(['a', 'b', 'c']) // `d` outside, `edge` straddles
    expect(t.frameIds).toEqual(['inner']) // never itself; a straddling frame is not carried
    expect(t.edgeIds).toEqual(['ab']) // `cd` has one end outside, `bc` has no waypoints
  })

  it('a node straddling the boundary is NOT carried (the creation guard\'s rule, not centre-in-rect)', () => {
    const t = moveTargets({ x: -20, y: -20, w: 300, h: 100 }, 'x', [], nodes, edges)
    expect(t.nodeIds).toEqual(['a']) // `b` spans 260..410, the rect ends at 280
  })

  it('every id appears exactly once, whatever the input order', () => {
    const t = moveTargets(outer.rect, 'outer', [inner, outer, inner], [...nodes, nodes[0]], edges)
    expect(new Set(t.nodeIds).size).toBe(t.nodeIds.length)
    expect(new Set(t.frameIds).size).toBe(t.frameIds.length)
  })

  it('a frame that only overlaps is not carried; a node inside two frames follows whichever is dragged (D3)', () => {
    const left = F('left', -20, -20, 440, 100) // a, b
    const right = F('right', 200, -20, 480, 100) // b, c
    const tr = moveTargets(right.rect, 'right', [left, right], nodes, edges)
    expect(tr.nodeIds).toEqual(['b', 'c'])
    expect(tr.frameIds).toEqual([])
    const tl = moveTargets(left.rect, 'left', [left, right], nodes, edges)
    expect(tl.nodeIds).toEqual(['a', 'b'])
  })
})

describe('frameMoveGesture — captureMoveOrigin / applyMoveDelta (origin + absolute Δ, never accumulated)', () => {
  const origin = () =>
    captureMoveOrigin({
      frameId: 'outer',
      rect: outer.rect,
      isAuto: false,
      frameOnly: false,
      anchor: { x: 10, y: 10 },
      frames: [outer, inner, straddling],
      nodes,
      edges,
    })

  it('captures immutable origins for the dragged frame, the nested frame, the carried nodes and the carried waypoints', () => {
    const o = origin()
    expect(Object.keys(o.frameRects).sort()).toEqual(['inner', 'outer'])
    expect(Object.keys(o.nodePositions).sort()).toEqual(['a', 'b', 'c'])
    expect(o.edgeWaypoints).toEqual({ ab: [{ x: 200, y: 80 }] })
    // mutating the inputs afterwards cannot leak into the origin
    nodes[0].position.x = 999
    expect(o.nodePositions.a).toEqual({ x: 0, y: 0 })
    nodes[0].position.x = 0
  })

  it('applies origin + Δ: two successive deltas never accumulate, a zero Δ is the origin', () => {
    const o = origin()
    const r1 = applyMoveDelta(o, 10, 5)
    const r2 = applyMoveDelta(o, 30, -7)
    expect(r2.frameRects.outer).toEqual({ x: -10, y: -47, w: 720, h: 300 })
    expect(r2.frameRects.inner).toEqual({ x: 10, y: -27, w: 200, h: 100 })
    expect(r2.nodePositions.b).toEqual({ x: 290, y: -7 })
    expect(r2.edgeWaypoints.ab).toEqual([{ x: 230, y: 73 }])
    expect(r1.nodePositions.b).toEqual({ x: 270, y: 5 })
    expect(applyMoveDelta(o, 0, 0).nodePositions).toEqual(o.nodePositions)
    expect(applyMoveDelta(o, 0, 0).rect).toEqual(outer.rect)
  })

  it('frameOnly (Alt held at pointer-down) moves the dragged rect only — no nodes, no nested frames, no waypoints', () => {
    const o = captureMoveOrigin({
      frameId: 'outer',
      rect: outer.rect,
      isAuto: false,
      frameOnly: true,
      anchor: { x: 0, y: 0 },
      frames: [outer, inner],
      nodes,
      edges,
    })
    expect(Object.keys(o.nodePositions)).toEqual([])
    expect(Object.keys(o.frameRects)).toEqual(['outer'])
    expect(o.edgeWaypoints).toEqual({})
    const r = applyMoveDelta(o, 50, 50)
    expect(r.frameRects).toEqual({ outer: { x: 10, y: 10, w: 720, h: 300 } })
  })

  it('an AUTO frame keeps its own rect out of frameRects (it is a draft until promoted) but still carries its contents', () => {
    const o = captureMoveOrigin({
      frameId: 'auto1',
      rect: { x: -20, y: -20, w: 440, h: 100 },
      isAuto: true,
      frameOnly: false,
      anchor: { x: 0, y: 0 },
      frames: [inner],
      nodes,
      edges,
    })
    expect(Object.keys(o.frameRects)).toEqual(['inner'])
    expect(Object.keys(o.nodePositions).sort()).toEqual(['a', 'b'])
    expect(applyMoveDelta(o, 5, 5).rect).toEqual({ x: -15, y: -15, w: 440, h: 100 })
  })
})
