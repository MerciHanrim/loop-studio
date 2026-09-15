import { expect, openApp, resetAll, test } from './support/loop'

test.describe('smoke', () => {
  test('the app loads with no console errors and the store bridge is live', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    // core chrome is present
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(page.locator('.canvas .react-flow')).toBeVisible()
    await expect(page.locator('.pstrip')).toBeVisible()
    await expect(page.locator('.pstrip__mc button', { hasText: 'Monte Carlo' })).toBeVisible()
    // New / Import are File ▾'s own rows now (docs/toolbar-responsive.md),
    // rendered as menuitem buttons, not plain "button"-role controls
    await page.locator('.toolbar__actions .menu > button', { hasText: /^File ▾$/ }).click()
    await expect(page.getByRole('menuitem', { name: 'New' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Import' })).toBeVisible()
    await page.keyboard.press('Escape')

    // the store bridge round-trips
    const before = await page.evaluate(
      () =>
        (window as unknown as { __loop: Record<string, { getState: () => { nodes: unknown[] } }> })
          .__loop.graph.getState().nodes.length,
    )
    expect(before).toBe(0) // resetAll cleared it

    await page.evaluate(() =>
      (window as unknown as { __loop: Record<string, { getState: () => Record<string, (...a: unknown[]) => void> }> })
        .__loop.graph.getState()
        .addNodeAt('pool', { x: 200, y: 160 }),
    )
    await expect(page.locator('.react-flow__node')).toHaveCount(1)
  })
})
