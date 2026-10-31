import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// #423 items 3 and 4 (Lumi, 2026-10-31).
//
// Reset all data, when the browser refuses a removal part-way: the step stays
// and says that some data may still be in this browser — some keys were
// already removed — and the page is NOT reloaded. Before, `resetAllData()` ran
// bare in the click handler: the throw escaped, nothing was said, and the
// Confirm button looked dead.
//
// A file that cannot be read in the import wizard or the refresh wizard: the
// wizard says so, and there is no unhandled rejection (`test` from
// ./support/loop fails on any page error). Before, both called
// `file.text().then(ok)` with no rejection handler.

const storage = (page: Page) => page.locator('.mcdlg--storage')

async function openStorageArea(page: Page): Promise<void> {
  await page.locator('.toolbar__filemenu > .wb-mb').click()
  await page.locator('[data-settings-row="storage-privacy"]').click()
  await expect(storage(page)).toHaveAttribute('data-storage-step', 'menu')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('Reset all data: a removal refused after others succeeded keeps the step, says some data may remain, and does not reload', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('loop-studio:author', JSON.stringify({ name: 'Kept' }))
    ;(window as unknown as { __noReload?: boolean }).__noReload = true // gone if the page reloads
    // the first removal goes through, every later one is refused: a partial reset
    const orig = Storage.prototype.removeItem
    let calls = 0
    Storage.prototype.removeItem = function (this: Storage, k: string) {
      calls += 1
      if (calls > 1) throw new Error('removal refused by the test')
      return orig.call(this, k)
    }
  })
  const before = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('loop-studio')).length)
  await openStorageArea(page)
  await storage(page).locator('[data-storage-action="reset-all"]').click()
  await storage(page).locator('[data-storage-confirm]').click()

  const failed = storage(page).locator('[data-storage-notice="failed"]')
  await expect(failed).toBeVisible()
  await expect(failed).toContainText('may still be in this browser')
  await expect(storage(page)).toHaveAttribute('data-storage-step', 'resetAll')
  await expect(storage(page).locator('[data-storage-notice="done"]')).toHaveCount(0)
  await expect(page.locator('.gate')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
  // it really was partial: one key went, the rest are still there
  const after = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('loop-studio')).length)
  expect(after).toBeGreaterThan(0)
  expect(after).toBeLessThan(before)
})

/** every `Blob#text()` (a `File` is a `Blob`) rejects from here on */
const failFileReads = (page: Page) =>
  page.evaluate(() => {
    Blob.prototype.text = () => Promise.reject(new DOMException('read refused by the test', 'NotReadableError'))
  })

async function upload(page: Page, scope: ReturnType<Page['locator']>): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await scope.getByRole('button', { name: 'Upload file…' }).click()
  await (await chooser).setFiles({ name: 'items.csv', mimeType: 'text/csv', buffer: Buffer.from('item_key,weight\nitm_a,10', 'utf8') })
}

test('the import wizard: a file that cannot be read is reported in the wizard, with no unhandled rejection', async ({ page }) => {
  const wizard = page.locator('.mcdlg--dataimport')
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem').first().click()
  await expect(wizard).toBeVisible()
  await failFileReads(page)
  await upload(page, wizard)
  await expect(wizard.getByText('The file could not be read.', { exact: false })).toBeVisible()
  await expect(wizard.getByPlaceholder('Paste CSV or TSV text here')).toHaveValue('')
})

test('the refresh wizard: a file that cannot be read is reported in the wizard, with no unhandled rejection', async ({ page }) => {
  const wizard = page.getByRole('dialog', { name: 'Import spreadsheet data' })
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
  await wizard.getByLabel('Table name').fill('Items')
  await wizard.getByPlaceholder('Paste CSV or TSV text here').fill('item_key,weight\nitm_a,10')
  const head = wizard.locator('.import__preview thead tr').first()
  await head.locator('select').nth(0).selectOption('key')
  await head.locator('select').nth(1).selectOption('number')
  await wizard.getByRole('button', { name: 'Next' }).click()
  await wizard.getByRole('button', { name: 'Next' }).click()
  await wizard.getByRole('button', { name: 'Import' }).click()
  await expect(wizard).toBeHidden()

  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem', { name: 'Refresh or manage imported tables…' }).click()
  const manage = page.getByRole('dialog', { name: 'Manage spreadsheet bindings' })
  await manage.getByRole('button', { name: 'Refresh…' }).click()
  const refresh = page.getByRole('dialog', { name: /^Refresh "/ })
  await expect(refresh).toBeVisible()
  await failFileReads(page)
  await upload(page, refresh)
  await expect(refresh.getByText('The file could not be read.', { exact: false })).toBeVisible()
})
