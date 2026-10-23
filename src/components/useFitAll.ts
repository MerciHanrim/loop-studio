import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { LoopNode } from '../model/types'
import { diagramBounds } from '../store/routeMap'
import { useUiStore } from '../store/uiStore'

/** node structure (Lumi, 2026-10-12) — a fit that contains the OUTSIDE NAMES:
 *  React Flow's fitView knows only the node boxes, so under the new structure
 *  a name on the far side was cut off; here the bounds take every name box in
 *  (routeMap.diagramBounds), then the same 1.2 zoom ceiling as fitView's.
 *  Today's structure keeps fitView as it was. Shared by the canvas (its reset
 *  and its first fit) and the workbench status bar's Fit, so the two are one
 *  fit. `pane` is the canvas element (its size centres a capped zoom). */
export function useFitAll(pane: () => HTMLElement | null): () => Promise<void> {
  const { fitView, fitBounds, getNodes, getViewport, setViewport } = useReactFlow()
  return useCallback(async (): Promise<void> => {
    const b = useUiStore.getState().nodeStructure === 'outside' ? diagramBounds(getNodes() as LoopNode[]) : null
    if (!b) {
      await fitView({ padding: 0.3, maxZoom: 1.2 })
      return
    }
    await fitBounds(b, { padding: 0.3, duration: 0 })
    const v = getViewport()
    if (v.zoom > 1.2) {
      const el = pane()
      const w = el?.clientWidth ?? 0
      const h = el?.clientHeight ?? 0
      await setViewport({ x: w / 2 - (b.x + b.width / 2) * 1.2, y: h / 2 - (b.y + b.height / 2) * 1.2, zoom: 1.2 }, { duration: 0 })
    }
  }, [fitView, fitBounds, getNodes, getViewport, setViewport, pane])
}
