import { expect, openApp, resetAll, test } from './support/loop'

// Item 5 — both app dialogs share `useDialogFocus`: focus moves in on open,
// Tab is trapped, Escape closes without committing, focus returns to the opener.

const activeInside = (page: import('@playwright/test').Page, sel: string) =>
  page.evaluate((s) => {
    const box = document.querySelector(s)
    return Boolean(box && document.activeElement && box.contains(document.activeElement))
  }, sel)

test.describe('dialog focus + keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('New → ConfirmDialog traps focus, Escape cancels and restores focus', async ({ page }) => {
    // a node so we could tell if the graph got wiped
    await page.evaluate(() =>
      (window as any).__loop.graph.getState().addNodeAt('pool', { x: 200, y: 160 }),
    )
    await expect(page.locator('.react-flow__node')).toHaveCount(1)

    const newBtn = page.getByRole('button', { name: 'New' })
    await newBtn.click()

    const dlg = page.locator('.mcdlg--confirm')
    await expect(dlg).toBeVisible()
    expect(await activeInside(page, '.mcdlg--confirm')).toBe(true)

    // Tab several times — focus never leaves the dialog
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
    expect(await activeInside(page, '.mcdlg--confirm')).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    await expect(newBtn).toBeFocused()
    await expect(page.locator('.react-flow__node')).toHaveCount(1) // not wiped
  })

  test('New → ConfirmDialog "New graph" clears the document', async ({ page }) => {
    await page.evaluate(() =>
      (window as any).__loop.graph.getState().addNodeAt('pool', { x: 200, y: 160 }),
    )
    await page.getByRole('button', { name: 'New' }).click()
    await page.locator('.mcdlg--confirm').getByRole('button', { name: 'New graph' }).click()
    await expect(page.locator('.mcdlg--confirm')).toBeHidden()
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
  })

  test('Monte Carlo dialog focuses the first field, traps Tab, Escape closes', async ({ page }) => {
    const mcBtn = page.locator('.pstrip__mc button')
    await mcBtn.click()

    const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('input[type="number"]').first()).toBeFocused()

    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
    expect(await activeInside(page, '.mcdlg[aria-labelledby="mcdlg-title"]')).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    await expect(mcBtn).toBeFocused()
  })
})
