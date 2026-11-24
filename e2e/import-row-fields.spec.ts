import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// #615 item 1 — the two data wizards' "Header row" and "Ignore last rows"
// fields set their value on Enter or when the field is left, never per key.
// Before, each key went through `sanitizeRowCount`: a blank snapped to the
// minimum (clearing 2 showed 1, and typing 3 then made 13), and in the import
// wizard each change reparsed the paste, which resets the column roles
// whenever the header row's cell count differs. The rule that a CONFIRMED
// header row with another cell count resets the roles stands.

const wizard = (page: Page) => page.getByRole('dialog', { name: 'Import spreadsheet data' })
const manage = (page: Page) => page.getByRole('dialog', { name: 'Manage spreadsheet bindings' })
const refresh = (page: Page) => page.getByRole('dialog', { name: /^Refresh "/ })
const NOTE_FIRST = 'note line\nitem_key,display_name,weight\nitm_a,Ember Blade,10\nitm_b,Iron Charm,3'

async function openImport(page: Page) {
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
  await expect(wizard(page)).toBeVisible()
  await wizard(page).getByLabel('Table name').fill('Items')
  await wizard(page).getByPlaceholder('Paste CSV or TSV text here').fill(NOTE_FIRST)
}
const roleSelects = (page: Page) => wizard(page).locator('.import__preview thead tr').first().locator('select')
async function roles(page: Page): Promise<string[]> {
  const sel = roleSelects(page)
  const out: string[] = []
  for (let i = 0; i < (await sel.count()); i++) out.push(await sel.nth(i).inputValue())
  return out
}
/** set a row field the way a person does: select all, type, Enter */
async function setByKeys(field: Locator, text: string) {
  await field.click()
  await field.press('Control+a')
  for (const ch of text) await field.press(ch)
  await field.press('Enter')
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test.describe('the import wizard’s Header row and Ignore last rows set their value on Enter or leaving (#615 item 1)', () => {
  test('2 → cleared → 3 never shows 1 or 13 nor reparses; back to 2 on Enter keeps the roles', async ({ page }) => {
    await openImport(page)
    const header = wizard(page).getByLabel('Header row')
    await setByKeys(header, '2')
    await expect(header).toHaveValue('2')
    await roleSelects(page).nth(0).selectOption('key')
    await roleSelects(page).nth(1).selectOption('label')
    await roleSelects(page).nth(2).selectOption('number')
    const set = ['key', 'label', 'number']
    expect(await roles(page)).toEqual(set)

    await header.click()
    await header.press('End')
    await header.press('Backspace')
    expect.soft(await header.inputValue(), 'a blank is not snapped to 1').toBe('')
    expect.soft(await roles(page), 'no reparse while typing').toEqual(set)
    await header.press('3')
    expect.soft(await header.inputValue(), 'the digit does not append to a snapped 1').toBe('3')
    expect.soft(await roles(page), 'still no reparse').toEqual(set)
    await header.press('Control+a')
    await header.press('2')
    await header.press('Enter')
    await expect(header).toHaveValue('2')
    expect(await roles(page), 'the same header row confirmed: the roles are kept').toEqual(set)
  })

  test('control: a header row with another cell count, confirmed by Enter or by leaving, resets the roles', async ({ page }) => {
    await openImport(page)
    const header = wizard(page).getByLabel('Header row')
    await setByKeys(header, '2')
    await roleSelects(page).nth(0).selectOption('key')
    await roleSelects(page).nth(1).selectOption('label')
    await roleSelects(page).nth(2).selectOption('number')
    // row 1 is the one-cell note line
    await setByKeys(header, '1')
    await expect.poll(() => roles(page)).toEqual(['ignored'])
    // and leaving the field confirms too
    await header.click()
    await header.press('Control+a')
    await header.press('2')
    await header.press('Tab')
    await expect.poll(() => roles(page)).toEqual(['ignored', 'ignored', 'ignored'])
    await expect(header).toHaveValue('2')
  })

  test('Ignore last rows: a blank is not snapped to 0 while typing; a confirmed value applies', async ({ page }) => {
    await openImport(page)
    const ignore = wizard(page).getByLabel('Ignore last N rows')
    await ignore.click()
    await ignore.press('End')
    await ignore.press('Backspace')
    expect.soft(await ignore.inputValue()).toBe('')
    await ignore.press('1')
    await ignore.press('Enter')
    await expect(ignore).toHaveValue('1')
    // a blank confirmed sets nothing: the field shows the value again
    await ignore.click()
    await ignore.press('End')
    await ignore.press('Backspace')
    await ignore.press('Tab')
    await expect(ignore).toHaveValue('1')
  })
})

test.describe('the refresh wizard’s Header row sets its value on Enter or leaving (#615 item 1)', () => {
  test('2 → cleared → 3 never shows 1 or 13; Enter sets it', async ({ page }) => {
    // a bound table
    await page.getByRole('button', { name: 'Data' }).click()
    await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
    await wizard(page).getByLabel('Table name').fill('Items')
    await wizard(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,display_name,weight\nitm_a,Ember Blade,10\nitm_b,Iron Charm,3')
    await roleSelects(page).nth(0).selectOption('key')
    await roleSelects(page).nth(1).selectOption('label')
    await roleSelects(page).nth(2).selectOption('number')
    await wizard(page).getByRole('button', { name: 'Next' }).click()
    await wizard(page).getByRole('button', { name: 'Next' }).click()
    await wizard(page).getByRole('button', { name: 'Import' }).click()
    await expect(wizard(page)).toBeHidden()

    await page.getByRole('button', { name: 'Data' }).click()
    await page.getByRole('menuitem', { name: 'Refresh or manage imported tables…' }).click()
    await manage(page).getByRole('button', { name: 'Refresh…' }).click()
    await refresh(page).getByPlaceholder('Paste CSV or TSV text here').fill(NOTE_FIRST)
    const header = refresh(page).getByLabel('Header row')
    await setByKeys(header, '2')
    await expect(header).toHaveValue('2')
    await header.click()
    await header.press('End')
    await header.press('Backspace')
    expect.soft(await header.inputValue()).toBe('')
    await header.press('3')
    expect.soft(await header.inputValue()).toBe('3')
    await header.press('Control+a')
    await header.press('2')
    await header.press('Enter')
    await expect(header).toHaveValue('2')
    // the confirmed row is read: Next reaches the review with no column changes
    const ignore = refresh(page).getByLabel('Ignore last N rows')
    await ignore.click()
    await ignore.press('End')
    await ignore.press('Backspace')
    expect.soft(await ignore.inputValue()).toBe('')
  })
})
