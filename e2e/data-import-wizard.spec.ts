import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/data-import.md §DI16 Phase 1B — the CSV/TSV import wizard through the
// real UI: paste → configure roles → validate → place → commit as one
// atomic history entry, a blocking validation error keeps Commit
// unreachable, and Undo/Redo round-trip the whole batch.

type GS = {
  nodes: { id: string; data?: { label?: string; value?: number } }[]
  past: unknown[]
}

const gs = (page: Page): Promise<GS> =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => GS } } }).__loop.graph.getState()
    return { nodes: g.nodes.map((n) => ({ id: n.id, data: { label: n.data?.label, value: n.data?.value } })), past: g.past }
  })

const dataImportTables = (page: Page): Promise<unknown[]> =>
  page.evaluate(
    () => (window as unknown as { __loop: { dataImport: { getState: () => { tables: unknown[] } } } }).__loop.dataImport.getState().tables,
  )

const importButton = (page: Page) => page.getByRole('button', { name: 'Spreadsheet data ▾' })
const dialog = (page: Page) => page.locator('.mcdlg--dataimport')

async function openWizard(page: Page): Promise<void> {
  await importButton(page).click()
  await expect(dialog(page)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('paste a table, assign roles, validate, place, and commit as one atomic import', async ({ page }) => {
  await openWizard(page)

  await dialog(page).getByPlaceholder('Table name').fill('Items')
  await dialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,weight\nitm_a,10\nitm_b,20')

  const headerRow = dialog(page).locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('number')

  const pastBefore = (await gs(page)).past.length

  await dialog(page).getByRole('button', { name: 'Next' }).click() // -> placement (validation passed)
  await expect(dialog(page).getByText('Place on the canvas, no frames')).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Next' }).click() // -> review
  await expect(dialog(page).getByText(/Ready to import/)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Import' }).click() // commit

  await expect(dialog(page)).toBeHidden()

  const after = await gs(page)
  expect(after.nodes.map((n) => n.data?.label).sort()).toEqual(['Items · itm_a · weight', 'Items · itm_b · weight'])
  expect(after.nodes.map((n) => n.data?.value).sort()).toEqual([10, 20])
  expect(after.past.length).toBe(pastBefore + 1) // ONE atomic history entry

  const tables = await dataImportTables(page)
  expect(tables).toHaveLength(1)
})

test('a duplicate key blocks Commit until fixed', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByPlaceholder('Table name').fill('Items')
  await dialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,weight\nitm_a,10\nitm_a,20')

  const headerRow = dialog(page).locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('number')

  await dialog(page).getByRole('button', { name: 'Next' }).click()
  // validation failed -> stays on the issues step, never reaches placement/commit
  await expect(dialog(page).getByText(/problem/)).toBeVisible()
  await expect(dialog(page).getByRole('button', { name: 'Import' })).toHaveCount(0)

  const before = await gs(page)
  expect(before.nodes).toHaveLength(0)
})

test('Undo removes the whole imported batch in one step; Redo restores it', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByPlaceholder('Table name').fill('Items')
  await dialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,weight\nitm_a,10')
  const headerRow = dialog(page).locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('number')
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()

  expect((await gs(page)).nodes).toHaveLength(1)
  expect(await dataImportTables(page)).toHaveLength(1)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(0)
  expect(await dataImportTables(page)).toHaveLength(0)

  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(async () => (await gs(page)).nodes.length).toBe(1)
  expect(await dataImportTables(page)).toHaveLength(1)
})
