import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// docs/data-import.md §DI11/§DI16 Phase 2 — the refresh workflow through the
// real UI: manage bindings, rename cascade, the row-lifecycle refresh
// (added/missing/changed) as one atomic commit, locally-deleted cells,
// Inspector hand-edit detach, and the change-proposal CSV export's
// duplicate-triple refusal.

type GS = {
  nodes: { id: string; data?: { label?: string; value?: number; labelAutoComposed?: boolean; sourceKey?: string; sourceColumnId?: string } }[]
  past: unknown[]
}

const gs = (page: Page): Promise<GS> =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => GS } } }).__loop.graph.getState()
    return {
      nodes: g.nodes.map((n) => ({
        id: n.id,
        data: {
          label: n.data?.label,
          value: n.data?.value,
          labelAutoComposed: n.data?.labelAutoComposed,
          sourceKey: n.data?.sourceKey,
          sourceColumnId: n.data?.sourceColumnId,
        },
      })),
      past: g.past,
    }
  })

type ImportRowSnapshot = { sourceKey: string; number: Record<string, number>; label: Record<string, string>; foreignKey: Record<string, string> }
type ImportTableSnapshot = { sourceTableId: string; label: string; columns: { sourceColumnId: string; header: string }[]; rows: ImportRowSnapshot[] }

const dataImportTables = (page: Page): Promise<ImportTableSnapshot[]> =>
  page.evaluate(
    () => (window as unknown as { __loop: { dataImport: { getState: () => { tables: ImportTableSnapshot[] } } } }).__loop.dataImport.getState().tables,
  )

const menuButton = (page: Page) => page.getByRole('button', { name: 'Data ▾' })
const manageDialog = (page: Page) => page.getByRole('dialog', { name: 'Manage spreadsheet bindings' })
const refreshDialog = (page: Page) => page.getByRole('dialog', { name: /^Refresh "/ })
const wizardDialog = (page: Page) => page.getByRole('dialog', { name: 'Import spreadsheet data' })

async function openManage(page: Page): Promise<void> {
  await menuButton(page).click()
  await page.getByRole('menuitem', { name: 'Refresh or manage imported tables…' }).click()
  await expect(manageDialog(page)).toBeVisible()
}

/** Import a fresh `Items` table (key/label/number) via the Phase 1B wizard,
 *  creating two Parameters (`itm_a` = Ember Blade/10, `itm_b` = Iron
 *  Charm/3) bound to it. */
async function importItemsTable(page: Page): Promise<void> {
  await menuButton(page).click()
  await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
  await expect(wizardDialog(page)).toBeVisible()

  await wizardDialog(page).getByLabel('Table name').fill('Items')
  await wizardDialog(page)
    .getByPlaceholder('Paste CSV or TSV text here')
    .fill('item_key,display_name,weight\nitm_a,Ember Blade,10\nitm_b,Iron Charm,3')

  const headerRow = wizardDialog(page).locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('label')
  await headerRow.locator('select').nth(2).selectOption('number')

  await wizardDialog(page).getByRole('button', { name: 'Next' }).click() // -> placement
  await wizardDialog(page).getByRole('button', { name: 'Next' }).click() // -> review
  await wizardDialog(page).getByRole('button', { name: 'Import' }).click() // commit
  await expect(wizardDialog(page)).toBeHidden()
}

/** Import `Items` (key/label/number) AND `GachaPoolEntries` (key/foreignKey
 *  -> Items/number) in one atomic batch, mirroring the existing Phase 1B
 *  "2-table FK import" e2e test's own UI flow. `ppe_a` points at `itm_a`. */
async function importItemsAndPoolTables(page: Page): Promise<void> {
  await menuButton(page).click()
  await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
  await expect(wizardDialog(page)).toBeVisible()

  await wizardDialog(page).getByLabel('Table name').fill('Items')
  await wizardDialog(page)
    .getByPlaceholder('Paste CSV or TSV text here')
    .fill('item_key,display_name,weight\nitm_a,Ember Blade,10\nitm_b,Iron Charm,3')
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

  await wizardDialog(page).getByRole('button', { name: 'Next' }).click() // -> placement
  await wizardDialog(page).getByRole('button', { name: 'Next' }).click() // -> review
  await wizardDialog(page).getByRole('button', { name: 'Import' }).click() // commit
  await expect(wizardDialog(page)).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('manage bindings lists a bound table with its row count, a refresh trigger, and CSV export', async ({ page }) => {
  await importItemsTable(page)
  await openManage(page)

  await expect(manageDialog(page).getByLabel('Table name')).toHaveValue('Items')
  await expect(manageDialog(page).getByText('2 rows')).toBeVisible()
  await expect(manageDialog(page).getByRole('button', { name: 'Refresh…' })).toBeVisible()
  await expect(manageDialog(page).getByRole('button', { name: 'Export change-proposal CSV' })).toBeEnabled()
})

test('renaming a table recomposes every auto-composed Parameter as ONE atomic Undo entry, and never touches an already hand-detached one', async ({
  page,
}) => {
  await importItemsTable(page)

  // hand-detach one Parameter's label before the rename (§DI-D19 item 1's
  // own detach mechanism, exercised through Inspector directly).
  const before = await gs(page)
  const emberId = before.nodes.find((n) => n.data?.label === 'Items · Ember Blade · weight')!.id
  await page.locator(`.react-flow__node[data-id="${emberId}"]`).click()
  await page.getByLabel('Label').fill('My Custom Blade')
  await expect(page.getByLabel('Label')).toHaveValue('My Custom Blade')

  const pastBefore = (await gs(page)).past.length
  await openManage(page)
  await manageDialog(page).getByLabel('Table name').fill('Loot Items')
  await manageDialog(page).getByLabel('Table name').press('Tab')

  const after = await gs(page)
  expect(after.past.length).toBe(pastBefore + 1) // ONE entry for the whole cascade
  const byLabel = (l: string) => after.nodes.find((n) => n.data?.label === l)
  expect(byLabel('Loot Items · Iron Charm · weight')).toBeTruthy() // recomposed
  expect(byLabel('My Custom Blade')).toBeTruthy() // hand-detached -- untouched by the rename
  expect((await dataImportTables(page))[0].label).toBe('Loot Items')
})

test('refresh: an added row, a missing row, and an auto-applied value change commit as ONE atomic entry; Undo reverts nodes and the table together', async ({
  page,
}) => {
  await importItemsTable(page)
  const nodesBefore = (await gs(page)).nodes.length
  const pastBefore = (await gs(page)).past.length

  await openManage(page)
  await manageDialog(page).getByRole('button', { name: 'Refresh…' }).click()
  await expect(refreshDialog(page)).toBeVisible()

  // itm_a's weight changes (source-only, auto-applies), itm_b is missing,
  // itm_c is a brand-new row -- same header, no column-events step.
  await refreshDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,display_name,weight\nitm_a,Ember Blade,25\nitm_c,Steel Ring,7')
  await refreshDialog(page).getByRole('button', { name: 'Next' }).click()

  await expect(refreshDialog(page).getByText('1 row will be added')).toBeVisible()
  await expect(refreshDialog(page).getByText('1 row is missing from the new data')).toBeVisible()
  await expect(refreshDialog(page).getByText('1 value will update automatically')).toBeVisible()

  await refreshDialog(page).locator('li', { hasText: 'itm_c' }).getByRole('checkbox').check()
  await refreshDialog(page).locator('li', { hasText: 'itm_b' }).locator('select').selectOption('delete')
  await refreshDialog(page).getByRole('button', { name: 'Commit refresh' }).click()
  await expect(refreshDialog(page)).toBeHidden()

  const after = await gs(page)
  expect(after.nodes).toHaveLength(nodesBefore) // itm_b's node deleted, itm_c's node created -- net zero
  expect(after.nodes.some((n) => n.data?.label === 'Items · Steel Ring · weight' && n.data?.value === 7)).toBe(true)
  expect(after.nodes.some((n) => n.data?.label === 'Items · Ember Blade · weight' && n.data?.value === 25)).toBe(true)
  expect(after.nodes.some((n) => n.data?.sourceKey === 'itm_b')).toBe(false)
  expect(after.past.length).toBe(pastBefore + 1) // ONE entry for the whole refresh

  const tableAfter = (await dataImportTables(page))[0]
  expect(tableAfter.rows).toHaveLength(2) // itm_a + itm_c

  await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { undo: () => void } } } }).__loop.graph.getState().undo())
  const reverted = await gs(page)
  expect(reverted.nodes).toHaveLength(nodesBefore)
  expect(reverted.nodes.some((n) => n.data?.label === 'Items · Ember Blade · weight' && n.data?.value === 10)).toBe(true)
  expect((await dataImportTables(page))[0].rows).toHaveLength(2) // itm_a + itm_b again

  await page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { redo: () => void } } } }).__loop.graph.getState().redo())
  const redone = await gs(page)
  expect(redone.nodes).toHaveLength(nodesBefore)
  expect(redone.nodes.some((n) => n.data?.label === 'Items · Ember Blade · weight' && n.data?.value === 25)).toBe(true)
  expect(redone.nodes.some((n) => n.data?.label === 'Items · Steel Ring · weight' && n.data?.value === 7)).toBe(true)
  expect((await dataImportTables(page))[0].rows).toHaveLength(2) // itm_a + itm_c again
})

test('a locally-deleted cell offers recreate/discard; discard stays silent on the next refresh', async ({ page }) => {
  await importItemsTable(page)
  const emberId = (await gs(page)).nodes.find((n) => n.data?.label === 'Items · Ember Blade · weight')!.id

  // delete the Parameter directly on the canvas -- OUTSIDE this feature's own
  // unlink/delete flow -- while its source row and stored base survive.
  await page.locator(`.react-flow__node[data-id="${emberId}"]`).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  expect((await gs(page)).nodes.some((n) => n.id === emberId)).toBe(false)

  await openManage(page)
  await manageDialog(page).getByRole('button', { name: 'Refresh…' }).click()
  await refreshDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,display_name,weight\nitm_a,Ember Blade,25\nitm_b,Iron Charm,3')
  await refreshDialog(page).getByRole('button', { name: 'Next' }).click()

  await expect(refreshDialog(page).getByText(/Discard/)).toBeVisible()
  await refreshDialog(page).getByLabel(/Discard/).check()
  await refreshDialog(page).getByRole('button', { name: 'Commit refresh' }).click()
  await expect(refreshDialog(page)).toBeHidden()

  expect((await gs(page)).nodes.some((n) => n.data?.label?.includes('Ember Blade'))).toBe(false)

  // second refresh, same incoming value -- must stay silent, never re-ask.
  // (the manage dialog itself is still open from before -- committing a
  // refresh only closes the refresh wizard, not its parent.)
  await manageDialog(page).getByRole('button', { name: 'Refresh…' }).click()
  await refreshDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,display_name,weight\nitm_a,Ember Blade,25\nitm_b,Iron Charm,3')
  await refreshDialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(refreshDialog(page).getByText(/Discard/)).toHaveCount(0)
})

test('the change-proposal CSV export refuses outright when a duplicate generating triple exists', async ({ page }) => {
  await importItemsTable(page)
  const table = (await dataImportTables(page))[0] as { sourceTableId: string }
  const ember = (await gs(page)).nodes.find((n) => n.data?.label === 'Items · Ember Blade · weight')!

  // manufacture a hand-corrupted document: a second Parameter sharing the
  // exact same generating triple (§DI-D15) -- not reachable through the
  // ordinary UI, so injected directly via the dev store bridge.
  await page.evaluate(
    ({ sourceTableId, ember }) => {
      const bridge = (window as unknown as { __loop: { graph: { getState: () => { nodes: unknown[] }; setState: (p: unknown) => void } } }).__loop
      const g = bridge.graph.getState()
      const dupe = {
        id: 'e2e-dupe-parameter',
        type: 'parameter',
        position: { x: 400, y: 400 },
        data: { kind: 'parameter', label: 'Duplicate', value: 999, sourceTableId, sourceKey: ember.data!.sourceKey, sourceColumnId: ember.data!.sourceColumnId, labelAutoComposed: false },
      }
      bridge.graph.setState({ nodes: [...(g.nodes as unknown[]), dupe] })
    },
    { sourceTableId: table.sourceTableId, ember },
  )

  await openManage(page)
  await manageDialog(page).getByRole('button', { name: 'Export change-proposal CSV' }).click()
  await expect(manageDialog(page).getByText(/Export blocked/)).toBeVisible()
})

test('Escape closes only the topmost dialog: the refresh wizard first, then the manage dialog on a second press', async ({ page }) => {
  await importItemsTable(page)
  await openManage(page)
  await manageDialog(page).getByRole('button', { name: 'Refresh…' }).click()
  await expect(refreshDialog(page)).toBeVisible()

  // only ONE modal is ever active at a time (the manage dialog's own
  // markup unmounts while the wizard is open) -- a single Escape must
  // close just the wizard, never both dialogs at once.
  await page.keyboard.press('Escape')
  await expect(refreshDialog(page)).toBeHidden()
  await expect(manageDialog(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(manageDialog(page)).toBeHidden()
})

test('column events: an explicit rename re-links a renamed header and a new column maps as a fresh number field; an unresolved event blocks continuing', async ({
  page,
}) => {
  await importItemsTable(page)
  await openManage(page)
  await manageDialog(page).getByRole('button', { name: 'Refresh…' }).click()

  // "weight" is renamed to "mass" (a missing-header event -- §DI9: never
  // inferred) alongside a genuinely new "rarity_score" column.
  await refreshDialog(page)
    .getByPlaceholder('Paste CSV or TSV text here')
    .fill('item_key,display_name,mass,rarity_score\nitm_a,Ember Blade,99,5\nitm_b,Iron Charm,3,2')
  await refreshDialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(refreshDialog(page).getByText(/is no longer in the new data/)).toBeVisible()

  // continuing with the rename left unresolved is refused, not silently
  // skipped -- validation is never bypassed just because the UI reached
  // the column-events step.
  await refreshDialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(refreshDialog(page).getByText('This column change needs a choice before continuing.')).toBeVisible()

  await refreshDialog(page).locator('li', { hasText: 'weight' }).locator('select').selectOption({ label: 'mass' })
  await refreshDialog(page).getByRole('button', { name: 'Map more columns…' }).click()
  // scoped to the exact "not mapped" phrasing -- the RENAME select's own
  // <option> list (all incoming headers) also contains the literal text
  // "rarity_score", so a bare `hasText: 'rarity_score'` matches two `<li>`s.
  await refreshDialog(page).locator('li', { hasText: 'rarity_score" is not mapped' }).locator('select').selectOption('number')

  await refreshDialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(refreshDialog(page).getByText('2 new column values will be added')).toBeVisible()
  await refreshDialog(page).getByRole('button', { name: 'Commit refresh' }).click()
  await expect(refreshDialog(page)).toBeHidden()

  const after = await gs(page)
  expect(after.nodes.some((n) => n.data?.label?.includes('Ember Blade') && n.data?.value === 99)).toBe(true) // the renamed column's value still reaches the SAME Parameter
  expect(after.nodes.some((n) => n.data?.value === 5)).toBe(true) // the new rarity_score column materialized
  const table = (await dataImportTables(page))[0]
  expect(table.columns.some((c) => c.header === 'mass')).toBe(true) // the stored header updated
})

test('a missing row still referenced by another table blocks unlink/delete, naming the blocking table, and survives the commit untouched', async ({
  page,
}) => {
  await importItemsAndPoolTables(page)
  await openManage(page)
  const itemsRow = manageDialog(page).locator('.import__binding').nth(0)
  await itemsRow.getByRole('button', { name: 'Refresh…' }).click()

  // itm_a drops from the new Items paste -- but GachaPoolEntries' ppe_a
  // still has an item_key FK cell pointing at it (§DI-D21).
  await refreshDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,display_name,weight\nitm_b,Iron Charm,3')
  await refreshDialog(page).getByRole('button', { name: 'Next' }).click()

  await expect(refreshDialog(page).getByText(/Still referenced by GachaPoolEntries/)).toBeVisible()
  await expect(refreshDialog(page).locator('li', { hasText: 'itm_a' }).locator('select')).toHaveCount(0) // no destructive choice offered at all

  await refreshDialog(page).getByRole('button', { name: 'Commit refresh' }).click()
  await expect(refreshDialog(page)).toBeHidden()

  // itm_a's row and Parameter both survive untouched -- never silently dropped.
  expect((await gs(page)).nodes.some((n) => n.data?.label === 'Items · Ember Blade · weight')).toBe(true)
  const items = (await dataImportTables(page)).find((t) => t.label === 'Items')!
  expect(items.rows.some((r) => r.sourceKey === 'itm_a')).toBe(true)
})

test('an FK re-point can be accepted or rejected; a rejected re-point reappears unresolved on the next refresh', async ({ page }) => {
  await importItemsAndPoolTables(page)
  await openManage(page)
  const poolRow = manageDialog(page).locator('.import__binding').nth(1)

  const refreshWithRepoint = async () => {
    await poolRow.getByRole('button', { name: 'Refresh…' }).click()
    await refreshDialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('pool_entry_key,item_key,weight\nppe_a,itm_b,5')
    await refreshDialog(page).getByRole('button', { name: 'Next' }).click()
  }

  await refreshWithRepoint()
  await expect(refreshDialog(page).getByText('1 foreign key changed')).toBeVisible()
  await refreshDialog(page).getByLabel(/Keep the old reference/).check() // reject
  await refreshDialog(page).getByRole('button', { name: 'Commit refresh' }).click()
  await expect(refreshDialog(page)).toBeHidden()

  const poolFkFor = async (sourceKey: string) => {
    const pool = (await dataImportTables(page)).find((t) => t.label === 'GachaPoolEntries')!
    const row = pool.rows.find((r) => r.sourceKey === sourceKey)!
    return Object.values(row.foreignKey)[0]
  }
  expect(await poolFkFor('ppe_a')).toBe('itm_a') // rejected -- base never moves, unlike a number conflict's "keep mine"

  // the SAME disagreement resurfaces on the next refresh -- rejecting is
  // "not yet decided," never "acknowledged and different".
  await refreshWithRepoint()
  await expect(refreshDialog(page).getByText('1 foreign key changed')).toBeVisible()
  await refreshDialog(page).getByLabel(/Accept the new reference/).check()
  await refreshDialog(page).getByRole('button', { name: 'Commit refresh' }).click()
  await expect(refreshDialog(page)).toBeHidden()

  expect(await poolFkFor('ppe_a')).toBe('itm_b') // accepted -- base moves
})
