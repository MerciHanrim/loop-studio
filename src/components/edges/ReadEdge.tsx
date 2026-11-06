import type { EdgeProps } from '@xyflow/react'
import { useGraphStore } from '../../store/graphStore'
import { currentRouteGeneration, useRouteInputs } from '../../store/routeMap'
import { useUiStore } from '../../store/uiStore'

const RING_R = 4.5

// SEMANTICS-M6.md §M6-7 — a read connection: dash-dot, no arrowhead, a ring on the tank.
// A flow is solid with an arrow, and an activator dashed with an arrow and a chip, so
// the pattern tells it apart in every mode, forced colours included. It has no chip,
// because nothing moves along it. It is not a document connection: nothing here selects
// it, and a click on it selects the stage (Canvas).
export function ReadEdge({ id, source, target }: EdgeProps) {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const chosen = useGraphStore((s) => s.selectedNodeId === source || s.selectedNodeId === target)
  const pointed = useUiStore((s) => s.hoverEdgeId === id)
  useRouteInputs((s) => s.rev)
  const route = currentRouteGeneration(nodes, edges).map.get(id)
  if (!route) return null
  // the ring sits on the line just outside the tank: nodes draw over lines
  const [start, next] = route.points
  const run = start && next ? Math.hypot(next.x - start.x, next.y - start.y) : 0
  const ring = start && next && run > 0 ? { x: start.x + ((next.x - start.x) / run) * RING_R, y: start.y + ((next.y - start.y) / run) * RING_R } : null
  return (
    <g className={`read-edge${chosen || pointed ? ' is-related' : ''}`} data-read-edge={id}>
      <path className="read-edge__halo" d={route.d} />
      <path className="read-edge__line react-flow__edge-path" d={route.d} />
      <path className="react-flow__edge-interaction" d={route.d} fill="none" strokeOpacity={0} strokeWidth={14} />
      {ring ? <circle className="read-edge__ring" cx={ring.x} cy={ring.y} r={RING_R} /> : null}
    </g>
  )
}
