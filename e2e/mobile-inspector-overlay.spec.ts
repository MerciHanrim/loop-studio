import type { Locator, Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #411 — reproduction on current main, under the `mobile` project. The
// phone's Inspector sheet opens from an effect that lists the exclusive
// `overlay` among its dependencies and calls `openOverlay('inspector')`
// whenever something is selected. With a node selected, does opening Timeline
// or the Monte Carlo dialog hold, or does the Inspector sheet take the slot
// back? Compared with the same openers after the selection is cleared.

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

/** what is on screen a moment after an opener, once the effects have settled */
async function settle(page: Page) {
  await page.waitForTimeout(300)
  return {
    overlay: await overlay(page),
    inspector: await inspector(page).isVisible(),
    timeline: await timeline(page).isVisible(),
    mcDialog: await mcDialog(page).isVisible(),
    mcOpen: await mcOpen(page),
    selected: await selected(page),
  }
}

test.describe('phone: the Inspector sheet and the other overlays with a node selected (#411)', () => {
  test('Timeline with a node selected: what shows after the tap, compared with no selection', async ({ page }) => {
    await loadWithSelection(page)
    await runBar(page).getByRole('button', { name: /^Timeline/ }).click()
    const withSelection = await settle(page)

    // current main: the Inspector effect re-runs on the overlay change and
    // takes the slot back; Timeline never stays open while a node is selected
    expect(withSelection).toMatchObject({ overlay: 'inspector', inspector: true, timeline: false, selected: 'ore_stock' })

    // the same tap with the selection cleared (Close on the sheet)
    await inspector(page).locator('.sheet__x').click()
    await expect.poll(() => selected(page)).toBeNull()
    await expect(inspector(page)).toBeHidden()
    await runBar(page).getByRole('button', { name: /^Timeline/ }).click()
    const without = await settle(page)
    expect(without).toMatchObject({ overlay: 'timeline', inspector: false, timeline: true, selected: null })
  })

  test('Monte Carlo with a node selected: what shows after the tap, compared with no selection', async ({ page }) => {
    await loadWithSelection(page)
    await runBar(page).getByRole('button', { name: 'Monte Carlo' }).click()
    const withSelection = await settle(page)

    // current main: the dialog's opening closes the sheet (overlay → none),
    // the Inspector effect re-opens its overlay, and opening an overlay
    // dismisses the Monte Carlo dialog — the dialog cannot be reached
    expect(withSelection).toMatchObject({ overlay: 'inspector', inspector: true, mcDialog: false, mcOpen: false, selected: 'ore_stock' })

    await inspector(page).locator('.sheet__x').click()
    await expect.poll(() => selected(page)).toBeNull()
    await runBar(page).getByRole('button', { name: 'Monte Carlo' }).click()
    const without = await settle(page)
    expect(without).toMatchObject({ overlay: 'none', inspector: false, mcDialog: true, mcOpen: true, selected: null })
  })
})
