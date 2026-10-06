// docs/visual-language.md §VL6 — the edge direction marker.
//
// React Flow's built-in `markerEnd: { type: MarkerType.ArrowClosed }` draws a
// FIXED grey arrow and was only ever attached to a few code-built graphs (the
// boot sample, templates); an imported graph or a hand-wired state edge got no
// marker at all. The renderer now owns the marker instead: one shared `<defs>`,
// referenced unconditionally by every `LoopEdge`, filled through the same edge
// tokens as the stroke so the arrow holds contrast in BOTH themes and matches
// the class of edge it terminates (resource / state / selected).
//
// Mounted once inside <ReactFlow> as a zero-box <svg> — the same pattern React
// Flow uses for its own marker defs.

import { readAccent } from '../../model/model'
import { useGraphStore } from '../../store/graphStore'
import { accentMarkerId } from '../../ui/flowColour'

export const EDGE_MARKER = {
  resource: 'loop-arrow-resource',
  state: 'loop-arrow-state',
  selected: 'loop-arrow-selected',
} as const

type ArrowProps = { id: string; className: string; fill?: string }

function Arrow({ id, className, fill }: ArrowProps) {
  return (
    <marker
      id={id}
      className={className}
      style={fill ? { ['--loop-arrow-fill' as string]: fill } : undefined}
      viewBox="0 0 12 12"
      refX="10"
      refY="6"
      markerWidth="8"
      markerHeight="8"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      {/* slim head with a concave base — lighter than a solid triangle */}
      <path d="M1 1 L11 6 L1 11 L3.75 6 Z" />
    </marker>
  )
}

/** the distinct stored flow colours on the graph's edges, sorted, as ONE
 *  string so the selector only changes when the set does */
const edgeAccentKey = (s: { edges: { data?: unknown }[] }): string => {
  const set = new Set<string>()
  for (const e of s.edges) {
    const a = readAccent((e.data as { accent?: unknown } | undefined)?.accent)
    if (a !== undefined) set.add(a)
  }
  return [...set].sort().join(' ')
}

export function EdgeMarkers() {
  const accents = useGraphStore(edgeAccentKey)
  return (
    <svg className="loop-edge-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        <Arrow id={EDGE_MARKER.resource} className="loop-arrow loop-arrow--resource" />
        <Arrow id={EDGE_MARKER.state} className="loop-arrow loop-arrow--state" />
        <Arrow id={EDGE_MARKER.selected} className="loop-arrow loop-arrow--selected" />
        {/* FC-4.2 — one arrow per distinct flow colour in the document */}
        {accents === ''
          ? null
          : accents.split(' ').map((a) => {
              const id = accentMarkerId(a)
              return id ? <Arrow key={id} id={id} className="loop-arrow loop-arrow--accent" fill={a} /> : null
            })}
      </defs>
    </svg>
  )
}
