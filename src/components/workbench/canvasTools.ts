import { useFrameStore } from '../../store/frameStore'
import { useUiStore } from '../../store/uiStore'

// The workbench (2026-10, step 5) — the canvas TOOLS of the tool row, one
// exclusive set: Select (none armed), Pan, Select a region, Draw a frame.
// Arming one turns the others off (docs/large-graph-readability.md §LGR12
// already made region select exclusive with the other two; the tool row makes
// the whole set one choice). Esc, pointer cancel and the edit lock keep their
// own rules where they live (Canvas, store/editPolicy) — they read the same
// store flags, so a tool armed here is cancelled the same way.

export type CanvasTool = 'select' | 'pan' | 'region' | 'frame'

export function activeTool(s: { panMode: boolean; regionSelectArmed: boolean }, frameArmed: boolean): CanvasTool {
  if (frameArmed) return 'frame'
  if (s.regionSelectArmed) return 'region'
  if (s.panMode) return 'pan'
  return 'select'
}

/** choose a tool; choosing the active one again goes back to Select */
export function chooseTool(tool: CanvasTool): void {
  const ui = useUiStore.getState()
  const frame = useFrameStore.getState()
  const current = activeTool(ui, frame.toolArmed)
  const next = current === tool && tool !== 'select' ? 'select' : tool
  if (next !== 'frame' && frame.toolArmed) frame.disarmTool()
  if (next !== 'region' && ui.regionSelectArmed) ui.setRegionSelectArmed(false)
  if (next !== 'pan' && ui.panMode) ui.setPanMode(false)
  if (next === 'pan') ui.setPanMode(true)
  if (next === 'region') ui.setRegionSelectArmed(true)
  if (next === 'frame' && !ui.canvasLocked) frame.armTool()
}
