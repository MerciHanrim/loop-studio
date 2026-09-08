import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MiniMap, useStore } from '@xyflow/react'
import { useT } from '../i18n'
import type { NodeKind } from '../model/types'
import { useUiStore } from '../store/uiStore'

// docs/large-graph-readability.md — the bottom-right graph minimap plus its
// collapse control. Rendered by Canvas only when `minimapFits` (pane ≥ 640×380,
// not mobile); the collapsed / expanded choice within that is a persisted UI
// preference (`uiStore.minimapCollapsed`). Toggling it never touches the graph
// viewport, zoom, or node coordinates — it only re-renders this component.
//
// The toggle button is a plain DOM element (React Flow's <MiniMap> takes only
// SVG children); both states share one anchor corner, positioned by
// `.minimap-toggle` in index.css against the pinned 200×150 minimap box.

// minimap node fill by kind — resolved from the theme tokens (var() in an inline
// style property stays theme-reactive)
const MINIMAP_HUE: Record<NodeKind, string> = {
  pool: 'var(--hue-pool)',
  source: 'var(--hue-source)',
  drain: 'var(--hue-drain)',
  gate: 'var(--hue-gate)',
  converter: 'var(--hue-converter)',
  end: 'var(--hue-end)',
  // loop-model/1 — annotation nodes read as structure, not a flow hue
  parameter: 'var(--line-structure)',
  register: 'var(--line-structure)',
}

const MapIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
    <path
      d="M5.5 2.5 2 4v9l3.5-1.5 5 2L14 12V3l-3.5 1.5-5-2Zm0 0v9m5-7v9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
)

const CollapseIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
    <path
      d="M13 3 3 13M8.5 13H3v-5.5M13 3h-5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export function MinimapDock() {
  const t = useT()
  const collapsed = useUiStore((s) => s.minimapCollapsed)
  const toggle = useUiStore((s) => s.toggleMinimapCollapsed)

  if (collapsed) {
    // no minimap on screen — a compact restore tile at the pane's corner
    return (
      <button
        type="button"
        className="minimap-toggle is-collapsed"
        onClick={toggle}
        title={t('canvas.minimap.show')}
        aria-label={t('canvas.minimap.show')}
        aria-pressed={true}
      >
        <MapIcon />
      </button>
    )
  }

  return (
    <>
      <MiniMap
        pannable
        zoomable
        ariaLabel={t('canvas.minimap')}
        nodeColor={(n) => MINIMAP_HUE[(n.type as NodeKind) ?? 'pool'] ?? 'var(--line-strong)'}
        nodeStrokeColor="var(--line-strong)"
        nodeStrokeWidth={2}
        nodeBorderRadius={2}
        maskColor="var(--minimap-mask)"
        maskStrokeColor="var(--signal-primary)"
        maskStrokeWidth={1}
        bgColor="var(--surface-raised)"
      />
      {/* the collapse button lives INSIDE the minimap panel (portalled), so it
          tracks its top-right corner whatever size the minimap renders at */}
      <MinimapCollapseButton onClick={toggle} label={t('canvas.minimap.hide')} />
    </>
  )
}

/** Portals the collapse button into React Flow's `.react-flow__minimap` panel
 *  (a `position:absolute` box) so a `position:absolute` child anchors to its
 *  own corner regardless of the minimap's dynamic aspect-driven size. */
function MinimapCollapseButton({ onClick, label }: { onClick: () => void; label: string }) {
  // re-run when the graph changes (minimap remounts its svg) — a cheap signal
  const nodeCount = useStore((s) => s.nodes.length)
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.react-flow__minimap'))
  }, [nodeCount])
  if (!host) return null
  // the button is portalled as a SIBLING of `.react-flow__minimap-svg` (which
  // owns the d3-zoom pan + the click-to-jump listener), so a press on it never
  // reaches the minimap's navigation — no `stopPropagation` needed.
  return createPortal(
    <button
      type="button"
      className="minimap-toggle"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={false}
    >
      <CollapseIcon />
    </button>,
    host,
  )
}
