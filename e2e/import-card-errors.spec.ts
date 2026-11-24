import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// #615 item 5 (A) — the import wizard's table cards were keyed by position and
// their recorded problems matched by position. Removing a card before the
// next check moved the problems: the card that had one showed none, and a
// clean card showed the removed card's problem, written with its own name
// ("Table Beta, row 3 … Key "itm_a" is already used"), its jump leading into
// it. A recorded problem now stays with its table: removing a table removes
// its problems, and the others stay on their cards. Next still checks the
// current tables, and what is checked and imported is unchanged.

const wizard = (page: Page) => page.getByRole('dialog', { name: 'Import spreadsheet data' })
const cards = (page: Page) => wizard(page).locator('.import__table')
const DUP = 'item_key,weight\nitm_a,10\nitm_a,20'
const CLEAN = 'pool_key,weight\np_1,5\np_2,6'
const OTHER_CLEAN = 'q_key,weight\nq_1,5\nq_2,6'

async function twoCards(page: Page, first: [string, string], second: [string, string]) {
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
  await wizard(page).getByRole('button', { name: 'Add another table' }).click()
  for (const [i, [name, text]] of [first, second].entries()) {
    const card = cards(page).nth(i)
    await card.getByLabel('Table name').fill(name)
    await card.getByPlaceholder('Paste CSV or TSV text here').fill(text)
    const sel = card.locator('.import__preview thead tr').first().locator('select')
    await sel.nth(0).selectOption('key')
    await sel.nth(1).selectOption('number')
  }
  await wizard(page).getByRole('button', { name: 'Next' }).click()
}
const problemsOf = (page: Page, i: number) => cards(page).nth(i).locator('.import__issues li').allInnerTexts()
const onPlacement = (page: Page) => wizard(page).locator('.import__placement')

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test.describe('a recorded problem stays with its table when another table is removed (#615 item 5)', () => {
  test('the problem in card 2 stays on it when card 1 is removed; Next checks again and finds it', async ({ page }) => {
    await twoCards(page, ['Alpha', CLEAN], ['Beta (dup)', DUP])
    expect(await problemsOf(page, 1)).toHaveLength(1)
    await cards(page).nth(0).getByRole('button', { name: 'Remove table' }).click()
    await expect(cards(page)).toHaveCount(1)
    const left = await problemsOf(page, 0)
    expect.soft(left, 'Beta (dup) still shows its problem (greyed until the next check)').toHaveLength(1)
    expect(left.join(' ')).toContain('Beta (dup)')
    await wizard(page).getByRole('button', { name: 'Next' }).click()
    await expect.poll(() => problemsOf(page, 0)).toHaveLength(1)
    await expect(onPlacement(page)).toHaveCount(0)
  })

  test('the problem of a removed card goes with it: the clean card left shows none and no line names it; Next moves on', async ({ page }) => {
    await twoCards(page, ['Alpha (dup)', DUP], ['Beta', CLEAN])
    expect(await problemsOf(page, 0)).toHaveLength(1)
    await cards(page).nth(0).getByRole('button', { name: 'Remove table' }).click()
    await expect(cards(page)).toHaveCount(1)
    expect.soft(await problemsOf(page, 0), 'Beta shows no problem').toEqual([])
    await expect.soft(wizard(page).getByText(/Table .{0,3}Beta.{0,3}, row/)).toHaveCount(0)
    await wizard(page).getByRole('button', { name: 'Next' }).click()
    await expect(onPlacement(page)).toBeVisible()
  })

  test('control: removing the card AFTER the one with a problem moves nothing; Next finds it again', async ({ page }) => {
    await twoCards(page, ['Alpha (dup)', DUP], ['Beta', OTHER_CLEAN])
    await cards(page).nth(1).getByRole('button', { name: 'Remove table' }).click()
    await expect(cards(page)).toHaveCount(1)
    const left = await problemsOf(page, 0)
    expect(left).toHaveLength(1)
    expect(left.join(' ')).toContain('Alpha (dup)')
    await wizard(page).getByRole('button', { name: 'Next' }).click()
    await expect.poll(() => problemsOf(page, 0)).toHaveLength(1)
    await expect(onPlacement(page)).toHaveCount(0)
  })
})
