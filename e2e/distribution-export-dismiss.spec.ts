import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, runMc, test } from './support/loop'

// issue #422 item 1 (Lumi, 2026-11-01) — the Distribution view's Export menu
// closes through the shared `useOutsideDismiss` hook, like every toolbar menu.
// It had its own bubble-phase `window` `mousedown` listener, the mechanism
// that hook was written to replace: React Flow stops a node's mousedown before
// it reaches `window`, so a click on a canvas NODE left the menu open. One
// click outside — a node or the empty pane — closes it; a press inside keeps it.

const trigger = (page: Page) => page.locator('.dist .timeline__csv[aria-haspopup="true"]')
const pop = (page: Page) => page.locator('.dist .menu__pop[role="menu"]')
const selected = (page: Page) => page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { selectedNodeId: string | null } } } }).__loop.graph.getState().selectedNodeId)

async function openExport(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await runMc(page, { runs: 20, steps: 10 })
  await expect(trigger(page)).toBeEnabled()
  await trigger(page).click()
  await expect(pop(page)).toBeVisible()
}

test.describe('the Distribution view’s Export menu and an outside click (#422)', () => {
  test('one click on a canvas node closes it, and the click still selects the node', async ({ page }) => {
    await openExport(page)
    await page.locator('.react-flow__node[data-id="ore_stock"]').click()
    await expect(pop(page)).toBeHidden()
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
    expect(await selected(page)).toBe('ore_stock')
  })

  test('one click on the empty canvas pane closes it', async ({ page }) => {
    await openExport(page)
    const pane = (await page.locator('.react-flow__pane').boundingBox())!
    await page.locator('.react-flow__pane').click({ position: { x: pane.width - 20, y: 20 } })
    await expect(pop(page)).toBeHidden()
  })

  test('a click inside the menu, off its items, keeps it open', async ({ page }) => {
    await openExport(page)
    const b = (await pop(page).boundingBox())!
    // the popup's own 4 px padding: inside the menu, on no item
    const at = { x: b.x + 2, y: b.y + 2 }
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('.dist .menu__pop[role="menu"]'), at)).toBe(true)
    await page.mouse.click(at.x, at.y)
    await expect(pop(page)).toBeVisible()
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')
  })
})
