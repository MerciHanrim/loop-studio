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

// #625 item 5 (Lumi, 2026-11-28) — useDialogFocus, pinned before its refs change: where focus is
// when a dialog or sheet opens, and where each Escape puts it back. A dialog opened over a sheet
// keeps focus inside the dialog (the measured regression: a re-run of the open effect when the
// sheet re-rendered took focus back into the sheet behind the scrim), and closing it returns to
// the row in the sheet that opened it.
const settleTour = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as L).__loop as any
    l.tour.setState({ phase: 'idle' })
    l.hint.setState({ postTourCooldownActive: false })
  })
const helpButton = (page: Page) => page.locator('.toolbar__actions .wb-mb', { hasText: /^Help$/ })

test.describe('focus on open and back on Escape — desktop', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
  })
  test('About: its Close on open; Escape back to Help', async ({ page }) => {
    await helpButton(page).click()
    await page.getByRole('menuitem', { name: 'About Loop Studio' }).click()
    await expect(page.locator('.mcdlg--about .mcdlg__x')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(helpButton(page)).toBeFocused()
  })
  test('Monte Carlo: its first field on open; Escape back to Run', async ({ page }) => {
    await openMonteCarloDialog(page)
    const dialog = page.locator('.mcdlg').filter({ has: page.locator('input') }).first()
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.locator('.toolbar__actions .wb-mb', { hasText: /^Run$/ })).toBeFocused()
  })
  test('Example notes: its Close on open; Escape back to Help', async ({ page }) => {
    await helpButton(page).click()
    await page.getByRole('menuitem', { name: /^Example notes/ }).click()
    await expect(page.locator('.mcdlg--contextual-help .mcdlg__x')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(helpButton(page)).toBeFocused()
  })
  test('the tour replayed: Next on open (its initialFocus); Escape back to Help', async ({ page }) => {
    await page.evaluate(() => ((window as unknown as L).__loop as any).tour.getState().startReplay('desktop'))
    await expect(page.locator('.tour-popover').getByRole('button', { name: /^Next$/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(helpButton(page)).toBeFocused()
  })
})

test.describe('focus on open and back on Escape — phone 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const more = (page: Page) => page.locator('.mob-more')
  const moreSheet = (page: Page) => page.locator('.sheet[aria-label="More"]')
  const helpSheet = (page: Page) => page.locator('.sheet[aria-label="Help"]')
  async function openRow(page: Page, sheet: () => ReturnType<typeof moreSheet>, text: string | RegExp) {
    await sheet().locator('.sheet__row').filter({ hasText: text }).focus()
    await page.keyboard.press('Enter')
  }
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await settleTour(page)
    await more(page).focus()
    await page.keyboard.press('Enter')
    await expect(moreSheet(page).locator('.sheet__x')).toBeFocused()
  })
  test('More: its Close on open; Escape back to More', async ({ page }) => {
    await page.keyboard.press('Escape')
    await expect(more(page)).toBeFocused()
  })
  test('About over the Help sheet: focus stays in About; Escape back to its row, then to Help in More', async ({ page }) => {
    await openRow(page, () => moreSheet(page), 'Help')
    await expect(helpSheet(page).locator('.sheet__x')).toBeFocused()
    await openRow(page, () => helpSheet(page), /About/)
    const close = page.locator('.mcdlg--about .mcdlg__x')
    await expect(close).toBeFocused()
    await page.waitForTimeout(600)
    await expect(close, 'still in About after the sheet behind has re-rendered').toBeFocused()
    await page.keyboard.press('Escape')
    await expect(helpSheet(page).locator('.sheet__row', { hasText: 'About Loop Studio' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(moreSheet(page).locator('.sheet__row', { hasText: /^Help/ })).toBeFocused()
  })
  test('the contextual-tips dialog over the Help sheet: focus in it; Escape back to its row, then to Help in More', async ({ page }) => {
    await openRow(page, () => moreSheet(page), 'Help')
    await openRow(page, () => helpSheet(page), 'Turn contextual tips back on')
    await expect(page.locator('.mcdlg--contextual-help .mcdlg__x')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(helpSheet(page).locator('.sheet__row', { hasText: 'Turn contextual tips back on' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(moreSheet(page).locator('.sheet__row', { hasText: /^Help/ })).toBeFocused()
  })
  test('Storage over the More sheet: its first field on open; Escape back to its row, then to More', async ({ page }) => {
    const row = moreSheet(page).locator('[data-settings-row="storage-privacy"]')
    await row.focus()
    await page.keyboard.press('Enter')
    const dialog = page.locator('.mcdlg--storage')
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(row).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(more(page)).toBeFocused()
  })
})
