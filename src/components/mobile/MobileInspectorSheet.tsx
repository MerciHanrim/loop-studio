import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { selectSelectedNodeCount, useGraphStore } from '../../store/graphStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { useIsMobile } from '../../ui/media'
import { useT } from '../../i18n'
import { Inspector } from '../Inspector'
import { MobileSheet } from './MobileSheet'

// docs/mobile.md §MV5 / §MV-D3 — on mobile the Inspector is a READ-ONLY bottom
// sheet. It auto-opens when a node/edge is selected and closes when selection
// clears (an empty-canvas tap) or on Close. Every control inside is inert: the
// whole panel is wrapped in <fieldset disabled>, so no field, no Delete button,
// no Convert button can mutate the graph (§MV3a — structural editing is
// desktop-only).

export function MobileInspectorSheet() {
  const t = useT()
  const isMobile = useIsMobile()
  const overlay = useUiStore(selectOverlay)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  const selectedNodeCount = useGraphStore(selectSelectedNodeCount)
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
    <MobileSheet title={t('mobile.inspector.title')} className="sheet--inspector" onClose={dismiss}>
      <p className="sheet__ro-note">{t('mobile.inspector.roNote')}</p>
      {/* docs/large-graph-readability.md §LGR12.3 — the sheet shows ONE node
          (the anchor), so with two or more selected it says how many. A single
          tap-selection needs no count (this sheet IS that node), and the
          desktop "unlock editing" wording never applies here. One verified way
          in: a multi-selection held across a desktop → mobile width switch
          (docs/mobile.md §MV3c). */}
      {selectedNodeCount >= 2 && (
        <p className="lgr-selection-count lgr-selection-count--sheet" role="status">
          {t('canvas.regionSelect.count', { n: selectedNodeCount })}
        </p>
      )}
      <fieldset className="inspector-ro" disabled>
        <Inspector />
      </fieldset>
    </MobileSheet>
  )
}
