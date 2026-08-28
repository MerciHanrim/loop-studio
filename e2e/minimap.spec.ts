import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// The existing visual specs frame `.timeline` and don't touch the canvas, so the
// minimap legibility fix (per-kind node hues, viewport outline, mask, frame
// tokens) has no pixel guard. These two shots + two semantic checks pin it.

async function minimapReady(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node')).toHaveCount(18)
  // the MiniMap renders a <rect> per node only once React Flow has measured it
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(18, { timeout: 10_000 })
  await page.evaluate(() => document.fonts.ready)
}

/** rgb() string that `var(--signal-primary)` resolves to in the current theme */
const signalPrimaryRgb = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--signal-primary)'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  })

test.describe('minimap — legibility', () => {
  test('semantic: multiple node hues + viewport outline is the signal colour', async ({ page }) => {
    await minimapReady(page)

    // node fills are per-kind, not one flat colour (risky-factory has 6 kinds)
    const fills = await page.$$eval('.react-flow__minimap-node', (els) =>
      els.map((el) => getComputedStyle(el as SVGElement).fill),
    )
    expect(fills).toHaveLength(18)
    expect(new Set(fills).size).toBeGreaterThanOrEqual(4)

    // the mask (everything outside the viewport) is stroked with --signal-primary
    const maskStroke = await page.$eval(
      '.react-flow__minimap-mask',
      (el) => getComputedStyle(el as SVGElement).stroke,
    )
    expect(maskStroke).toBe(await signalPrimaryRgb(page))
  })

  test('light', async ({ page }) => {
    await minimapReady(page)
    await expect(page.locator('.react-flow__minimap')).toHaveScreenshot('minimap-light.png')
  })

  test('dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await minimapReady(page)
    await expect(page.locator('.react-flow__minimap')).toHaveScreenshot('minimap-dark.png')
  })
})
