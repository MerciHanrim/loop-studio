import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'
import { openMonteCarloDialog } from './support/workbenchMenus'

// Review U1 (2026-11-22) — a dialog or sheet that opens with its first field
// disabled. `useDialogFocus` took that field, `focus()` on it did nothing, and
// focus was left on <body>: on the phone's Inspector sheet (every field is in a
// `<fieldset disabled>`) and on the desktop Monte Carlo dialog opened again
// while its run goes (its fields are disabled then). Focus now goes to the
// first control that can take it, and with no usable field that is Close.

type L = { __loop: Record<string, { getState: () => any }> }

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
}

test.describe('phone 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('Details opened by Enter puts focus on the sheet\'s Close, and PageDown then scrolls the sheet', async ({ page }) => {
    await load(page)
    // Assembly: its read-only Inspector is taller than the sheet
    const node = page.locator('.react-flow__node[data-id="assembly"]')
    await expect(node).toBeVisible()
    const b = (await node.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    const details = page.locator('.selpanel__details')
    await expect(details).toBeVisible()
    await details.focus()
    await expect(details).toBeFocused()
    await page.keyboard.press('Enter')

    const sheet = page.locator('.sheet--inspector')
    await expect(sheet).toBeVisible()
    // the case itself: the sheet's first field is disabled (through the fieldset)
    expect(await sheet.locator('input, select, textarea').first().evaluate((e) => e.matches(':disabled'))).toBe(true)
    await expect(sheet.locator('.sheet__x')).toBeFocused()

    const scroll = () => sheet.evaluate((s) => ({ top: s.scrollTop, max: s.scrollHeight - s.clientHeight }))
    const start = await scroll()
    expect(start.top).toBe(0)
    expect(start.max, 'the sheet has more to read than it shows').toBeGreaterThan(100)
    for (let i = 0; i < 3; i++) await page.keyboard.press('PageDown')
    // a key scroll is smooth: wait for it to reach the end
    await expect.poll(async () => { const s = await scroll(); return s.max - s.top }).toBeLessThanOrEqual(1)
    await expect(sheet.locator('.sheet__x')).toBeFocused()
  })
})

test('desktop: the Monte Carlo dialog opened again while its run goes has focus inside, on Close', async ({ page }) => {
  await load(page)
  // one tracked Pool keeps the run long enough to open the dialog again during it
  await page.evaluate(() => (window as unknown as L).__loop.mc.getState().setConfig({ runs: 24000, steps: 200, tracked: ['ore_stock'] }))
  await openMonteCarloDialog(page)
  const dialog = page.locator('.mcdlg')
  await expect(dialog).toBeVisible()
  const run = dialog.getByRole('button', { name: /^Run/ })
  await expect(run).toBeEnabled()
  await run.click()
  const status = () => page.evaluate(() => (window as unknown as L).__loop.mc.getState().status as string)
  await expect.poll(status).toBe('running')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await openMonteCarloDialog(page)
  await expect(dialog).toBeVisible()
  // the case itself: the run still goes and the first field is disabled
  expect(await status()).toBe('running')
  await expect(dialog.locator('input').first()).toBeDisabled()
  await expect(dialog.locator('.mcdlg__x')).toBeFocused()
  expect(await status(), 'measured while the run went').toBe('running')
  await page.evaluate(() => (window as unknown as L).__loop.mc.getState().cancel())
})
