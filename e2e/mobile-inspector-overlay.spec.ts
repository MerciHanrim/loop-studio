import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #411 — the phone's Inspector sheet and the other overlays, under the
// `mobile` project. The rule (Lumi, 2026-10-30): the screen the user opened
// comes first. With a node selected, Timeline and the Monte Carlo dialog open
// and STAY open; the Inspector sheet claims the exclusive slot only while the
// slot is empty and the dialog is closed, so it never pushes them out — not
// even in the moment the chrome closes the sheet to bring the dialog up. When
// Timeline or the dialog closes and the selection still stands, the sheet
// comes back. Close on the sheet itself still clears the selection. Until
// v0.31.0 the sheet's effect re-ran on every overlay change and took the
// slot back: Timeline never stayed open over a selection, and the dialog was
// dismissed before it could be used.

const runBar = (page: Page) => page.locator('.pstrip--mobile')
const inspector = (page: Page) => page.locator('.sheet--inspector')
const timeline = (page: Page) => page.locator('.timeline--sheet')
const mcDialog = (page: Page) => page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
const overlay = (page: Page) => page.evaluate(() => (window as unknown as { __loop: { ui: { getState: () => { overlay: string } } } }).__loop.ui.getState().overlay)
const mcOpen = (page: Page) => page.evaluate(() => (window as unknown as { __loop: { mc: { getState: () => { dialogOpen: boolean } } } }).__loop.mc.getState().dialogOpen)
const selected = (page: Page) => page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { selectedNodeId: string | null } } } }).__loop.graph.getState().selectedNodeId)

/** a tap at a node's screen centre, through the mobile pan-capture overlay */
async function tapNode(page: Page, node: Locator): Promise<void> {
  const b = (await node.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}

async function loadWithSelection(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  const node = page.locator('.react-flow__node[data-id="ore_stock"]')
  await expect(node).toBeVisible()
  await tapNode(page, node)
  await expect.poll(() => selected(page)).toBe('ore_stock')
  await expect(inspector(page)).toBeVisible()
  expect(await overlay(page)).toBe('inspector')
}

/** what is on screen */
const onScreen = async (page: Page) => ({
  overlay: await overlay(page),
  inspector: await inspector(page).isVisible(),
  timeline: await timeline(page).isVisible(),
  mcDialog: await mcDialog(page).isVisible(),
  mcOpen: await mcOpen(page),
  selected: await selected(page),
})

/** #424 — a deliberate time wait, only for the reads that claim a screen
 *  STAYS open over a selection: the defect was the Inspector's effect taking
 *  the slot back after the change, and nothing marks the moment it would
 *  have; 300 ms is the window in which it must not */
async function settle(page: Page) {
  await page.waitForTimeout(300)
  return onScreen(page)
}

/** #424 — a state the screens move TO is waited for, not timed */
const reach = (page: Page, want: Record<string, unknown>) => expect.poll(() => onScreen(page)).toMatchObject(want)

test.describe('phone: the Inspector sheet yields to the screen the user opened (#411)', () => {
  test('Timeline over a selection stays open; closing it brings the Inspector back with the selection kept', async ({ page }) => {
    await loadWithSelection(page)
    const tl = runBar(page).getByRole('button', { name: /^Timeline/ })
    await tl.click()
    expect(await settle(page)).toMatchObject({ overlay: 'timeline', inspector: false, timeline: true, selected: 'ore_stock' })

    // Timeline closed again (the same button toggles it): the selection still
    // stands, so the Inspector comes back
    await tl.click()
    await reach(page, { overlay: 'inspector', inspector: true, timeline: false, selected: 'ore_stock' })

    // Close on the sheet clears the selection, as before
    await inspector(page).locator('.sheet__x').click()
    await expect.poll(() => selected(page)).toBeNull()
    await reach(page, { overlay: 'none', inspector: false })
    await tl.click()
    await reach(page, { overlay: 'timeline', timeline: true, selected: null })
  })

  test('the Monte Carlo dialog over a selection stays open, through the moment the sheet is closed for it; closing it brings the Inspector back', async ({ page }) => {
    await loadWithSelection(page)
    await runBar(page).getByRole('button', { name: 'Monte Carlo' }).click()
    await expect(mcDialog(page)).toBeVisible()
    expect(await settle(page)).toMatchObject({ overlay: 'none', inspector: false, mcDialog: true, mcOpen: true, selected: 'ore_stock' })

    // the dialog's own Close: the selection still stands, so the Inspector comes back
    await page.locator('.mcdlg__x').click()
    await reach(page, { overlay: 'inspector', inspector: true, mcDialog: false, mcOpen: false, selected: 'ore_stock' })

    // and with no selection the dialog behaves as before
    await inspector(page).locator('.sheet__x').click()
    await expect.poll(() => selected(page)).toBeNull()
    await runBar(page).getByRole('button', { name: 'Monte Carlo' }).click()
    await reach(page, { overlay: 'none', inspector: false, mcDialog: true, mcOpen: true, selected: null })
  })

  // The top bar's More button sits behind the open Inspector sheet's scrim
  // (`data-covered-by-sheets`), so the More sheet cannot be opened over a
  // selection from the Inspector; only the run bar's Timeline and Monte Carlo
  // reach past the scrim, and those are the two cases above.
})
