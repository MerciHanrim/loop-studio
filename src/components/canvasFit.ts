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
//    here" a large import needs, not a dot;
//  - issue #344 (docs/diagram-layout.md §DL5.6) — an optional `keep` rect (the
//    core start nodes at their widest box over the 18 languages) caps the
//    zoom at the largest one that shows `keep` whole: inside the pane, and
//    clear of the minimap's corner only when `keep` would overlap it on BOTH
//    axes (a top row running past the minimap's column, above it, is not
//    under it). The floor still wins on a pane too small for `keep`.

export type FitRect = { x: number; y: number; width: number; height: number }
export type FitInsets = { left: number; right: number; bottom: number; top: number }
export type FitOptions = { floor: number; ceil: number; keep?: FitRect }
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
  const fit = Math.min(opts.ceil, Math.max(opts.floor, Math.min(usableW / (rectW * PAD), usableH / (rect.height * PAD))))
  const zoom = opts.keep ? Math.max(opts.floor, keepZoom(rect, opts.keep, pane, insets, usableH, fit)) : fit
  return place(rect, insets, usableH, zoom)
}

/** Left-aligned; vertically centred, or top-anchored when taller than the area. */
function place(rect: FitRect, insets: FitInsets, usableH: number, zoom: number): Viewport {
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

type Limits = { left: number; top: number; right: number; bottom: number }

/** The largest zoom z with a + b·z <= c. */
const upTo = (a: number, b: number, c: number) => (b > 0 ? (c - a) / b : a <= c ? Infinity : 0)

/** The largest zoom at which `keep` lies inside `lim` (screen px) under one
 *  vertical placement: `place` pins one graph point per axis to a fixed screen
 *  anchor, so each edge of `keep` moves linearly with the zoom and gives one
 *  upper bound. */
function keepBound(rect: FitRect, keep: FitRect, insets: FitInsets, usableH: number, lim: Limits, centred: boolean): number {
  const ax = insets.left + EDGE_GAP
  const ox = rect.x
  const ay = centred ? insets.top + usableH / 2 : insets.top + TOP_GAP
  const oy = centred ? rect.y + rect.height / 2 : rect.y
  return Math.min(
    upTo(ax, keep.x + keep.width - ox, lim.right),
    upTo(-ax, ox - keep.x, -lim.left),
    upTo(ay, keep.y + keep.height - oy, lim.bottom),
    upTo(-ay, oy - keep.y, -lim.top),
  )
}

/** The largest zoom <= `fit` at which `keep` is whole inside the pane and, when
 *  it would overlap the minimap's corner on both axes, clear of that corner. */
function keepZoom(rect: FitRect, keep: FitRect, pane: { width: number; height: number }, insets: FitInsets, usableH: number, fit: number): number {
  // the vertical placement switches from top-anchored to centred once the
  // rect fits the area (zoom <= usableH / rect.height)
  const switchAt = usableH / rect.height
  const within = (lim: Limits, z: number) => {
    if (z > switchAt) {
      const top = Math.min(z, keepBound(rect, keep, insets, usableH, lim, false))
      if (top > switchAt) return top
    }
    return Math.min(z, switchAt, keepBound(rect, keep, insets, usableH, lim, true))
  }
  const paneLim: Limits = { left: insets.left, top: insets.top, right: pane.width - EDGE_GAP, bottom: pane.height - EDGE_GAP }
  const z = within(paneLim, fit)
  if (insets.right <= 0 || insets.bottom <= 0) return z
  const corner = { left: pane.width - insets.right, top: pane.height - insets.bottom }
  const vp = place(rect, insets, usableH, z)
  const right = vp.x + (keep.x + keep.width) * z
  const bottom = vp.y + (keep.y + keep.height) * z
  if (right <= corner.left || bottom <= corner.top) return z
  // clear the corner by whichever side keeps the larger zoom
  return Math.max(within({ ...paneLim, right: corner.left }, z), within({ ...paneLim, bottom: corner.top }, z))
}
