// docs/simulation-playback.md §PB4.8 — the badge plan for the current layout:
// computed once per layout (positions, sizes, outside names, routes), on the
// first step that needs it, and reused until the layout changes. LoopEdge
// keeps the place it read for the whole of a step, so a plan never changes a
// moving badge.

import { getBezierPath, Position } from '@xyflow/react'
import type { LoopEdge, LoopNode } from '../../model/types'
import { edgePortKind, faceOf, type PortEnd } from '../../model/ports'
import type { PortFace } from '../../model/types'
import { layoutSignature, nameFootprintsOf, portPoint, type RoutedEdge } from '../../store/routeMap'
import { planBadgePlaces, type PlanEdge, type PlanMark } from './badgePlan'
import { badgeWidth, type BadgePlace, type Box } from './playbackBadge'
import { samplePath } from './pathSample'

/** route sampling step, flow px */
const STEP = 2
/** a plan does not depend on one step's amounts: a two-digit amount's width */
const PLAN_TEXT = '+12'

const posOf = (f: PortFace): Position =>
  f === 'top' ? Position.Top : f === 'right' ? Position.Right : f === 'bottom' ? Position.Bottom : Position.Left

export const nodeBodyBox = (n: LoopNode): Box | null => {
  const w = n.measured?.width ?? n.width
  const h = n.measured?.height ?? n.height
  return w && h ? { x0: n.position.x, y0: n.position.y, x1: n.position.x + w, y1: n.position.y + h } : null
}

let sampler: SVGPathElement | null = null
/** the route at equal steps along its length: the browser's length (one call)
 *  sets the count, the points are computed in script (pathSample.ts); a path
 *  the script does not read is sampled through the DOM, point by point */
function sample(d: string): { x: number; y: number }[] {
  if (typeof document === 'undefined') return []
  sampler ??= document.createElementNS('http://www.w3.org/2000/svg', 'path')
  sampler.setAttribute('d', d)
  let len = 0
  try {
    len = sampler.getTotalLength()
  } catch {
    return []
  }
  const pts = samplePath(d, STEP, len)
  if (pts) return pts
  const n = Math.max(1, Math.ceil(len / STEP))
  const out: { x: number; y: number }[] = []
  for (let i = 0; i <= n; i++) {
    const p = sampler.getPointAtLength((i / n) * len)
    out.push({ x: p.x, y: p.y })
  }
  return out
}

/** the path a connection is drawn with, as LoopEdge draws it */
function pathOf(e: LoopEdge, s: LoopNode, t: LoopNode, map: ReadonlyMap<string, RoutedEdge>): string | null {
  const route = (e.data as { route?: unknown } | undefined)?.route
  if (route === 'orthogonal') return map.get(e.id)?.d ?? null
  const end = (n: LoopNode, which: PortEnd) => {
    const pos = posOf(faceOf(e, which))
    const port = edgePortKind(e) === 'state' ? 'state' : which === 'source' ? 'out' : 'in'
    return { pos, ...portPoint(n, pos, port) }
  }
  const a = end(s, 'source')
  const b = end(t, 'target')
  if (route === 'straight') return `M ${a.x},${a.y}L ${b.x},${b.y}`
  return getBezierPath({ sourceX: a.x, sourceY: a.y, sourcePosition: a.pos, targetX: b.x, targetY: b.y, targetPosition: b.pos })[0]
}

let cache: { sig: string; map: ReadonlyMap<string, RoutedEdge>; places: Map<string, BadgePlace> } | null = null

/** what a plan reads: the marks, and every resource connection with its path */
function planInputs(nodes: LoopNode[], edges: LoopEdge[], map: ReadonlyMap<string, RoutedEdge>): { marks: PlanMark[]; plan: (PlanEdge & { d: string })[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const marks: PlanMark[] = []
  for (const n of nodes) {
    const b = nodeBodyBox(n)
    if (b && !n.hidden) marks.push({ ...b, node: n.id, kind: 'body' })
  }
  for (const f of nameFootprintsOf(nodes)) marks.push({ x0: f.name.x, y0: f.name.y, x1: f.name.x + f.name.w, y1: f.name.y + f.name.h, node: f.id, kind: 'name' })
  const plan: (PlanEdge & { d: string })[] = []
  for (const e of edges) {
    if (edgePortKind(e) !== 'resource') continue
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    const sb = s && nodeBodyBox(s)
    const tb = t && nodeBodyBox(t)
    if (!s || !t || !sb || !tb) continue
    const d = pathOf(e, s, t, map)
    const pts = d ? sample(d) : []
    if (!d || pts.length < 2) continue
    plan.push({ id: e.id, fan: `${e.source}|${faceOf(e, 'source')}`, pts, from: e.source, to: e.target, source: sb, target: tb, d })
  }
  return { marks, plan }
}

/** every resource connection's badge place for this layout */
export function badgePlaces(nodes: LoopNode[], edges: LoopEdge[], map: ReadonlyMap<string, RoutedEdge>): Map<string, BadgePlace> {
  const sig = layoutSignature(nodes, edges)
  if (cache && cache.sig === sig && cache.map === map) return cache.places
  const { marks, plan } = planInputs(nodes, edges, map)
  const places = planBadgePlaces(plan, marks, badgeWidth(PLAN_TEXT))
  cache = { sig, map, places }
  return places
}
