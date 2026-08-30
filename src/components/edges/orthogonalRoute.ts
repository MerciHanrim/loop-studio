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
type Node = { x: number; y: number; key: string }
const key = (x: number, y: number): string => `${q(x)},${q(y)}`

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

  const freePt = (x: number, y: number): boolean => !rs.some((r) => ptInside({ x, y }, r))
  const startKey = key(a.x, a.y)
  const goalKey = key(goal.x, goal.y)
  const nodeAt = new Map<string, Node>()
  const push = (x: number, y: number) => {
    const k = key(x, y)
    if (!nodeAt.has(k) && (freePt(x, y) || k === startKey || k === goalKey)) nodeAt.set(k, { x: q(x), y: q(y), key: k })
  }
  for (const x of X) for (const y of Y) push(x, y)
  push(a.x, a.y); push(goal.x, goal.y)
  if (!nodeAt.has(startKey) || !nodeAt.has(goalKey)) return null

  const nodes = [...nodeAt.values()]
  const byX = new Map<number, Node[]>()
  const byY = new Map<number, Node[]>()
  for (const n of nodes) {
    ;(byX.get(n.x) ?? byX.set(n.x, []).get(n.x)!).push(n)
    ;(byY.get(n.y) ?? byY.set(n.y, []).get(n.y)!).push(n)
  }
  for (const arr of byX.values()) arr.sort((p, q2) => cmpNum(p.y, q2.y))
  for (const arr of byY.values()) arr.sort((p, q2) => cmpNum(p.x, q2.x))

  const neighbours = (n: Node): Node[] => {
    const out: Node[] = []
    const col = byX.get(n.x)!
    const ci = col.indexOf(n)
    for (const j of [ci - 1, ci + 1]) if (col[j] && segFree(n, col[j], rs)) out.push(col[j])
    const row = byY.get(n.y)!
    const ri = row.indexOf(n)
    for (const j of [ri - 1, ri + 1]) if (row[j] && segFree(n, row[j], rs)) out.push(row[j])
    return out
  }

  const h = (n: Node): number => Math.abs(n.x - goal.x) + Math.abs(n.y - goal.y)
  const start = nodeAt.get(startKey)!
  const g = new Map<string, number>([[start.key, 0]])
  const bends = new Map<string, number>([[start.key, 0]])
  const dir = new Map<string, string>([[start.key, aPos ? (isHoriz(aPos) ? 'h' : 'v') : '']])
  const from = new Map<string, Node | null>([[start.key, null]])
  const open: Node[] = [start]
  let expansions = 0

  const better = (n: Node, cand: { g: number; b: number; d: string }): boolean => {
    const cur = g.get(n.key)
    if (cur === undefined) return true
    const curB = bends.get(n.key)!
    if (cand.g !== cur) return cand.g < cur
    if (cand.b !== curB) return cand.b < curB
    return false
  }

  while (open.length) {
    // pick lowest f, then g, then (x,y)
    let bi = 0
    for (let i = 1; i < open.length; i++) {
      const A = open[i], B = open[bi]
      const fa = g.get(A.key)! + h(A) + bends.get(A.key)! * BEND_COST
      const fb = g.get(B.key)! + h(B) + bends.get(B.key)! * BEND_COST
      if (fa < fb || (fa === fb && (g.get(A.key)! < g.get(B.key)! || (g.get(A.key)! === g.get(B.key)! && (cmpNum(A.x, B.x) < 0 || (A.x === B.x && cmpNum(A.y, B.y) < 0)))))) bi = i
    }
    const cur = open.splice(bi, 1)[0]
    if (cur.key === goalKey) break
    if (++expansions > MAX_EXPANSIONS) return null
    for (const nb of neighbours(cur)) {
      const stepDir = near(nb.x, cur.x) ? 'v' : 'h'
      const prevDir = dir.get(cur.key)!
      const turn = prevDir && prevDir !== stepDir ? 1 : 0
      const ng = g.get(cur.key)! + Math.abs(nb.x - cur.x) + Math.abs(nb.y - cur.y)
      const nbn = bends.get(cur.key)! + turn
      if (better(nb, { g: ng, b: nbn, d: stepDir })) {
        g.set(nb.key, ng)
        bends.set(nb.key, nbn)
        dir.set(nb.key, stepDir)
        from.set(nb.key, cur)
        if (!open.includes(nb)) open.push(nb)
      }
    }
  }
  if (!g.has(goalKey)) return null
  const path: Pt[] = []
  let c: Node | null = nodeAt.get(goalKey)!
  while (c) { path.push({ x: c.x, y: c.y }); c = from.get(c.key) ?? null }
  path.reverse()
  // enforce the exit/entry direction with the goal stub already applied by caller
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
