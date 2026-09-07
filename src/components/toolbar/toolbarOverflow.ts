// docs/localization.md §L12 #5 / the toolbar locale-independent responsive
// contract — a pure, measured fit calculator. Given the measured widths of the
// toolbar regions, decide how many trailing action controls move into the
// "More" (⋯) overflow menu, whether the build stamp is hidden, and whether the
// palette drops to its own row. NOTHING here reads the DOM or the locale — the
// same widths always give the same layout, so EN / KO / JA differ only through
// their measurements, never a branch on the language name.

/** Collapse order for the trailing action controls. Index 0 collapses first.
 *  Help / Export / Share / Import are the plain "utility" tail — the priority
 *  overflow candidates. Theme / Language / New / Module are the "keep exposed"
 *  tier: in ONE-ROW mode they are never shed (the toolbar goes to two rows
 *  first); only the narrow TWO-ROW layouts may shed them, and only to stop the
 *  actions line itself wrapping into a surprise third row. */
export const OVERFLOW_ORDER = [
  'help',
  'export',
  'share',
  'import',
  'theme',
  'language',
  'new',
  'module',
] as const
export type OverflowItem = (typeof OVERFLOW_ORDER)[number]

/** The utility tail — the first N items — plus the build stamp are the only
 *  things one-row mode will move out of the way (priority steps 1–5). Step 6 is
 *  "go to two rows", not "hide Theme". */
export const STAMP_AFTER = 4

export type ToolbarMetrics = {
  /** toolbar content-box width (clientWidth minus horizontal padding) */
  inner: number
  /** flex `gap` between the brand / palette / actions regions */
  topGap: number
  /** flex `gap` between individual action controls */
  actionGap: number
  /** brand region width WITHOUT the build stamp */
  brandBase: number
  /** build-stamp width + the one in-brand gap it occupies */
  stampSlot: number
  /** palette region width (all 8 chips on one line) */
  palette: number
  /** the never-collapsed action core: undo + redo + Templates (+ RevisionChip
   *  when a project is open), including the gaps between them */
  core: number
  /** the ⋯ overflow trigger width (no surrounding gap) */
  more: number
  /** width of each collapsible control, in `OVERFLOW_ORDER`, gaps excluded */
  items: number[]
}

export type ToolbarLayout = {
  /** `row` — brand + palette + actions share one line. `wrap` — the palette
   *  drops to its own second line; brand + actions stay on line 1. */
  mode: 'row' | 'wrap'
  /** number of leading `OVERFLOW_ORDER` items in the ⋯ menu (0 = none) */
  collapsed: number
  /** the `v… · <sha>` build stamp is hidden from the brand row */
  hideStamp: boolean
}

const SAFETY = 6 // px of headroom required before a lighter layout is chosen — hysteresis against 1px measurement jitter at a boundary

/** Fixed one-row / two-row breakpoint, in toolbar content-box px. Below it the
 *  palette always drops to its own line; above it the ⋯ menu always keeps the
 *  toolbar to a single line. The row COUNT is therefore decided purely by the
 *  viewport, never by which language is active — the widest shipped locale (JA)
 *  can just reach a clean single row at this width. Above it, every locale
 *  fits; below it, no locale forces a surprise third row. */
export const ONE_ROW_MIN = 1560

/** Width the actions region occupies with `collapsed` leading items removed. */
function actionsWidth(m: ToolbarMetrics, collapsed: number): number {
  let w = m.core
  let slots = 3 // undo, redo, Templates — for inter-control gap accounting
  for (let i = collapsed; i < m.items.length; i++) {
    w += m.items[i]
    slots++
  }
  if (collapsed > 0) {
    w += m.more
    slots++
  }
  return w + m.actionGap * Math.max(0, slots - 1)
}

/** The escalation ladder: progressively heavier layouts. Each entry is
 *  `[collapsed, hideStamp]`. Stamp is shed between item 4 and item 5. */
function ladder(itemCount: number): Array<[number, boolean]> {
  const steps: Array<[number, boolean]> = []
  for (let c = 0; c <= STAMP_AFTER; c++) steps.push([c, false])
  for (let c = STAMP_AFTER; c <= itemCount; c++) steps.push([c, true])
  return steps
}

export function computeToolbarLayout(m: ToolbarMetrics): ToolbarLayout {
  const fullLadder = ladder(m.items.length)
  // one-row mode only shifts the utility tail + the stamp (priority steps 1–5)
  const rowLadder = fullLadder.filter(([collapsed]) => collapsed <= STAMP_AFTER)
  const brand = (hideStamp: boolean) => m.brandBase + (hideStamp ? 0 : m.stampSlot)

  // At / above the fixed breakpoint the toolbar is ALWAYS one row — the mode is
  // decided by the viewport alone, never by which language is active. The ⋯
  // menu collapses as much of the utility tail as the active locale needs to
  // hold that single line: more for JA than EN at the same width, but the row
  // COUNT is identical. `ONE_ROW_MIN` is calibrated to the width at which the
  // widest shipped locale still fits with only the utility tail + stamp shed,
  // so the final `return` below is a safety net that does not fire in practice.
  if (m.inner >= ONE_ROW_MIN) {
    for (const [collapsed, hideStamp] of rowLadder) {
      const total =
        brand(hideStamp) + m.topGap + m.palette + m.topGap + actionsWidth(m, collapsed)
      if (total <= m.inner - SAFETY) return { mode: 'row', collapsed, hideStamp }
    }
    return { mode: 'row', collapsed: STAMP_AFTER, hideStamp: true }
  }

  // Two rows: the palette takes its own line; fit brand + actions on line 1.
  // Here the "keep exposed" tier MAY be shed too, but only to stop the actions
  // line wrapping into a third row.
  for (const [collapsed, hideStamp] of fullLadder) {
    const line1 = brand(hideStamp) + m.topGap + actionsWidth(m, collapsed)
    if (line1 <= m.inner - SAFETY) return { mode: 'wrap', collapsed, hideStamp }
  }

  // Nothing fits even collapsed to the bone — the smallest possible.
  return { mode: 'wrap', collapsed: m.items.length, hideStamp: true }
}

/** Which controls are in the ⋯ menu for a given layout, in display order. */
export function overflowedItems(collapsed: number): OverflowItem[] {
  return OVERFLOW_ORDER.slice(0, collapsed)
}

/** Whether a given control is shown inline (not in the ⋯ menu). */
export function isInline(item: OverflowItem, collapsed: number): boolean {
  return OVERFLOW_ORDER.indexOf(item) >= collapsed
}
