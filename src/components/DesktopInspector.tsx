import { useT } from '../i18n'
import { selectSelectedNodeCount, useGraphStore } from '../store/graphStore'
import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { Inspector } from './Inspector'
import { onOverlayKey, PANEL_ID, useWorkbenchPanels } from './workbench/panelLayout'

// The desktop right column: the selection's properties (the Inspector), in one
// scrolling `.rightcol`. The workbench (2026-10, step 5) moved the Inputs /
// Summary panels (docs/module-system.md §MS5) to the left panel's Inputs tab
// (workbench/LeftPanel.tsx), so this column answers one question.
//
// When the Canvas is edit-locked (uiStore.canvasLocked) the Inspector renders
// its editing parts inside a `<fieldset disabled>` — every input / select /
// textarea / button there goes inert, values stay visible, no field can mutate
// the graph (docs/mobile.md §MV3a). The Relations layer is outside it: its rows
// only select (2026-10-22). The panels are NOT wrapped: read-through select and the Summary's
// show-calculation toggle are not mutations and stay usable under the lock; only
// the Parameter value input is disabled (it reads `canvasLocked` itself).
//
// Never rendered as `.rightcol` on mobile — the mobile read-only sheet handles
// that layout, and `.app__body > .inspector` (the bare fallback below) is
// CSS-hidden there.
export function DesktopInspector() {
  const isMobile = useIsMobile()
  const locked = useUiStore((s) => s.canvasLocked)
  const t = useT()
  const selectedNodeCount = useGraphStore(selectSelectedNodeCount)

  // the workbench's width bands (./workbench/panelLayout): folded, hidden and
  // still mounted; at the narrow band an overlay over the canvas
  const { rightOpen, overlay, close } = useWorkbenchPanels()

  if (isMobile) return <Inspector />

  return (
    <div
      id={PANEL_ID.right}
      className={`rightcol${overlay ? ' is-overlay' : ''}`}
      role={overlay ? 'region' : undefined}
      aria-label={overlay ? t('workbench.panel.right') : undefined}
      hidden={!rightOpen}
      onKeyDown={overlay ? (e) => onOverlayKey(e, 'right', close) : undefined}
    >
      {/* docs/large-graph-readability.md §LGR12.3 — how many nodes are selected,
          shown whenever there is a selection and regardless of the edit-lock
          (it must survive the unlock — that is the moment the user acts on it).
          Under the lock it also says why dragging does nothing. Sits here, below
          the panels and directly above the Inspector that shows only the
          selection's anchor (§LGR12.4), and NOT on the canvas: a bottom-centre
          canvas panel covered the top of the bottom node row at L0 (measured),
          and the top-centre lane is taken by the hint notes. Pointer events stay
          on so the occlusion e2e can see it with elementFromPoint. */}
      {selectedNodeCount > 0 && (
        <p className="lgr-selection-count" role="status" aria-live="polite">
          {locked
            ? t('canvas.regionSelect.countLocked', { n: selectedNodeCount })
            : t('canvas.regionSelect.count', { n: selectedNodeCount })}
        </p>
      )}
      {/* under the lock the Inspector wraps its editing parts in
          `<fieldset disabled>` itself, leaving the Relations layer usable */}
      <Inspector editLocked={locked} />
    </div>
  )
}
