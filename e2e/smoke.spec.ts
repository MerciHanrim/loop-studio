import { expect, openApp, resetAll, test } from './support/loop'
import { openMonteCarloDialog } from './support/workbenchMenus'

test.describe('smoke', () => {
  test('the app loads with no console errors and the store bridge is live', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    // core chrome is present
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(page.locator('.canvas .react-flow')).toBeVisible()
    await expect(page.locator('.pstrip')).toBeVisible()
    // Monte Carlo is reachable: opened the way a user opens it — the run row's
    // button, or, where the row folds it (1280, docs/workbench.md §WB7),
    // Run ▸ Monte Carlo… — its dialog comes up; Escape closes it
    await openMonteCarloDialog(page)
    await expect(page.locator('.mcdlg[role="dialog"] #mcdlg-title')).toHaveText('Monte Carlo')
    await page.keyboard.press('Escape')
    await expect(page.locator('.mcdlg[role="dialog"]')).toHaveCount(0)
    // New / Import are File ▾'s own rows now (docs/toolbar-responsive.md),
    // rendered as menuitem buttons, not plain "button"-role controls
    await page.locator('.toolbar__actions .menu > button', { hasText: /^File$/ }).click()
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
