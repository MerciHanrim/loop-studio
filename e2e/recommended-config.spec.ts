import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readFixture, readRiskyFactory, resetAll, test } from './support/loop'
import { capturedExports, installProbe } from './support/mc'

// A graph file now carries `recommendedRunConfig` (baseSeed / runs / steps /
// tracked). Import applies the valid fields to the Monte-Carlo config; Export
// writes the current config. Live results / view / progress are NOT saved.

const RF_RECOMMENDED = {
  baseSeed: 1,
  runs: 500,
  steps: 40,
  tracked: ['ore_stock', 'energy_pool', 'components', 'finished', 'scrap', 'salvage'],
}

const mcConfig = (page: Page) =>
  page.evaluate(() => ({ ...(window as any).__loop.mc.getState().config }))

const setConfig = (page: Page, c: Record<string, unknown>) =>
  page.evaluate((v) => (window as any).__loop.mc.getState().setConfig(v), c)

test.describe('recommendedRunConfig', () => {
  test('importing Risky Factory applies its recommended MC config (no dialog)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    expect(await mcConfig(page)).toEqual(RF_RECOMMENDED)
  })

  test('importing a file without the field leaves the current MC config untouched', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await setConfig(page, { baseSeed: 9, runs: 333, steps: 22, tracked: [] })
    await importGraph(page, readFixture()) // engine-b-verification.json has no recommendedRunConfig
    expect(await mcConfig(page)).toEqual({ baseSeed: 9, runs: 333, steps: 22, tracked: [] })
  })

  test('Toolbar Export writes the current MC settings into the file', async ({ page }) => {
    await installProbe(page)
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    await setConfig(page, { baseSeed: 7, runs: 250, steps: 18, tracked: ['components'] })

    await page.getByRole('button', { name: 'Export' }).click()
    const exports = await capturedExports(page)
    const file = exports.findLast((e) => e.name.endsWith('.json'))
    expect(file).toBeTruthy()
    const doc = JSON.parse(file!.text)
    expect(doc.recommendedRunConfig).toEqual({ baseSeed: 7, runs: 250, steps: 18, tracked: ['components'] })
    expect(doc.nodes).toHaveLength(18) // still a normal graph file
  })

  test('Import → Export → Import round-trips the recommended config', async ({ page }) => {
    await installProbe(page)
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    expect(await mcConfig(page)).toEqual(RF_RECOMMENDED)

    // export, then reset everything and re-import the exported bytes
    await page.getByRole('button', { name: 'Export' }).click()
    const exports = await capturedExports(page)
    const exported = exports.findLast((e) => e.name.endsWith('.json'))!.text

    await resetAll(page)
    await setConfig(page, { baseSeed: 2, runs: 10, steps: 5, tracked: [] })
    await importGraph(page, exported)
    expect(await mcConfig(page)).toEqual(RF_RECOMMENDED)
  })

  test('the MC dialog Run button reads "Run N runs"', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    await page.locator('.pstrip__mc button', { hasText: 'Monte Carlo' }).click()
    await expect(page.locator('.mcdlg__foot .btn--primary')).toHaveText('Run 500 runs')
  })
})
