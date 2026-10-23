import { expect, type Page } from '@playwright/test'

// The workbench's right panel (docs/workbench.md §WB6): relation, then Edit,
// then More settings — folded on desktop, and once opened kept open across
// selections until the page reloads. A spec that reads a field kept there
// (a connection's kind, route, ends, resource type; a node's flow mode,
// activation, colour) opens it the way a user does: a click on its summary.
// Idempotent; on the phone the settings are never folded, and this is a no-op.
export async function openPanelDetails(page: Page): Promise<void> {
  const more = page.locator('.inspector details.wb-panel__more')
  if ((await more.count()) === 0) return
  if (await more.evaluate((el) => (el as HTMLDetailsElement).open)) return
  await more.locator('summary').click()
  await expect.poll(() => more.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)
}

/** the state a user leaves after opening More settings once: open, across
 *  every later selection until the page reloads (uiStore `panelDetailsOpen`).
 *  For specs about a field kept there (a colour, a label's timing), not about
 *  the fold itself — that is `openPanelDetails`, a real click. */
export async function keepPanelDetailsOpen(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __loop: { ui: { getState: () => { setPanelDetailsOpen: (v: boolean) => void } } } }).__loop.ui.getState().setPanelDetailsOpen(true))
}

/** for the specs whose fixtures were placed for the two-tier bar's canvas:
 *  at 1280 × 800 that canvas was 980 px wide (the 300 px right column); in
 *  the workbench (left list 272, right column 344) a 1600-wide window gives
 *  984 px. 940 tall leaves the canvas 688 px under the menu bar (32), tool
 *  row (42), the open analysis area (152) and the status bar (26) */
export const WORKBENCH_ROOMY_VIEWPORT = { width: 1600, height: 940 } as const
