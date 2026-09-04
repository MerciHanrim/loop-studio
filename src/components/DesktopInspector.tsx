import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { Inspector } from './Inspector'
import { ModelPanels } from './ModelPanels'

// The desktop right column: the Inputs / Summary panels (docs/module-system.md
// §MS5) stacked above the Inspector, both in one scrolling `.rightcol`.
//
// When the Canvas is edit-locked (uiStore.canvasLocked) the Inspector renders
// inside a `<fieldset disabled>` — every input / select / textarea / button goes
// inert, values stay visible, no field can mutate the graph (docs/mobile.md
// §MV3a). The panels are NOT wrapped: read-through select and the Summary's
// show-calculation toggle are not mutations and stay usable under the lock; only
// the Parameter value input is disabled (it reads `canvasLocked` itself).
//
// Never rendered as `.rightcol` on mobile — the mobile read-only sheet handles
// that layout, and `.app__body > .inspector` (the bare fallback below) is
// CSS-hidden there.
export function DesktopInspector() {
  const isMobile = useIsMobile()
  const locked = useUiStore((s) => s.canvasLocked)

  if (isMobile) return <Inspector />

  return (
    <div className="rightcol">
      <ModelPanels />
      {locked ? (
        // `display: contents` (CSS) drops the <fieldset> box so `.inspector`
        // stays the flex child; `disabled` still cascades to every control.
        <fieldset className="inspector-ro--desktop" disabled>
          <Inspector />
        </fieldset>
      ) : (
        <Inspector />
      )}
    </div>
  )
}
