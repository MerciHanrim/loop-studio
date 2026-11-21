import { readFileSync } from 'node:fs'
import type { Browser, Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, seedPersonalBrowser, test } from './support/loop'
import { waitForAppReady } from './support/appReady'

// Review P2 (2026-11-22) — the phone's Graph JSON, Share link and protected
// link carry the canvas lock and the Timeline's series choice, as the desktop
// ones do. They used to write the Monte Carlo settings only, so a locked
// document with a chosen pair of series, exported or shared from the phone,
// opened unlocked and with the automatic series. The Workspace file already
// kept both, and a project revision leaves both out on purpose (display
// preferences, revision.ts): both stay as they are, as controls here.

type L = { __loop: Record<string, { getState: () => any }> }
const PASSWORD = 'phone export password 6' // never a real one
const SERIES = ['energy_pool', 'ore_stock']

// risky-factory with the lock on and an explicit choice of two series
const LOCKED_DOC = (() => {
  const doc = JSON.parse(readRiskyFactory()) as Record<string, any>
  doc.recommendedRunConfig = { ...doc.recommendedRunConfig, canvasLocked: true, timelineSeries: SERIES }
  return JSON.stringify(doc)
})()

const settings = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as L).__loop
    return { canvasLocked: l.ui.getState().canvasLocked as boolean, timelineSeries: l.sim.getState().timelineSeries as unknown }
  })
const LOCKED = { canvasLocked: true, timelineSeries: SERIES }

const more = (page: Page) => page.locator('.mob-more')
const sheet = (page: Page, label: string) => page.locator(`.sheet[aria-label="${label}"]`)

/** a fresh desktop profile that has chosen to store work, on this run's server */
async function freshPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: test.info().project.use.baseURL })
  await seedPersonalBrowser(ctx)
  const page = await ctx.newPage()
  page.on('dialog', (d) => void d.accept())
  await openApp(page)
  return { ctx, page }
}

/** what a file opens as in a fresh browser */
async function openFile(browser: Browser, text: string) {
  const { ctx, page } = await freshPage(browser)
  await resetAll(page)
  await importGraph(page, text)
  const s = await settings(page)
  await ctx.close()
  return s
}

/** what a link opens as in a fresh browser: a link is consumed at boot */
async function openLink(browser: Browser, url: string, password?: string) {
  const { ctx, page } = await freshPage(browser)
  await page.goto('about:blank')
  await page.goto('/' + url.slice(url.indexOf('#')))
  await waitForAppReady(page)
  await page.waitForFunction(() => Boolean((window as unknown as L).__loop))
  if (password) {
    const prompt = page.locator('[data-protected-open="prompt"]')
    await expect(prompt).toBeVisible()
    await prompt.locator('[data-protected-open="password"]').fill(password)
    await prompt.getByRole('button', { name: 'Open' }).click()
    await expect(prompt).toHaveCount(0)
  }
  await expect(page.locator('.react-flow__node[data-id="ore_stock"]')).toBeVisible()
  const s = await settings(page)
  await ctx.close()
  return s
}

/** More ▸ Export ▸ `row`, then the confirm button when the row asks; the downloaded text */
async function exportFrom(page: Page, row: string, confirm?: string) {
  await more(page).click()
  await sheet(page, 'More').locator('.sheet__row', { hasText: 'Export' }).click()
  const download = page.waitForEvent('download')
  await sheet(page, 'Export').locator('.sheet__row', { hasText: row }).click()
  if (confirm) await page.getByRole('button', { name: confirm }).click()
  return readFileSync((await (await download).path())!, 'utf8')
}

/** More ▸ Share link ▸ Create link, with a password or without; the link */
async function shareFrom(page: Page, password?: string) {
  await more(page).click()
  await sheet(page, 'More').locator('.sheet__row', { hasText: 'Share link' }).click()
  const dlg = page.locator('.mcdlg--share[data-share-create]')
  await expect(dlg).toBeVisible()
  if (password) {
    await dlg.locator('[data-share-protect="option"]').check()
    await dlg.locator('[data-share-protect="password"]').fill(password)
    await dlg.locator('[data-share-protect="confirm"]').fill(password)
  }
  await dlg.getByRole('button', { name: 'Create link' }).click()
  const url = page.locator('.sheet .share-pop__url')
  await expect(url).toBeVisible()
  return url.inputValue()
}

test.describe('phone 390 × 844: a locked document with two chosen series', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
    })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, LOCKED_DOC)
    // the case itself: the document opened locked, with the two series
    expect(await settings(page)).toEqual(LOCKED)
  })

  test('Graph JSON keeps the lock and the series, and opens with them', async ({ page, browser }) => {
    const text = await exportFrom(page, 'Graph JSON')
    const rc = (JSON.parse(text) as { recommendedRunConfig: Record<string, unknown> }).recommendedRunConfig
    expect({ canvasLocked: rc.canvasLocked, timelineSeries: rc.timelineSeries }, 'in the file').toEqual(LOCKED)
    expect(await openFile(browser, text), 'opened in a fresh browser').toEqual(LOCKED)
  })

  test('a Share link opens with the lock and the series', async ({ page, browser }) => {
    const url = await shareFrom(page)
    expect(url).toContain('#g1=')
    expect(await openLink(browser, url)).toEqual(LOCKED)
  })

  test('a protected link opens with the lock and the series', async ({ page, browser }) => {
    const url = await shareFrom(page, PASSWORD)
    expect(url).toContain('#p1=')
    expect(await openLink(browser, url, PASSWORD)).toEqual(LOCKED)
  })

  test('control: the Workspace file already keeps both', async ({ page }) => {
    const text = await exportFrom(page, 'Workspace JSON', 'Save workspace')
    const rc = (JSON.parse(text) as { recommendedRunConfig: Record<string, unknown> }).recommendedRunConfig
    expect({ canvasLocked: rc.canvasLocked, timelineSeries: rc.timelineSeries }).toEqual(LOCKED)
  })

  test('control: a project revision leaves both out, as on the desktop', async ({ page }) => {
    const text = await exportFrom(page, 'Project revision', 'Export revision')
    const rc = ((JSON.parse(text) as { recommendedRunConfig?: Record<string, unknown> }).recommendedRunConfig ?? {}) as Record<string, unknown>
    expect('canvasLocked' in rc, 'no canvasLocked').toBe(false)
    expect('timelineSeries' in rc, 'no timelineSeries').toBe(false)
  })
})
