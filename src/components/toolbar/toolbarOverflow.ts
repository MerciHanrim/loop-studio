// docs/toolbar-responsive.md — the toolbar's fixed two-tier contract — a pure,
// measured fit calculator. Tier 1 (brand + app commands) is always one row;
// Tier 2 (the node palette) is always its own row, never measured here. Given
// the measured widths of Tier 1's regions, decide how many trailing GROUPS
// move into the "More" (⋯) overflow menu. NOTHING here reads the DOM or the
// locale — the same widths always give the same layout, so EN / KO / JA
// differ only through their measurements, never a branch on the language.

/** Collapse order for Tier 1's grouped controls. Index 0 collapses first.
 *  Each entry is a whole GROUP (never an individual button torn out of one).
 *  The workbench (2026-10, step 5): Tier 1 is the MENU BAR — File, Edit,
 *  View, Insert, Data, Run, Help, then Share — in that render order
 *  (`Toolbar.tsx`), independent of this collapse order: Help, Run, Insert,
 *  View, Edit, Data, File, Share. (Settings became View and File's Storage
 *  row; the Templates button became File's Templates section.) */
export const OVERFLOW_ORDER = ['help', 'run', 'insert', 'view', 'edit', 'data', 'file', 'share'] as const
export type OverflowItem = (typeof OVERFLOW_ORDER)[number]

export type ToolbarMetrics = {
  /** toolbar content-box width (clientWidth minus horizontal padding) */
  inner: number
  /** flex `gap` between the brand / actions regions */
  topGap: number
  /** flex `gap` between individual action controls */
  actionGap: number
  /** brand region width */
  brandBase: number
  /** the never-collapsed action core: the session and revision chips (when
   *  shown), including the gaps between them; 0 when neither is shown */
  core: number
  /** the ⋯ overflow trigger width (no surrounding gap) */
  more: number
  /** width of each collapsible GROUP, in `OVERFLOW_ORDER`, gaps excluded */
  items: number[]
}

export type ToolbarLayout = {
  /** number of leading `OVERFLOW_ORDER` groups in the ⋯ menu (0 = none) */
  collapsed: number
}

const SAFETY = 6 // px of headroom required before a heavier collapse is chosen — hysteresis against 1px measurement jitter at a boundary

/** Width Tier 1's actions region occupies with `collapsed` leading groups
 *  removed. */
function actionsWidth(m: ToolbarMetrics, collapsed: number): number {
  let w = m.core
  let slots = m.core > 0 ? 1 : 0 // the chips' core, when shown — for inter-control gap accounting
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

export function computeToolbarLayout(m: ToolbarMetrics): ToolbarLayout {
  for (let collapsed = 0; collapsed <= m.items.length; collapsed++) {
    const total = m.brandBase + m.topGap + actionsWidth(m, collapsed)
    if (total <= m.inner - SAFETY) return { collapsed }
  }
  // Nothing fits even collapsed to the bone — the smallest possible.
  return { collapsed: m.items.length }
}

/** Which groups are in the ⋯ menu for a given collapse count — NOT display
 *  order; callers filter their own canonical render order down to this
 *  membership set. */
export function overflowedItems(collapsed: number): OverflowItem[] {
  return OVERFLOW_ORDER.slice(0, collapsed)
}

/** Whether a given group is shown inline (not in the ⋯ menu). */
export function isInline(item: OverflowItem, collapsed: number): boolean {
  return OVERFLOW_ORDER.indexOf(item) >= collapsed
}
