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

export const EDGE_MARKER = {
  resource: 'loop-arrow-resource',
  state: 'loop-arrow-state',
  selected: 'loop-arrow-selected',
} as const

type ArrowProps = { id: string; className: string }

function Arrow({ id, className }: ArrowProps) {
  return (
    <marker
      id={id}
      className={className}
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

export function EdgeMarkers() {
  return (
    <svg className="loop-edge-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        <Arrow id={EDGE_MARKER.resource} className="loop-arrow loop-arrow--resource" />
        <Arrow id={EDGE_MARKER.state} className="loop-arrow loop-arrow--state" />
        <Arrow id={EDGE_MARKER.selected} className="loop-arrow loop-arrow--selected" />
      </defs>
    </svg>
  )
}
