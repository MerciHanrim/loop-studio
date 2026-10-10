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
import { GRID, PORT_ROW } from '../model/layout/grid'
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
import { freeLinePoints, pointAlong } from '../components/edges/freeLine'

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

/** §ER15 — a Curved or Straight edge's label slot: the fraction of its line's
 *  length where the label is centred (the line `LoopEdge` draws, sampled the
 *  same way), and that point on the route map's own copy of the line */
export type FreeSlot = { f: number; at: Pt }

/** a generation: the routes, and the label slots of the other edges */
type GenOut = { map?: Map<string, RoutedEdge>; free?: Map<string, FreeSlot> }

// ── the routing inputs that are not graph data: label sizes, the live flag ──

type LabelSize = { w: number; h: number }
const labelSizes = new Map<string, LabelSize>()

/** bumped whenever the map to show changes outside a graph edit (a label size,
 *  a committed full generation), so every `LoopEdge` re-reads it */
export const useRouteInputs = create<{ rev: number; busy: boolean; record: boolean }>(() => ({ rev: 0, busy: false, record: false }))

/** §ER15.1 — the document is a record shown by its recorded label rule
 *  (`graphStore.recordLabels`): Curved and Straight labels are not placed, they
 *  sit at their line's middle as recorded, and nothing else keeps off their
 *  lines — the routed edges get exactly the generation they had before step 3 */
let recordLabels = false
export function setRecordLabels(on: boolean): void {
  if (recordLabels === on) return
  recordLabels = on
  useRouteInputs.setState((s) => ({ rev: s.rev + 1, record: on }))
}
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
const isStraight = (e: LoopEdge): boolean =>
  (e.data as { route?: unknown } | undefined)?.route === 'straight'

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
    case Position.Left: return { x: x + portInsetFraction(kind, h, 'in', PORT_ROW, w) * w, y: y + PORT_ROW }
    case Position.Right: return { x: x + w - portInsetFraction(kind, h, 'out', PORT_ROW, w) * w, y: y + PORT_ROW }
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
const pointAt = pointAlong

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
  /** §ER15 — the Curved and Straight connections with both ends present, in id
   *  order, and each one's line (from the same port anchors the routes use):
   *  not routed, but their labels take a free slot and every other label keeps
   *  off their lines */
  free: LoopEdge[]
  lines: Map<string, Pt[]>
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
  const free: LoopEdge[] = []
  const lines = new Map<string, Pt[]>()
  for (const e of recordLabels ? [] : [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (isOrtho(e)) continue
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (!s || !t) continue
    const sPos = handlePos(e.sourceHandle, Position.Right)
    const tPos = handlePos(e.targetHandle, Position.Left)
    free.push(e)
    lines.set(e.id, freeLinePoints(handlePoint(s, sPos), sPos, handlePoint(t, tPos), tPos, isStraight(e)))
  }
  return { ortho, free, lines, byId, boxes: nodes.map(boxOf), groups, portUse, fans, reserved }
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

/** the first free slot on the edge's own line: never on a shared port stub;
 *  then clear of every node box, every label already placed and every other
 *  line (routed, Curved or Straight); failing that, clear of nodes and labels
 *  only; the midpoint last. Returns the slot's centre and its fraction. */
function placeLabelOn(
  p: Plan,
  id: string,
  points: Pt[],
  mid: Pt,
  placed: Map<string, Box>,
  routes: ReadonlyMap<string, GuardedResult>,
  stubs: Pt[][],
): { c: Pt; f: number } | null {
  const size = labelSizes.get(id)
  if (!size) return null
  const nodes = p.boxes.map((b) => ({ ...b, x: b.x - LABEL_NODE_MARGIN, y: b.y - LABEL_NODE_MARGIN, w: b.w + 2 * LABEL_NODE_MARGIN, h: b.h + 2 * LABEL_NODE_MARGIN }))
  const candidates = LABEL_SLOTS.map((f) => ({ c: f === 0.5 ? mid : pointAt(points, f), f }))
  const offStub = (box: Box) => !stubs.some((s) => polyHits(s, box))
  const clear = (box: Box): boolean => {
    if (nodes.some((n) => hit(n, box))) return false
    for (const [oid, ob] of placed) if (oid !== id && hit(ob, box)) return false
    return true
  }
  const offLines = (box: Box): boolean => {
    for (const [oid, o] of routes) if (oid !== id && polyHits(o.points, box)) return false
    for (const [oid, l] of p.lines) if (oid !== id && polyHits(l, box)) return false
    return true
  }
  for (const s of candidates) {
    const box = labelBoxAt(s.c, size, id)
    if (offStub(box) && clear(box) && offLines(box)) return s
  }
  for (const s of candidates) {
    const box = labelBoxAt(s.c, size, id)
    if (offStub(box) && clear(box)) return s
  }
  for (const s of candidates) if (offStub(labelBoxAt(s.c, size, id))) return s
  return { c: mid, f: 0.5 }
}

/** a routed edge's label slot */
function placeLabel(
  p: Plan,
  id: string,
  r: GuardedResult,
  placed: Map<string, Box>,
  routes: ReadonlyMap<string, GuardedResult>,
  stubs: Pt[][],
): Pt | null {
  return placeLabelOn(p, id, r.points, r.mid, placed, routes, stubs)?.c ?? null
}

/** a Curved or Straight edge's label slot, as a fraction of its line */
function placeFreeLabel(p: Plan, e: LoopEdge, placed: Map<string, Box>, routes: ReadonlyMap<string, GuardedResult>, stubs: Pt[][]): FreeSlot | null {
  const line = p.lines.get(e.id)!
  const s = placeLabelOn(p, e.id, line, pointAt(line, 0.5), placed, routes, stubs)
  if (!s) return null
  placed.set(e.id, labelBoxAt(s.c, labelSizes.get(e.id)!, e.id))
  return { f: s.f, at: s.c }
}

/** a full generation, as steps: each `yield` is a point where a sliced run may
 *  pause. Run to the end in one go it IS the synchronous generation. */
function* fullSteps(nodes: LoopNode[], edges: LoopEdge[], out: GenOut): Generator<string> {
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
  // §ER15 — then the Curved and Straight labels, in id order, among every
  // label and line already placed
  const free = new Map<string, FreeSlot>()
  for (const e of p.free) {
    const s = placeFreeLabel(p, e, placed, routes, stubs)
    if (s) free.set(e.id, s)
    yield `free ${e.id}`
  }
  const map = new Map<string, RoutedEdge>()
  for (const e of p.ortho) {
    const r = routes.get(e.id)
    if (r) map.set(e.id, { ...r, label: labels.get(e.id) ?? null })
  }
  out.map = map
  out.free = free
}

/** the synchronous full generation */
function rebuildFull(nodes: LoopNode[], edges: LoopEdge[]): Required<GenOut> {
  const out: GenOut = {}
  for (const _ of fullSteps(nodes, edges, out)) {
    // run every step at once
  }
  return { map: out.map!, free: out.free! }
}

/** each routed edge's own routing input, to tell which changed */
const edgeKey = (e: LoopEdge): string =>
  JSON.stringify([e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null, (e.data as { route?: unknown }).route ?? null, (e.data as { waypoints?: unknown }).waypoints ?? null, labelSizes.get(e.id) ?? null])

/** the provisional map: the last full generation, with the routes this change
 *  touches routed again — an edge that is new or whose own input changed, one
 *  incident to a moved / resized node, one whose route now runs into a moved
 *  node — incident and new ones first, within `PROVISIONAL_MS` (a new edge left
 *  over is not drawn until the full generation commits; a moved one keeps its
 *  last route). Their labels take a free slot among the labels already placed;
 *  then so do the labels of the Curved and Straight edges that are new, changed
 *  or incident to a moved node (no routing: always within the budget). Never
 *  committed as a full generation. */
function provisional(nodes: LoopNode[], edges: LoopEdge[], from: Base): Required<GenOut> {
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
  const free = new Map<string, FreeSlot>()
  const freeRedo: LoopEdge[] = []
  for (const e of p.free) {
    const s = from.free.get(e.id)
    if (!s || from.keys.get(e.id) !== edgeKey(e) || moved.has(e.source) || moved.has(e.target)) {
      freeRedo.push(e)
      continue
    }
    free.set(e.id, s)
    const size = labelSizes.get(e.id)
    if (size) placed.set(e.id, labelBoxAt(s.at, size, e.id))
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
  for (const e of freeRedo) {
    const s = placeFreeLabel(p, e, placed, out, [])
    if (s) free.set(e.id, s)
  }
  lastProvisional.ms = +(now() - tStart).toFixed(2)
  provisionalPeakMs = Math.max(provisionalPeakMs, lastProvisional.ms)
  return { map: out, free }
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
 *  edges are part of it; §ER15 — so is every edge's shape and label size, as
 *  Curved and Straight labels are placed too. */
export function layoutSignature(nodes: LoopNode[], edges: LoopEdge[]): string {
  const ns: (string | number | boolean)[][] = []
  for (const n of nodes) {
    const { w, h } = sizeOf(n)
    ns.push([n.id, n.position.x, n.position.y, w, h, n.hidden === true])
  }
  const es: unknown[][] = []
  for (const e of edges) {
    const shape = isOrtho(e) ? 'o' : isStraight(e) ? 's' : 'c'
    const wp = (e.data as { waypoints?: unknown } | undefined)?.waypoints
    const ls = labelSizes.get(e.id)
    es.push([e.id, shape, e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null, shape === 'o' && Array.isArray(wp) ? wp : null, ls ? [ls.w, ls.h] : null])
  }
  return JSON.stringify([ns, es])
}

/** a committed full generation, and what it was computed from */
type Base = {
  sig: string
  map: Map<string, RoutedEdge>
  free: Map<string, FreeSlot>
  geo: Map<string, { x: number; y: number; w: number; h: number }>
  keys: Map<string, string>
}
const baseOf = (nodes: LoopNode[], edges: LoopEdge[], sig: string, gen: Required<GenOut>): Base => ({
  sig,
  map: gen.map,
  free: gen.free,
  geo: new Map(nodes.map((n) => [n.id, { ...n.position, ...sizeOf(n) }])),
  keys: new Map(edges.map((e) => [e.id, edgeKey(e)])),
})

/** the map shown now, for the signature it answers */
let committed: { sig: string; map: ReadonlyMap<string, RoutedEdge>; free: ReadonlyMap<string, FreeSlot> } | null = null
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

let job: { token: number; sig: string; nodes: LoopNode[]; edges: LoopEdge[]; steps: Generator<string>; out: GenOut; slices: number; maxSlice: number; lastStep: number; maxStep: number; slowest: string } | null = null
let jobToken = 0

function cancelJob(): void {
  if (job) lastJob = { ...lastJob, cancelled: lastJob.cancelled + 1 }
  job = null
  jobToken++
}

function startFull(nodes: LoopNode[], edges: LoopEdge[], sig: string): void {
  cancelJob()
  if (!scheduler) return
  const out: GenOut = {}
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
      commitFull(j.nodes, j.edges, j.sig, { map: j.out.map!, free: j.out.free! })
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

function commitFull(nodes: LoopNode[], edges: LoopEdge[], sig: string, gen: Required<GenOut>): void {
  base = baseOf(nodes, edges, sig, gen)
  committed = { sig, map: gen.map, free: gen.free }
  genCount++
  report(nodes, edges, gen.map)
  generations.delete(sig)
  generations.set(sig, base)
  while (generations.size > GENERATIONS_KEPT) generations.delete(generations.keys().next().value!)
  setBusy(false)
}

/** what is waiting: a routed edge with no route yet, or a Curved / Straight
 *  edge whose label size is known but has no slot yet */
function waiting(nodes: LoopNode[], edges: LoopEdge[], gen: { map: ReadonlyMap<string, RoutedEdge>; free: ReadonlyMap<string, FreeSlot> }): boolean {
  const ids = new Set(nodes.map((n) => n.id))
  for (const e of edges) {
    if (isOrtho(e)) {
      if (!gen.map.has(e.id)) return true
    } else if (!recordLabels && ids.has(e.source) && ids.has(e.target) && labelSizes.has(e.id) && !gen.free.has(e.id)) return true
  }
  return false
}

const NO_SLOTS: ReadonlyMap<string, FreeSlot> = new Map()

/** The generation to draw for the current routing input — the routes and the
 *  Curved / Straight label slots — shared by every `LoopEdge` in the render. */
export function currentRouteGeneration(nodes: LoopNode[], edges: LoopEdge[]): { map: ReadonlyMap<string, RoutedEdge>; free: ReadonlyMap<string, FreeSlot> } {
  const rev = useRouteInputs.getState().rev
  if (committed && idKey && idKey.nodes === nodes && idKey.edges === edges && idKey.rev === rev) return committed
  lastInput = { nodes, edges }
  const sig = layoutSignature(nodes, edges) + `|v${ROUTE_MAP_VERSION}${recordLabels ? '|record' : ''}`
  idKey = { nodes, edges, rev }
  if (committed && committed.sig === sig) return committed // same layout, new identities
  const known = generations.get(sig)
  if (known) {
    // a full generation of exactly this layout is kept: show it at once
    cancelJob()
    base = known
    committed = { sig, map: known.map, free: known.free }
    report(nodes, edges, known.map)
    setBusy(false)
    return committed
  }
  if (!scheduler) {
    // tests and the offline judge: the full generation at once
    cancelJob()
    commitFull(nodes, edges, sig, rebuildFull(nodes, edges))
    return committed!
  }
  const total = edges.filter(isOrtho).length
  // a cold start, or another document (most routed edges are new): nothing
  // routed, and no Curved / Straight label, is drawn until the sliced full
  // generation commits
  const fresh = base ? edges.filter((e) => isOrtho(e) && !base!.map.has(e.id)).length : total
  if (!base || fresh > Math.max(8, total / 2)) {
    committed = { sig, map: new Map(), free: NO_SLOTS }
    setBusy(waiting(nodes, edges, committed))
    if (!live) startFull(nodes, edges, sig)
    return committed
  }
  const gen = provisional(nodes, edges, base)
  committed = { sig, ...gen }
  setBusy(waiting(nodes, edges, committed))
  if (!live) startFull(nodes, edges, sig)
  return committed
}

/** the routes of the current generation (see `currentRouteGeneration`) */
export function currentRouteMap(nodes: LoopNode[], edges: LoopEdge[]): ReadonlyMap<string, RoutedEdge> {
  return currentRouteGeneration(nodes, edges).map
}

// ── bend-point editing (issue #344 step 3, docs/edge-routing.md §ER16) ─────

/** how close to a port stub a bend point may not be, flow px */
export const BEND_STUB_TOL = 8

/** why a bend point of `edgeId` cannot be at `p`: inside a node, or on one of
 *  the connection's own port stubs (the stretch from a port to `ROUTE_STUB`
 *  past its node's side, which the router owns); null when it can. A refused
 *  edit is undone, never adjusted. */
export function bendRejection(nodes: LoopNode[], edges: LoopEdge[], edgeId: string, p: Pt): 'node' | 'stub' | null {
  for (const n of nodes) {
    const b = boxOf(n)
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return 'node'
  }
  const e = edges.find((x) => x.id === edgeId)
  if (!e) return null
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const asSource of [true, false]) {
    const n = byId.get(asSource ? e.source : e.target)
    if (!n) continue
    const pos = asSource ? handlePos(e.sourceHandle, Position.Right) : handlePos(e.targetHandle, Position.Left)
    const port = handlePoint(n, pos)
    const nrm = pos === Position.Left ? { x: -1, y: 0 } : pos === Position.Right ? { x: 1, y: 0 } : pos === Position.Top ? { x: 0, y: -1 } : { x: 0, y: 1 }
    const b = boxOf(n)
    const side = nrm.x > 0 ? b.x + b.w - port.x : nrm.x < 0 ? port.x - b.x : nrm.y > 0 ? b.y + b.h - port.y : port.y - b.y
    const len = Math.max(0, side) + ROUTE_STUB
    const end = { x: port.x + nrm.x * len, y: port.y + nrm.y * len }
    if (distToSegment(p, port, end) < BEND_STUB_TOL) return 'stub'
  }
  return null
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** where along a polyline the point nearest to `p` lies, as a length from its start */
function lengthAt(pts: Pt[], p: Pt): number {
  let best = Infinity
  let at = 0
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    const d = distToSegment(p, a, b)
    if (d < best) {
      best = d
      const dx = b.x - a.x
      const dy = b.y - a.y
      const t = seg > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (seg * seg))) : 0
      at = acc + t * seg
    }
    acc += seg
  }
  return at
}

/** the point of segment a→b (axis-aligned) nearest to `p`, snapped to the grid
 *  ALONG the segment and kept on its line ACROSS it, so a bend point added
 *  there leaves the route where it is (a port row is off the grid: a full snap
 *  would make the route jog). `free` (Alt) skips the snap. Null when no grid
 *  line falls inside the segment. */
function onSegment(a: Pt, b: Pt, p: Pt, free: boolean): Pt | null {
  const horiz = Math.abs(a.y - b.y) <= Math.abs(a.x - b.x)
  const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
  const hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
  const want = Math.max(lo, Math.min(hi, horiz ? p.x : p.y))
  let v = want
  if (!free) {
    v = Math.round(want / GRID) * GRID
    if (v < lo || v > hi) v = v < lo ? Math.ceil(lo / GRID) * GRID : Math.floor(hi / GRID) * GRID
    if (v < lo || v > hi) return null
  }
  return horiz ? { x: v, y: a.y } : { x: a.x, y: v }
}

/** where a click at `p` puts a new bend point: on the nearest segment of the
 *  route, snapped along it (Alt: free); null when that segment holds no grid
 *  line */
export function bendAtClick(points: Pt[], p: Pt, free: boolean): Pt | null {
  let best = -1
  let bestD = Infinity
  for (let i = 1; i < points.length; i++) {
    const d = distToSegment(p, points[i - 1], points[i])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best < 0 ? null : onSegment(points[best - 1], points[best], p, free)
}

/** §ER16.2 — the bend point Enter adds: the middle of the longest editable
 *  segment of the route (between its two stub ends), snapped along it; equal
 *  lengths go to the one nearer the route's start; a segment whose point would
 *  be refused (`bendRejection`) gives way to the next. Null when none can take
 *  one. Deterministic: lengths and order only. */
export function keyboardBend(nodes: LoopNode[], edges: LoopEdge[], edgeId: string, route: GuardedResult): Pt | null {
  const pts = route.points
  const sStart = lengthAt(pts, route.stubs[1])
  const sEnd = lengthAt(pts, route.stubs[2])
  const spans: { a: Pt; b: Pt; len: number; at: number }[] = []
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    const s0 = Math.max(acc, sStart)
    const s1 = Math.min(acc + seg, sEnd)
    if (s1 - s0 > COORD_TOL && seg > 0) {
      const at = (k: number) => ({ x: a.x + ((b.x - a.x) * (k - acc)) / seg, y: a.y + ((b.y - a.y) * (k - acc)) / seg })
      spans.push({ a: at(s0), b: at(s1), len: s1 - s0, at: s0 })
    }
    acc += seg
  }
  spans.sort((p, q) => q.len - p.len || p.at - q.at)
  for (const s of spans) {
    const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
    const p = onSegment(s.a, s.b, mid, false)
    if (p && bendRejection(nodes, edges, edgeId, p) === null) return p
  }
  return null
}
const COORD_TOL = 1e-6

/** the index a new bend point clicked at `p` takes among `waypoints`, for a
 *  route drawn through `points`: the span of the route the click lands on (the
 *  route passes through its bend points in order) */
export function bendInsertIndex(points: Pt[], waypoints: Pt[], p: Pt): number {
  const s = lengthAt(points, p)
  return waypoints.filter((w) => lengthAt(points, w) < s).length
}

/** test hook — how many FULL generations have been committed. */
export function __routeGenCount(): number {
  return genCount
}
/** test hook — the synchronous full generation for this input, computed aside
 *  (the cache, the job and the diagnostics are untouched): what a committed
 *  sliced generation must equal */
export function __syncFullGeneration(nodes: LoopNode[], edges: LoopEdge[]): Map<string, RoutedEdge> {
  return rebuildFull(nodes, edges).map
}
/** test hook — the synchronous Curved / Straight label slots for this input */
export function __syncFreeSlots(nodes: LoopNode[], edges: LoopEdge[]): Map<string, FreeSlot> {
  return rebuildFull(nodes, edges).free
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
  recordLabels = false
  warned.clear()
  lastProvisional = null
  lastJob = { slices: 0, maxSliceMs: 0, maxStepMs: 0, slowestStep: '', cancelled: 0 }
}
