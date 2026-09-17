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
// The cache key is (nodes ref, edges ref, ROUTER_VERSION). Zoom / pan / hover /
// selection / theme / sim never touch `graphStore.nodes` / `.edges`, so they
// never invalidate the map (§ER3.8).

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

export const isOrthogonalEdge = (e: LoopEdge): boolean =>
  (e.data as { route?: unknown } | undefined)?.route === 'orthogonal'
const isOrtho = isOrthogonalEdge

/** §ER3.7 — the unordered endpoint key of a parallel set (a reversed pair
 *  shares it). Also used by the drag preview so a previewed edge keeps the
 *  same fan slot as its canonical route. */
export const parallelKey = (e: Pick<LoopEdge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>): string => {
  const a = `${e.source}:${e.sourceHandle ?? ''}`
  const b = `${e.target}:${e.targetHandle ?? ''}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

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
  const pkey = parallelKey
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

/** The route generation for the current `(nodes, edges)` identity — computed at
 *  most once per identity, shared by every `LoopEdge` in the render. */
export function currentRouteMap(nodes: LoopNode[], edges: LoopEdge[]): ReadonlyMap<string, RouteResult> {
  if (cacheKey && cacheKey.nodes === nodes && cacheKey.edges === edges && cacheKey.v === ROUTER_VERSION) {
    return cacheMap
  }
  // §ER3.8 — the key is the routing INPUT, not the array identity. React Flow's
  // `applyNodeChanges` hands back a new array for a `select` change (and other
  // non-geometric edits do the same), which used to rebuild the whole map on
  // every click. Same layout signature ⇒ same generation: adopt the new
  // identities and keep the map. A moved / resized node, or any change to the
  // orthogonal edge set, its handles or its waypoints, still rebuilds.
  const sig = layoutSignature(nodes, edges)
  if (cacheKey && cacheKey.sig === sig && cacheKey.v === ROUTER_VERSION) {
    cacheKey = { nodes, edges, v: ROUTER_VERSION, sig }
    return cacheMap
  }
  cacheMap = rebuild(nodes, edges)
  cacheKey = { nodes, edges, v: ROUTER_VERSION, sig }
  genCount += 1
  return cacheMap
}

/** everything `rebuild` reads, in input order (obstacle order does not change
 *  a route — `computeOrthogonalRoute` sorts internally — but keeping it makes
 *  the signature cheap and unambiguous) */
function layoutSignature(nodes: LoopNode[], edges: LoopEdge[]): string {
  let out = ''
  for (const n of nodes) {
    const w = n.measured?.width ?? n.width ?? DEFAULT_W
    const h = n.measured?.height ?? n.height ?? DEFAULT_H
    out += `${n.id}:${n.position.x}:${n.position.y}:${w}:${h};`
  }
  out += '|'
  for (const e of edges) {
    if (!isOrtho(e)) continue
    const wp = (e.data as { waypoints?: unknown } | undefined)?.waypoints
    out += `${e.id}:${e.source}:${e.sourceHandle ?? ''}:${e.target}:${e.targetHandle ?? ''}:${Array.isArray(wp) ? JSON.stringify(wp) : ''};`
  }
  return out
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
