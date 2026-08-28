import { expect, test } from '@playwright/test'
import { capturedExports, installProbe, pathProbe, portableUrl } from './support/mc'

// Portable single-file build opened from file://. No dev server, no window.__loop
// bridge (production build) — everything is driven through the DOM, and the MC
// result is read back via the URL.createObjectURL capture in the probe (the real
// Playwright `download` event also fires here, and is checked as a bonus).
//
// Confirmed by the step-1 spike: file:// boot, hidden-<input> import, MC on the
// cooperative path (no Worker), and Export → JSON blob capture all work with
// zero product-code change.

const RF = 'examples/risky-factory.json'

test('portable file://: boots, imports, runs on the cooperative path, exports 424/500', async ({ page }) => {
  test.setTimeout(60_000)
  await installProbe(page)

  // 1 — boots from file://
  await page.goto(portableUrl())
  expect(await page.evaluate(() => location.protocol)).toBe('file:')
  await expect(page.locator('.toolbar')).toBeVisible()
  await expect(page.locator('.canvas .react-flow')).toBeVisible()
  expect(await page.evaluate(() => Boolean((window as any).__loop))).toBe(false) // no bridge in prod

  // 2 — import risky-factory through the real hidden <input type=file>
  await page.locator('input[type="file"]').setInputFiles(RF)
  await expect(page.locator('.react-flow__node')).toHaveCount(18)

  // 3 — MC run via the dialog: 500 × 40, baseSeed 1
  await page.locator('.pstrip__mc button', { hasText: 'Monte Carlo' }).click()
  const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
  await expect(dlg).toBeVisible()
  const nums = dlg.locator('.mcdlg__field input[type="number"]')
  await nums.nth(0).fill('500') // runs
  await nums.nth(1).fill('40') // steps
  await nums.nth(2).fill('1') // base seed
  const runBtn = dlg.locator('.mcdlg__foot .btn--primary')
  await expect(runBtn).toBeEnabled()
  await runBtn.click()
  await page.keyboard.press('Escape') // close the setup dialog; the run continues
  await expect(dlg).toBeHidden()

  // strip shows progress, then the distribution panel appears
  await expect(page.locator('.dist')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')

  const probe = await pathProbe(page)
  expect(probe.wk.ctor, 'no Worker constructed on file:// (cooperative path)').toBe(0)

  // populated termination sparkline
  await expect(page.locator('.term__line')).toHaveCount(1)
  await expect(page.locator('.term__bead')).toHaveCount(1)
  await expect(page.locator('.term__empty')).toHaveCount(0)
  await expect(page.locator('.term__pct b')).toHaveText('85%')

  // 4 — Export ▾ → JSON, captured via URL.createObjectURL wrapper
  await page.locator('.dist__stats .menu button', { hasText: 'Export' }).click()

  // does the real download event also fire on file://? (informational)
  const dl = page
    .waitForEvent('download', { timeout: 3_000 })
    .then((d) => d.suggestedFilename())
    .catch(() => null)

  await page.getByRole('menuitem', { name: 'JSON' }).click()
  const realDownloadName = await dl
  console.log('[spike] real download event on file://:', realDownloadName ?? 'DID NOT FIRE')

  // 5 — the captured JSON is a full MonteCarloResult with the expected 424/500
  const exports = await capturedExports(page)
  console.log('[spike] captured exports:', exports.map((e) => e.name))
  expect(exports.length, 'URL.createObjectURL capture yielded the export').toBeGreaterThan(0)
  const jsonExport = exports.findLast((e) => e.name.endsWith('.json'))
  expect(jsonExport, 'a .json export was captured').toBeTruthy()
  const result = JSON.parse(jsonExport!.text)
  expect(result.spec).toBe('loop-mc/1')
  expect(result.config).toMatchObject({ baseSeed: 1, runs: 500, steps: 40 })
  expect(result.completedRuns).toBe(500)
  expect(result.endedRuns.atOrBeforeStep.length).toBe(41)
  expect(result.endedRuns.atOrBeforeStep.at(-1)).toBe(424)
})
