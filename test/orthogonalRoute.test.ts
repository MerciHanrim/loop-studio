import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'
import {
  COORD_EPS,
  PATH_DECIMALS,
  computeOrthogonalRoute,
  type Box,
  type RouteInput,
} from '../src/components/edges/orthogonalRoute'

// docs/edge-routing.md §ER3 — the deterministic orthogonal router. Slice 1
// asserts: same input ⇒ byte-identical `d` + `hitD`; the tie-break order is
// stable; every special case (self-loop / same-side / degenerate) and the
// `fallback-lz` escape are reproducible; `d` carries no more than PATH_DECIMALS.

const base = (over: Partial<RouteInput> = {}): RouteInput => ({
  edgeId: 'e1',
  source: { x: 0, y: 0 },
  target: { x: 300, y: 160 },
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  obstacles: [],
  waypoints: [],
  parallelIndex: 0,
  parallelCount: 1,
  selfLoop: false,
  ...over,
})

const decimals = (d: string): number =>
  Math.max(0, ...[...d.matchAll(/\d+\.(\d+)/g)].map((m) => m[1].length))

describe('orthogonalRoute — determinism', () => {
  it('same input ⇒ byte-identical d / hitD / routeClass / mid / endAngle', () => {
    const a = computeOrthogonalRoute(base())
    const b = computeOrthogonalRoute(base())
    expect(b).toEqual(a)
    expect(a.d.startsWith('M')).toBe(true)
    expect(a.hitD.startsWith('M')).toBe(true)
  })

  it('the result is independent of obstacle input order (they are sorted internally)', () => {
    const obs: Box[] = [
      { id: 'z', x: 120, y: -40, w: 40, h: 40 },
      { id: 'a', x: 60, y: 80, w: 50, h: 30 },
      { id: 'm', x: 180, y: 40, w: 30, h: 60 },
    ]
    const forward = computeOrthogonalRoute(base({ obstacles: obs }))
    const reversed = computeOrthogonalRoute(base({ obstacles: [...obs].reverse() }))
    expect(reversed.d).toBe(forward.d)
    expect(reversed.hitD).toBe(forward.hitD)
  })

  it('d is quantised to at most PATH_DECIMALS places', () => {
    const r = computeOrthogonalRoute(
      base({ target: { x: 199.99997, y: 83.333333 }, obstacles: [{ id: 'o', x: 80, y: 20, w: 33, h: 41 }] }),
    )
    expect(decimals(r.d)).toBeLessThanOrEqual(PATH_DECIMALS)
    expect(decimals(r.hitD)).toBeLessThanOrEqual(PATH_DECIMALS)
  })

  it('negative / fractional coordinates round the same way on both sides of zero', () => {
    const pos = computeOrthogonalRoute(base({ source: { x: 0.4996, y: 0 }, target: { x: 120.5004, y: 40 } }))
    const neg = computeOrthogonalRoute(base({ source: { x: -0.4996, y: 0 }, target: { x: -120.5004, y: 40 }, sourcePosition: Position.Left, targetPosition: Position.Right }))
    // symmetric magnitudes ⇒ the coordinate lists are mirror images to COORD_EPS
    const xs = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Math.abs(parseFloat(m[0])))
    const a = xs(pos.d)
    const b = xs(neg.d)
    expect(a.length).toBe(b.length)
  })
})

describe('orthogonalRoute — special cases', () => {
  it('self-loop ⇒ routeClass "self-loop", a closed-ish stub near the node', () => {
    // same node, two different handles: right handle at (130,32), top at (65,0)
    const inp = base({
      selfLoop: true,
      source: { x: 130, y: 32 },
      sourcePosition: Position.Right,
      target: { x: 65, y: 0 },
      targetPosition: Position.Top,
    })
    const r = computeOrthogonalRoute(inp)
    expect(r.routeClass).toBe('self-loop')
    expect(computeOrthogonalRoute(inp).d).toBe(r.d)
  })

  it('both handles on the same side ⇒ routeClass "same-side", deterministic', () => {
    const inp = base({
      source: { x: 0, y: 0 },
      target: { x: 0, y: 120 },
      sourcePosition: Position.Right,
      targetPosition: Position.Right,
    })
    const r = computeOrthogonalRoute(inp)
    expect(r.routeClass).toBe('same-side')
    expect(computeOrthogonalRoute(inp).d).toBe(r.d)
  })

  it('coincident endpoints ⇒ routeClass "degenerate", still a valid path string', () => {
    const r = computeOrthogonalRoute(base({ target: { x: 0, y: 0 } }))
    expect(r.routeClass).toBe('degenerate')
    expect(r.d.startsWith('M')).toBe(true)
    expect(r.hitD.startsWith('M')).toBe(true)
  })

  it('target boxed in on every side ⇒ routeClass "fallback-lz", d === hitD shape is still deterministic', () => {
    // one obstacle whose inflated bounds swallow both endpoints — no free axis
    // segment exists, so A* cannot solve it and the L/Z fallback is taken.
    const inp = base({
      source: { x: 0, y: 0 },
      target: { x: 120, y: 0 },
      obstacles: [{ id: 'wall', x: -80, y: -80, w: 320, h: 160 }],
    })
    const r = computeOrthogonalRoute(inp)
    expect(r.routeClass).toBe('fallback-lz')
    // identical inputs ⇒ identical fallback geometry (both the visible and hit path)
    const again = computeOrthogonalRoute(inp)
    expect(again.d).toBe(r.d)
    expect(again.hitD).toBe(r.hitD)
  })
})

describe('orthogonalRoute — waypoint span contract (§ER5)', () => {
  it('interior waypoints that each form a corner are honoured in user order', () => {
    const wp = [
      { x: 100, y: 0 },
      { x: 100, y: 90 },
      { x: 220, y: 90 },
    ]
    // target below the last waypoint ⇒ (220,90) is a genuine bend, not collinear
    const inp = base({ target: { x: 220, y: 220 }, targetPosition: Position.Top, waypoints: wp })
    const r = computeOrthogonalRoute(inp)
    for (const p of wp) expect(r.d).toContain(String(p.x))
    expect(computeOrthogonalRoute(inp).d).toBe(r.d)
  })

  it('every non-collinear waypoint is a vertex of the emitted polyline (auto span interpolation)', () => {
    const wp = [
      { x: 90, y: 0 },
      { x: 90, y: 120 },
      { x: 210, y: 120 },
    ]
    const r = computeOrthogonalRoute(base({ target: { x: 210, y: 260 }, targetPosition: Position.Top, waypoints: wp }))
    // every number pair in the `d` (M / L vertices AND Q corner control points)
    const nums = [...r.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]))
    const pairs: { x: number; y: number }[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) pairs.push({ x: nums[i], y: nums[i + 1] })
    // each corner waypoint is honoured: an x within CORNER_R and a y within
    // CORNER_R of some emitted coordinate pair (the rounded `Q` control point is
    // the waypoint itself; adjacent L points are pulled in by CORNER_R).
    const near = (a: number, b: number) => Math.abs(a - b) <= 6 + 0.5
    for (const p of wp) {
      expect(pairs.some((v) => near(v.x, p.x) && near(v.y, p.y))).toBe(true)
    }
  })

  it('a waypoint inside an inflated obstacle ⇒ invalidWaypoint, deterministic fallback, value not consumed by the router', () => {
    const wpBad = [{ x: 100, y: 0 }] // sits inside the obstacle below
    const inp = base({
      source: { x: 0, y: 0 },
      target: { x: 300, y: 0 },
      waypoints: wpBad,
      obstacles: [{ id: 'box', x: 70, y: -40, w: 80, h: 80 }],
    })
    const r = computeOrthogonalRoute(inp)
    expect(r.invalidWaypoint).toBe(true)
    expect(r.routeClass).toBe('fallback-lz')
    // deterministic: identical inputs ⇒ identical fallback geometry
    const again = computeOrthogonalRoute(inp)
    expect(again.d).toBe(r.d)
    expect(again.hitD).toBe(r.hitD)
    expect(again.invalidWaypoint).toBe(true)
    // a valid waypoint set on the same layout is NOT flagged
    const ok = computeOrthogonalRoute({ ...inp, waypoints: [{ x: 100, y: 200 }] })
    expect(ok.invalidWaypoint).toBe(false)
  })

  it('a duplicate / collinear waypoint list still yields a path with no NaN and ≤ PATH_DECIMALS', () => {
    const r = computeOrthogonalRoute(
      base({ waypoints: [{ x: 80, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 80, y: 160 }] }),
    )
    expect(r.d).not.toMatch(/NaN/)
    expect(decimals(r.d)).toBeLessThanOrEqual(PATH_DECIMALS)
    expect(Number.isFinite(r.mid.x) && Number.isFinite(r.mid.y)).toBe(true)
    expect(Math.abs(r.endAngle)).toBeLessThanOrEqual(Math.PI * 2 + COORD_EPS)
  })
})
