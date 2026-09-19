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

// Item 8 — the Distribution panel pixel snapshots, light and dark (the first
// pixel snapshots in the suite; the other visual specs added theirs later).
// Everything is pinned (fixture graph, baseSeed 1, 200 × 30, the 4 tracked
// Pools, Dice Pool selected) so the band geometry is identical run to run; OS
// font AA is absorbed by the config's maxDiffPixelRatio.

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

// Framed on `.timeline__panel` (view tabs + distribution panel + band chart),
// NOT the enclosing `.timeline`: that would also capture the playback strip,
// whose speed slider / seed field are not what these shots protect and whose
// defaults have changed under them before (#193 moved the slider). The Export
// menu's open state is covered functionally in export.spec.ts (it opens upward
// and doesn't fit the strip cleanly for a stable snapshot).
test.describe('Distribution — visual', () => {
  test('light — Pool selector shown, mean off', async ({ page }) => {
    await distributionReady(page)
    await expect(page.locator('.band__mean')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.timeline__panel')).toHaveScreenshot('distribution-light.png')
  })

  test('dark — mean on', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await distributionReady(page)

    await page.locator('.band__mean').click()
    await expect(page.locator('.band__mean')).toHaveAttribute('aria-pressed', 'true')

    await expect(page.locator('.timeline__panel')).toHaveScreenshot('distribution-dark.png')
  })
})
