import {
  expect,
  FIXTURE_POOLS_4,
  importGraph,
  openApp,
  readFixture,
  resetAll,
  runMc,
  test,
} from './support/loop'

// Item 8 — the ONLY pixel snapshots in the suite: the Distribution panel in
// light and dark. Everything is pinned (fixture graph, baseSeed 1, 200 × 30,
// the 4 tracked Pools, Dice Pool selected) so the band geometry is identical
// run to run; OS font AA is absorbed by the config's maxDiffPixelRatio.

async function distributionReady(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readFixture())
  await runMc(page, { baseSeed: 1, runs: 200, steps: 30, tracked: FIXTURE_POOLS_4 })

  await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
  await page.locator('.band__pool').selectOption({ label: 'Dice Pool' })

  const svg = page.locator('.band__svg')
  await expect(svg).toBeVisible()
  await page.waitForFunction(() => {
    const el = document.querySelector('.band__svg') as SVGSVGElement | null
    return !!el && el.getBoundingClientRect().width > 400
  })
  await page.evaluate(() => document.fonts.ready)
}

// Framed on `.timeline` (playback strip + timeline panel) — it holds the whole
// distribution panel and band chart. Only these two shots are pixel-locked;
// the Export menu's open state is covered functionally in export.spec.ts (it
// opens upward and doesn't fit the strip cleanly for a stable snapshot).
test.describe('Distribution — visual', () => {
  test('light — Pool selector shown, mean off', async ({ page }) => {
    await distributionReady(page)
    await expect(page.locator('.band__mean')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.timeline')).toHaveScreenshot('distribution-light.png')
  })

  test('dark — mean on', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await distributionReady(page)

    await page.locator('.band__mean').click()
    await expect(page.locator('.band__mean')).toHaveAttribute('aria-pressed', 'true')

    await expect(page.locator('.timeline')).toHaveScreenshot('distribution-dark.png')
  })
})
