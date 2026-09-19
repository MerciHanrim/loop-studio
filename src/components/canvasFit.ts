// docs/mmo-multilingual-layout.md §MML3 / docs/data-import.md §DI17 — ONE
// pure "fit this graph-space rect into the usable pane" computation, shared
// by the Canvas's Template initial view (`applyInitialView`) and the import
// wizard's post-commit view. Extracted verbatim from `Canvas.tsx` so the
// Template fit stays byte-identical; the wizard only feeds it a different
// floor / ceiling and a top inset for the canvas hint slot.
//
// Rules, in order:
//  - the usable area is the pane minus fixed overlays (left: the zoom
//    Controls; right + bottom: the minimap when it is on screen; top: the
//    `top-center` hint slot when the caller reserves it);
//  - the zoom is the largest that fits the rect (with a 6 % pad) in that
//    area, clamped to [floor, ceil];
//  - on a small pane, fewer of the rect's COLUMNS are framed rather than
//    letting its right edge fall under the minimap at the floor zoom;
//  - the rect is left-aligned (a progression reads beginning-first) and
//    vertically centred, or top-anchored when it is taller than the area —
//    so a rect too large for the floor zoom is never shrunk further: the
//    view shows its top-left corner at the floor, which is the "start
//    here" a large import needs, not a dot.

export type FitRect = { x: number; y: number; width: number; height: number }
export type FitInsets = { left: number; right: number; bottom: number; top: number }
export type FitOptions = { floor: number; ceil: number }
export type Viewport = { x: number; y: number; zoom: number }

/** The Canvas's fixed overlays: the zoom Controls on the left (~44 px) and,
 *  when it is on screen, the minimap's column (224 px incl. margin) and row
 *  (176 px) bands. `top` is 0 here; the import wizard adds the hint slot. */
export function canvasFitInsets(minimapVisible: boolean, top = 0): FitInsets {
  return { left: 44, right: minimapVisible ? 224 : 0, bottom: minimapVisible ? 176 : 0, top }
}

const PAD = 1.06
const EDGE_GAP = 8
const TOP_GAP = 12

export function viewportForRect(
  rect: FitRect,
  pane: { width: number; height: number },
  insets: FitInsets,
  opts: FitOptions,
): Viewport | null {
  if (pane.width <= 0 || pane.height <= 0) return null
  const usableW = Math.max(160, pane.width - insets.left - insets.right)
  const usableH = Math.max(120, pane.height - insets.top - insets.bottom)
  const rectW = Math.min(rect.width, (usableW - EDGE_GAP) / opts.floor)
  const zoom = Math.min(opts.ceil, Math.max(opts.floor, Math.min(usableW / (rectW * PAD), usableH / (rect.height * PAD))))
  const contentH = rect.height * zoom
  return {
    x: insets.left + EDGE_GAP - rect.x * zoom,
    y:
      contentH <= usableH
        ? insets.top + usableH / 2 - (rect.y + rect.height / 2) * zoom
        : insets.top + TOP_GAP - rect.y * zoom,
    zoom,
  }
}
