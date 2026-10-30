import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

/** the share flow writes the link to the clipboard; a stub keeps the panel's copy step from throwing */
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
  })
}

// issue #413 — reproduction on current main. Two non-modal surfaces answer
// Escape outside the overlay stack ("only the top entry answers Escape"): the
// Share result panel (a bubble `window` listener, no top-of-stack check) and
// the Run-settings popover (a capture `window` listener that stops
// propagation). With a dialog opened over each of them from the keyboard (a
// pointer would dismiss them first), what does ONE Escape close?

const shareBtn = (page: Page) => page.locator('.toolbar__actions button', { hasText: /^Share$/ })
const confirm = (page: Page) => page.locator('.mcdlg--confirm')
const sharePanel = (page: Page) => page.locator('.share-pop')
const mcDialog = (page: Page) => page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
const settingsBtn = (page: Page) => page.locator('.pstrip__settings-btn')
const settingsPop = (page: Page) => page.locator('.pstrip__settings.is-open')

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

test.describe('Escape with a dialog over a non-modal surface (#413)', () => {
  test('Share result panel under the New confirm dialog: one Escape', async ({ page }) => {
    await stubClipboard(page)
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    await shareBtn(page).click()
    await confirm(page).getByRole('button', { name: /create link/i }).click()
    await expect(sharePanel(page)).toBeVisible()

    // File ▸ New from the keyboard: the confirm dialog opens over the panel
    await pickByKeyboard(page, 'File', /^New$/)
    await expect(confirm(page)).toBeVisible()
    await expect(sharePanel(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const afterOne = { dialog: await confirm(page).isVisible(), panel: await sharePanel(page).isVisible() }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const afterTwo = { dialog: await confirm(page).isVisible(), panel: await sharePanel(page).isVisible() }
    // observed on current main (the review expected both to close on the
    // first Escape): the dialog closes alone, the panel stays; the second
    // Escape closes the panel
    expect({ afterOne, afterTwo }).toEqual({ afterOne: { dialog: false, panel: true }, afterTwo: { dialog: false, panel: false } })
  })

  test('Run-settings popover (folded run row) under the Monte Carlo dialog: one Escape, then a second', async ({ page }) => {
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

    // Run ▸ Monte Carlo… from the keyboard: the dialog opens over the popover
    await pickByKeyboard(page, 'Run', /Monte Carlo/)
    await expect(mcDialog(page)).toBeVisible()
    const beforeEsc = { dialog: true, popover: await settingsPop(page).isVisible() }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const afterOne = { dialog: await mcDialog(page).isVisible(), popover: await settingsPop(page).isVisible() }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const afterTwo = { dialog: await mcDialog(page).isVisible(), popover: await settingsPop(page).isVisible() }
    // current main: the popover's capture listener takes the first Escape
    // behind the modal and stops it, so the dialog needs a second one
    expect({ beforeEsc, afterOne, afterTwo }).toEqual({
      beforeEsc: { dialog: true, popover: true },
      afterOne: { dialog: true, popover: false },
      afterTwo: { dialog: false, popover: false },
    })
  })
})
