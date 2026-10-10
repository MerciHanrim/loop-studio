import { ViewportPortal } from '@xyflow/react'
import { useGuideStore } from '../store/guideStore'
import { useIsMobile } from '../ui/media'

// docs/diagram-layout.md §DL3.6 (issue #344) — the smart guides, drawn in flow
// coordinates over the canvas: a thin dashed placement line through where the
// dragged node (or selection) will land, and a solid line out to every other
// node it is exactly aligned with (port row, centre or edge). Faint while Alt
// frees the move. Decorative (`aria-hidden`), no pointer events; never on the
// phone, which has no node dragging.
export function SmartGuideLayer() {
  const guides = useGuideStore((s) => s.guides)
  const faint = useGuideStore((s) => s.faint)
  const isMobile = useIsMobile()
  if (isMobile || guides.length === 0) return null
  return (
    <ViewportPortal>
      <svg className={`smart-guides${faint ? ' is-faint' : ''}`} aria-hidden="true" data-guides={guides.length}>
        {guides.map((g, i) => (
          <line
            key={i}
            className={`smart-guide smart-guide--${g.kind}${g.strong ? ' is-strong' : ''}`}
            data-axis={g.axis}
            data-at={g.at}
            x1={g.axis === 'x' ? g.at : g.from}
            x2={g.axis === 'x' ? g.at : g.to}
            y1={g.axis === 'y' ? g.at : g.from}
            y2={g.axis === 'y' ? g.at : g.to}
          />
        ))}
      </svg>
    </ViewportPortal>
  )
}
