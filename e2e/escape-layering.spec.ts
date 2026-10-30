import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #413 — Escape with a dialog over a non-modal surface (Lumi,
// 2026-10-30). The Share result panel and the Run-settings popover answer
// Escape on their own, outside the overlay stack; both now check
// `topOverlay()` first: while a dialog or a sheet is open above them they do
// nothing — neither close nor stop the event — so the top screen gets the
// key; the next Escape, with the stack empty again, closes them as before,
// with the popover's focus return intact. Until v0.31.0 the popover's capture
// listener took the first Escape behind the Monte Carlo dialog and stopped
// it, so the dialog needed a second one.

/** the share flow writes the link to the clipboard; a stub keeps the panel's copy step from throwing */
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
  })
}

const shareBtn = (page: Page) => page.locator('.toolbar__actions button', { hasText: /^Share$/ })
const confirm = (page: Page) => page.locator('.mcdlg--confirm')
const sharePanel = (page: Page) => page.locator('.share-pop')
const mcDialog = (page: Page) => page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
const settingsBtn = (page: Page) => page.locator('.pstrip__settings-btn')
const settingsPop = (page: Page) => page.locator('.pstrip__settings.is-open')
const focusedIs = (page: Page, selector: string) => page.evaluate((s) => document.activeElement === document.querySelector(s), selector)

/** open a menubar menu and pick a row, from the keyboard only: focus the
 *  button (no pointer event), Enter opens the menu, the row's own focus + Enter */
async function pickByKeyboard(page: Page, menu: 'File' | 'Run', row: RegExp) {
  await page.getByRole('button', { name: menu, exact: true }).focus()
  await page.keyboard.press('Enter')
  const item = page.getByRole('menuitem', { name: row })
  await expect(item).toBeVisible()
  await item.focus()
  await page.keyboard.press('Enter')
}

async function shown(page: Page) {
  await page.waitForTimeout(150)
  return { confirm: await confirm(page).isVisible(), panel: await sharePanel(page).isVisible(), dialog: await mcDialog(page).isVisible(), popover: await settingsPop(page).isVisible() }
}

test.describe('Escape closes only the top screen (#413)', () => {
  test('Share result panel under the New confirm dialog: the first Escape closes the dialog alone, the second the panel', async ({ page }) => {
    await stubClipboard(page)
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    await shareBtn(page).click()
    await confirm(page).getByRole('button', { name: /create link/i }).click()
    await expect(sharePanel(page)).toBeVisible()

    await pickByKeyboard(page, 'File', /^New$/)
    await expect(confirm(page)).toBeVisible()
    await expect(sharePanel(page)).toBeVisible()

    await page.keyboard.press('Escape')
    expect(await shown(page)).toMatchObject({ confirm: false, panel: true })
    await page.keyboard.press('Escape')
    expect(await shown(page)).toMatchObject({ confirm: false, panel: false })
  })

  test('Run-settings popover (folded run row) under the Monte Carlo dialog: the first Escape closes the dialog alone, the second the popover with its focus return', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    // the run row folds Speed / Seed into Run settings (fit step 2 or 3) when
    // the strip is short: the canvas column pinned narrow, as run-bar-fit.spec does
    await page.addStyleTag({ content: '.canvas-col { max-width: 360px !important; }' })
    await expect.poll(() => page.locator('.pstrip').first().getAttribute('data-fit')).toMatch(/^[23]$/)
    await expect(settingsBtn(page)).toBeVisible()
    await settingsBtn(page).click()
    await expect(settingsPop(page)).toBeVisible()

    await pickByKeyboard(page, 'Run', /Monte Carlo/)
    await expect(mcDialog(page)).toBeVisible()
    await expect(settingsPop(page)).toBeVisible()

    await page.keyboard.press('Escape')
    expect(await shown(page)).toMatchObject({ dialog: false, popover: true }) // the top screen only
    await page.keyboard.press('Escape')
    expect(await shown(page)).toMatchObject({ dialog: false, popover: false })
    expect(await focusedIs(page, '.pstrip__settings-btn')).toBe(true) // the popover's own focus return, as before
    await expect(settingsBtn(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('with nothing above them the two surfaces still close on Escape, as before', async ({ page }) => {
    await stubClipboard(page)
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    await shareBtn(page).click()
    await confirm(page).getByRole('button', { name: /create link/i }).click()
    await expect(sharePanel(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sharePanel(page)).toBeHidden()

    await page.addStyleTag({ content: '.canvas-col { max-width: 360px !important; }' })
    await expect.poll(() => page.locator('.pstrip').first().getAttribute('data-fit')).toMatch(/^[23]$/)
    await settingsBtn(page).click()
    await expect(settingsPop(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(settingsPop(page)).toBeHidden()
    expect(await focusedIs(page, '.pstrip__settings-btn')).toBe(true)
  })
})
