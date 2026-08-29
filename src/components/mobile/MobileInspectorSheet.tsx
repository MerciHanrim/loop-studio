import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useGraphStore } from '../../store/graphStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { useIsMobile } from '../../ui/media'
import { Inspector } from '../Inspector'
import { MobileSheet } from './MobileSheet'

// docs/mobile.md §MV5 / §MV-D3 — on mobile the Inspector is a READ-ONLY bottom
// sheet. It auto-opens when a node/edge is selected and closes when selection
// clears (an empty-canvas tap) or on Close. Every control inside is inert: the
// whole panel is wrapped in <fieldset disabled>, so no field, no Delete button,
// no Convert button can mutate the graph (§MV3a — structural editing is
// desktop-only).

export function MobileInspectorSheet() {
  const isMobile = useIsMobile()
  const overlay = useUiStore(selectOverlay)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  const setSelection = useGraphStore((s) => s.setSelection)
  const { setNodes, setEdges } = useReactFlow()
  const hasSelection = selectedNodeId != null || selectedEdgeId != null

  // Close must also clear React Flow's own selection, not just the store's, or
  // the node stays internally selected and can't be re-picked.
  const dismiss = () => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)))
    setSelection(null, null)
  }

  // selection drives the sheet: pick something → open it; clear the selection
  // (empty-canvas tap) → close it. Opening another overlay leaves the selection
  // untouched but takes over the exclusive slot (uiStore), so the sheet hides.
  useEffect(() => {
    if (!isMobile) return
    if (hasSelection) openOverlay('inspector')
    else if (overlay === 'inspector') closeOverlay('inspector')
  }, [isMobile, hasSelection, overlay, openOverlay, closeOverlay])

  if (!isMobile || !hasSelection || overlay !== 'inspector') return null

  return (
    <MobileSheet title="Inspector — read only" className="sheet--inspector" onClose={dismiss}>
      <p className="sheet__ro-note">Editing is on desktop. This is a read-only view.</p>
      <fieldset className="inspector-ro" disabled>
        <Inspector />
      </fieldset>
    </MobileSheet>
  )
}
