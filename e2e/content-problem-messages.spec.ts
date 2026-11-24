import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { openFileSubmenu } from './support/workbenchMenus'

// #619 follow-up — the revision export and the data import refuse a diagram
// whose content cannot be read. Both said a general sentence: the export
// "…such as a number that is not finite…" even for a Register that cannot be
// read, the import "The resulting graph is invalid — please contact support."
// for everything, although the export already named a node of an unknown
// kind. Each now names the node (its label, else its id) and what is wrong
// with it, from the same cause, and ends with its own outcome; the import
// says the problem is in the OPEN diagram, not in the table being imported.
// A bad node is put in through the store, as a broken file or a defect would
// leave it; everything else goes through the real UI.

type L = { __loop: Record<string, any> }

const BAD = {
  S1: (nodes: any[]) => nodes.map((n) => (n.data.kind === 'pool' ? { ...n, data: { ...n.data, initial: Infinity } } : n)),
  S2: (nodes: any[]) => nodes.map((n) => (n.data.kind === 'register' ? { ...n, data: { ...n.data, expr: 42 } } : n)),
  S3: (nodes: any[]) => [...nodes, { id: 'w', type: 'widget', position: { x: 40, y: 260 }, data: { kind: 'widget', label: 'Wonder' } }],
  none: (nodes: any[]) => nodes,
} as const

/** a Pool "Tank" and a Register "Ratio", then the bad content */
async function scene(page: Page, bad: keyof typeof BAD) {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => {
    const g = (window as unknown as L).__loop.graph.getState()
    g.newGraph()
    g.addNodeAt('pool', { x: 0, y: 0 })
    g.addNodeAt('register', { x: 300, y: 0 })
  })
  const nodes = await page.evaluate(() =>
    (window as unknown as L).__loop.graph
      .getState()
      .nodes.map((n: any) => ({ ...n, data: { ...n.data, label: n.data.kind === 'pool' ? 'Tank' : 'Ratio' } })),
  )
  await page.evaluate((n) => (window as unknown as L).__loop.graph.setState({ nodes: n }), BAD[bad](nodes))
}
const nodeCount = (page: Page) => page.evaluate(() => (window as unknown as L).__loop.graph.getState().nodes.length)

/** File ▸ Export ▸ Project revision… ▸ Export revision: the alert, and the file if one came */
async function exportRevision(page: Page) {
  const alerts: string[] = []
  page.on('dialog', async (d) => {
    alerts.push(d.message())
    await d.dismiss()
  })
  const download = page.waitForEvent('download', { timeout: 3000 }).catch(() => null)
  await openFileSubmenu(page, 'export')
  await page.locator('.toolbar__actions .menu__pop .menu__item').filter({ has: page.locator('.menu__name', { hasText: /Project revision/ }) }).click()
  await page.locator('.mcdlg--confirm').getByRole('button', { name: 'Export revision' }).click()
  const file = await download
  return { alert: alerts.join(' | '), file: file?.suggestedFilename() ?? null }
}

const wizard = (page: Page) => page.getByRole('dialog', { name: 'Import spreadsheet data' })
/** Data ▸ Import spreadsheet values as Parameters…, one valid table, Import */
async function importTable(page: Page) {
  await page.getByRole('button', { name: 'Data' }).click()
  await page.getByRole('menuitem', { name: 'Import spreadsheet values as Parameters…' }).click()
  await wizard(page).getByLabel('Table name').fill('Items')
  await wizard(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,display_name,weight\nitm_a,Ember Blade,10')
  const sel = wizard(page).locator('.import__preview thead tr').first().locator('select')
  await sel.nth(0).selectOption('key')
  await sel.nth(1).selectOption('label')
  await sel.nth(2).selectOption('number')
  await wizard(page).getByRole('button', { name: 'Next' }).click()
  await wizard(page).getByRole('button', { name: 'Next' }).click()
  await wizard(page).getByRole('button', { name: 'Import' }).click()
}
const importError = (page: Page) => wizard(page).locator('.import__error')

test.describe('the revision export names what cannot be read (#619 follow-up)', () => {
  test('S1 — a Pool whose starting amount is not finite: the node and the field, nothing exported', async ({ page }) => {
    await scene(page, 'S1')
    const r = await exportRevision(page)
    expect(r.file).toBeNull()
    expect(r.alert).toContain('Tank')
    expect(r.alert).toContain('starting amount')
    expect(r.alert).toContain('not a finite number')
    expect(r.alert).toContain('Nothing was exported.')
    expect(r.alert).not.toContain('such as')
  })

  test('S2 — a Register that cannot be read: the node and that it cannot be read, not "a number that is not finite"', async ({ page }) => {
    await scene(page, 'S2')
    const r = await exportRevision(page)
    expect(r.file).toBeNull()
    expect(r.alert).toContain('Ratio')
    expect(r.alert).toContain('Register')
    expect(r.alert).toContain('cannot be read')
    expect(r.alert).not.toContain('finite')
    expect(r.alert).toContain('Nothing was exported.')
  })

  test('S3 (control) — a node of an unknown kind is still named, nothing exported', async ({ page }) => {
    await scene(page, 'S3')
    const r = await exportRevision(page)
    expect(r.file).toBeNull()
    expect(r.alert).toContain('Wonder')
    expect(r.alert).toContain('widget')
    expect(r.alert).toContain('Nothing was exported.')
  })

  test('control — a readable diagram exports a file and says nothing', async ({ page }) => {
    await scene(page, 'none')
    const r = await exportRevision(page)
    expect(r.alert).toBe('')
    expect(r.file).toBe('loop-studio-revision.json')
  })
})

test.describe('the data import says the open diagram cannot be read, and names what (#619 follow-up)', () => {
  for (const [bad, names] of [
    ['S1', ['Tank', 'starting amount', 'not a finite number']],
    ['S2', ['Ratio', 'Register', 'cannot be read']],
    ['S3', ['Wonder', 'widget']],
  ] as const) {
    test(`${bad} — the node and its problem, in the open diagram, nothing imported`, async ({ page }) => {
      await scene(page, bad)
      const before = await nodeCount(page)
      await importTable(page)
      await expect(importError(page)).toBeVisible()
      const text = await importError(page).innerText()
      for (const n of names) expect(text).toContain(n)
      expect(text).toContain('open diagram')
      expect(text).toContain('Nothing was imported.')
      expect(text).not.toContain('contact support')
      await expect(wizard(page)).toBeVisible()
      expect(await nodeCount(page)).toBe(before)
    })
  }

  test('control — a readable diagram imports the table: one Parameter added, no error', async ({ page }) => {
    await scene(page, 'none')
    const before = await nodeCount(page)
    await importTable(page)
    await expect(wizard(page)).toBeHidden()
    expect(await nodeCount(page)).toBe(before + 1)
  })
})
