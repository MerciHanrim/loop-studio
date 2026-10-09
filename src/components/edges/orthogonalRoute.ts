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

function inflate(b: Box, pad: number = ROUTE_PAD): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: b.x - pad, y0: b.y - pad, x1: b.x + b.w + pad, y1: b.y + b.h + pad }
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

/** issue #344 step 2 — the segments other routes already run along, by ruler
 *  line: `v` keyed by x (each a y interval), `h` keyed by y. `vx` / `hy` are
 *  the sorted keys, for the crossing count. */
export type Occupied = {
  v: Map<number, [number, number][]>
  h: Map<number, [number, number][]>
  vx?: number[]
  hy?: number[]
}

/** optional search inputs of the guarded router (§ER3 v2); absent ⇒ exactly the
 *  v1 search */
type SearchOpts = {
  /** shared-trunk cost: every px a step runs along an occupied segment costs
   *  `TRUNK_COST` px more */
  occ?: Occupied
  /** the routes of the same port's fan, past their stubs: every px a step runs
   *  along one costs `FAN_COST` px more (a fan splits after its stub) */
  fan?: Occupied
  /** extra ruler lines (the outer corridor of the last rung) */
  extraX?: number[]
  extraY?: number[]
  maxExpansions?: number
  /** the only move allowed out of the start (0 up, 1 down, 2 left, 3 right) */
  firstDir?: number
  /** the only move allowed into the goal */
  lastDir?: number
  /** issue #344 step 3 — the move the route ARRIVED at the start with (a bend
   *  point between two spans): leaving along it is free, turning is one bend,
   *  and going straight back counts as two (a U-turn), so a Manual route turns
   *  at its bend point instead of folding back over itself */
  arrive?: number
}

/** issue #344 step 2 — the extra cost per px of running along an unrelated
 *  route (so two unrelated connections do not share a trunk when another lane
 *  exists) */
export const TRUNK_COST = 2

/** issue #344 step 2 — the extra cost of crossing a route already placed, in px
 *  (the same order as a bend: a detour of about one bend is worth one crossing
 *  fewer) */
export const CROSS_COST = BEND_COST

/** issue #344 step 2 (§ER14.3) — the extra cost per px of running along another
 *  connection of the same port past its stub: high enough that a lane one
 *  `PARALLEL_GAP` aside (two bends) is always cheaper */
export const FAN_COST = 40

/** how many segments of the sorted-key index `keys` / `map` lie strictly inside
 *  (lo, hi) and span `at` strictly — the perpendicular segments a step crosses */
function crossCount(keys: number[] | undefined, map: Map<number, [number, number][]>, lo: number, hi: number, at: number): number {
  if (!keys || keys.length === 0) return 0
  let a = 0
  let b = keys.length
  while (a < b) {
    const m = (a + b) >> 1
    if (keys[m] > lo + COORD_EPS) b = m
    else a = m + 1
  }
  let n = 0
  for (let k = a; k < keys.length && keys[k] < hi - COORD_EPS; k++) {
    for (const [y0, y1] of map.get(keys[k])!) if (at > y0 + COORD_EPS && at < y1 - COORD_EPS) n++
  }
  return n
}

/** the length of [lo, hi] covered by the intervals of `list` */
function overlapLen(list: [number, number][] | undefined, lo: number, hi: number): number {
  if (!list) return 0
  let s = 0
  for (const [a, b] of list) {
    const o = Math.min(hi, b) - Math.max(lo, a)
    if (o > 0) s += o
  }
  return s
}

/** the search as steps: it pauses (yields) every `SEARCH_SLICE` expansions,
 *  so a long search can be spread over several slices of a sliced generation
 *  (§ER14.5). `buildRoute` runs it to the end. */
function* buildRouteSteps(a: Pt, goal: Pt, aPos: Position | null, bPos: Position | null, rs: IBox[], opts?: SearchOpts): Generator<string, Pt[] | null> {
  // rulers
  const xs = new Set<number>([q(a.x), q(goal.x)])
  const ys = new Set<number>([q(a.y), q(goal.y)])
  for (const r of rs) {
    xs.add(q(r.x0)); xs.add(q(r.x1)); ys.add(q(r.y0)); ys.add(q(r.y1))
  }
  if (opts?.extraX) for (const x of opts.extraX) xs.add(q(x))
  if (opts?.extraY) for (const y of opts.extraY) ys.add(q(y))
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
  const arrive = opts?.arrive
  dir[startId] = aPos ? (isHoriz(aPos) ? 1 : 2) : arrive != null ? (arrive < 2 ? 2 : 1) : 0
  // the move straight back along `arrive` (0 up ↔ 1 down, 2 left ↔ 3 right)
  const back = arrive == null ? -1 : arrive ^ 1

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
  const maxExp = opts?.maxExpansions ?? MAX_EXPANSIONS
  const firstDir = opts?.firstDir
  const lastDir = opts?.lastDir
  const occ = opts?.occ
  // the surcharge of one axis-aligned step (0 without `occ`): running along an
  // occupied segment (shared trunk) and crossing one
  const fan = opts?.fan
  const trunk = (i0: number, j0: number, i1: number, j1: number): number => {
    if (!occ && !fan) return 0
    if (i0 === i1) {
      const lo = Math.min(Y[j0], Y[j1])
      const hi = Math.max(Y[j0], Y[j1])
      return (
        (occ ? TRUNK_COST * overlapLen(occ.v.get(X[i0]), lo, hi) + CROSS_COST * crossCount(occ.hy, occ.h, lo, hi, X[i0]) : 0) +
        (fan ? FAN_COST * overlapLen(fan.v.get(X[i0]), lo, hi) : 0)
      )
    }
    const lo = Math.min(X[i0], X[i1])
    const hi = Math.max(X[i0], X[i1])
    return (
      (occ ? TRUNK_COST * overlapLen(occ.h.get(Y[j0]), lo, hi) + CROSS_COST * crossCount(occ.vx, occ.v, lo, hi, Y[j0]) : 0) +
      (fan ? FAN_COST * overlapLen(fan.h.get(Y[j0]), lo, hi) : 0)
    )
  }

  while (heap.length > 0) {
    const e = pop()
    const cur = e.id
    const ci = (cur / NY) | 0
    const cj = cur - ci * NY
    if (e.g !== g[cur] || e.f !== fOf(cur, ci, cj)) continue // superseded entry
    if (cur === goalId) break
    if (++expansions > maxExp) return null
    if ((expansions & (SEARCH_SLICE - 1)) === 0) yield 'search'

    // the nearest existing lattice point in each of the four directions
    for (let d = 0; d < 4; d++) {
      // §ER14.3 — a port fan's branch: the first move out of the start, and
      // the move into the goal, may be fixed (0 up, 1 down, 2 left, 3 right)
      if (firstDir != null && cur === startId && d !== firstDir) continue
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
      if (lastDir != null && nb === goalId && d !== lastDir) continue
      // `near`, not index equality: two ruler lines can sit exactly COORD_EPS
      // apart, and a step between them counts as vertical for the bend test.
      const stepDir = near(X[ni], X[ci]) ? 2 : 1
      const prevDir = dir[cur]
      const turn = prevDir !== 0 && prevDir !== stepDir ? 1 : cur === startId && d === back ? 2 : 0
      const ng = g[cur] + Math.abs(X[ni] - X[ci]) + Math.abs(Y[nj] - Y[cj]) + trunk(ci, cj, ni, nj)
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

/** expansions between two pauses of a search (a power of two) */
export const SEARCH_SLICE = 1024

/** run a step generator to its end and return its value */
function drain<T>(gen: Generator<string, T>): T {
  for (;;) {
    const r = gen.next()
    if (r.done) return r.value
  }
}

/** the §ER3 search, run at once */
function buildRoute(a: Pt, goal: Pt, aPos: Position | null, bPos: Position | null, rs: IBox[], opts?: SearchOpts): Pt[] | null {
  return drain(buildRouteSteps(a, goal, aPos, bPos, rs, opts))
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
  const rs = inp.obstacles.map((b) => inflate(b))
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

// ── the guarded router (docs/edge-routing.md §ER14, issue #344 step 2) ──────
//
// The same A* search, with four guarantees the v1 entry point above does not
// give (it stays as the pinned single-edge core):
//   1. the edge's OWN end nodes are obstacles — a route leaves its port along
//      the port normal to a stub beyond its own box, and only that stub may run
//      inside its own node;
//   2. no node fill is ever crossed: a failed search is retried with the
//      clearance stepped down (`GUARD_PADS`), then with an outer corridor
//      around every obstacle (`outer`); the plain L / Z through nodes is gone;
//   3. unrelated routes already placed cost extra to run along (`TRUNK_COST`);
//   4. a failure is reported, never hidden: `routeClass` says which rung found
//      the route, `blocked` when the port itself is covered by another node.

/** the clearance ladder, px around every obstacle */
export const GUARD_PADS = [ROUTE_PAD, 6, 2, 0] as const
/** the outer corridor's distance from the bounding box of everything */
export const OUTER_MARGIN = 2 * ROUTE_PAD
export const OUTER_EXPANSIONS = 10 * MAX_EXPANSIONS

export type GuardedClass = 'orthogonal' | 'tight' | 'outer' | 'blocked' | 'degenerate'

export type GuardedInput = {
  edgeId: string
  source: Pt
  target: Pt
  sourcePosition: Position
  targetPosition: Position
  /** the edge's own end nodes (null for one not measured / missing) */
  sourceBox: Box | null
  targetBox: Box | null
  /** every OTHER node — a fill no route may cross */
  obstacles: Box[]
  /** boxes avoided when possible but not fills (other connections' labels) */
  soft?: Box[]
  /** interior pinned points, in user order, verbatim */
  waypoints: Pt[]
  parallelIndex: number
  parallelCount: number
  occupied?: Occupied
  /** the same port's other connections past their stubs (`FAN_COST`) */
  fan?: Occupied
  /** extra ruler lines offered to the search (the parallel lanes beside the
   *  routes of related connections, so a fan can always split after its stub) */
  lanes?: { x: number[]; y: number[] }
  /** §ER14.3 — this end is one connection of a port fan: its branch point is
   *  `len` px (0–16) beyond the node box, and the route leaves it toward
   *  `side`: -1 the negative side across the stub (up for a left / right port,
   *  left for a top / bottom one), +1 the positive side, 0 straight on. At the
   *  target the route arrives FROM `side`. */
  sourceFan?: FanEnd
  targetFan?: FanEnd
  /** a reroute around `soft` boxes only (a guarded label round): the ONE rung
   *  at this clearance, with the soft boxes, nothing else; when it is not free
   *  the result is `null` and the caller keeps its route */
  softPad?: number
}

export type FanEnd = { len: number; side: -1 | 0 | 1 }

/** the clearances a reroute around labels tries, one per step (§ER14.3) */
export const SOFT_PADS = [ROUTE_PAD, 6] as const
/** the search budget of one such rung: a label reroute is an optional
 *  improvement, so a search that would have to explore the whole graph gives up
 *  early (the edge keeps its route) */
export const SOFT_EXPANSIONS = MAX_EXPANSIONS / 5

export type GuardedResult = Omit<RouteResult, 'routeClass'> & {
  routeClass: GuardedClass
  /** the simplified polyline the path is drawn from */
  points: Pt[]
  /** the clearance the route was found with (px), -1 for outer / blocked */
  clearance: number
  /** each port and the end of its stub: [source port, source stub end,
   *  target stub end, target port] — the only stretch two connections of one
   *  port may share (§ER14.3) */
  stubs: [Pt, Pt, Pt, Pt]
  /** a fan branch was blocked by obstacles: the route was found without the
   *  branch constraint and may run along a sibling (reported, §ER14.4) */
  fanBlocked: boolean
}

/** the move index of `buildRoute` (0 up, 1 down, 2 left, 3 right) for a unit vector */
const moveOf = (v: Pt): number => (v.y < 0 ? 0 : v.y > 0 ? 1 : v.x < 0 ? 2 : 3)
/** the last move of a polyline (its last two distinct points), or none */
function arrivalOf(pts: Pt[]): number | undefined {
  const b = pts[pts.length - 1]
  for (let k = pts.length - 2; k >= 0; k--) {
    const a = pts[k]
    if (!near(a.x, b.x) || !near(a.y, b.y)) return moveOf({ x: near(a.x, b.x) ? 0 : b.x - a.x, y: near(a.y, b.y) ? 0 : b.y - a.y })
  }
  return undefined
}
/** the unit vector across a port's stub, toward its positive side */
const across = (pos: Position): Pt => (isHoriz(pos) ? { x: 0, y: 1 } : { x: 1, y: 0 })
/** the first move after a fan branch at the source */
function leaveMove(pos: Position, f: FanEnd): number {
  if (f.side === 0) return moveOf(normal(pos))
  const a = across(pos)
  return moveOf({ x: a.x * f.side, y: a.y * f.side })
}
/** the move into a fan branch at the target (arriving from `f.side`) */
function arriveMove(pos: Position, f: FanEnd): number {
  const n = normal(pos)
  if (f.side === 0) return moveOf({ x: -n.x, y: -n.y })
  const a = across(pos)
  return moveOf({ x: -a.x * f.side, y: -a.y * f.side })
}

/** a polyline's path strings, arc-length midpoint and end angle */
function polyResult(s: Pt[]): Pick<RouteResult, 'd' | 'hitD' | 'mid' | 'endAngle'> {
  let total = 0
  for (let i = 1; i < s.length; i++) total += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y)
  let acc = 0
  let mid: Pt = s[0]
  for (let i = 1; i < s.length; i++) {
    const seg = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y)
    if (acc + seg >= total / 2) {
      const r = seg > 0 ? (total / 2 - acc) / seg : 0
      mid = { x: s[i - 1].x + (s[i].x - s[i - 1].x) * r, y: s[i - 1].y + (s[i].y - s[i - 1].y) * r }
      break
    }
    acc += seg
  }
  const p = s.length >= 2 ? s[s.length - 2] : s[0]
  const e = s[s.length - 1]
  return { d: pointsToPath(s), hitD: pointsToPoly(s), mid, endAngle: Math.atan2(e.y - p.y, e.x - p.x) }
}

/** the end of a port's stub: `want` (default `ROUTE_STUB`) beyond the node's
 *  own box along the port normal, shortened to half the free gap when another
 *  node is nearer */
function stubEnd(port: Pt, pos: Position, own: Box | null, fills: IBox[], want: number = ROUTE_STUB): Pt {
  const n = normal(pos)
  // how far the own box reaches along the normal from the port
  let base = 0
  if (own) {
    if (n.x > 0) base = Math.max(0, own.x + own.w - port.x)
    else if (n.x < 0) base = Math.max(0, port.x - own.x)
    else if (n.y > 0) base = Math.max(0, own.y + own.h - port.y)
    else base = Math.max(0, port.y - own.y)
  }
  // the nearest other fill face crossing the port's line, beyond the own box
  let gap = Infinity
  for (const r of fills) {
    if (n.x !== 0) {
      if (!(port.y > r.y0 + COORD_EPS && port.y < r.y1 - COORD_EPS)) continue
      const d = n.x > 0 ? r.x0 - port.x : port.x - r.x1
      if (d > -COORD_EPS) gap = Math.min(gap, d - base)
    } else {
      if (!(port.x > r.x0 + COORD_EPS && port.x < r.x1 - COORD_EPS)) continue
      const d = n.y > 0 ? r.y0 - port.y : port.y - r.y1
      if (d > -COORD_EPS) gap = Math.min(gap, d - base)
    }
  }
  const len = gap === Infinity || gap >= 2 * want ? want : Math.max(Math.min(want, gap / 2), 0)
  return { x: q(port.x + n.x * (base + len)), y: q(port.y + n.y * (base + len)) }
}

/** does any segment of `pts` from index `from` to `to` (exclusive end) cross a fill? */
function crossesFill(pts: Pt[], from: number, to: number, fills: IBox[]): boolean {
  for (let i = from + 1; i <= to; i++) if (!segFree(pts[i - 1], pts[i], fills)) return true
  return false
}

/** the guarded route of one edge: always a route (§ER14.2) */
export function computeGuardedRoute(inp: GuardedInput): GuardedResult {
  return drain(guardedRouteSteps({ ...inp, softPad: undefined }))!
}

/** §ER14.3 — one rung of a guarded label round's reroute around `soft` boxes,
 *  at clearance `pad`; null when it is not free (the caller tries the next
 *  rung of `SOFT_PADS` in a later step, or keeps its route). One search, so
 *  one step stays short. */
export function computeSoftReroute(inp: GuardedInput, pad: number): GuardedResult | null {
  return drain(guardedRouteSteps({ ...inp, softPad: pad }))
}

/** the guarded router as steps (§ER14.5): it pauses wherever its searches do,
 *  so one edge's route can be spread over slices; the two functions above run
 *  it at once */
export function* guardedRouteSteps(inp: GuardedInput): Generator<string, GuardedResult | null> {
  const fanOffset = (inp.parallelIndex - (inp.parallelCount - 1) / 2) * PARALLEL_GAP
  const perpS = isHoriz(inp.sourcePosition) ? { x: 0, y: fanOffset } : { x: fanOffset, y: 0 }
  const perpT = isHoriz(inp.targetPosition) ? { x: 0, y: fanOffset } : { x: fanOffset, y: 0 }
  const src = { x: inp.source.x + perpS.x, y: inp.source.y + perpS.y }
  const tgt = { x: inp.target.x + perpT.x, y: inp.target.y + perpT.y }
  const ownBoxes = [inp.sourceBox, inp.targetBox].filter((b): b is Box => b != null)
  if (inp.sourceBox && inp.targetBox && inp.sourceBox.id === inp.targetBox.id) ownBoxes.pop()
  // every node fill: other nodes and the edge's own end nodes, at no clearance
  const fills = [...inp.obstacles, ...ownBoxes].map((b) => inflate(b, 0))
  const others0 = inp.obstacles.map((b) => inflate(b, 0))
  const invalidWaypoint = inp.waypoints.some((w) => {
    const p = { x: q(w.x), y: q(w.y) }
    return inp.obstacles.some((b) => ptInside(p, inflate(b)))
  })
  const result = (pts: Pt[], cls: GuardedClass, clearance: number, stubs: [Pt, Pt, Pt, Pt], fanBlocked = false): GuardedResult => {
    const s = simplify(pts)
    return { ...polyResult(s), routeClass: cls, points: s, clearance, invalidWaypoint, stubs, fanBlocked }
  }

  if (near(src.x, tgt.x) && near(src.y, tgt.y)) {
    const n = normal(inp.sourcePosition)
    return result([src, { x: src.x + n.x, y: src.y + n.y }], 'degenerate', -1, [src, src, tgt, tgt])
  }

  const laneX = inp.lanes?.x ?? []
  const laneY = inp.lanes?.y ?? []
  // a waypoint inside a node fill cannot be passed through: it keeps its value
  // (and the §ER4 cue) but the route does not use it
  const wps = inp.waypoints.map((p) => ({ x: q(p.x), y: q(p.y) })).filter((p) => !fills.some((r) => ptInside(p, r)))
  const soft = inp.soft ?? []

  // with the fan branches (§ER14.3), then — only if no rung finds a route —
  // without them, reported as `fanBlocked`
  const withFan = inp.sourceFan != null || inp.targetFan != null
  const first = yield* solve(true)
  if (first) return first
  if (inp.softPad != null) return null
  if (withFan) {
    const plain = yield* solve(false)
    if (plain) return { ...plain, fanBlocked: true }
  }
  return yield* blockedRoute(withFan)

  /** the clearance ladder and the outer corridor, with or without the fan
   *  branches; null when nothing inside them is free */
  function* solve(fanOn: boolean): Generator<string, GuardedResult | null> {
    const sf = fanOn ? inp.sourceFan : undefined
    const tf = fanOn ? inp.targetFan : undefined
    const stubA = stubEnd(src, inp.sourcePosition, inp.sourceBox, others0, sf?.len ?? ROUTE_STUB)
    const stubB = stubEnd(tgt, inp.targetPosition, inp.targetBox, others0, tf?.len ?? ROUTE_STUB)
    const stubs: [Pt, Pt, Pt, Pt] = [src, stubA, stubB, tgt]
    const anchors: Pt[] = [stubA, ...wps, stubB]
    // the own nodes keep a clearance just inside the shortest branch, so a
    // branch point is always outside them
    const ownPad = (pad: number) => Math.max(0, Math.min(pad, Math.min(sf?.len ?? ROUTE_STUB, tf?.len ?? ROUTE_STUB) - 1))
    const dirs = {
      firstDir: sf ? leaveMove(inp.sourcePosition, sf) : undefined,
      lastDir: tf ? arriveMove(inp.targetPosition, tf) : undefined,
    }
    function* attempt(rs: IBox[], opts: SearchOpts): Generator<string, Pt[] | null> {
      // an anchor strictly inside an obstacle cannot leave it (every segment
      // from it crosses that interior), so the search would only exhaust its
      // budget: the same failure, decided without searching
      if (anchors.some((p) => rs.some((r) => ptInside(p, r)))) return null
      const full: Pt[] = [src]
      for (let i = 0; i < anchors.length - 1; i++) {
        const spanOpts: SearchOpts = {
          ...opts,
          firstDir: i === 0 ? dirs.firstDir : undefined,
          lastDir: i === anchors.length - 2 ? dirs.lastDir : undefined,
          // issue #344 step 3 — a span after a bend point continues from the
          // way the route arrived there
          arrive: i === 0 ? undefined : arrivalOf(full),
        }
        const seg = yield* buildRouteSteps(anchors[i], anchors[i + 1], i === 0 ? inp.sourcePosition : null, i === anchors.length - 2 ? inp.targetPosition : null, rs, spanOpts)
        if (!seg) return null
        full.push(...(i === 0 ? seg : seg.slice(1)))
      }
      full.push(tgt)
      // the guarantee itself: between the two stubs nothing crosses a fill,
      // and the stubs cross no OTHER node
      if (crossesFill(full, 1, full.length - 2, fills)) return null
      if (crossesFill(full, 0, 1, others0) || crossesFill(full, full.length - 2, full.length - 1, others0)) return null
      return full
    }
    const boxesAt = (pad: number, withSoft: boolean): IBox[] => [
      ...inp.obstacles.map((b) => inflate(b, pad)),
      ...ownBoxes.map((b) => inflate(b, ownPad(pad))),
      ...(withSoft ? soft.map((b) => inflate(b, pad)) : []),
    ]
    const search: SearchOpts = {
      occ: inp.occupied,
      fan: inp.fan,
      extraX: laneX,
      extraY: laneY,
      ...(inp.softPad != null ? { maxExpansions: SOFT_EXPANSIONS } : {}),
    }
    for (const pad of GUARD_PADS) {
      if (inp.softPad != null && pad !== inp.softPad) continue
      const pts = yield* attempt(boxesAt(pad, true), search)
      if (pts) return result(pts, pad === ROUTE_PAD ? 'orthogonal' : 'tight', pad, stubs)
    }
    if (inp.softPad != null) return null
    for (const pad of GUARD_PADS) {
      // the soft boxes give way before the node clearance does
      if (soft.length === 0) break
      const pts = yield* attempt(boxesAt(pad, false), search)
      if (pts) return result(pts, pad === ROUTE_PAD ? 'orthogonal' : 'tight', pad, stubs)
    }
    // the outer corridor: rulers outside the bounding box of every fill, both
    // stubs and every waypoint, and a larger search budget
    const outer = yield* attempt(boxesAt(0, false), outerOpts(stubA, stubB))
    if (outer) return result(outer, 'outer', -1, stubs)
    return null
  }

  function outerOpts(stubA: Pt, stubB: Pt): SearchOpts {
    let bx0 = Math.min(src.x, tgt.x, stubA.x, stubB.x)
    let by0 = Math.min(src.y, tgt.y, stubA.y, stubB.y)
    let bx1 = Math.max(src.x, tgt.x, stubA.x, stubB.x)
    let by1 = Math.max(src.y, tgt.y, stubA.y, stubB.y)
    for (const r of fills) {
      bx0 = Math.min(bx0, r.x0); by0 = Math.min(by0, r.y0); bx1 = Math.max(bx1, r.x1); by1 = Math.max(by1, r.y1)
    }
    for (const p of wps) {
      bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y)
    }
    return {
      occ: inp.occupied,
      fan: inp.fan,
      extraX: [...laneX, bx0 - OUTER_MARGIN, bx1 + OUTER_MARGIN],
      extraY: [...laneY, by0 - OUTER_MARGIN, by1 + OUTER_MARGIN],
      maxExpansions: OUTER_EXPANSIONS,
    }
  }

  /** nothing is free: another node covers a port or a stub. Route around every
   *  node that does NOT cover a stub, and say so. */
  function* blockedRoute(fanBlocked: boolean): Generator<string, GuardedResult> {
    const stubA = stubEnd(src, inp.sourcePosition, inp.sourceBox, others0)
    const stubB = stubEnd(tgt, inp.targetPosition, inp.targetBox, others0)
    const stubs: [Pt, Pt, Pt, Pt] = [src, stubA, stubB, tgt]
    const anchors: Pt[] = [stubA, ...wps, stubB]
    const stubSegs: [Pt, Pt][] = [[src, stubA], [stubB, tgt]]
    const covering = new Set<number>()
    inp.obstacles.forEach((b, k) => {
      const r = inflate(b, 0)
      if (stubSegs.some(([a, c]) => segHitsBox(a, c, r)) || ptInside(src, r) || ptInside(tgt, r)) covering.add(k)
    })
    const rest = inp.obstacles.filter((_, k) => !covering.has(k))
    const restFills = [...rest, ...ownBoxes].map((b) => inflate(b, 0))
    // no budget here: on the obstacle-edge grid with the outer corridor, every
    // anchor outside the remaining fills is connected, so the search ends
    const blockedOpts: SearchOpts = { ...outerOpts(stubA, stubB), maxExpansions: Infinity }
    const full: Pt[] = [src]
    for (let i = 0; i < anchors.length - 1; i++) {
      const seg = yield* buildRouteSteps(anchors[i], anchors[i + 1], i === 0 ? inp.sourcePosition : null, i === anchors.length - 2 ? inp.targetPosition : null, restFills, blockedOpts)
      // unreachable in practice (an anchor sealed inside the fills left after
      // dropping the covering ones); drawn along the stubs only, never across
      if (!seg) return result([src, stubA], 'blocked', -1, stubs, fanBlocked)
      full.push(...(i === 0 ? seg : seg.slice(1)))
    }
    full.push(tgt)
    return result(full, 'blocked', -1, stubs, fanBlocked)
  }
}
