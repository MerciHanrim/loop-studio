import { useEffect } from 'react'
import { selectSelectedNodeCount, useGraphStore } from '../../store/graphStore'
import { selectOverlay, useUiStore } from '../../store/uiStore'
import { useIsMobile } from '../../ui/media'
import { useT } from '../../i18n'
import { Inspector } from '../Inspector'
import { MobileSheet } from './MobileSheet'

// docs/mobile.md §MV5 / §MV-D3 — on mobile the Inspector is a READ-ONLY bottom
// sheet. Every control inside is inert: the whole panel is wrapped in
// <fieldset disabled>, so no field, no Delete button, no Convert button can
// mutate the graph (§MV3a — structural editing is desktop-only).
//
// §MV5b (2026-11-15) — the sheet opens ON REQUEST: the selection panel's
// Details button (`MobileSelectionPanel`) asks for it. A selection by itself
// no longer opens it (its scrim covered the More button and the sheet the
// canvas rail). Its Close, a tap on its scrim and Escape close the SHEET and
// keep the selection: the panel is under it and shows again. Taking the
// selection off is the panel's Deselect, or a tap on the empty canvas. The
// sheet still goes when the selection does (something else cleared it).

export function MobileInspectorSheet() {
  const t = useT()
  const isMobile = useIsMobile()
  const overlay = useUiStore(selectOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  const selectedNodeCount = useGraphStore(selectSelectedNodeCount)
  const hasSelection = selectedNodeId != null || selectedEdgeId != null

  // the sheet is about the selection: with nothing selected it has nothing to show
  useEffect(() => {
    if (isMobile && !hasSelection && overlay === 'inspector') closeOverlay('inspector')
  }, [isMobile, hasSelection, overlay, closeOverlay])

  if (!isMobile || !hasSelection || overlay !== 'inspector') return null

  return (
    <MobileSheet title={t('mobile.inspector.title')} className="sheet--inspector" onClose={() => closeOverlay('inspector')}>
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
