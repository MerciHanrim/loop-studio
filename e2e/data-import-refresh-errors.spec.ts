import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Review P3 (2026-11-22) — the data refresh wizard's error lines say which
// cell is wrong, as the first import wizard's do: the table, the row as a line
// of the pasted text (counting the header row and anything above it), the
// column and its header, and the cell as typed. A duplicate key and a bad
// number used to read "text unavailable (import.issue.duplicate-key)" and
// "text unavailable (import.issue.invalid-number)", and no line had a place.

type GS = { nodes: { data?: { label?: string; value?: number } }[] }

const menuButton = (page: Page) => page.getByRole('button', { name: 'Data' })
const manageDialog = (page: Page) => page.getByRole('dialog', { name: 'Manage spreadsheet bindings' })
const refreshDialog = (page: Page) => page.getByRole('dialog', { name: /^Refresh "/ })
const wizardDialog = (page: Page) => page.getByRole('dialog', { name: 'Import spreadsheet data' })
/** the shown text without the bidi isolates the lines wrap user text in */
const plain = (s: string) => s.replace(/[⁦-⁩]/g, '').trim()

/** `Items` (key / label / number): itm_a Ember Blade 10, itm_b Iron Charm 3 */
async function importItemsTable(page: Page): Promise<void> {
  await menuButton(page).click()
  await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
  await expect(wizardDialog(page)).toBeVisible()
  await wizardDialog(page).getByLabel('Table name').fill('Items')
  await wizardDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,display_name,weight\nitm_a,Ember Blade,10\nitm_b,Iron Charm,3')
  const headerRow = wizardDialog(page).locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('label')
  await headerRow.locator('select').nth(2).selectOption('number')
  await wizardDialog(page).getByRole('button', { name: 'Next' }).click()
  await wizardDialog(page).getByRole('button', { name: 'Next' }).click()
  await wizardDialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(wizardDialog(page)).toBeHidden()
}

/** Refresh… with `csv` (and the header row / ignored rows when given), Next */
async function refreshWith(page: Page, csv: string, rows: { header?: number; ignoreLast?: number } = {}): Promise<void> {
  await menuButton(page).click()
  await page.getByRole('menuitem', { name: 'Refresh or manage imported tables…' }).click()
  await expect(manageDialog(page)).toBeVisible()
  await manageDialog(page).getByRole('button', { name: 'Refresh…' }).click()
  await expect(refreshDialog(page)).toBeVisible()
  await refreshDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill(csv)
  if (rows.header !== undefined) await refreshDialog(page).getByLabel('Header row').fill(String(rows.header))
  if (rows.ignoreLast !== undefined) await refreshDialog(page).getByLabel('Ignore last N rows').fill(String(rows.ignoreLast))
  await refreshDialog(page).getByRole('button', { name: 'Next' }).click()
}

const errorLines = async (page: Page) => {
  const items = refreshDialog(page).locator('ul.import__error li')
  await expect(items.first()).toBeVisible()
  return (await items.allInnerTexts()).map(plain)
}

/** `Items` as above AND `GachaPoolEntries` (key / foreignKey → Items / number),
 *  in one import, as e2e/data-import-refresh.spec.ts does */
async function importItemsAndPoolTables(page: Page): Promise<void> {
  await menuButton(page).click()
  await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
  await expect(wizardDialog(page)).toBeVisible()
  await wizardDialog(page).getByLabel('Table name').fill('Items')
  await wizardDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,display_name,weight\nitm_a,Ember Blade,10\nitm_b,Iron Charm,3')
  const itemsHeader = wizardDialog(page).locator('.import__table').nth(0).locator('.import__preview thead tr').first()
  await itemsHeader.locator('th').nth(0).locator('select').selectOption('key')
  await itemsHeader.locator('th').nth(1).locator('select').selectOption('label')
  await itemsHeader.locator('th').nth(2).locator('select').selectOption('number')
  await wizardDialog(page).getByRole('button', { name: 'Add another table' }).click()
  const poolTable = wizardDialog(page).locator('.import__table').nth(1)
  await poolTable.getByLabel('Table name').fill('GachaPoolEntries')
  await poolTable.getByPlaceholder('Paste CSV or TSV text here').fill('pool_entry_key,item_key,weight\nppe_a,itm_a,5')
  const poolHeader = poolTable.locator('.import__preview thead tr').first()
  await poolHeader.locator('th').nth(0).locator('select').selectOption('key')
  const fkTh = poolHeader.locator('th').nth(1)
  await fkTh.locator('select').first().selectOption('foreignKey')
  await fkTh.locator('select').nth(1).selectOption({ label: 'Items' })
  await poolHeader.locator('th').nth(2).locator('select').selectOption('number')
  await wizardDialog(page).getByRole('button', { name: 'Next' }).click()
  await wizardDialog(page).getByRole('button', { name: 'Next' }).click()
  await wizardDialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(wizardDialog(page)).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test.describe('one table, Items', () => {
  test.beforeEach(async ({ page }) => {
    await importItemsTable(page)
  })

test('a duplicate key names its row, its column and the key', async ({ page }) => {
  await refreshWith(page, 'item_key,display_name,weight\nitm_a,Ember Blade,10\nitm_a,Iron Charm,3')
  expect(await errorLines(page)).toEqual(['Table Items, row 3, column 1 (item_key): Key "itm_a" is already used by another row. Give every row a unique Key.'])
  // the user text is isolated as the first wizard isolates it (FSI … PDI)
  const raw = await refreshDialog(page).locator('ul.import__error li').first().innerText()
  for (const part of ['Items', 'item_key', 'itm_a']) expect(raw, part).toContain(`⁨${part}⁩`)
})

test('two bad numbers in two rows read as two lines, each with its row and its value', async ({ page }) => {
  await refreshWith(page, 'item_key,display_name,weight\nitm_a,Ember Blade,ten\nitm_b,Iron Charm,3kg')
  expect(await errorLines(page)).toEqual([
    'Table Items, row 2, column 3 (weight): "ten" is not a number. Remove thousands separators, currency symbols and %, for example 4900.',
    'Table Items, row 3, column 3 (weight): "3kg" is not a number. Remove thousands separators, currency symbols and %, for example 4900.',
  ])
})

test('an empty number cell names its row and column', async ({ page }) => {
  await refreshWith(page, 'item_key,display_name,weight\nitm_a,Ember Blade,\nitm_b,Iron Charm,3')
  expect(await errorLines(page)).toEqual(['Table Items, row 2, column 3 (weight): This cell is empty. Enter a number, or set the column to Ignore.'])
})

test('the row is the line of the pasted text: a title line above the header and an ignored total line below', async ({ page }) => {
  // line 1 a title, line 2 the header (Header row 2), lines 3–4 the rows, line 5 a total (ignored)
  await refreshWith(page, 'Inventory export,,\nitem_key,display_name,weight\nitm_a,Ember Blade,10\nitm_b,Iron Charm,ten\nTotal,,13', { header: 2, ignoreLast: 1 })
  expect(await errorLines(page)).toEqual(['Table Items, row 4, column 3 (weight): "ten" is not a number. Remove thousands separators, currency symbols and %, for example 4900.'])
})

test('control: a refresh with good data still applies', async ({ page }) => {
  await refreshWith(page, 'item_key,display_name,weight\nitm_a,Ember Blade,25\nitm_b,Iron Charm,3')
  await expect(refreshDialog(page).locator('ul.import__error')).toHaveCount(0)
  await expect(refreshDialog(page).getByText('1 value will update automatically')).toBeVisible()
  await refreshDialog(page).getByRole('button', { name: 'Commit refresh' }).click()
  await expect(refreshDialog(page)).toBeHidden()
  const nodes = await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => GS } } }).__loop.graph.getState().nodes.map((n) => n.data))
  expect(nodes.some((d) => d?.label === 'Items · Ember Blade · weight' && d?.value === 25)).toBe(true)
})
})

test.describe('two tables, GachaPoolEntries → Items', () => {
  test.beforeEach(async ({ page }) => {
    await importItemsAndPoolTables(page)
  })

  test('an unknown foreign key after a row refused for its key names its own line', async ({ page }) => {
    await menuButton(page).click()
    await page.getByRole('menuitem', { name: 'Refresh or manage imported tables…' }).click()
    await expect(manageDialog(page)).toBeVisible()
    await manageDialog(page).locator('.import__binding').nth(1).getByRole('button', { name: 'Refresh…' }).click()
    await expect(refreshDialog(page)).toBeVisible()
    // line 3 repeats line 2's key (refused), line 4 points at an item that does not exist
    await refreshDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('pool_entry_key,item_key,weight\nppe_a,itm_a,5\nppe_a,itm_b,5\nppe_c,itm_NOPE,5')
    await refreshDialog(page).getByRole('button', { name: 'Next' }).click()
    expect(await errorLines(page)).toEqual([
      'Table GachaPoolEntries, row 3, column 1 (pool_entry_key): Key "ppe_a" is already used by another row. Give every row a unique Key.',
      'Table GachaPoolEntries, row 4, column 2 (item_key): No row in the target table has the key "itm_NOPE".',
    ])
  })
})
