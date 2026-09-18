// docs/edge-routing.md §ER3 — the deterministic orthogonal connector.
//
// PURE and RENDER-ONLY. Given the same layout + handles + waypoints it returns a
// byte-identical route (`d` + hit-path `d` + routeClass), independent of browser
// or node/edge input order. Nothing here is wire content (SEMANTICS-R3.md §R3-9);
// no RNG.

import { Position } from '@xyflow/react'

// ── ER3.1 constants (world px) ──────────────────────────────────────────────
export const ROUTE_PAD = 12
export const ROUTE_STUB = 16
export const BEND_COST = 20
export const PARALLEL_GAP = 10
export const CORNER_R = 6
export const SELF_LOOP = 28
export const COORD_EPS = 1e-3
export const PATH_DECIMALS = 2
export const MAX_EXPANSIONS = 20000
export const ROUTER_VERSION = 1

export type RouteClass = 'orthogonal' | 'self-loop' | 'same-side' | 'fallback-lz' | 'degenerate'
export type Pt = { x: number; y: number }
export type Box = { id: string; x: number; y: number; w: number; h: number }

export type RouteInput = {
  edgeId: string
  source: Pt
  target: Pt
  sourcePosition: Position
  targetPosition: Position
  /** edge's own endpoints excluded by the caller */
  obstacles: Box[]
  /** interior pinned points, in user order, verbatim */
  waypoints: Pt[]
  /** index within its parallel set (sorted by edge id) and the set size */
  parallelIndex: number
  parallelCount: number
  selfLoop: boolean
}

export type RouteResult = {
  d: string
  hitD: string
  routeClass: RouteClass
  mid: Pt
  endAngle: number
  /** docs/edge-routing.md §ER4 — ≥ 1 manual waypoint sits inside an inflated
   *  obstacle. The value is still kept on the wire; the edge shows the §VL3
   *  dashed `--warning` cue and the route falls back deterministically. */
  invalidWaypoint: boolean
}

// ── numeric normalisation (§ER3.5) ─────────────────────────────────────────
const z0 = (n: number): number => (n === 0 ? 0 : n)
/** round-half-away-from-zero to COORD_EPS; symmetric about 0 */
const q = (v: number): number => z0(Math.sign(v) * Math.round(Math.abs(v) / COORD_EPS) * COORD_EPS)
const near = (a: number, b: number): boolean => Math.abs(a - b) <= COORD_EPS
/** total order: signed value, then used only where a tiebreak is needed */
const cmpNum = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0)

const normal = (p: Position): Pt =>
  p === Position.Left ? { x: -1, y: 0 } : p === Position.Right ? { x: 1, y: 0 } : p === Position.Top ? { x: 0, y: -1 } : { x: 0, y: 1 }
const isHoriz = (p: Position): boolean => p === Position.Left || p === Position.Right

function inflate(b: Box): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: b.x - ROUTE_PAD, y0: b.y - ROUTE_PAD, x1: b.x + b.w + ROUTE_PAD, y1: b.y + b.h + ROUTE_PAD }
}
type IBox = { x0: number; y0: number; x1: number; y1: number }
const ptInside = (p: Pt, r: IBox): boolean => p.x > r.x0 + COORD_EPS && p.x < r.x1 - COORD_EPS && p.y > r.y0 + COORD_EPS && p.y < r.y1 - COORD_EPS

/** does the axis-aligned segment a→b cross the interior of r? (touching an edge is OK) */
function segHitsBox(a: Pt, b: Pt, r: IBox): boolean {
  const xlo = Math.min(a.x, b.x)
  const xhi = Math.max(a.x, b.x)
  const ylo = Math.min(a.y, b.y)
  const yhi = Math.max(a.y, b.y)
  return xhi > r.x0 + COORD_EPS && xlo < r.x1 - COORD_EPS && yhi > r.y0 + COORD_EPS && ylo < r.y1 - COORD_EPS
}
const segFree = (a: Pt, b: Pt, rs: IBox[]): boolean => !rs.some((r) => segHitsBox(a, b, r))

// ── path string (§ER3.5 corners) ──────────────────────────────────────────
const f = (n: number): string => {
  const r = Number(n.toFixed(PATH_DECIMALS))
  return String(r === 0 ? 0 : r)
}

function pointsToPath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${f(pts[0].x)} ${f(pts[0].y)}`
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const prev = pts[i - 1]
    const next = pts[i + 1]
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y)
    const outLen = Math.hypot(next.x - p.x, next.y - p.y)
    const rad = Math.min(CORNER_R, inLen / 2, outLen / 2)
    if (rad < CORNER_R - COORD_EPS && (inLen < 2 * CORNER_R || outLen < 2 * CORNER_R)) {
      d += ` L ${f(p.x)} ${f(p.y)}`
      continue
    }
    const dirIn = { x: Math.sign(p.x - prev.x), y: Math.sign(p.y - prev.y) }
    const dirOut = { x: Math.sign(next.x - p.x), y: Math.sign(next.y - p.y) }
    const a = { x: p.x - dirIn.x * rad, y: p.y - dirIn.y * rad }
    const c = { x: p.x + dirOut.x * rad, y: p.y + dirOut.y * rad }
    d += ` L ${f(a.x)} ${f(a.y)} Q ${f(p.x)} ${f(p.y)} ${f(c.x)} ${f(c.y)}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${f(last.x)} ${f(last.y)}`
  return d
}
const pointsToPoly = (pts: Pt[]): string =>
  pts.length ? `M ${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join(' L ')}` : ''

// ── post-process: drop zero-length + collinear (§ER3.5) ────────────────────
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && near(last.x, p.x) && near(last.y, p.y)) continue
    out.push({ x: q(p.x), y: q(p.y) })
  }
  const res: Pt[] = []
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && i < out.length - 1) {
      const a = res[res.length - 1]
      const b = out[i]
      const c = out[i + 1]
      const collx = near(a.x, b.x) && near(b.x, c.x)
      const colly = near(a.y, b.y) && near(b.y, c.y)
      if (collx || colly) continue
    }
    res.push(out[i])
  }
  return res
}

// ── the ruler grid + A* (§ER3.3–§ER3.4) ───────────────────────────────────
//
// The ruler grid, the free-point rule, the neighbour rule, the cost function,
// the tie-break order and the MAX_EXPANSIONS accounting are all exactly as
// specified — this is the same search finding the same answer. What differs
// from the obvious implementation is only the bookkeeping, because the pause
// after a node drag is ~98 % this function:
//
//   1. LATTICE INDEXING. Every search node is a grid point (i, j) of the ruler
//      grid, identified by `i * NY + j`. The string keys ("12,34") and the four
//      Maps keyed by them become typed arrays indexed by that id.
//   2. PER-RULER COVERAGE. A point is blocked iff some inflated obstacle covers
//      both its x ruler and its y ruler, and an axis-aligned segment is blocked
//      iff some obstacle covering its fixed ruler straddles its span. So the
//      obstacles covering each ruler line are gathered once per edge (`coverX`
//      / `coverY`) instead of scanning every obstacle for every point and every
//      segment probe.
//   3. BINARY HEAP with lazy deletion for the open list, instead of an O(n)
//      scan plus an `includes` test on every push.
//
// (2) and (3) are where the time went: `ptInside` / `segHitsBox` were the two
// largest self-time entries in the drop profile, and the open-list scan the
// third. `test/orthogonalRoute.differential.test.ts` holds this to
// byte-identical output against a frozen copy of the previous implementation.
//
// On (3), the one place where "same answer" is not self-evident: the previous
// implementation kept ONE open entry per node and re-read that node's LIVE
// g / bends at pick time, so improving a node re-ordered it immediately. A heap
// cannot re-order in place, so a fresh entry carrying the live key is pushed on
// every improvement, and an entry whose key no longer matches the node's live
// values is skipped when popped. A skipped pop is NOT an expansion — the
// previous implementation never saw such an entry — so the expansion budget,
// and with it the `fallback-lz` decision, is reached at exactly the same point.
//
// Note also that the pick order is a strict TOTAL order: f, then g, then x,
// then y, over distinct lattice points. No two open entries can compare equal,
// so the order in which neighbours are discovered cannot change the result.

/** open-list entry: a node id plus the key it was pushed with */
type Open = { f: number; g: number; x: number; y: number; id: number }

function buildRoute(a: Pt, goal: Pt, aPos: Position | null, bPos: Position | null, rs: IBox[]): Pt[] | null {
  // rulers
  const xs = new Set<number>([q(a.x), q(goal.x)])
  const ys = new Set<number>([q(a.y), q(goal.y)])
  for (const r of rs) {
    xs.add(q(r.x0)); xs.add(q(r.x1)); ys.add(q(r.y0)); ys.add(q(r.y1))
  }
  const xArr = [...xs].sort(cmpNum)
  const yArr = [...ys].sort(cmpNum)
  // wide-channel midpoints
  for (let i = 1; i < xArr.length; i++) if (xArr[i] - xArr[i - 1] > 2 * ROUTE_PAD) xs.add(q((xArr[i] + xArr[i - 1]) / 2))
  for (let i = 1; i < yArr.length; i++) if (yArr[i] - yArr[i - 1] > 2 * ROUTE_PAD) ys.add(q((yArr[i] + yArr[i - 1]) / 2))
  const X = [...xs].sort(cmpNum)
  const Y = [...ys].sort(cmpNum)
  const NX = X.length
  const NY = Y.length

  // which inflated obstacles strictly cover each ruler line — per axis, the
  // same strict test `ptInside` applies
  const coverX: number[][] = new Array(NX)
  for (let i = 0; i < NX; i++) {
    const x = X[i]
    const l: number[] = []
    for (let k = 0; k < rs.length; k++) if (x > rs[k].x0 + COORD_EPS && x < rs[k].x1 - COORD_EPS) l.push(k)
    coverX[i] = l
  }
  const coverY: number[][] = new Array(NY)
  for (let j = 0; j < NY; j++) {
    const y = Y[j]
    const l: number[] = []
    for (let k = 0; k < rs.length; k++) if (y > rs[k].y0 + COORD_EPS && y < rs[k].y1 - COORD_EPS) l.push(k)
    coverY[j] = l
  }

  const startI = X.indexOf(q(a.x))
  const startJ = Y.indexOf(q(a.y))
  const goalI = X.indexOf(q(goal.x))
  const goalJ = Y.indexOf(q(goal.y))
  const startId = startI * NY + startJ
  const goalId = goalI * NY + goalJ

  // which lattice points exist: the free ones, plus the two endpoints, which are
  // kept even when they sit inside an inflated obstacle
  // Asked per cell, that is "does some obstacle cover BOTH my x ruler and my y
  // ruler", i.e. `coverX[i] ∩ coverY[j] ≠ ∅` — which is the same as "does this
  // cell lie strictly inside some obstacle". Walking the obstacles answers it
  // once each instead of once per cell: an obstacle covers a contiguous block of
  // rulers on each axis, so clearing that block is the whole job. A*
  // subsequently expands 3-4 % of these cells, so building the grid dominated
  // the search it exists to serve.
  const exists = new Uint8Array(NX * NY).fill(1)
  // `ptInside` is strict on both sides (`v > x0 + EPS` and `v < x1 - EPS`), so
  // the block starts at the first ruler strictly ABOVE the low bound and ends
  // before the first ruler AT OR ABOVE the high bound. Using the same bound for
  // both would include a ruler sitting exactly on `x1 - EPS`, which the strict
  // test excludes — and that ruler is where a route hugging the obstacle runs.
  const firstAbove = (arr: number[], v: number): number => {
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid] > v) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  const firstAtLeast = (arr: number[], v: number): number => {
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid] >= v) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  for (let k = 0; k < rs.length; k++) {
    const r = rs[k]
    const i0 = firstAbove(X, r.x0 + COORD_EPS)
    const i1 = firstAtLeast(X, r.x1 - COORD_EPS)
    if (i0 >= i1) continue
    const j0 = firstAbove(Y, r.y0 + COORD_EPS)
    const j1 = firstAtLeast(Y, r.y1 - COORD_EPS)
    if (j0 >= j1) continue
    for (let i = i0; i < i1; i++) {
      const base = i * NY
      exists.fill(0, base + j0, base + j1)
    }
  }
  exists[startId] = 1
  exists[goalId] = 1
  if (!exists[startId] || !exists[goalId]) return null

  /** is the vertical segment on ruler X[i], spanning Y[j0]..Y[j1] (j0 < j1), blocked? */
  const blockedV = (i: number, j0: number, j1: number): boolean => {
    const cx = coverX[i]
    const ylo = Y[j0]
    const yhi = Y[j1]
    for (let m = 0; m < cx.length; m++) {
      const r = rs[cx[m]]
      if (yhi > r.y0 + COORD_EPS && ylo < r.y1 - COORD_EPS) return true
    }
    return false
  }
  /** is the horizontal segment on ruler Y[j], spanning X[i0]..X[i1] (i0 < i1), blocked? */
  const blockedH = (j: number, i0: number, i1: number): boolean => {
    const cy = coverY[j]
    const xlo = X[i0]
    const xhi = X[i1]
    for (let m = 0; m < cy.length; m++) {
      const r = rs[cy[m]]
      if (xhi > r.x0 + COORD_EPS && xlo < r.x1 - COORD_EPS) return true
    }
    return false
  }

  const N = NX * NY
  const g = new Float64Array(N).fill(Infinity)
  const bends = new Int32Array(N)
  const dir = new Int8Array(N) // 0 = none, 1 = horizontal, 2 = vertical
  const from = new Int32Array(N).fill(-1)
  g[startId] = 0
  dir[startId] = aPos ? (isHoriz(aPos) ? 1 : 2) : 0

  // the heuristic measures to the RAW goal, not to its ruler line: `goal` is an
  // anchor (a stub end or a user waypoint) and is not quantised, so when it
  // falls between two COORD_EPS steps the two differ by up to half a step. That
  // is enough to decide an otherwise tied pair of L-shaped routes, so it is not
  // a rounding detail — it is part of the specified pick order.
  const gx = goal.x
  const gy = goal.y
  // `h` is summed on its own and only then added to `g`. Floating-point
  // addition is not associative, so `g + (|dx| + |dy|)` and `(g + |dx|) + |dy|`
  // can differ in the last bit — and f ties are decided by the g tie-break, so
  // a last-bit difference silently picks the other route. Same grouping as the
  // previous implementation, deliberately.
  const hOf = (i: number, j: number): number => Math.abs(X[i] - gx) + Math.abs(Y[j] - gy)
  const fOf = (id: number, i: number, j: number): number => g[id] + hOf(i, j) + bends[id] * BEND_COST

  const heap: Open[] = []
  const less = (A: Open, B: Open): boolean =>
    A.f < B.f ||
    (A.f === B.f && (A.g < B.g || (A.g === B.g && (cmpNum(A.x, B.x) < 0 || (A.x === B.x && cmpNum(A.y, B.y) < 0)))))
  const push = (e: Open): void => {
    heap.push(e)
    let k = heap.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (!less(heap[k], heap[p])) break
      const t = heap[k]; heap[k] = heap[p]; heap[p] = t
      k = p
    }
  }
  const pop = (): Open => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < heap.length && less(heap[l], heap[m])) m = l
        if (r < heap.length && less(heap[r], heap[m])) m = r
        if (m === k) break
        const t = heap[k]; heap[k] = heap[m]; heap[m] = t
        k = m
      }
    }
    return top
  }

  push({ f: fOf(startId, startI, startJ), g: 0, x: X[startI], y: Y[startJ], id: startId })
  let expansions = 0

  while (heap.length > 0) {
    const e = pop()
    const cur = e.id
    const ci = (cur / NY) | 0
    const cj = cur - ci * NY
    if (e.g !== g[cur] || e.f !== fOf(cur, ci, cj)) continue // superseded entry
    if (cur === goalId) break
    if (++expansions > MAX_EXPANSIONS) return null

    // the nearest existing lattice point in each of the four directions
    for (let d = 0; d < 4; d++) {
      let ni = ci
      let nj = cj
      if (d === 0) {
        let j = cj - 1
        while (j >= 0 && !exists[ci * NY + j]) j--
        if (j < 0 || blockedV(ci, j, cj)) continue
        nj = j
      } else if (d === 1) {
        let j = cj + 1
        while (j < NY && !exists[ci * NY + j]) j++
        if (j >= NY || blockedV(ci, cj, j)) continue
        nj = j
      } else if (d === 2) {
        let i = ci - 1
        while (i >= 0 && !exists[i * NY + cj]) i--
        if (i < 0 || blockedH(cj, i, ci)) continue
        ni = i
      } else {
        let i = ci + 1
        while (i < NX && !exists[i * NY + cj]) i++
        if (i >= NX || blockedH(cj, ci, i)) continue
        ni = i
      }

      const nb = ni * NY + nj
      // `near`, not index equality: two ruler lines can sit exactly COORD_EPS
      // apart, and a step between them counts as vertical for the bend test.
      const stepDir = near(X[ni], X[ci]) ? 2 : 1
      const prevDir = dir[cur]
      const turn = prevDir !== 0 && prevDir !== stepDir ? 1 : 0
      const ng = g[cur] + Math.abs(X[ni] - X[ci]) + Math.abs(Y[nj] - Y[cj])
      const nbn = bends[cur] + turn
      const curG = g[nb]
      const better = curG === Infinity ? true : ng !== curG ? ng < curG : nbn !== bends[nb] ? nbn < bends[nb] : false
      if (!better) continue
      g[nb] = ng
      bends[nb] = nbn
      dir[nb] = stepDir
      from[nb] = cur
      push({ f: fOf(nb, ni, nj), g: ng, x: X[ni], y: Y[nj], id: nb })
    }
  }
  if (g[goalId] === Infinity) return null

  const path: Pt[] = []
  for (let c = goalId; c >= 0; c = from[c]) {
    const i = (c / NY) | 0
    path.push({ x: X[i], y: Y[c - i * NY] })
  }
  path.reverse()
  // the exit / entry direction is enforced by the stubs the caller already applied
  void bPos
  return path
}

// ── special cases (§ER3.6) ────────────────────────────────────────────────
function selfLoopRoute(inp: RouteInput): Pt[] {
  const n = normal(inp.sourcePosition)
  const s = inp.source
  const a = { x: s.x + n.x * ROUTE_STUB, y: s.y + n.y * ROUTE_STUB }
  const side = isHoriz(inp.sourcePosition)
  const b = side ? { x: a.x, y: a.y - SELF_LOOP } : { x: a.x - SELF_LOOP, y: a.y }
  const cc = side ? { x: s.x, y: b.y } : { x: b.x, y: s.y }
  return simplify([s, a, b, cc, inp.target])
}

function lzRoute(a: Pt, b: Pt, aPos: Position): Pt[] {
  const horizFirst = isHoriz(aPos)
  const mid = horizFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
  return simplify([a, mid, b])
}

// ── the entry point ───────────────────────────────────────────────────────
export function computeOrthogonalRoute(inp: RouteInput): RouteResult {
  const fanOffset = (inp.parallelIndex - (inp.parallelCount - 1) / 2) * PARALLEL_GAP
  const sN = normal(inp.sourcePosition)
  const tN = normal(inp.targetPosition)
  const perpS = isHoriz(inp.sourcePosition) ? { x: 0, y: fanOffset } : { x: fanOffset, y: 0 }
  const perpT = isHoriz(inp.targetPosition) ? { x: 0, y: fanOffset } : { x: fanOffset, y: 0 }
  const src = { x: inp.source.x + perpS.x, y: inp.source.y + perpS.y }
  const tgt = { x: inp.target.x + perpT.x, y: inp.target.y + perpT.y }

  // §ER4 — set once the obstacle set is known; a manual waypoint landing inside
  // an inflated obstacle keeps its value but flags the edge + forces the fallback.
  let invalidWp = false

  const done = (pts: Pt[], cls: RouteClass): RouteResult => {
    const s = simplify(pts.length ? pts : [src, tgt])
    // arc-length midpoint of the polyline, for the label
    let total = 0
    for (let i = 1; i < s.length; i++) total += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y)
    let acc = 0
    let mid: Pt = s[0] ?? { x: src.x, y: src.y }
    for (let i = 1; i < s.length; i++) {
      const seg = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y)
      if (acc + seg >= total / 2) {
        const r = seg > 0 ? (total / 2 - acc) / seg : 0
        mid = { x: s[i - 1].x + (s[i].x - s[i - 1].x) * r, y: s[i - 1].y + (s[i].y - s[i - 1].y) * r }
        break
      }
      acc += seg
    }
    const p = s.length >= 2 ? s[s.length - 2] : { x: src.x, y: src.y }
    const e2 = s[s.length - 1] ?? { x: tgt.x, y: tgt.y }
    const endAngle = Math.atan2(e2.y - p.y, e2.x - p.x)
    return { d: pointsToPath(s), hitD: pointsToPoly(s), routeClass: cls, mid, endAngle, invalidWaypoint: invalidWp }
  }

  if (near(src.x, tgt.x) && near(src.y, tgt.y)) {
    return done([src, { x: src.x + sN.x, y: src.y + sN.y }], 'degenerate')
  }
  if (inp.selfLoop) return done(selfLoopRoute({ ...inp, source: src, target: tgt }), 'self-loop')

  const stubA = { x: src.x + sN.x * ROUTE_STUB, y: src.y + sN.y * ROUTE_STUB }
  const stubB = { x: tgt.x + tN.x * ROUTE_STUB, y: tgt.y + tN.y * ROUTE_STUB }
  const rs = inp.obstacles.map(inflate)
  invalidWp = inp.waypoints.some((w) => {
    const p = { x: q(w.x), y: q(w.y) }
    return rs.some((r) => ptInside(p, r))
  })

  // same-side handles → deterministic C: both stubs face the shared normal, an
  // outer segment ROUTE_PAD beyond the furthest stub, then back.
  if (inp.sourcePosition === inp.targetPosition) {
    const horiz = isHoriz(inp.sourcePosition)
    const out = horiz
      ? sN.x > 0
        ? Math.max(stubA.x, stubB.x) + ROUTE_PAD
        : Math.min(stubA.x, stubB.x) - ROUTE_PAD
      : sN.y > 0
        ? Math.max(stubA.y, stubB.y) + ROUTE_PAD
        : Math.min(stubA.y, stubB.y) - ROUTE_PAD
    const c1 = horiz ? { x: out, y: src.y } : { x: src.x, y: out }
    const c2 = horiz ? { x: out, y: tgt.y } : { x: tgt.x, y: out }
    return done([src, c1, c2, tgt], 'same-side')
  }

  // build the pinned spans (endpoints + waypoints), A* each
  const anchors: Pt[] = [stubA, ...inp.waypoints.map((p) => ({ x: q(p.x), y: q(p.y) })), stubB]
  const full: Pt[] = [src]
  for (let i = 0; i < anchors.length - 1; i++) {
    const seg = buildRoute(anchors[i], anchors[i + 1], i === 0 ? inp.sourcePosition : null, i === anchors.length - 2 ? inp.targetPosition : null, rs)
    if (!seg) return done(lzRoute(src, tgt, inp.sourcePosition), 'fallback-lz')
    full.push(...(i === 0 ? seg : seg.slice(1)))
  }
  full.push(tgt)

  const simplified = simplify(full)
  // final padding re-check (§ER3.5)
  for (let i = 1; i < simplified.length; i++) {
    if (!segFree(simplified[i - 1], simplified[i], rs)) {
      return done(lzRoute(src, tgt, inp.sourcePosition), 'fallback-lz')
    }
  }
  return done(simplified, 'orthogonal')
}
