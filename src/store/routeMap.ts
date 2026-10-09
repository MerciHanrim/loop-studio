// docs/edge-routing.md §ER3.8–§ER3.9, §ER14 — the atomic orthogonal-route map.
//
// One `Map<edgeId, RoutedEdge>` for every `route: "orthogonal"` edge. A FULL
// generation routes every edge with the guarded router (`computeGuardedRoute`:
// own end nodes are obstacles, no fill is crossed, unrelated routes pay to share
// a trunk or to cross), in id order, places the labels and runs the guarded
// label rounds; it never depends on input order and is the same however it is
// run.
//
// Uses the module-identity-cache pattern (like `src/store/registers.ts`):
// Zustand keeps `nodes` / `edges` referentially stable until they actually
// change, so within one render every `LoopEdge` gets the SAME map with no
// recompute. The cache key is the routing INPUT (§ER3.8): the `(nodes ref,
// edges ref, input revision)` identity first, then the layout signature — every
// value a generation reads, serialised. A `select` change or a label edit keeps
// the map; zoom / pan / hover / theme / sim never touch the inputs at all.
//
// §ER14.5 — the cost. A layout change first shows a PROVISIONAL map: the last
// full generation with only the routes the change touches routed again (within
// a small time budget). The full generation for the new layout then runs as a
// job in slices of about `SLICE_MS`, each its own task, and is committed
// in one swap when it is complete — never a partial map. A newer layout, or a
// drag starting, cancels a running job; a cancelled job never commits. During a
// node / selection / frame drag (`beginLiveLayout` … `endLiveLayout`) no job
// runs; the drop starts one. Without a task scheduler (tests,
// non-browser runs) the full generation is computed at once — the same steps,
// so the result is byte-identical.

import { create } from 'zustand'
import { Position } from '@xyflow/react'
import type { LoopEdge, LoopNode, NodeKind } from '../model/types'
import { PORT_ROW } from '../model/layout/grid'
import {
  type Box,
  computeGuardedRoute,
  computeSoftReroute,
  guardedRouteSteps,
  type GuardedClass,
  type GuardedInput,
  type FanEnd,
  type GuardedResult,
  type Occupied,
  PARALLEL_GAP,
  ROUTE_STUB,
  SOFT_PADS,
  type Pt,
} from '../components/edges/orthogonalRoute'
import { BASE_NODE_H, portInsetFraction } from '../components/nodes/silhouette'

// the size of a node React Flow has not measured yet; the height is the node's
// own floor, so a one-line node routes the same before and after it is measured
const DEFAULT_W = 130
const DEFAULT_H = BASE_NODE_H

/** the route map's own version: part of the cache key, so a router change
 *  never reuses a generation computed by the previous rules */
export const ROUTE_MAP_VERSION = 2

/** guarded label rounds after the first label placement */
export const LABEL_ROUNDS = 2
/** label slots along a route, as fractions of its length, in order of preference */
export const LABEL_SLOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8] as const
/** the margin kept between a label and a node box */
const LABEL_NODE_MARGIN = 2
/** a full generation's work per animation frame, ms */
export const SLICE_MS = 8
/** the provisional map's routing budget, ms (a new edge over it is not drawn
 *  until the full generation commits) */
export const PROVISIONAL_MS = 5

export type RoutedEdge = GuardedResult & {
  /** where the edge's label is centred; null when its size is not known yet
   *  (the label then sits at `mid`) */
  label: Pt | null
}

// ── the routing inputs that are not graph data: label sizes, the live flag ──

type LabelSize = { w: number; h: number }
const labelSizes = new Map<string, LabelSize>()

/** bumped whenever the map to show changes outside a graph edit (a label size,
 *  a committed full generation), so every `LoopEdge` re-reads it */
export const useRouteInputs = create<{ rev: number; busy: boolean }>(() => ({ rev: 0, busy: false }))
const bump = () => useRouteInputs.setState((s) => ({ rev: s.rev + 1 }))

/** §ER14.5 — `busy` while a routed edge is not drawn because its first route
 *  is still being computed (the canvas carries `aria-busy`). Decided during a
 *  render, so it is published right after it. */
let wantBusy = false
function setBusy(b: boolean): void {
  wantBusy = b
  if (useRouteInputs.getState().busy === b) return
  queueMicrotask(() => {
    if (useRouteInputs.getState().busy !== wantBusy) useRouteInputs.setState({ busy: wantBusy })
  })
}

/** a label's REST size (visible, not selected, no run value), in flow px; the
 *  last known size stays while the label is hidden, so zooming never moves a
 *  route */
export function setRouteLabelSize(edgeId: string, w: number, h: number): void {
  const prev = labelSizes.get(edgeId)
  if (prev && prev.w === w && prev.h === h) return
  labelSizes.set(edgeId, { w, h })
  bump()
}

let live = false
/** a node / selection / frame drag starts: until `endLiveLayout`, a layout
 *  change shows only provisional maps, and a running full generation stops */
export function beginLiveLayout(): void {
  live = true
  cancelJob()
}
/** the gesture ends: the full generation for the last layout starts */
export function endLiveLayout(): void {
  if (!live) return
  live = false
  if (lastInput && committed && committed.sig !== base?.sig) startFull(lastInput.nodes, lastInput.edges, committed.sig)
}

// ── geometry ──────────────────────────────────────────────────────────────

const isOrtho = (e: LoopEdge): boolean =>
  (e.data as { route?: unknown } | undefined)?.route === 'orthogonal'

const handlePos = (handleId: string | null | undefined, fallback: Position): Position => {
  // resource ports: `in` = Left, `out` = Right; state ports: top / bottom.
  if (handleId === 'in') return Position.Left
  if (handleId === 'out') return Position.Right
  if (handleId === 'state-target') return Position.Top
  if (handleId === 'state-source') return Position.Bottom
  return fallback
}

const sizeOf = (n: LoopNode): { w: number; h: number } => ({
  w: n.measured?.width ?? n.width ?? DEFAULT_W,
  h: n.measured?.height ?? n.height ?? DEFAULT_H,
})

/** centre of a node's handle in flow coords. issue #344 §DL1 — a resource
 *  port is on the fixed row `PORT_ROW` below the top, drawn on the outline
 *  there (`portInsetFraction`, the same rule `nodes.tsx` draws it with), so a
 *  route starts where the port is; state ports stay at the top / bottom centre */
function handlePoint(n: LoopNode, pos: Position): Pt {
  const { w, h } = sizeOf(n)
  const x = n.position.x
  const y = n.position.y
  const kind = n.type as NodeKind
  switch (pos) {
    case Position.Left: return { x: x + portInsetFraction(kind, h, 'in', PORT_ROW) * w, y: y + PORT_ROW }
    case Position.Right: return { x: x + w - portInsetFraction(kind, h, 'out', PORT_ROW) * w, y: y + PORT_ROW }
    case Position.Top: return { x: x + w / 2, y }
    default: return { x: x + w / 2, y: y + h }
  }
}

const boxOf = (n: LoopNode): Box => ({ id: n.id, x: n.position.x, y: n.position.y, ...sizeOf(n) })

const hit = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** does the polyline enter box `b`'s interior? */
function polyHits(pts: Pt[], b: Box): boolean {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const c = pts[i]
    if (Math.max(a.x, c.x) > b.x && Math.min(a.x, c.x) < b.x + b.w && Math.max(a.y, c.y) > b.y && Math.min(a.y, c.y) < b.y + b.h) return true
  }
  return false
}

/** the point at fraction `f` of a polyline's length */
function pointAt(pts: Pt[], f: number): Pt {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (acc + seg >= total * f) {
      const r = seg > 0 ? (total * f - acc) / seg : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * r, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * r }
    }
    acc += seg
  }
  return pts[pts.length - 1]
}

/** the segments of `routes`, indexed by ruler line for the trunk / crossing cost */
function occupiedOf(routes: Pt[][]): Occupied {
  const v = new Map<number, [number, number][]>()
  const h = new Map<number, [number, number][]>()
  for (const pts of routes) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a.x === b.x) (v.get(a.x) ?? v.set(a.x, []).get(a.x)!).push([Math.min(a.y, b.y), Math.max(a.y, b.y)])
      else if (a.y === b.y) (h.get(a.y) ?? h.set(a.y, []).get(a.y)!).push([Math.min(a.x, b.x), Math.max(a.x, b.x)])
    }
  }
  const num = (p: number, q: number) => p - q
  return { v, h, vx: [...v.keys()].sort(num), hy: [...h.keys()].sort(num) }
}

const CLASS_RANK: Record<GuardedClass, number> = { orthogonal: 0, degenerate: 0, tight: 1, outer: 2, blocked: 3 }

// ── ports, fans and the shared stub (§ER14.3) ─────────────────────────────

const endKey = (node: string, handle: string | null | undefined) => `${node}:${handle ?? ''}`
const srcKey = (e: LoopEdge) => endKey(e.source, e.sourceHandle)
const tgtKey = (e: LoopEdge) => endKey(e.target, e.targetHandle)
const pkey = (e: LoopEdge): string => {
  const a = srcKey(e)
  const b = tgtKey(e)
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** a polyline from the end of its stub at `start`: the first segment cut where
 *  the stub ends (or where the route already turned, if earlier) */
function fromStub(pts: Pt[], stubEnd: Pt): Pt[] {
  if (pts.length < 2) return pts
  const a = pts[0]
  const b = pts[1]
  const dB = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
  const dS = Math.abs(stubEnd.x - a.x) + Math.abs(stubEnd.y - a.y)
  return dB <= dS ? pts.slice(1) : [stubEnd, ...pts.slice(1)]
}

/** what two connections of one port may NOT share: everything past the port's
 *  stub. `atSource` / `atTarget` say which end is the shared port. */
function pastSharedStub(r: GuardedResult, atSource: boolean, atTarget: boolean): Pt[] {
  let pts = r.points
  if (atSource) pts = fromStub(pts, r.stubs[1])
  if (atTarget) pts = [...fromStub([...pts].reverse(), r.stubs[2])].reverse()
  return pts
}

/** the stretch of a route on its shared stub(s): where no label may sit */
function sharedStubSegments(r: GuardedResult, atSource: boolean, atTarget: boolean): Pt[][] {
  const out: Pt[][] = []
  if (atSource) out.push([r.stubs[0], r.stubs[1]])
  if (atTarget) out.push([r.stubs[2], r.stubs[3]])
  return out
}

// ── one generation ────────────────────────────────────────────────────────

type Plan = {
  ortho: LoopEdge[]
  byId: Map<string, LoopNode>
  boxes: Box[]
  /** parallel sets — unordered endpoint key, reversed pairs included (§ER3.7) */
  groups: Map<string, string[]>
  /** how many routed edges use each port */
  portUse: Map<string, number>
  /** every routed end's reserved stretch, known before any route: its stub
   *  (port → branch point) and, at a fan, its first leg after the branch. A
   *  route pays `FAN_COST` to run along any of them but its own ports' stubs. */
  reserved: { edgeId: string; port: string; stub: Pt[]; leg: Pt[] | null }[]
  /** each fan member's branch at its source / target port (§ER14.3) */
  fans: Map<string, { src?: FanEnd; tgt?: FanEnd }>
}

/** §ER14.3 — the branch points of one port's fan. Each member's far end is
 *  measured across the stub; members on the negative side leave toward it,
 *  members on the positive side toward that one, and at most one member goes
 *  straight on (the lowest id; other level members alternate sides). Within a
 *  side, the member reaching furthest out branches nearest the node, so
 *  siblings never cross; members on opposite sides may share an offset. The
 *  offsets split the 16 px stub evenly. */
function assignFan(members: { id: string; delta: number }[]): Map<string, FanEnd> {
  const out = new Map<string, FanEnd>()
  const byId = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const neg: { id: string; delta: number }[] = []
  const pos: { id: string; delta: number }[] = []
  let straight: string | null = null
  let alt = 0
  for (const m of byId) {
    if (m.delta < -1) neg.push(m)
    else if (m.delta > 1) pos.push(m)
    else if (straight == null) straight = m.id
    else (alt++ % 2 === 0 ? neg : pos).push(m)
  }
  const tie = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  neg.sort((a, b) => a.delta - b.delta || tie(a, b))
  pos.sort((a, b) => b.delta - a.delta || tie(a, b))
  const place = (list: { id: string }[], side: -1 | 1) =>
    list.forEach((m, k) => out.set(m.id, { len: (ROUTE_STUB * (k + 1)) / list.length, side }))
  place(neg, -1)
  place(pos, 1)
  if (straight != null) out.set(straight, { len: ROUTE_STUB, side: 0 })
  return out
}

function plan(nodes: LoopNode[], edges: LoopEdge[]): Plan {
  const ortho = edges.filter(isOrtho).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const groups = new Map<string, string[]>()
  const portUse = new Map<string, number>()
  const atPort = new Map<string, { e: LoopEdge; asSource: boolean }[]>()
  for (const e of ortho) {
    const k = pkey(e)
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(e.id)
    portUse.set(srcKey(e), (portUse.get(srcKey(e)) ?? 0) + 1)
    portUse.set(tgtKey(e), (portUse.get(tgtKey(e)) ?? 0) + 1)
    ;(atPort.get(srcKey(e)) ?? atPort.set(srcKey(e), []).get(srcKey(e))!).push({ e, asSource: true })
    ;(atPort.get(tgtKey(e)) ?? atPort.set(tgtKey(e), []).get(tgtKey(e))!).push({ e, asSource: false })
  }
  const fans = new Map<string, { src?: FanEnd; tgt?: FanEnd }>()
  for (const list of atPort.values()) {
    if (list.length < 2) continue
    const { e: e0, asSource } = list[0]
    const portNode = byId.get(asSource ? e0.source : e0.target)
    if (!portNode) continue
    const pos = asSource ? handlePos(e0.sourceHandle, Position.Right) : handlePos(e0.targetHandle, Position.Left)
    const at = handlePoint(portNode, pos)
    const horiz = pos === Position.Left || pos === Position.Right
    const members: { id: string; delta: number }[] = []
    for (const { e, asSource: s } of list) {
      const far = byId.get(s ? e.target : e.source)
      if (!far) continue
      const p = handlePoint(far, s ? handlePos(e.targetHandle, Position.Left) : handlePos(e.sourceHandle, Position.Right))
      members.push({ id: e.id, delta: horiz ? p.y - at.y : p.x - at.x })
    }
    for (const [id, f] of assignFan(members)) {
      const cur = fans.get(id) ?? {}
      if (asSource) cur.src = f
      else cur.tgt = f
      fans.set(id, cur)
    }
  }
  const reserved: Plan['reserved'] = []
  for (const e of ortho) {
    for (const asSource of [true, false]) {
      const n = byId.get(asSource ? e.source : e.target)
      if (!n) continue
      const pos = asSource ? handlePos(e.sourceHandle, Position.Right) : handlePos(e.targetHandle, Position.Left)
      const f = asSource ? fans.get(e.id)?.src : fans.get(e.id)?.tgt
      const port = handlePoint(n, pos)
      const nrm = pos === Position.Left ? { x: -1, y: 0 } : pos === Position.Right ? { x: 1, y: 0 } : pos === Position.Top ? { x: 0, y: -1 } : { x: 0, y: 1 }
      const b = boxOf(n)
      const side = nrm.x > 0 ? b.x + b.w - port.x : nrm.x < 0 ? port.x - b.x : nrm.y > 0 ? b.y + b.h - port.y : port.y - b.y
      const len = Math.max(0, side) + (f?.len ?? ROUTE_STUB)
      const branch = { x: port.x + nrm.x * len, y: port.y + nrm.y * len }
      let leg: Pt[] | null = null
      if (f) {
        const across = pos === Position.Left || pos === Position.Right ? { x: 0, y: 1 } : { x: 1, y: 0 }
        const dir = f.side === 0 ? nrm : { x: across.x * f.side, y: across.y * f.side }
        leg = [branch, { x: branch.x + dir.x * ROUTE_STUB, y: branch.y + dir.y * ROUTE_STUB }]
      }
      reserved.push({ edgeId: e.id, port: asSource ? srcKey(e) : tgtKey(e), stub: [port, branch], leg })
    }
  }
  return { ortho, byId, boxes: nodes.map(boxOf), groups, portUse, fans, reserved }
}

/** one edge, routed against the current layout and the given placed routes:
 *  every other route costs to run along or cross; one sharing a port only past
 *  that port's stub, and its lines ± `PARALLEL_GAP` are offered as lanes */
function routeInput(p: Plan, e: LoopEdge, others: ReadonlyMap<string, GuardedResult>, soft: Box[]): GuardedInput | null {
  const s = p.byId.get(e.source)
  const t = p.byId.get(e.target)
  if (!s || !t) return null
  const sPos = handlePos(e.sourceHandle, Position.Right)
  const tPos = handlePos(e.targetHandle, Position.Left)
  const set = p.groups.get(pkey(e))!
  const busy: Pt[][] = []
  const fanRoutes: Pt[][] = []
  const laneX: number[] = []
  const laneY: number[] = []
  for (const o of p.ortho) {
    if (o.id === e.id) continue
    const r = others.get(o.id)
    if (!r) continue
    // a parallel set (same two ports) fans out by its own offset (§ER3.7)
    if (pkey(o) === pkey(e)) continue
    const atS = srcKey(o) === srcKey(e)
    const atT = tgtKey(o) === tgtKey(e)
    if (!atS && !atT) {
      busy.push(r.points)
      continue
    }
    const rest = pastSharedStub(r, atS, atT)
    fanRoutes.push(rest)
    // lanes beside the sibling's first two segments past the shared stub — where
    // the split is decided — at the shared end(s)
    const near = (seg: Pt[]) => {
      for (let i = 1; i < seg.length; i++) {
        if (seg[i].x === seg[i - 1].x) laneX.push(seg[i].x - PARALLEL_GAP, seg[i].x + PARALLEL_GAP)
        else if (seg[i].y === seg[i - 1].y) laneY.push(seg[i].y - PARALLEL_GAP, seg[i].y + PARALLEL_GAP)
      }
    }
    if (atS) near(rest.slice(0, 3))
    if (atT) near(rest.slice(-3))
  }
  const input: GuardedInput = {
    edgeId: e.id,
    source: handlePoint(s, sPos),
    target: handlePoint(t, tPos),
    sourcePosition: sPos,
    targetPosition: tPos,
    sourceBox: boxOf(s),
    targetBox: boxOf(t),
    obstacles: p.boxes.filter((b) => b.id !== e.source && b.id !== e.target),
    soft,
    waypoints: Array.isArray((e.data as { waypoints?: Pt[] }).waypoints) ? (e.data as { waypoints: Pt[] }).waypoints : [],
    parallelIndex: set.indexOf(e.id),
    parallelCount: set.length,
    occupied: occupiedOf(busy),
    fan: occupiedOf([
      ...fanRoutes,
      ...p.reserved.flatMap((r) =>
        r.edgeId === e.id ? [] : [...(r.port === srcKey(e) || r.port === tgtKey(e) ? [] : [r.stub]), ...(r.leg ? [r.leg] : [])],
      ),
    ]),
    lanes: { x: laneX, y: laneY },
    sourceFan: p.fans.get(e.id)?.src,
    targetFan: p.fans.get(e.id)?.tgt,
  }
  return input
}

/** one edge, routed at once (the provisional map); a label round (soft boxes)
 *  tries one rung of `SOFT_PADS` per call */
function routeOne(p: Plan, e: LoopEdge, others: ReadonlyMap<string, GuardedResult>, soft: Box[], softPad?: number): GuardedResult | null {
  const input = routeInput(p, e, others, soft)
  if (!input) return null
  return softPad != null ? computeSoftReroute(input, softPad) : computeGuardedRoute(input)
}

/** the same, as steps: it pauses inside its searches (§ER14.5) */
function* routeOneSteps(p: Plan, e: LoopEdge, others: ReadonlyMap<string, GuardedResult>, soft: Box[], softPad?: number): Generator<string, GuardedResult | null> {
  const input = routeInput(p, e, others, soft)
  if (!input) return null
  return yield* guardedRouteSteps(softPad != null ? { ...input, softPad } : input)
}

const labelBoxAt = (c: Pt, s: LabelSize, id: string): Box => ({ id: `label:${id}`, x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h })

/** every stretch of the given routes that sits on a shared port stub */
function sharedStubsOf(p: Plan, routes: ReadonlyMap<string, GuardedResult>): Pt[][] {
  const out: Pt[][] = []
  for (const e of p.ortho) {
    const r = routes.get(e.id)
    if (!r) continue
    const atS = (p.portUse.get(srcKey(e)) ?? 0) > 1
    const atT = (p.portUse.get(tgtKey(e)) ?? 0) > 1
    out.push(...sharedStubSegments(r, atS, atT))
  }
  return out
}

/** the first free slot on the edge's own route: never on a shared port stub;
 *  then clear of every node box, every label already placed and every other
 *  line; failing that, clear of nodes and labels only; the midpoint last */
function placeLabel(
  p: Plan,
  id: string,
  r: GuardedResult,
  placed: Map<string, Box>,
  routes: ReadonlyMap<string, GuardedResult>,
  stubs: Pt[][],
): Pt | null {
  const size = labelSizes.get(id)
  if (!size) return null
  const nodes = p.boxes.map((b) => ({ ...b, x: b.x - LABEL_NODE_MARGIN, y: b.y - LABEL_NODE_MARGIN, w: b.w + 2 * LABEL_NODE_MARGIN, h: b.h + 2 * LABEL_NODE_MARGIN }))
  const candidates = LABEL_SLOTS.map((f) => (f === 0.5 ? r.mid : pointAt(r.points, f)))
  const offStub = (box: Box) => !stubs.some((s) => polyHits(s, box))
  const clear = (box: Box): boolean => {
    if (nodes.some((n) => hit(n, box))) return false
    for (const [oid, ob] of placed) if (oid !== id && hit(ob, box)) return false
    return true
  }
  const offLines = (box: Box): boolean => {
    for (const [oid, o] of routes) if (oid !== id && polyHits(o.points, box)) return false
    return true
  }
  for (const c of candidates) {
    const box = labelBoxAt(c, size, id)
    if (offStub(box) && clear(box) && offLines(box)) return c
  }
  for (const c of candidates) {
    const box = labelBoxAt(c, size, id)
    if (offStub(box) && clear(box)) return c
  }
  for (const c of candidates) if (offStub(labelBoxAt(c, size, id))) return c
  return r.mid
}

/** a full generation, as steps: each `yield` is a point where a sliced run may
 *  pause. Run to the end in one go it IS the synchronous generation. */
function* fullSteps(nodes: LoopNode[], edges: LoopEdge[], out: { map?: Map<string, RoutedEdge> }): Generator<string> {
  const p = plan(nodes, edges)
  yield 'plan'
  const routes = new Map<string, GuardedResult>()
  for (const e of p.ortho) {
    const r = yield* routeOneSteps(p, e, routes, [])
    if (r) routes.set(e.id, r)
    yield `route ${e.id}`
  }
  // labels: first free slot, in id order
  let stubs = sharedStubsOf(p, routes)
  yield 'stubs'
  const labels = new Map<string, Pt | null>()
  const placed = new Map<string, Box>()
  for (const e of p.ortho) {
    const r = routes.get(e.id)
    if (!r) continue
    const c = placeLabel(p, e.id, r, placed, routes, stubs)
    labels.set(e.id, c)
    if (c) placed.set(e.id, labelBoxAt(c, labelSizes.get(e.id)!, e.id))
    yield `label ${e.id}`
  }
  // guarded rounds: an edge running through other edges' labels is routed again
  // with those labels as soft obstacles, kept only when it crosses fewer of them
  // and is not a lower rung
  for (let round = 0; round < LABEL_ROUNDS; round++) {
    let changed = 0
    for (const e of p.ortho) {
      const r = routes.get(e.id)
      if (!r) continue
      const crossed = [...placed].filter(([id, b]) => id !== e.id && polyHits(r.points, b)).map(([, b]) => b)
      if (crossed.length === 0) continue
      // one rung of `SOFT_PADS` per step, until one is free
      let r2: GuardedResult | null = null
      for (const pad of SOFT_PADS) {
        r2 = yield* routeOneSteps(p, e, routes, crossed, pad)
        yield `round ${e.id} @${pad}`
        if (r2) break
      }
      if (!r2 || r2.d === r.d || CLASS_RANK[r2.routeClass] > CLASS_RANK[r.routeClass]) continue
      if (crossed.filter((b) => polyHits(r2.points, b)).length >= crossed.length) continue
      routes.set(e.id, r2)
      stubs = sharedStubsOf(p, routes)
      placed.delete(e.id)
      const c = placeLabel(p, e.id, r2, placed, routes, stubs)
      labels.set(e.id, c)
      if (c) placed.set(e.id, labelBoxAt(c, labelSizes.get(e.id)!, e.id))
      changed++
    }
    if (changed === 0) break
  }
  const map = new Map<string, RoutedEdge>()
  for (const e of p.ortho) {
    const r = routes.get(e.id)
    if (r) map.set(e.id, { ...r, label: labels.get(e.id) ?? null })
  }
  out.map = map
}

/** the synchronous full generation */
function rebuildFull(nodes: LoopNode[], edges: LoopEdge[]): Map<string, RoutedEdge> {
  const out: { map?: Map<string, RoutedEdge> } = {}
  for (const _ of fullSteps(nodes, edges, out)) {
    // run every step at once
  }
  return out.map!
}

/** each routed edge's own routing input, to tell which changed */
const edgeKey = (e: LoopEdge): string =>
  JSON.stringify([e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null, (e.data as { waypoints?: unknown }).waypoints ?? null, labelSizes.get(e.id) ?? null])

/** the provisional map: the last full generation, with the routes this change
 *  touches routed again — an edge that is new or whose own input changed, one
 *  incident to a moved / resized node, one whose route now runs into a moved
 *  node — incident and new ones first, within `PROVISIONAL_MS` (a new edge left
 *  over is not drawn until the full generation commits; a moved one keeps its
 *  last route). Their labels take a free slot among the labels already placed.
 *  Never committed as a full generation. */
function provisional(nodes: LoopNode[], edges: LoopEdge[], from: Base): Map<string, RoutedEdge> {
  const tStart = now()
  const p = plan(nodes, edges)
  const moved = new Set<string>()
  for (const n of nodes) {
    const b = from.geo.get(n.id)
    const s = sizeOf(n)
    if (!b || b.x !== n.position.x || b.y !== n.position.y || b.w !== s.w || b.h !== s.h) moved.add(n.id)
  }
  const movedBoxes = p.boxes.filter((b) => moved.has(b.id))
  const out = new Map<string, RoutedEdge>()
  for (const e of p.ortho) {
    const r = from.map.get(e.id)
    if (r) out.set(e.id, r)
  }
  const first: LoopEdge[] = []
  const then: LoopEdge[] = []
  for (const e of p.ortho) {
    const r = from.map.get(e.id)
    if (!r || from.keys.get(e.id) !== edgeKey(e) || moved.has(e.source) || moved.has(e.target)) first.push(e)
    else if (movedBoxes.some((b) => polyHits(r.points, b))) then.push(e)
  }
  lastProvisional = { moved: moved.size, affected: first.length + then.length, routed: 0 }
  const placed = new Map<string, Box>()
  const redo = new Set([...first, ...then].map((e) => e.id))
  for (const [id, r] of out) {
    const s = labelSizes.get(id)
    if (r.label && s && !redo.has(id)) placed.set(id, labelBoxAt(r.label, s, id))
  }
  const t0 = now()
  let longest = 0
  for (const e of [...first, ...then]) {
    // a route is started only when the longest one so far still fits
    if (now() - t0 + longest > PROVISIONAL_MS) continue
    const r0 = now()
    const r = routeOne(p, e, out, [])
    longest = Math.max(longest, now() - r0)
    lastProvisional.routed++
    if (!r) {
      out.delete(e.id)
      continue
    }
    const c = placeLabel(p, e.id, r, placed, out, [])
    if (c) placed.set(e.id, labelBoxAt(c, labelSizes.get(e.id)!, e.id))
    out.set(e.id, { ...r, label: c })
  }
  lastProvisional.ms = +(now() - tStart).toFixed(2)
  provisionalPeakMs = Math.max(provisionalPeakMs, lastProvisional.ms)
  return out
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// ── diagnostics (never hidden): §ER14.4 ───────────────────────────────────

type Report = {
  counts: Record<GuardedClass, number>
  flagged: { id: string; routeClass: GuardedClass }[]
  /** two connections of one port running together past its stub (must be 0) */
  fanOverlaps: { a: string; b: string; length: number }[]
  /** fan members whose branch was blocked by obstacles (routed without it) */
  fanBlocked: string[]
}
let lastReport: Report = { counts: { orthogonal: 0, tight: 0, outer: 0, blocked: 0, degenerate: 0 }, flagged: [], fanOverlaps: [], fanBlocked: [] }
/** the last provisional map: moved nodes, routes it had to redo, routes redone */
let lastProvisional: { moved: number; affected: number; routed: number; ms?: number } | null = null
/** the longest provisional map since the last `__resetProvisionalPeak` (it runs inside a render) */
let provisionalPeakMs = 0
export function __resetProvisionalPeak(): void {
  provisionalPeakMs = 0
}
/** the last full generation's job: slices and the longest one, ms */
let lastJob: { slices: number; maxSliceMs: number; maxStepMs: number; slowestStep: string; cancelled: number } = { slices: 0, maxSliceMs: 0, maxStepMs: 0, slowestStep: '', cancelled: 0 }
const warned = new Set<string>()

/** the collinear length two polylines share */
function sharedLength(a: Pt[], b: Pt[]): number {
  let s = 0
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const p0 = a[i - 1]
      const p1 = a[i]
      const q0 = b[j - 1]
      const q1 = b[j]
      if (p0.x === p1.x && q0.x === q1.x && p0.x === q0.x) {
        const o = Math.min(Math.max(p0.y, p1.y), Math.max(q0.y, q1.y)) - Math.max(Math.min(p0.y, p1.y), Math.min(q0.y, q1.y))
        if (o > 0) s += o
      } else if (p0.y === p1.y && q0.y === q1.y && p0.y === q0.y) {
        const o = Math.min(Math.max(p0.x, p1.x), Math.max(q0.x, q1.x)) - Math.max(Math.min(p0.x, p1.x), Math.min(q0.x, q1.x))
        if (o > 0) s += o
      }
    }
  }
  return s
}

function report(nodes: LoopNode[], edges: LoopEdge[], map: Map<string, RoutedEdge>): void {
  const counts: Record<GuardedClass, number> = { orthogonal: 0, tight: 0, outer: 0, blocked: 0, degenerate: 0 }
  const flagged: Report['flagged'] = []
  for (const [id, r] of map) {
    counts[r.routeClass]++
    if (r.routeClass === 'outer' || r.routeClass === 'blocked') {
      flagged.push({ id, routeClass: r.routeClass })
      const k = `${id}|${r.routeClass}`
      if (import.meta.env.DEV && !warned.has(k)) {
        warned.add(k)
        console.warn(`[route] ${id}: no route inside the clearance ladder — drawn as "${r.routeClass}"`)
      }
    }
  }
  const fanOverlaps: Report['fanOverlaps'] = []
  const p = plan(nodes, edges)
  for (let i = 0; i < p.ortho.length; i++) {
    for (let j = i + 1; j < p.ortho.length; j++) {
      const a = p.ortho[i]
      const b = p.ortho[j]
      if (pkey(a) === pkey(b)) continue
      const atS = srcKey(a) === srcKey(b)
      const atT = tgtKey(a) === tgtKey(b)
      if (!atS && !atT) continue
      const ra = map.get(a.id)
      const rb = map.get(b.id)
      if (!ra || !rb) continue
      const len = sharedLength(pastSharedStub(ra, atS, atT), pastSharedStub(rb, atS, atT))
      if (len > 0.5) fanOverlaps.push({ a: a.id, b: b.id, length: +len.toFixed(1) })
    }
  }
  lastReport = { counts, flagged, fanOverlaps, fanBlocked: [...map].filter(([, r]) => r.fanBlocked).map(([id]) => id) }
}

/** the last full generation's route classes, for the collision check and the
 *  development tools: how many routes each rung produced, every edge drawn on
 *  the outer corridor or blocked, and every port fan that runs together past
 *  its stub; plus the last provisional map and the last job's slices */
export function routeDiagnostics(): Report & { provisional: typeof lastProvisional; provisionalPeakMs: number; job: typeof lastJob; pending: boolean } {
  return { ...lastReport, provisional: lastProvisional, provisionalPeakMs, job: lastJob, pending: job != null }
}

// ── the cache, the provisional map and the full-generation job ─────────────

/** §ER3.8 — the layout signature: exactly what a generation reads, in input
 *  order, plus each node's `hidden` flag (not read by the router today, but a
 *  visibility change is a layout change by contract and must never reuse a
 *  generation if the router ever starts skipping hidden obstacles). Structured
 *  (JSON) rather than delimiter-joined: ids are user data and may contain any
 *  character, so two different layouts must never serialise to the same
 *  string (an id such as `a:100:10:80:60;b` would collide under a joined key).
 *  Non-layout fields — `selected`, `dragging`, `data.label`, values, classes —
 *  are deliberately NOT part of it. issue #344 — the label sizes of routed
 *  edges are part of it. */
export function layoutSignature(nodes: LoopNode[], edges: LoopEdge[]): string {
  const ns: (string | number | boolean)[][] = []
  for (const n of nodes) {
    const { w, h } = sizeOf(n)
    ns.push([n.id, n.position.x, n.position.y, w, h, n.hidden === true])
  }
  const es: unknown[][] = []
  for (const e of edges) {
    if (!isOrtho(e)) continue
    const wp = (e.data as { waypoints?: unknown } | undefined)?.waypoints
    const ls = labelSizes.get(e.id)
    es.push([e.id, e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null, Array.isArray(wp) ? wp : null, ls ? [ls.w, ls.h] : null])
  }
  return JSON.stringify([ns, es])
}

/** a committed full generation, and what it was computed from */
type Base = {
  sig: string
  map: Map<string, RoutedEdge>
  geo: Map<string, { x: number; y: number; w: number; h: number }>
  keys: Map<string, string>
}
const baseOf = (nodes: LoopNode[], edges: LoopEdge[], sig: string, map: Map<string, RoutedEdge>): Base => ({
  sig,
  map,
  geo: new Map(nodes.map((n) => [n.id, { ...n.position, ...sizeOf(n) }])),
  keys: new Map(edges.filter(isOrtho).map((e) => [e.id, edgeKey(e)])),
})

/** the map shown now, for the signature it answers */
let committed: { sig: string; map: ReadonlyMap<string, RoutedEdge> } | null = null
/** the last FULL generation (exact): what a provisional map starts from */
let base: Base | null = null
let lastInput: { nodes: LoopNode[]; edges: LoopEdge[] } | null = null
let idKey: { nodes: LoopNode[]; edges: LoopEdge[]; rev: number } | null = null
let genCount = 0

type Scheduler = (run: () => void) => void
/** the slice scheduler: in a browser each slice is its own task (a
 *  `MessageChannel` message), so between two slices the browser handles input
 *  and draws a frame whenever one is due; none (synchronous full generations)
 *  elsewhere */
function taskScheduler(): Scheduler | null {
  if (typeof MessageChannel !== 'function' || typeof window === 'undefined') return null
  const queue: (() => void)[] = []
  const ch = new MessageChannel()
  ch.port1.onmessage = () => queue.shift()?.()
  return (run) => {
    queue.push(run)
    ch.port2.postMessage(0)
  }
}
let scheduler: Scheduler | null = taskScheduler()

let job: { token: number; sig: string; nodes: LoopNode[]; edges: LoopEdge[]; steps: Generator<string>; out: { map?: Map<string, RoutedEdge> }; slices: number; maxSlice: number; lastStep: number; maxStep: number; slowest: string } | null = null
let jobToken = 0

function cancelJob(): void {
  if (job) lastJob = { ...lastJob, cancelled: lastJob.cancelled + 1 }
  job = null
  jobToken++
}

function startFull(nodes: LoopNode[], edges: LoopEdge[], sig: string): void {
  cancelJob()
  if (!scheduler) return
  const out: { map?: Map<string, RoutedEdge> } = {}
  const token = ++jobToken
  job = { token, sig, nodes, edges, steps: fullSteps(nodes, edges, out), out, slices: 0, maxSlice: 0, lastStep: 0, maxStep: 0, slowest: '' }
  const runSlice = () => {
    const j = job
    if (!j || j.token !== token) return // cancelled: never commits
    const t0 = now()
    let done = false
    // at least one step; another only when the last step's length still fits
    for (;;) {
      const s0 = now()
      const step = j.steps.next()
      if (step.done) {
        done = true
        break
      }
      j.lastStep = now() - s0
      if (j.lastStep > j.maxStep) j.slowest = step.value
      j.maxStep = Math.max(j.maxStep, j.lastStep)
      if (now() - t0 + Math.max(j.lastStep, j.maxStep) > SLICE_MS) break
    }
    j.slices++
    j.maxSlice = Math.max(j.maxSlice, now() - t0)
    scheduler!(done ? commitSlice : runSlice)
  }
  // the commit (diagnostics, the kept generation) is a task of its own, counted
  // like a slice
  const commitSlice = () => {
    const j = job
    if (!j || j.token !== token) return
    const t0 = now()
    job = null
    // only the generation for the layout on screen is committed
    if (committed && committed.sig === j.sig && !live) {
      commitFull(j.nodes, j.edges, j.sig, j.out.map!)
      bump()
    }
    j.slices++
    j.maxSlice = Math.max(j.maxSlice, now() - t0)
    lastJob = { slices: j.slices, maxSliceMs: +j.maxSlice.toFixed(2), maxStepMs: +j.maxStep.toFixed(2), slowestStep: j.slowest, cancelled: lastJob.cancelled }
  }
  scheduler(runSlice)
}

/** the last few committed full generations, by signature: a layout seen again
 *  (undo, redo, reopening the same document) is shown at once */
const generations = new Map<string, Base>()
const GENERATIONS_KEPT = 4

function commitFull(nodes: LoopNode[], edges: LoopEdge[], sig: string, map: Map<string, RoutedEdge>): void {
  base = baseOf(nodes, edges, sig, map)
  committed = { sig, map }
  genCount++
  report(nodes, edges, map)
  generations.delete(sig)
  generations.set(sig, base)
  while (generations.size > GENERATIONS_KEPT) generations.delete(generations.keys().next().value!)
  setBusy(false)
}

/** The route map to draw for the current routing input — shared by every
 *  `LoopEdge` in the render. */
export function currentRouteMap(nodes: LoopNode[], edges: LoopEdge[]): ReadonlyMap<string, RoutedEdge> {
  const rev = useRouteInputs.getState().rev
  if (committed && idKey && idKey.nodes === nodes && idKey.edges === edges && idKey.rev === rev) return committed.map
  lastInput = { nodes, edges }
  const sig = layoutSignature(nodes, edges) + `|v${ROUTE_MAP_VERSION}`
  idKey = { nodes, edges, rev }
  if (committed && committed.sig === sig) return committed.map // same layout, new identities
  const known = generations.get(sig)
  if (known) {
    // a full generation of exactly this layout is kept: show it at once
    cancelJob()
    base = known
    committed = { sig, map: known.map }
    report(nodes, edges, known.map)
    setBusy(false)
    return known.map
  }
  if (!scheduler) {
    // tests and the offline judge: the full generation at once
    cancelJob()
    const map = rebuildFull(nodes, edges)
    commitFull(nodes, edges, sig, map)
    return map
  }
  const total = edges.filter(isOrtho).length
  // a cold start, or another document (most routed edges are new): nothing
  // routed is drawn until the sliced full generation commits
  const fresh = base ? edges.filter((e) => isOrtho(e) && !base!.map.has(e.id)).length : total
  if (!base || fresh > Math.max(8, total / 2)) {
    const map = new Map<string, RoutedEdge>()
    committed = { sig, map }
    setBusy(total > 0)
    if (!live) startFull(nodes, edges, sig)
    return map
  }
  const map = provisional(nodes, edges, base)
  committed = { sig, map }
  setBusy(map.size < total)
  if (!live) startFull(nodes, edges, sig)
  return map
}

/** test hook — how many FULL generations have been committed. */
export function __routeGenCount(): number {
  return genCount
}
/** test hook — the synchronous full generation for this input, computed aside
 *  (the cache, the job and the diagnostics are untouched): what a committed
 *  sliced generation must equal */
export function __syncFullGeneration(nodes: LoopNode[], edges: LoopEdge[]): Map<string, RoutedEdge> {
  return rebuildFull(nodes, edges)
}
/** test hook — replace the slice scheduler (null = synchronous) */
export function __setRouteScheduler(s: Scheduler | null): void {
  cancelJob()
  scheduler = s
}
export function __resetRouteCache(): void {
  cancelJob()
  committed = null
  base = null
  generations.clear()
  wantBusy = false
  lastInput = null
  idKey = null
  genCount = 0
  labelSizes.clear()
  live = false
  warned.clear()
  lastProvisional = null
  lastJob = { slices: 0, maxSliceMs: 0, maxStepMs: 0, slowestStep: '', cancelled: 0 }
}
