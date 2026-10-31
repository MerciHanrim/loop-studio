import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// #423 items 1, 2, 6 — the import wizard's state (Lumi, 2026-10-31, decision
// D1 = A). Every way of closing the wizard gives the same result: the draft is
// discarded and the next opening is a fresh one (Escape used to keep it while
// Cancel and the scrim reset it; the wizard has no ✕). While the pasted text
// does not parse, the preview and its role controls are hidden — they used to
// show the LAST good table beside the error — and fixing the text brings the
// earlier role choices back. A group-by setting that the columns or the
// foreign-key roles no longer support is cleared instead of blocking Next with
// no control to change it.

const dialog = (page: Page) => page.locator('.mcdlg--dataimport')
const nameField = (page: Page) => dialog(page).locator('.import__table').first().getByLabel('Table name')
const paste = (page: Page, ti = 0) => dialog(page).locator('.import__table').nth(ti).getByPlaceholder('Paste CSV or TSV text here')
const headRow = (page: Page, ti = 0) => dialog(page).locator('.import__table').nth(ti).locator('.import__preview thead tr').first()

async function openWizard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem').first().click()
  await expect(dialog(page)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

const DISMISS: Record<string, (page: Page) => Promise<void>> = {
  Escape: (page) => page.keyboard.press('Escape'),
  'the scrim': async (page) => {
    const box = (await dialog(page).boundingBox())!
    await page.mouse.click(Math.max(4, box.x - 20), box.y + 20) // outside the dialog, on the scrim
  },
  Cancel: (page) => dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click(),
}

for (const [how, dismiss] of Object.entries(DISMISS)) {
  test(`closing with ${how} discards the draft; the next opening is a fresh one`, async ({ page }) => {
    await openWizard(page)
    await nameField(page).fill('Items')
    await paste(page).fill('item_key,weight\nitm_a,10')
    await expect(headRow(page)).toBeVisible()
    await dismiss(page)
    await expect(dialog(page)).toBeHidden()

    await openWizard(page)
    await expect(nameField(page)).toHaveValue('')
    await expect(paste(page)).toHaveValue('')
    await expect(dialog(page).locator('.import__preview')).toHaveCount(0)
  })
}

test('a parse error hides the preview and its role controls; fixing the text restores the earlier roles', async ({ page }) => {
  await openWizard(page)
  await nameField(page).fill('Items')
  await paste(page).fill('item_key,weight\nitm_a,10\nitm_b,20')
  await headRow(page).locator('select').nth(0).selectOption('key')
  await headRow(page).locator('select').nth(1).selectOption('number')

  await paste(page).fill('item_key,weight\n"itm_a,10\nitm_b,20') // an unterminated quote
  await expect(dialog(page).locator('.import__error').first()).toBeVisible()
  await expect(dialog(page).locator('.import__preview')).toHaveCount(0)

  await paste(page).fill('item_key,weight\nitm_a,10\nitm_b,30') // fixed, same columns
  await expect(headRow(page).locator('select').nth(0)).toHaveValue('key')
  await expect(headRow(page).locator('select').nth(1)).toHaveValue('number')
})

/** Items (key, label) + Banners (key, label) + a pool table with two foreign
 *  keys grouped by `banner_key` */
async function poolWithGroupBy(page: Page): Promise<void> {
  await openWizard(page)
  await nameField(page).fill('Items')
  await paste(page, 0).fill('item_key,name\nitm_a,Sword')
  await headRow(page, 0).locator('select').nth(0).selectOption('key')
  await headRow(page, 0).locator('select').nth(1).selectOption('label')
  await dialog(page).getByRole('button', { name: 'Add another table' }).click()
  const banners = dialog(page).locator('.import__table').nth(1)
  await banners.getByLabel('Table name').fill('Banners')
  await paste(page, 1).fill('banner_key,banner_name\nb1,Pickup')
  await headRow(page, 1).locator('select').nth(0).selectOption('key')
  await headRow(page, 1).locator('select').nth(1).selectOption('label')
  await dialog(page).getByRole('button', { name: 'Add another table' }).click()
  const pool = dialog(page).locator('.import__table').nth(2)
  await pool.getByLabel('Table name').fill('Pool')
  await paste(page, 2).fill('entry_key,item_key,banner_key,weight\ne1,itm_a,b1,10')
  const head = headRow(page, 2)
  await head.locator('th').nth(0).locator('select').selectOption('key')
  await head.locator('th').nth(1).locator('select').first().selectOption('foreignKey')
  await head.locator('th').nth(1).locator('select').nth(1).selectOption({ label: 'Items' })
  await head.locator('th').nth(2).locator('select').first().selectOption('foreignKey')
  await head.locator('th').nth(2).locator('select').nth(1).selectOption({ label: 'Banners' })
  await head.locator('th').nth(3).locator('select').selectOption('number')
  await pool.locator('.import__preview thead tr').nth(1).locator('select').selectOption({ label: 'banner_key' })
}

const nextAdvances = async (page: Page) => {
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).getByText(/must be one of this table's foreign key columns/)).toHaveCount(0)
  await expect(dialog(page).getByText('Place on the canvas, no frames')).toBeVisible()
}

test('a group-by left behind when the columns are rebuilt is cleared, and Next goes on', async ({ page }) => {
  await poolWithGroupBy(page)
  // one more column: the columns are rebuilt and every role resets
  await paste(page, 2).fill('entry_key,item_key,banner_key,weight,note\ne1,itm_a,b1,10,x')
  const head = headRow(page, 2)
  await head.locator('th').nth(0).locator('select').selectOption('key')
  await head.locator('th').nth(1).locator('select').first().selectOption('foreignKey')
  await head.locator('th').nth(1).locator('select').nth(1).selectOption({ label: 'Items' })
  await head.locator('th').nth(3).locator('select').selectOption('number')
  await nextAdvances(page)
})

test('a group-by whose foreign key stops being one is cleared, and Next goes on', async ({ page }) => {
  await poolWithGroupBy(page)
  // banner_key is no longer a foreign key: one foreign key left, the group-by row is gone
  await headRow(page, 2).locator('th').nth(2).locator('select').first().selectOption('ignored')
  await nextAdvances(page)
})
