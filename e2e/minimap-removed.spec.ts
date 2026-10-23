import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'
import { openViewMenu, pickTemplate } from './support/workbenchMenus'

// The graph minimap was removed (v0.30.0). A browser that ran an earlier
// version may still hold its choice under `loop-studio:minimap-collapsed`
// (now a retired key, `RETIRED_STORAGE_KEYS`): the app starts and reads a
// document as usual, draws no minimap and no restore button, and leaves the
// stored value alone (no migration; "Reset all Loop Studio data" removes it).

for (const stored of ['0', '1'] as const) {
  test(`an old stored minimap choice ('${stored}') changes nothing: the app starts, a document and a Template open, no minimap is drawn`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.addInitScript((v) => {
      try {
        localStorage.setItem('loop-studio:minimap-collapsed', v)
      } catch {
        /* opaque origin */
      }
    }, stored)
    await openApp(page)
    await resetAll(page)

    // a document reads as usual
    await importGraph(page, readRiskyFactory())
    await expect(page.locator('.react-flow__node')).toHaveCount(18)
    // and a Template opens
    await pickTemplate(page, 'equilibrium')
    const confirm = page.locator('.mcdlg--confirm .btn--primary')
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()

    // no minimap, no restore button, no View row for it
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    await expect(page.locator('.minimap-toggle')).toHaveCount(0)
    await openViewMenu(page)
    await expect(page.locator('.wb-viewmenu__pop [data-view-row]')).toHaveCount(4) // Focus, Filters, Activity overlay, Reset view
    await expect(page.locator('.wb-viewmenu__pop [data-view-row="minimap"]')).toHaveCount(0)

    // the stored value is left as it was
    expect(await page.evaluate(() => localStorage.getItem('loop-studio:minimap-collapsed'))).toBe(stored)
    expect(errors).toEqual([])
  })
}
