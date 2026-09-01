import { useUiStore } from '../store/uiStore'
import { useIsMobile } from '../ui/media'
import { Inspector } from './Inspector'

// The desktop Inspector column. When the Canvas is edit-locked
// (uiStore.canvasLocked) it renders inside a `<fieldset disabled>` — the same
// mechanism the mobile read-only sheet uses (docs/mobile.md §MV3a): every input,
// select, textarea and button inside goes inert, values stay visible, and no
// field can mutate the graph. Selection still opens it. Unlocked ⇒ exactly the
// Inspector as before. Never rendered on mobile (the mobile read-only sheet
// handles that layout); mobile also CSS-hides `.app__body > .inspector`.
export function DesktopInspector() {
  const isMobile = useIsMobile()
  const locked = useUiStore((s) => s.canvasLocked)

  if (isMobile || !locked) return <Inspector />

  // `display: contents` (CSS) makes the <fieldset> box vanish from layout, so
  // the inner <aside class="inspector"> is the flex column exactly as usual —
  // `disabled` still cascades to every control inside it.
  return (
    <fieldset className="inspector-ro--desktop" disabled>
      <Inspector />
    </fieldset>
  )
}
