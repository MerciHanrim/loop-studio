// docs/edge-routing.md §ER3.8–§ER3.9 — the atomic orthogonal-route map.
//
// One `Map<edgeId, RouteResult>` for every `route: "orthogonal"` edge, rebuilt
// as a whole generation whenever the routing inputs change, and swapped in
// atomically (a render never mixes an edge's stale route with another's fresh
// one). Uses the module-identity-cache pattern (like `src/store/registers.ts`):
// Zustand keeps `nodes` / `edges` referentially stable until they actually
// change, so within one render every `LoopEdge` gets the SAME generation with
// no recompute; a graph edit swaps a reference ⇒ exactly one full recompute.
//
// The cache key is the routing INPUT (§ER3.8), checked in two steps: the
// `(nodes ref, edges ref, ROUTER_VERSION)` identity first (free), then the
// layout signature — every value `rebuild` reads, serialised. React Flow's
// `applyNodeChanges` returns a NEW `nodes` array for a `select` change (and
// other non-geometric edits do the same), which used to rebuild the whole map
// on every click; the same signature now keeps the generation and adopts the
// new identities. Zoom / pan / hover / theme / sim never touch
// `graphStore.nodes` / `.edges` at all.

import { Position } from '@xyflow/react'
import type { LoopEdge, LoopNode } from '../model/types'
import {
  type Box,
  computeOrthogonalRoute,
  type RouteResult,
  ROUTER_VERSION,
} from '../components/edges/orthogonalRoute'

const DEFAULT_W = 130
const DEFAULT_H = 64

type Key = { nodes: LoopNode[]; edges: LoopEdge[]; v: number; sig: string }
let cacheKey: Key | null = null
let cacheMap: ReadonlyMap<string, RouteResult> = new Map()
let genCount = 0

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

/** centre of a node's handle in flow coords */
function handlePoint(n: LoopNode, pos: Position): { x: number; y: number } {
  const w = n.measured?.width ?? n.width ?? DEFAULT_W
  const h = n.measured?.height ?? n.height ?? DEFAULT_H
  const x = n.position.x
  const y = n.position.y
  switch (pos) {
    case Position.Left: return { x, y: y + h / 2 }
    case Position.Right: return { x: x + w, y: y + h / 2 }
    case Position.Top: return { x: x + w / 2, y }
    default: return { x: x + w / 2, y: y + h }
  }
}

function rebuild(nodes: LoopNode[], edges: LoopEdge[]): ReadonlyMap<string, RouteResult> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const boxOf = (n: LoopNode): Box => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    w: n.measured?.width ?? n.width ?? DEFAULT_W,
    h: n.measured?.height ?? n.height ?? DEFAULT_H,
  })

  // parallel sets — unordered endpoint key, reversed pairs included (§ER3.7)
  const groups = new Map<string, string[]>()
  const pkey = (e: LoopEdge): string => {
    const a = `${e.source}:${e.sourceHandle ?? ''}`
    const b = `${e.target}:${e.targetHandle ?? ''}`
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }
  const ortho = edges.filter(isOrtho).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const e of ortho) {
    const k = pkey(e)
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(e.id)
  }

  const out = new Map<string, RouteResult>()
  for (const e of ortho) {
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (!s || !t) continue
    const sPos = handlePos(e.sourceHandle, Position.Right)
    const tPos = handlePos(e.targetHandle, Position.Left)
    const set = groups.get(pkey(e))!
    const route = computeOrthogonalRoute({
      edgeId: e.id,
      source: handlePoint(s, sPos),
      target: handlePoint(t, tPos),
      sourcePosition: sPos,
      targetPosition: tPos,
      obstacles: nodes.filter((n) => n.id !== e.source && n.id !== e.target).map(boxOf),
      waypoints: Array.isArray((e.data as { waypoints?: { x: number; y: number }[] }).waypoints)
        ? (e.data as { waypoints: { x: number; y: number }[] }).waypoints
        : [],
      parallelIndex: set.indexOf(e.id),
      parallelCount: set.length,
      selfLoop: e.source === e.target,
    })
    out.set(e.id, route)
  }
  return out
}

/** §ER3.8 — the layout signature: exactly what `rebuild` reads, in input
 *  order, plus each node's `hidden` flag (not read by the router today, but a
 *  visibility change is a layout change by contract and must never reuse a
 *  generation if the router ever starts skipping hidden obstacles). Structured
 *  (JSON) rather than delimiter-joined: ids are user data and may contain any
 *  character, so two different layouts must never serialise to the same
 *  string (an id such as `a:100:10:80:60;b` would collide under a joined key).
 *  Non-layout fields — `selected`, `dragging`, `data.label`, values, classes —
 *  are deliberately NOT part of it. */
export function layoutSignature(nodes: LoopNode[], edges: LoopEdge[]): string {
  const ns: (string | number | boolean)[][] = []
  for (const n of nodes) {
    const w = n.measured?.width ?? n.width ?? DEFAULT_W
    const h = n.measured?.height ?? n.height ?? DEFAULT_H
    ns.push([n.id, n.position.x, n.position.y, w, h, n.hidden === true])
  }
  const es: unknown[][] = []
  for (const e of edges) {
    if (!isOrtho(e)) continue
    const wp = (e.data as { waypoints?: unknown } | undefined)?.waypoints
    es.push([e.id, e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null, Array.isArray(wp) ? wp : null])
  }
  return JSON.stringify([ns, es])
}

/** The route generation for the current routing input — computed at most once
 *  per layout, shared by every `LoopEdge` in the render. */
export function currentRouteMap(nodes: LoopNode[], edges: LoopEdge[]): ReadonlyMap<string, RouteResult> {
  if (cacheKey && cacheKey.nodes === nodes && cacheKey.edges === edges && cacheKey.v === ROUTER_VERSION) {
    return cacheMap
  }
  const sig = layoutSignature(nodes, edges)
  if (cacheKey && cacheKey.sig === sig && cacheKey.v === ROUTER_VERSION) {
    // same layout under new array identities (a select change, a label edit …):
    // keep the generation, adopt the identities for the fast path
    cacheKey = { nodes, edges, v: ROUTER_VERSION, sig }
    return cacheMap
  }
  cacheMap = rebuild(nodes, edges)
  cacheKey = { nodes, edges, v: ROUTER_VERSION, sig }
  genCount += 1
  return cacheMap
}

/** test hook — how many full route-map generations have been built. */
export function __routeGenCount(): number {
  return genCount
}
export function __resetRouteCache(): void {
  cacheKey = null
  cacheMap = new Map()
  genCount = 0
}
