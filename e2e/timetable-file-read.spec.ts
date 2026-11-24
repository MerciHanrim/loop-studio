import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// #615 item 5 (B) — Data ▸ New timetable…: a CSV chosen with the file input
// whose read fails left the text box empty with no word, and an unhandled
// promise rejection on the page (`await file.text()` with no catch). It now
// says so in the dialog with the data import wizard's own message
// (`import.fileReadFailed`, #423), raises no page error, and the person can
// go on by pasting the contents, which clears the message.

const dialog = (page: Page) => page.getByRole('dialog', { name: 'New timetable' })
const FAILED = 'The file could not be read. Try choosing it again, or paste its contents instead.'
const CSV = 'time,rate\n0,5\n10,8\n'
const file = { name: 'times.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') }

async function openTimetable(page: Page) {
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem', { name: 'New timetable…' }).click()
  await expect(dialog(page)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test.describe('the timetable dialog says when a chosen file cannot be read (#615 item 5)', () => {
  test('a failed read: the message in the dialog, no page error; pasting by hand goes on and clears it', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    // this page's file reads fail, as an unreadable or vanished file does
    await page.evaluate(() => {
      File.prototype.text = function () {
        return Promise.reject(new DOMException('The file could not be read.', 'NotReadableError'))
      }
    })
    await openTimetable(page)
    await dialog(page).locator('input[type="file"]').setInputFiles(file)
    await expect(dialog(page).getByRole('alert')).toHaveText(FAILED)
    expect(pageErrors, 'no unhandled rejection').toEqual([])
    await expect(dialog(page).locator('textarea')).toHaveValue('')

    await dialog(page).locator('textarea').fill(CSV)
    await expect(dialog(page).getByText('Rows read: 2')).toBeVisible()
    await expect(dialog(page).getByText(FAILED)).toHaveCount(0)
    expect(pageErrors).toEqual([])
  })

  test('control: a file that reads fills the text box, with no message', async ({ page }) => {
    await openTimetable(page)
    await dialog(page).locator('input[type="file"]').setInputFiles(file)
    await expect(dialog(page).locator('textarea')).toHaveValue(CSV)
    await expect(dialog(page).getByText('Rows read: 2')).toBeVisible()
    await expect(dialog(page).getByText(FAILED)).toHaveCount(0)
  })
})
