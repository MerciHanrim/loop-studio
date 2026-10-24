import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'
import {
  type Box,
  computeGuardedRoute,
  type GuardedInput,
  type GuardedResult,
  type Occupied,
  type Pt,
  ROUTE_STUB,
} from './orthogonalRoute'

// docs/edge-routing.md §ER14 (issue #344 step 2) — the guarded router's
// guarantees: own end nodes are obstacles, no node fill is ever crossed (only a
// connection's own port stub runs inside its own node), the clearance ladder and
// the outer corridor, the shared-trunk cost, determinism.

const box = (id: string, x: number, y: number, w = 120, h = 56): Box => ({ id, x, y, w, h })
const right = (b: Box): Pt => ({ x: b.x + b.w, y: b.y + 28 })
const left = (b: Box): Pt => ({ x: b.x, y: b.y + 28 })

/** a resource connection out of `s`'s right port into `t`'s left port */
const input = (s: Box, t: Box, others: Box[], extra: Partial<GuardedInput> = {}): GuardedInput => ({
  edgeId: 'e',
  source: right(s),
  target: left(t),
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  sourceBox: s,
  targetBox: t,
  obstacles: others,
  waypoints: [],
  parallelIndex: 0,
  parallelCount: 1,
  ...extra,
})

/** does the axis-aligned segment a→b cross the interior of box r? */
const crosses = (a: Pt, b: Pt, r: Box): boolean =>
  Math.max(a.x, b.x) > r.x + 1e-6 && Math.min(a.x, b.x) < r.x + r.w - 1e-6 && Math.max(a.y, b.y) > r.y + 1e-6 && Math.min(a.y, b.y) < r.y + r.h - 1e-6

/** the guarantee: between the two stubs no segment enters any fill (own end
 *  nodes included); the stubs enter no OTHER node */
function fillViolations(r: GuardedResult, inp: GuardedInput): string[] {
  const pts = r.points
  const own = [inp.sourceBox, inp.targetBox].filter((b): b is Box => b != null)
  const out: string[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const isStub = i === 1 || i === pts.length - 1
    for (const o of inp.obstacles) if (crosses(a, b, o)) out.push(`segment ${i} enters ${o.id}`)
    if (!isStub) for (const o of own) if (crosses(a, b, o)) out.push(`segment ${i} enters its own node ${o.id}`)
  }
  return out
}

/** a tiny seeded PRNG (mulberry32), so a failure is reproducible */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('guarded router — own end nodes are obstacles', () => {
  it('a backward connection (target left of source) goes around both of its own nodes', () => {
    const s = box('s', 400, 0)
    const t = box('t', 0, 0)
    const inp = input(s, t, [])
    const r = computeGuardedRoute(inp)
    expect(r.routeClass).toBe('orthogonal')
    expect(fillViolations(r, inp)).toEqual([])
    // it leaves along the port normal and turns only outside its own box
    expect(r.points[1].y).toBe(28)
    expect(r.points[1].x).toBeGreaterThan(s.x + s.w)
    expect(r.points[1].x).toBeLessThanOrEqual(s.x + s.w + ROUTE_STUB)
  })

  it('a self-loop goes around its node, never through it', () => {
    const n = box('n', 0, 0)
    const inp = input(n, n, [])
    const r = computeGuardedRoute(inp)
    expect(fillViolations(r, inp)).toEqual([])
    expect(r.points.length).toBeGreaterThan(4)
  })

  it('both ports on the same side route around, not through, the nodes', () => {
    const s = box('s', 0, 0)
    const t = box('t', 0, 200)
    const inp = input(s, t, [], { target: right(t), targetPosition: Position.Right })
    const r = computeGuardedRoute(inp)
    expect(fillViolations(r, inp)).toEqual([])
  })
})

describe('guarded router — no node fill is ever crossed', () => {
  it('random layouts: every route, on every rung, keeps out of every fill', () => {
    const classes: Record<string, number> = {}
    for (const seed of [1, 7, 42, 20261009]) {
      const r = rng(seed)
      for (let k = 0; k < 60; k++) {
        const boxes: Box[] = []
        const n = 6 + Math.floor(r() * 10)
        for (let i = 0; i < n; i++) {
          // a crowded board: gaps from 0 to ~60 px, so every rung is exercised
          const b = box(`n${i}`, Math.round(r() * 700), Math.round(r() * 400), 60 + Math.round(r() * 80), 40 + Math.round(r() * 40))
          if (!boxes.some((o) => o.x < b.x + b.w && b.x < o.x + o.w && o.y < b.y + b.h && b.y < o.y + o.h)) boxes.push(b)
        }
        if (boxes.length < 2) continue
        const s = boxes[0]
        const t = boxes[1]
        const inp = input(s, t, boxes.slice(2), { edgeId: `e${seed}-${k}` })
        const res = computeGuardedRoute(inp)
        classes[res.routeClass] = (classes[res.routeClass] ?? 0) + 1
        if (res.routeClass === 'blocked') continue // another node covers a port: reported, see below
        expect(fillViolations(res, inp), `seed ${seed} case ${k}: ${res.routeClass}`).toEqual([])
      }
    }
    // the corpus really reaches past the first rung
    expect(classes.orthogonal).toBeGreaterThan(0)
  })

  it('a gap narrower than the clearance is taken at a lower rung ("tight"), not crossed', () => {
    const s = box('s', 0, 100)
    const t = box('t', 400, 100)
    // the target sealed in a ring whose only opening is a 12 px slot in its
    // left wall, at the port row (y 122..134)
    const ring = [
      box('top', 300, 0, 260, 20),
      box('bottom', 300, 220, 260, 20),
      box('right', 540, 20, 20, 200),
      box('leftTop', 300, 20, 20, 102),
      box('leftBottom', 300, 134, 20, 86),
    ]
    const inp = input(s, t, ring)
    const r = computeGuardedRoute(inp)
    expect(fillViolations(r, inp)).toEqual([])
    expect(r.routeClass).toBe('tight')
    expect(r.clearance).toBeLessThan(12)
  })

  it('a target walled in on three sides is reached through the open side or the outer corridor', () => {
    const s = box('s', 0, 0)
    const t = box('t', 300, 200)
    const walls = [box('w1', 240, 140, 240, 20), box('w2', 240, 160, 20, 140), box('w3', 240, 300, 240, 20)]
    const inp = input(s, t, walls)
    const r = computeGuardedRoute(inp)
    expect(r.routeClass).not.toBe('blocked')
    expect(fillViolations(r, inp)).toEqual([])
  })

  it('another node over the port is the one case it cannot avoid: "blocked", and only the covering node is entered', () => {
    const s = box('s', 0, 0)
    const t = box('t', 400, 0)
    const cover = box('cover', 100, 0, 60, 56) // overlaps the source's right port region
    const far = box('far', 250, -100, 40, 300)
    const inp = input(s, t, [{ ...cover, x: 110 }, far])
    const r = computeGuardedRoute(inp)
    expect(r.routeClass).toBe('blocked')
    const entered = fillViolations(r, inp).filter((v) => !v.includes('cover'))
    expect(entered).toEqual([])
  })

  it('a waypoint inside a fill keeps its §ER4 cue but is not routed through', () => {
    const s = box('s', 0, 0)
    const t = box('t', 400, 0)
    const mid = box('mid', 200, -40, 60, 140)
    const inp = input(s, t, [mid], { waypoints: [{ x: 230, y: 30 }] })
    const r = computeGuardedRoute(inp)
    expect(r.invalidWaypoint).toBe(true)
    expect(fillViolations(r, inp)).toEqual([])
  })
})

describe('guarded router — the shared-trunk cost', () => {
  it('a second, unrelated connection takes its own lane when one exists', () => {
    const s = box('s', 0, 0)
    const t = box('t', 600, 300)
    const free = computeGuardedRoute(input(s, t, []))
    // the same corridor, already taken by an unrelated route
    const v = new Map<number, [number, number][]>()
    const h = new Map<number, [number, number][]>()
    for (let i = 1; i < free.points.length; i++) {
      const a = free.points[i - 1]
      const b = free.points[i]
      if (a.x === b.x) (v.get(a.x) ?? v.set(a.x, []).get(a.x)!).push([Math.min(a.y, b.y), Math.max(a.y, b.y)])
      else (h.get(a.y) ?? h.set(a.y, []).get(a.y)!).push([Math.min(a.x, b.x), Math.max(a.x, b.x)])
    }
    const occupied: Occupied = { v, h }
    const second = computeGuardedRoute(input(s, t, [], { occupied }))
    expect(second.d).not.toBe(free.d)
  })
})

// 2026-10-20 — two end nodes closer than two stubs: a full stub ended inside
// the other node, no search could leave it, and the last fallback drew the
// source's stub alone, so the line stopped short of (or ran past) its target.
// Measured under the previous body widths too: it predates the symbol nodes.
describe('guarded router — end nodes closer than two stubs', () => {
  const ends = (r: GuardedResult) => [r.points[0], r.points[r.points.length - 1]]
  // (at a 0 px gap these box-edge ports are one point: the degenerate case)
  for (const gap of [24, 16, 8, 4, 1]) {
    it(`facing at a ${gap} px gap: one straight line from port to port`, () => {
      const s = box('s', 0, 0, 56, 56)
      const t = box('t', 56 + gap, 0, 56, 56)
      const inp = input(s, t, [])
      const r = computeGuardedRoute(inp)
      expect(ends(r)).toEqual([inp.source, inp.target])
      expect(r.points).toHaveLength(2)
      expect(r.routeClass).not.toBe('blocked')
    })
  }
  for (const [what, t] of [
    ['offset by half a node, 8 px apart', box('t', 64, 28, 56, 56)],
    ['overlapping by 20 px', box('t', 36, 0, 56, 56)],
    ['overlapping and offset', box('t', 30, 40, 56, 56)],
  ] as const) {
    it(`${what}: the route still runs from the source's port to the target's`, () => {
      const s = box('s', 0, 0, 56, 56)
      const inp = input(s, t, [])
      const r = computeGuardedRoute(inp)
      expect(ends(r)).toEqual([inp.source, inp.target])
      // axis-aligned throughout
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1]
        const b = r.points[i]
        expect(a.x === b.x || a.y === b.y, `segment ${i}`).toBe(true)
      }
    })
  }
  it('touching boxes, ports inset on the outline (as a symbol\'s are): one straight line', () => {
    const s = box('s', 0, 0, 56, 56)
    const t = box('t', 56, 0, 56, 56)
    const inp = input(s, t, [], { source: { x: 43.17, y: 28 }, target: { x: 68.83, y: 28 } })
    const r = computeGuardedRoute(inp)
    expect(ends(r)).toEqual([inp.source, inp.target])
    expect(r.points).toHaveLength(2)
  })
  it('a stub still keeps its full length when the other end is far', () => {
    const s = box('s', 0, 0, 56, 56)
    const t = box('t', 56 + 4 * ROUTE_STUB, 200, 56, 56)
    const r = computeGuardedRoute(input(s, t, []))
    expect(r.stubs[1]).toEqual({ x: 56 + ROUTE_STUB, y: 28 })
    expect(r.stubs[2]).toEqual({ x: t.x - ROUTE_STUB, y: 228 })
  })
})

describe('guarded router — determinism', () => {
  it('the same input twice, and the obstacles in reverse order, give byte-identical routes', () => {
    const s = box('s', 0, 0)
    const t = box('t', 500, 200)
    const obs = [box('a', 200, -50), box('b', 220, 150), box('c', 380, 60, 60, 60)]
    const a = computeGuardedRoute(input(s, t, obs))
    const b = computeGuardedRoute(input(s, t, obs))
    const c = computeGuardedRoute(input(s, t, [...obs].reverse()))
    expect(b).toEqual(a)
    expect(c.d).toBe(a.d)
    expect(c.hitD).toBe(a.hitD)
  })
})

describe('guarded router — Manual orthogonal bend points (issue #344 step 3)', () => {
  /** is `p` on the polyline (a vertex or inside a segment)? */
  const onRoute = (pts: Pt[], p: Pt) =>
    pts.some((a, i) => {
      const b = pts[i + 1]
      if (!b) return a.x === p.x && a.y === p.y
      return (a.x === b.x && a.x === p.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) || (a.y === b.y && a.y === p.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x))
    })
  /** a vertex where the route goes straight back the way it came */
  const folds = (pts: Pt[]) =>
    pts.slice(1, -1).filter((b, i) => {
      const a = pts[i]
      const c = pts[i + 2]
      return (a.x === b.x && b.x === c.x && Math.sign(b.y - a.y) === -Math.sign(c.y - b.y)) || (a.y === b.y && b.y === c.y && Math.sign(b.x - a.x) === -Math.sign(c.x - b.x))
    })

  it('the route turns AT each bend point: it passes through every one and never folds back over itself', () => {
    // the case found on the canvas: a bend above the source row, then one below it
    const s = box('s', 0, 336, 145, 56)
    const t = box('t', 480, 448, 139, 56)
    const waypoints = [{ x: 304, y: 304 }, { x: 352, y: 448 }]
    const r = computeGuardedRoute(input(s, t, [], { waypoints }))
    for (const w of waypoints) expect(onRoute(r.points, w), `through (${w.x}, ${w.y})`).toBe(true)
    expect(folds(r.points)).toEqual([])
    expect(r.routeClass).toBe('orthogonal')
  })

  it('an automatic route (no bend points) is unchanged by the rule', () => {
    const s = box('s', 0, 0)
    const t = box('t', 480, 192)
    const auto = computeGuardedRoute(input(s, t, []))
    expect(auto.points.length).toBeGreaterThan(2)
    expect(folds(auto.points)).toEqual([])
  })

  // A bend point placed on a port's own stub (the standard gacha's `e_ssr_pity`:
  // 3 px short of the stub's end): the line leaves the port straight to it and
  // turns there — it does not run on to the stub's end, step aside and come back
  it('a bend point on the port’s own stub ends the stub there — source: out of the right port to the point, then down, no overshoot, no fold', () => {
    const s = box('s', 0, 0)
    const t = box('t', 400, 172)
    const port = right(s)
    const onStubPt = { x: port.x + ROUTE_STUB - 3, y: port.y }
    const waypoints = [onStubPt, { x: onStubPt.x, y: 200 }]
    const r = computeGuardedRoute(input(s, t, [], { waypoints }))
    expect(r.points[0]).toEqual(port)
    expect(r.points[1], JSON.stringify(r.points)).toEqual(onStubPt)
    expect(r.points.every((p) => p.x <= onStubPt.x || p.y >= 200 - 1e-6), 'nothing past the point before the turn').toBe(true)
    expect(folds(r.points)).toEqual([])
    expect(r.stubs[1]).toEqual(onStubPt)
  })

  // (a guard: the target side already turns in there without the rule)
  it('a bend point on the target port’s own stub: the point is where the line turns in', () => {
    const s = box('s', 0, 0)
    const t = box('t', 400, 172)
    const port = left(t)
    const onStubPt = { x: port.x - ROUTE_STUB + 3, y: port.y }
    const waypoints = [{ x: onStubPt.x, y: 28 }, onStubPt]
    const r = computeGuardedRoute(input(s, t, [], { waypoints }))
    const n = r.points.length
    expect(r.points[n - 1]).toEqual(port)
    expect(r.points[n - 2], JSON.stringify(r.points)).toEqual(onStubPt)
    expect(folds(r.points)).toEqual([])
  })

  it('a bend point on the stub: the line still leaves along the port’s normal, on every face', () => {
    const s = box('s', 200, 200)
    const t = box('t', 600, 600)
    const faces: [Position, Pt, Pt][] = [
      [Position.Right, right(s), { x: 1, y: 0 }],
      [Position.Left, left(s), { x: -1, y: 0 }],
      [Position.Top, { x: s.x + 60, y: s.y }, { x: 0, y: -1 }],
      [Position.Bottom, { x: s.x + 60, y: s.y + s.h }, { x: 0, y: 1 }],
    ]
    for (const [pos, port, n] of faces) {
      const onStubPt = { x: port.x + n.x * (ROUTE_STUB - 4), y: port.y + n.y * (ROUTE_STUB - 4) }
      const next = n.x !== 0 ? { x: onStubPt.x, y: onStubPt.y + 120 } : { x: onStubPt.x + 120, y: onStubPt.y }
      const r = computeGuardedRoute(input(s, t, [], { source: port, sourcePosition: pos, waypoints: [onStubPt, next] }))
      const [a, b] = r.points
      expect(a, pos).toEqual(port)
      expect(Math.sign(b.x - a.x) === n.x && Math.sign(b.y - a.y) === n.y, `${pos}: first segment along the normal, ${JSON.stringify(r.points)}`).toBe(true)
      expect(folds(r.points), pos).toEqual([])
    }
  })

  it('a bend point on the source stub leaves the target end alone: its stub (the arrow’s room) is the full one', () => {
    const s = box('s', 0, 0)
    const t = box('t', 400, 172)
    const port = right(s)
    const r = computeGuardedRoute(input(s, t, [], { waypoints: [{ x: port.x + 6, y: port.y }, { x: port.x + 6, y: 200 }] }))
    const tgt = left(t)
    expect(r.stubs[2]).toEqual({ x: tgt.x - ROUTE_STUB, y: tgt.y })
    const n = r.points.length
    expect(r.points[n - 1]).toEqual(tgt)
    expect(tgt.x - r.points[n - 2].x, 'the last segment is at least a stub long').toBeGreaterThanOrEqual(ROUTE_STUB - 1e-6)
  })

  it('a bend point on the source stub: the route after it still keeps off every node', () => {
    const s = box('s', 0, 0)
    const t = box('t', 480, 0)
    const wall = box('wall', 200, -80, 60, 220)
    const port = right(s)
    const w = { x: port.x + 8, y: port.y }
    const inp = input(s, t, [wall], { waypoints: [w] })
    const r = computeGuardedRoute(inp)
    // the point is passed (on a straight run on, it is not a vertex of its own)
    expect(onRoute(r.points, w)).toBe(true)
    expect(r.stubs[1]).toEqual(w)
    expect(fillViolations(r, inp)).toEqual([])
    expect(folds(r.points)).toEqual([])
  })

  it('not at a fan’s port: with siblings on the port its branch points stay, the bend point is routed to', () => {
    const s = box('s', 0, 0)
    const t = box('t', 400, 172)
    const port = right(s)
    const w = { x: port.x + 6, y: port.y }
    const r = computeGuardedRoute(input(s, t, [], { waypoints: [w, { x: w.x, y: 200 }], sourceFan: { len: ROUTE_STUB, side: 1 } }))
    expect(r.stubs[1]).toEqual({ x: port.x + ROUTE_STUB, y: port.y })
    expect(onRoute(r.points, w)).toBe(true)
  })

  it('a bend point beyond the stub, or off the port’s line, is routed to as before', () => {
    const s = box('s', 0, 0)
    const t = box('t', 400, 172)
    const port = right(s)
    for (const w of [{ x: port.x + ROUTE_STUB + 8, y: port.y }, { x: port.x + 8, y: port.y + 40 }]) {
      const r = computeGuardedRoute(input(s, t, [], { waypoints: [w] }))
      expect(r.stubs[1]).toEqual({ x: port.x + ROUTE_STUB, y: port.y })
      expect(onRoute(r.points, w), `through (${w.x}, ${w.y})`).toBe(true)
    }
  })
})
