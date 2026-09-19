import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, snap, test } from './support/loop'

// docs/data-import.md §DI17 — the in-tool guide for the CSV/TSV import
// wizard: the collapsible quick start with its one-click example, the shared
// role help (accessible names on the role selects), the per-table count line,
// inline validation errors, the review breakdown whose numbers are the same
// computation the commit uses, and the post-commit view (first Parameter
// selected, the created area framed inside the USABLE canvas, a one-shot
// hint).

type Node = { id: string; type?: string; data?: { label?: string; value?: number } }

const dialog = (page: Page) => page.locator('.mcdlg--dataimport')
const dataButton = (page: Page) => page.getByRole('button', { name: 'Data ▾' })

const graph = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: Node[]; selectedNodeId: string | null } } } }).__loop.graph.getState()
    return { nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, data: { label: n.data?.label, value: n.data?.value } })), selectedNodeId: g.selectedNodeId }
  })
const viewport = (page: Page) =>
  page.evaluate(() => (window as unknown as { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number } } } }).__loop.rf.getViewport())

async function openWizard(page: Page): Promise<void> {
  await dataButton(page).click()
  await page.getByRole('menuitem').first().click()
  await expect(dialog(page)).toBeVisible()
}

/** The canvas area a user can actually see nodes in: the React Flow pane
 *  minus the zoom Controls column, the minimap's row/column bands (when it
 *  is on screen) and the top-center hint slot (when a hint is showing). The
 *  right column (Inspector) is outside the pane already. */
async function usableCanvasArea(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  return page.evaluate(() => {
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    const controls = document.querySelector('.react-flow__controls')?.getBoundingClientRect()
    const mm = document.querySelector('.react-flow__minimap')?.getBoundingClientRect()
    const hint = document.querySelector('.react-flow__panel.top.center')?.getBoundingClientRect()
    let { left, top, right, bottom } = pane
    if (controls && controls.width > 0) left = Math.max(left, controls.right)
    if (mm && mm.width > 0) {
      right = Math.min(right, mm.left)
      bottom = Math.min(bottom, mm.top)
    }
    if (hint && hint.height > 0) top = Math.max(top, hint.bottom)
    return { left, top, right, bottom }
  })
}
async function nodeBox(page: Page, id: string) {
  return page.evaluate((nid) => {
    const r = document.querySelector(`.react-flow__node[data-id="${nid}"]`)!.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }, id)
}

const EXAMPLE_CSV = 'item_id,item_name,price,drop_rate\nsword,Steel Sword,4900,10\npotion,Health Potion,300,25'
const BAD_CSV = 'item_id,item_name,price,drop_rate\nsword,Steel Sword,"4,900",10\npotion,Health Potion,,25\nsword,Iron Sword,120,5'

async function pasteWithRoles(page: Page, name: string, csv: string, roles: string[]): Promise<void> {
  await dialog(page).locator('.import__nameField input').last().fill(name)
  await dialog(page).locator('textarea.import__paste').last().fill(csv)
  const head = dialog(page).locator('.import__table').last().locator('.import__preview thead tr').first()
  for (let i = 0; i < roles.length; i++) await head.locator('th').nth(i).locator('select').first().selectOption(roles[i])
}

/** The collapsed quick start must REALLY not render -- not just flip
 *  `aria-expanded` (a `display: flex` on the body once beat the UA's
 *  `[hidden]`): the body is hidden and none of its controls are visible. */
async function expectQuickStart(page: Page, expanded: boolean): Promise<void> {
  const qs = dialog(page).locator('.import__quickstart')
  await expect(qs.locator('.import__quickstartToggle')).toHaveAttribute('aria-expanded', expanded ? 'true' : 'false')
  const body = qs.locator('.import__quickstartBody')
  const controls = [
    qs.getByRole('button', { name: 'Use this example' }),
    qs.getByRole('button', { name: 'Download sample CSV' }),
    qs.getByRole('link', { name: /Full guide/ }),
  ]
  if (expanded) {
    await expect(body).toBeVisible()
    await expect(body).not.toHaveAttribute('hidden', /.*/)
    for (const c of controls) await expect(c).toBeVisible()
  } else {
    await expect(body).toBeHidden()
    await expect(body).toHaveAttribute('hidden', /.*/)
    expect(await body.evaluate((el) => getComputedStyle(el).display)).toBe('none')
    for (const c of controls) await expect(c).toBeHidden()
  }
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('the quick start is visible before any input; "Use this example" fills a table whose review counts equal the created nodes; the first Parameter is selected and the batch is framed inside the usable canvas', async ({ page }) => {
  await openWizard(page)
  const qs = dialog(page).locator('.import__quickstart')
  await expect(qs).toBeVisible()
  await expectQuickStart(page, true)
  await expect(qs.getByText(/2 rows × 2 Number columns = 4 Parameters/)).toBeVisible()

  await qs.getByRole('button', { name: 'Use this example' }).click()
  await expect(dialog(page).locator('.import__nameField input').first()).toHaveValue('Items')
  await expect(dialog(page).locator('.import__status').first()).toContainText(/item_id/)
  await expect(dialog(page).locator('.import__status').first()).toContainText(/4 Parameters/)

  const before = await graph(page)
  await dialog(page).getByRole('button', { name: 'Next' }).click() // placement
  await expect(dialog(page).getByText(/4 Parameters on the canvas/)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Next' }).click() // review
  const row = dialog(page).locator('.import__reviewTable tbody tr').first()
  await expect(row.locator('td').nth(0)).toHaveText('Items')
  await expect(row.locator('td').nth(1)).toHaveText('2')
  await expect(row.locator('td').nth(2)).toHaveText('2')
  await expect(row.locator('td').nth(3)).toHaveText('4')
  const total = Number(await dialog(page).locator('.import__reviewTotal').textContent())
  expect(total).toBe(4)
  await expect(dialog(page).getByText('Items · Steel Sword · price')).toBeVisible() // label preview

  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()

  const after = await graph(page)
  const created = after.nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  expect(created).toHaveLength(total) // the review total IS the created count
  expect(after.selectedNodeId).toBe(created[0].id) // exactly one selected, the first
  expect(after.nodes.filter((n) => n.id !== created[0].id).length).toBe(after.nodes.length - 1)

  // one-shot hint, and every created node inside the usable area
  await expect(page.locator('.hint-note', { hasText: /4 Parameters added/ })).toBeVisible()
  await page.waitForTimeout(150)
  const area = await usableCanvasArea(page)
  for (const n of created) {
    const b = await nodeBox(page, n.id)
    expect(b.left).toBeGreaterThanOrEqual(area.left - 1)
    expect(b.top).toBeGreaterThanOrEqual(area.top - 1)
    expect(b.right).toBeLessThanOrEqual(area.right + 1)
    expect(b.bottom).toBeLessThanOrEqual(area.bottom + 1)
  }

  // the quick start collapses after the first success (not an explicit choice) and the hint shows only once
  await openWizard(page)
  await expectQuickStart(page, false) // really collapsed: body hidden, controls not visible
  await dialog(page).locator('.import__quickstartToggle').click()
  await expectQuickStart(page, true)
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()
  expect((await graph(page)).nodes.filter((n) => n.type === 'parameter')).toHaveLength(8)
  await expect(page.locator('.hint-note', { hasText: /Parameters added/ })).toHaveCount(0)
})

test('"Use this example" is idempotent: repeated clicks reuse the example card, and a filled card is never overwritten', async ({ page }) => {
  await openWizard(page)
  const useIt = dialog(page).getByRole('button', { name: 'Use this example' })
  await useIt.click()
  await useIt.click()
  await useIt.click()
  await expect(dialog(page).locator('.import__table')).toHaveCount(1)

  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await openWizard(page)
  await dialog(page).locator('.import__quickstartToggle').click() // (still expanded on this fresh profile; toggling twice keeps it visible)
  await dialog(page).locator('.import__quickstartToggle').click()
  await pasteWithRoles(page, 'Mine', 'k,n\na,1', ['key', 'number'])
  await useIt.click()
  await expect(dialog(page).locator('.import__table')).toHaveCount(2)
  await expect(dialog(page).locator('.import__nameField input').first()).toHaveValue('Mine') // untouched
  await expect(dialog(page).locator('.import__nameField input').nth(1)).toHaveValue('Items')
  await useIt.click()
  await expect(dialog(page).locator('.import__table')).toHaveCount(2) // reused, not added again
})

test('role selects have an accessible name with the column header and are described by the shared role help', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  const keySelect = dialog(page).getByRole('combobox', { name: 'Role for column item_id' })
  await expect(keySelect).toHaveValue('key')
  const describedBy = await keySelect.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  await expect(page.locator(`#${describedBy}`)).toContainText(/Unique ID/)
  // the help is rendered ONCE per dialog, not once per table
  await expect(dialog(page).locator('.import__roleHelp')).toHaveCount(1)
  await dialog(page).getByRole('button', { name: 'Add another table' }).click()
  await expect(dialog(page).locator('.import__roleHelp')).toHaveCount(1)
  // changing the role re-points the description
  const priceSelect = dialog(page).getByRole('combobox', { name: 'Role for column price' })
  await priceSelect.selectOption('label')
  const d2 = await priceSelect.getAttribute('aria-describedby')
  await expect(page.locator(`#${d2}`)).toContainText(/Name shown/)
})

test('inline errors: the summary takes focus, each item is a button that reveals its cell, bad cells are marked, and an edit turns them stale until Next re-checks', async ({ page }) => {
  await openWizard(page)
  await pasteWithRoles(page, 'Bad', BAD_CSV, ['key', 'label', 'number', 'number'])
  await dialog(page).getByRole('button', { name: 'Next' }).click()

  // no separate error step -- the input is still there
  await expect(dialog(page).locator('textarea.import__paste')).toBeVisible()
  const summary = dialog(page).locator('.import__issueSummary[role="alert"]')
  await expect(summary).toContainText(/3 problems/)
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('import__issueSummary')

  const items = dialog(page).locator('.import__issues button.import__issueLink')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText(/"4,900"/)
  await expect(items.nth(0)).toContainText(/price/)
  await expect(items.nth(0)).toContainText(/thousands/i)
  await expect(items.nth(1)).toContainText(/price/)
  await expect(items.nth(2)).toContainText(/"sword"/)
  await expect(dialog(page).locator('.import__preview .is-bad[aria-invalid="true"]')).toHaveCount(3)

  await items.nth(0).click()
  expect(await page.evaluate(() => document.activeElement?.classList.contains('is-bad'))).toBe(true)

  // an edit -> stale: no active warning styling, but a "check again" state
  await dialog(page).locator('textarea.import__paste').fill(EXAMPLE_CSV)
  await expect(dialog(page).locator('.import__preview .is-bad')).toHaveCount(0)
  await expect(dialog(page).locator('[aria-invalid="true"]')).toHaveCount(0)
  await expect(dialog(page).locator('.import__issues.is-stale')).toBeVisible()
  await expect(dialog(page).locator('.import__issueSummary')).toContainText(/check again/i)

  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).getByText('Place on the canvas, no frames')).toBeVisible()
})

for (const [loc, needle] of [
  ['ko', 'price'],
  ['ja', 'price'],
] as const) {
  test(`${loc} -- the invalid-number message carries the value and the header, never the internal code`, async ({ page }) => {
    await page.evaluate((l) => (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (s: string) => void } } } }).__loop.i18n.getState().setLocale(l), loc)
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(loc)
    const btn = page.getByRole('button', { name: loc === 'ko' ? '데이터 ▾' : 'データ ▾', exact: true })
    if (!(await btn.isVisible())) await page.locator('.toolbar__overflow-btn').click()
    await btn.click()
    await page.getByRole('menuitem').first().click()
    await expect(dialog(page)).toBeVisible()
    await pasteWithRoles(page, 'Bad', BAD_CSV, ['key', 'label', 'number', 'number'])
    await dialog(page).locator('.mcdlg__foot .btn--primary').click()
    const first = dialog(page).locator('.import__issues button.import__issueLink').first()
    await expect(first).toContainText('4,900')
    await expect(first).toContainText(needle)
    expect(await first.textContent()).not.toContain('invalid-number')
  })
}

test('a long cell value in an error is truncated and control characters are made visible', async ({ page }) => {
  await openWizard(page)
  const long = 'x'.repeat(300)
  await pasteWithRoles(page, 'Long', `k,n\na,${long}\nb,"1\n2"`, ['key', 'number'])
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  const items = dialog(page).locator('.import__issues button.import__issueLink')
  const t0 = (await items.nth(0).textContent()) ?? ''
  expect(t0).toContain('…')
  expect(t0).not.toContain('x'.repeat(60))
  const t1 = (await items.nth(1).textContent()) ?? ''
  expect(t1).toContain('1⏎2')
})

test('the quick-start collapsed state: a manual toggle persists across reopen and reload, and a first success never overrides an explicit expand', async ({ page }) => {
  await openWizard(page)
  const toggle = () => dialog(page).locator('.import__quickstartToggle')
  await toggle().click()
  await expectQuickStart(page, false)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await openWizard(page)
  await expectQuickStart(page, false) // reopened: the stored state IS the real visibility
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await openWizard(page)
  await expectQuickStart(page, false) // reloaded: still really collapsed
  await toggle().focus()
  await page.keyboard.press('Enter')
  await expectQuickStart(page, true) // explicit expand
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await openWizard(page)
  await expectQuickStart(page, true)
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()
  await openWizard(page)
  await expectQuickStart(page, true) // explicit choice survives the first success
})

test('the Data menu\'s "How to prepare a spreadsheet…" opens the wizard with the quick start expanded even when it was collapsed', async ({ page }) => {
  await openWizard(page)
  await dialog(page).locator('.import__quickstartToggle').click()
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await dataButton(page).click()
  await page.getByRole('menuitem', { name: 'How to prepare a spreadsheet…' }).click()
  await expect(dialog(page)).toBeVisible()
  await expectQuickStart(page, true)
  // the full-guide link is a secondary, external path -- present but never required
  const guide = dialog(page).getByRole('link', { name: /Full guide/ })
  await expect(guide).toHaveAttribute('target', '_blank')
  await expect(guide).toHaveAttribute('href', /github\.com\/MerciHanrim\/loop-studio\/blob\/main\/docs\/import-guide\.md$/)
})

test('a 2-table import with a lookup-only table reports "0 (lookup only)" and the same total the commit creates', async ({ page }) => {
  await openWizard(page)
  await pasteWithRoles(page, 'Items', 'item_key,name\na,Sword\nb,Shield', ['key', 'label'])
  await dialog(page).getByRole('button', { name: 'Add another table' }).click()
  await pasteWithRoles(page, 'Drops', 'drop_key,item_ref,rate\nd1,a,10\nd2,b,20\nd3,a,30', ['key', 'foreignKey', 'number'])
  const fkTh = dialog(page).locator('.import__table').nth(1).locator('.import__preview thead tr').first().locator('th').nth(1)
  await fkTh.locator('select').nth(1).selectOption({ label: 'Items' })
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  const rows = dialog(page).locator('.import__reviewTable tbody tr')
  await expect(rows.nth(0).locator('td').nth(3)).toHaveText(/0 \(lookup only\)/)
  await expect(rows.nth(1).locator('td').nth(3)).toHaveText('3')
  await expect(dialog(page).locator('.import__reviewTotal')).toHaveText('3')
  const before = await graph(page)
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()
  expect((await graph(page)).nodes.length - before.nodes.length).toBe(3)
})

test('keyboard only: the quick start, fields, role selects and buttons are reachable in order; Escape returns focus to the Data trigger', async ({ page }) => {
  await dataButton(page).focus()
  await page.keyboard.press('Enter') // opens the Data menu
  await page.keyboard.press('Tab') // the first menu item follows the trigger in DOM order
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  const active = () => page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null
    return e ? `${e.tagName.toLowerCase()}:${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 24) ?? ''}` : ''
  })
  // focus starts on the first field, then Shift+Tab reaches the quick start's
  // last control above it (the second <details> summary), proving the block
  // sits in the Tab ring rather than being skipped
  expect(await active()).toMatch(/^input:/)
  await page.keyboard.press('Shift+Tab')
  expect(await active()).toMatch(/^summary:What is not imported/)
  await page.keyboard.press('Shift+Tab')
  expect(await active()).toMatch(/^summary:Getting data out/)
  await page.keyboard.press('Shift+Tab')
  expect(await active()).toMatch(/^a:Full guide/)
  // activate the example from the keyboard
  const useIt = dialog(page).getByRole('button', { name: 'Use this example' })
  await useIt.focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page).locator('.import__status').first()).toContainText(/4 Parameters/)
  const keySelect = dialog(page).getByRole('combobox', { name: 'Role for column item_id' })
  await keySelect.focus()
  await page.keyboard.press('Tab')
  expect(await active()).toBe('select:Role for column item_name')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  expect(await active()).toMatch(/^button:Data/)
})

test('a large import (1,200 rows × 2 Number columns) keeps the zoom at the floor, anchors the first node inside the usable area and selects only one node', async ({ page }) => {
  await openWizard(page)
  const rows = Array.from({ length: 1200 }, (_, i) => `r${i},Row ${i},${i},${i * 2}`).join('\n')
  await pasteWithRoles(page, 'Big', `id,name,a,b\n${rows}`, ['key', 'label', 'number', 'number'])
  await expect(dialog(page).locator('.import__status').first()).toContainText(/2,400 Parameters|2400 Parameters/)
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).locator('.import__reviewTotal')).toHaveText(/2,?400/)
  const before = await graph(page)
  const t0 = Date.now()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden({ timeout: 30_000 })
  const elapsed = Date.now() - t0
  console.log(`[diagnostic] 2,400-Parameter commit round-trip: ${elapsed} ms`)
  const after = await graph(page)
  const created = after.nodes.filter((n) => !before.nodes.some((b) => b.id === n.id))
  expect(created).toHaveLength(2400)
  expect(after.selectedNodeId).toBe(created[0].id)
  const vp = await viewport(page)
  expect(Math.abs(vp.zoom - IMPORT_FIT_FLOOR)).toBeLessThan(1e-6)
  await page.waitForTimeout(200)
  const area = await usableCanvasArea(page)
  const b = await nodeBox(page, created[0].id)
  expect(b.left).toBeGreaterThanOrEqual(area.left - 1)
  expect(b.top).toBeGreaterThanOrEqual(area.top - 1)
  expect(b.right).toBeLessThanOrEqual(area.right + 1)
  expect(b.bottom).toBeLessThanOrEqual(area.bottom + 1)
})

/** Must equal `IMPORT_FIT_FLOOR` in src/components/dataImport/DataImportWizard.tsx. */
const IMPORT_FIT_FLOOR = 0.5

test('visual: the quick start with the example loaded, and the inline error state (element captures)', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  await expect(dialog(page).locator('.import__status').first()).toContainText(/4 Parameters/)
  // "Use this example" moves focus to the table name, which scrolls the
  // dialog body down -- the baseline must protect the quick start's COPY,
  // so scroll back to the top and prove every guarded piece is inside the
  // dialog's clip before capturing.
  await dialog(page).locator('.mcdlg__body').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.evaluate(() => document.fonts.ready)
  const dlg = (await dialog(page).boundingBox())!
  const qs = dialog(page).locator('.import__quickstart')
  const guarded = [
    qs.locator('.import__quickstartToggle'),
    qs.locator('.import__quickstartLead'),
    qs.locator('.import__example'),
    qs.getByText(/item_id: Key · item_name: Label · price: Number · drop_rate: Number/),
    qs.getByText(/2 rows × 2 Number columns = 4 Parameters/),
    qs.getByRole('button', { name: 'Use this example' }),
    qs.getByRole('button', { name: 'Download sample CSV' }),
    qs.getByRole('link', { name: /Full guide/ }),
  ]
  for (const g of guarded) {
    const b = (await g.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(dlg.y)
    expect(b.y + b.height).toBeLessThanOrEqual(dlg.y + dlg.height)
    expect(b.x).toBeGreaterThanOrEqual(dlg.x)
    expect(b.x + b.width).toBeLessThanOrEqual(dlg.x + dlg.width)
  }
  // the `↗` external-link glyph comes from a fallback font whose
  // rasterisation differs between a local Windows machine and the CI runner
  // -- mask that one small span only. (The mapping line used `→` for the
  // same reason and is now written with `:` so it stays pixel-guarded.)
  await expect(dialog(page)).toHaveScreenshot(...snap(page, 'data-import-quickstart', { mask: [qs.locator('.menu__ext')] }))
  // the inline-error scene is captured from the REAL error experience: the
  // user was at the table (where "Use this example" left them -- a second
  // click reuses the example card and restores that scroll position), then
  // pressed Next and focus moved to the summary
  await dialog(page).getByRole('button', { name: 'Use this example' }).click()
  // "Use this example" moves focus to the card's name field on the next
  // animation frame -- wait for that before pressing Next, or the deferred
  // focus can land AFTER the summary took focus and steal it (seen once in
  // 4 local runs).
  await expect(dialog(page).locator('.import__nameField input').first()).toBeFocused()
  await dialog(page).locator('textarea.import__paste').fill(BAD_CSV)
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  const summary = dialog(page).locator('.import__issueSummary')
  await expect(summary).toBeFocused()
  // pin the scene the baseline protects: the focused summary at the top of
  // the body, with the table's issue list and its marked cells below it
  await summary.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  const guardedErr = [summary, dialog(page).locator('.import__issues button.import__issueLink').first(), dialog(page).locator('.import__preview .is-bad').first()]
  for (const g of guardedErr) {
    const b = (await g.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(dlg.y)
    expect(b.y + b.height).toBeLessThanOrEqual(dlg.y + dlg.height)
  }
  await expect(dialog(page)).toHaveScreenshot(...snap(page, 'data-import-inline-errors'))
})

// docs/data-import.md §DI17 / docs/mobile.md §MV1 — the wizard stays
// desktop-only: the mobile More sheet offers file import (Graph / Workspace
// JSON) and nothing spreadsheet-related. Pinned so the boundary is a
// decision, not an accident.
test.describe('mobile boundary', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('the mobile More sheet has no spreadsheet-import entry and the wizard is unreachable', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click()
    const sheet = page.locator('.sheet, [role="dialog"]').last()
    await expect(sheet.getByRole('button', { name: 'Import file' })).toBeVisible()
    await expect(page.getByRole('button', { name: /spreadsheet/i })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /spreadsheet/i })).toHaveCount(0)
    await expect(page.locator('.mcdlg--dataimport')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Data ▾' })).toHaveCount(0)
  })
})
