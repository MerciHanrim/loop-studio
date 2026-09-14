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
  // docs/data-import.md §DI16 Phase 2 -- the button now opens a small
  // dropdown ("Import new spreadsheet…" / "Manage bindings…") instead of
  // the wizard directly; the first item is always the import entry.
  await importButton(page).click()
  await page.getByRole('menuitem').first().click()
  await expect(dialog(page)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('Next is disabled while the table is empty; filling name and data independently shows/clears the matching inline hint', async ({ page }) => {
  await openWizard(page)
  const next = dialog(page).getByRole('button', { name: 'Next' })
  const nameInput = dialog(page).locator('.import__nameField input')
  const paste = dialog(page).getByPlaceholder('Paste CSV or TSV text here')

  // completely empty -- both root-cause hints shown at once (never just one
  // at a time), Next disabled
  await expect(dialog(page).getByText('Enter a table name to continue.')).toBeVisible()
  await expect(dialog(page).getByText('Paste or upload CSV/TSV data to continue.')).toBeVisible()
  await expect(next).toBeDisabled()

  // name only -- the name hint clears, the data hint remains
  await nameInput.fill('Items')
  await expect(dialog(page).getByText('Enter a table name to continue.')).toHaveCount(0)
  await expect(dialog(page).getByText('Paste or upload CSV/TSV data to continue.')).toBeVisible()
  await expect(next).toBeDisabled()

  // data only -- the reverse
  await nameInput.fill('')
  await paste.fill('item_key,weight\nitm_a,10')
  await expect(dialog(page).getByText('Enter a table name to continue.')).toBeVisible()
  await expect(dialog(page).getByText('Paste or upload CSV/TSV data to continue.')).toHaveCount(0)
  await expect(next).toBeDisabled()

  // both filled -- Next enabled, no hints left. Next was disabled at every
  // step above, so the derived "no key column" error (only reachable via
  // validateDrafts(), which Next alone can trigger) was never reachable
  // while the table was incomplete.
  await nameInput.fill('Items')
  await expect(dialog(page).getByText('Enter a table name to continue.')).toHaveCount(0)
  await expect(dialog(page).getByText('Paste or upload CSV/TSV data to continue.')).toHaveCount(0)
  await expect(next).toBeEnabled()
})

test('once real data exists, a genuinely missing key column is still reported -- never silently suppressed', async ({ page }) => {
  await openWizard(page)
  await dialog(page).locator('.import__nameField input').fill('Items')
  await dialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,weight\nitm_a,10')
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).getByText(/No column is marked as the row key/)).toBeVisible()

  // the validate/error step's own Back button reads "Back to input", not a
  // generic "Back"
  await dialog(page).getByRole('button', { name: 'Back to input' }).click()
  await expect(dialog(page).locator('.import__nameField input')).toHaveValue('Items')
})

test('paste a table, assign roles, validate, place, and commit as one atomic import', async ({ page }) => {
  await openWizard(page)

  await dialog(page).getByLabel('Table name').fill('Items')
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
  await dialog(page).getByLabel('Table name').fill('Items')
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

test('review round 3 -- a validation issue reports the RAW source line number, not an offset-blind row index', async ({ page }) => {
  // issueLocation() used to display `rowIndex + 1` with no header-row
  // offset added back, so a title row above the real header (a common,
  // supported case -- §DI5's own "drop a leading title row") made the
  // shown row number wrong. Header row 2 (skipping a title row); the
  // duplicate key sits on the raw text's 4th line.
  await openWizard(page)
  await dialog(page).getByLabel('Table name').fill('Items')
  await dialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('Title row to skip\nitem_key,weight\nitm_a,10\nitm_a,20')

  const headerInput = dialog(page).locator('label', { hasText: 'Header row' }).locator('input')
  await headerInput.fill('2')

  const headerRow = dialog(page).locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('number')

  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).getByText(/row 4/)).toBeVisible() // the raw text's 4th line, not row 2
  await expect(dialog(page).getByText(/row 2\b/)).toHaveCount(0)
})

for (const [loc, needle] of [
  ['ko', '닫히지 않은 따옴표'],
  ['ja', '閉じられていない引用符'],
] as const) {
  test(`review round 3 -- ${loc} shows a translated CSV parse-error message, never the raw internal code`, async ({ page }) => {
    await page.evaluate((l) => (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (s: string) => void } } } }).__loop.i18n.getState().setLocale(l), loc)
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(loc)

    const importButtonText = loc === 'ko' ? '스프레드시트 데이터 ▾' : 'スプレッドシートデータ ▾'
    const importBtn = page.getByRole('button', { name: importButtonText, exact: true })
    if (!(await importBtn.isVisible())) {
      await page.locator('.toolbar__overflow-btn').click()
    }
    await importBtn.click()
    await page.getByRole('menuitem').first().click() // "Import new spreadsheet…" -- always the first item
    await expect(dialog(page)).toBeVisible()

    // fill the table name too -- otherwise the empty-name inline hint (also
    // an `.import__error`) is a second match ahead of the parse error in DOM
    // order, and `.first()` below would grab the wrong one. CSS-scoped, not
    // `getByLabel`, since this test runs under a KO/JA locale where the
    // field's accessible name is translated.
    await dialog(page).locator('.import__nameField input').fill('Items')
    const paste = dialog(page).locator('textarea').first()
    await paste.fill('item_key,weight\n"itm_a,10')

    const errorText = await dialog(page).locator('.import__error').first().textContent()
    expect(errorText).toContain(needle)
    expect(errorText).not.toContain('unterminated-quote') // the raw internal code must never leak through
  })
}

test('a parse error blocks Next and Commit; fixing the CSV never lets stale prior-good data through', async ({ page }) => {
  // review round 2, item 1 — reparse() on a parse failure keeps the OLD
  // parsedRows/columns; runValidate() never checked parseError. Repro: valid
  // CSV -> configure roles -> edit to invalid CSV -> stale data must NOT
  // reach validation/commit, and Next must be disabled the whole time.
  await openWizard(page)
  await dialog(page).getByLabel('Table name').fill('Items')
  const paste = dialog(page).getByPlaceholder('Paste CSV or TSV text here')
  await paste.fill('item_key,weight\nitm_a,10\nitm_b,20')

  const headerRow = dialog(page).locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('number')

  const nextBtn = dialog(page).getByRole('button', { name: 'Next' })
  await expect(nextBtn).toBeEnabled()

  // edit to an unterminated quote -- a real CsvParseError
  await paste.fill('item_key,weight\n"itm_a,10\nitm_b,20')
  await expect(dialog(page).locator('.import__error').first()).toBeVisible()
  await expect(nextBtn).toBeDisabled()

  const before = await gs(page)
  // clicking a disabled button is a no-op, but assert the guard itself too
  await nextBtn.click({ force: true })
  await expect(dialog(page)).toBeVisible() // still open, never advanced
  await expect(dialog(page).getByText(/Ready to import/)).toHaveCount(0)
  expect((await gs(page)).past.length).toBe(before.past.length) // nothing committed

  // fixing the CSV re-enables Next and the wizard proceeds on the NEW data
  await paste.fill('item_key,weight\nitm_a,10\nitm_b,20\nitm_c,30')
  await expect(nextBtn).toBeEnabled()
  await nextBtn.click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()
  expect((await gs(page)).nodes).toHaveLength(3) // the FIXED data, not the stale 2-row data
})

test('BOM-prefixed file upload succeeds and the BOM never reaches the stored header', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByLabel('Table name').fill('Items')

  const chooserP = page.waitForEvent('filechooser')
  await dialog(page).getByRole('button', { name: 'Upload file…' }).click()
  const chooser = await chooserP
  await chooser.setFiles({
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('﻿item_key,weight\nitm_a,10', 'utf8'),
  })

  const headerRow = dialog(page).locator('.import__preview thead tr').first()
  await expect(headerRow.locator('th').first().locator('div')).toHaveText('item_key')
  const headerText = await headerRow.locator('th').first().locator('div').textContent()
  expect(headerText?.includes('﻿')).toBe(false)

  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('number')
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()

  const after = await gs(page)
  expect(after.nodes.map((n) => n.data?.label)).toEqual(['Items · itm_a · weight'])
})

test('TSV auto-detects, and the manual Tab delimiter option holds a real tab character', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByLabel('Table name').fill('Items')
  const paste = dialog(page).getByPlaceholder('Paste CSV or TSV text here')

  // auto-detect: a plain TSV paste, delimiter left on "Auto-detect"
  await paste.fill('item_key\tnote\nitm_a\tHello, World')
  const previewRow = dialog(page).locator('.import__preview tbody tr').first()
  await expect(previewRow.locator('td')).toHaveCount(2)
  await expect(previewRow.locator('td').nth(1)).toHaveText('Hello, World')

  // force it wrong (Comma) -- the embedded comma now wrongly splits the row
  const delimiterSelect = dialog(page).locator('label', { hasText: 'Delimiter' }).locator('select')
  await delimiterSelect.selectOption(',')
  await expect(dialog(page).locator('.import__preview tbody tr').first().locator('td')).toHaveCount(1)

  // switch back via the manual "Tab" option -- proves its <option> value is a
  // REAL tab character (item 5), not a literal backslash-t, since only that
  // re-splits the row correctly
  await delimiterSelect.selectOption({ label: 'Tab' })
  const fixedRow = dialog(page).locator('.import__preview tbody tr').first()
  await expect(fixedRow.locator('td')).toHaveCount(2)
  await expect(fixedRow.locator('td').nth(1)).toHaveText('Hello, World')
})

test('a 2-table FK import resolves the linked row into the generated label', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByLabel('Table name').fill('Items')
  await dialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,name,weight\nitm_a,Sword,5\nitm_b,Shield,8')
  const itemsHeader = dialog(page).locator('.import__table').nth(0).locator('.import__preview thead tr').first()
  await itemsHeader.locator('th').nth(0).locator('select').selectOption('key')
  await itemsHeader.locator('th').nth(1).locator('select').selectOption('label')
  await itemsHeader.locator('th').nth(2).locator('select').selectOption('number')

  await dialog(page).getByRole('button', { name: 'Add another table' }).click()
  const dropsTable = dialog(page).locator('.import__table').nth(1)
  await dropsTable.getByLabel('Table name').fill('Drops')
  await dropsTable.getByPlaceholder('Paste CSV or TSV text here').fill('drop_key,item_ref,rate\nd1,itm_a,10\nd2,itm_b,20')
  const dropsHeader = dropsTable.locator('.import__preview thead tr').first()
  await dropsHeader.locator('th').nth(0).locator('select').selectOption('key')
  const fkTh = dropsHeader.locator('th').nth(1)
  await fkTh.locator('select').first().selectOption('foreignKey')
  await fkTh.locator('select').nth(1).selectOption({ label: 'Items' })
  await dropsHeader.locator('th').nth(2).locator('select').selectOption('number')

  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).getByText('Place on the canvas, no frames')).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()

  const after = await gs(page)
  expect(after.nodes.map((n) => n.data?.label).sort()).toEqual([
    'Drops · Shield · rate',
    'Drops · Sword · rate',
    'Items · Shield · weight',
    'Items · Sword · weight',
  ])
})

test('adding to an existing frame with a partly-occupied top row finds the free space instead of failing', async ({ page }) => {
  await openApp(page)
  await resetAll(page)

  // one frame, with a node already sitting in its top-left interior cell --
  // review round 2, item 4: the old placement tried ONLY that one cell and
  // refused immediately on overlap, even with plenty of free space below.
  const frameId = await page.evaluate(() => {
    const frame = (window as unknown as { __loop: { frame: { getState: () => { addFrame: (r: object) => string } } } }).__loop.frame
    return frame.getState().addFrame({ x: 100, y: 100, w: 340, h: 340 })
  })
  await page.evaluate(() => {
    const graph = (window as unknown as { __loop: { graph: { getState: () => { nodes: unknown[] }; setState: (p: object) => void } } }).__loop.graph
    const g = graph.getState()
    graph.setState({
      nodes: [
        ...(g.nodes as object[]),
        {
          id: 'occupant',
          type: 'pool',
          position: { x: 124, y: 124 },
          data: { kind: 'pool', label: 'Occupant', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' },
        },
      ],
    })
  })

  await openWizard(page)
  await dialog(page).getByLabel('Table name').fill('Items')
  await dialog(page).getByPlaceholder('Paste CSV or TSV text here').fill('item_key,weight\nitm_a,10')
  const headerRow = dialog(page).locator('.import__preview thead tr').first()
  await headerRow.locator('select').nth(0).selectOption('key')
  await headerRow.locator('select').nth(1).selectOption('number')
  await dialog(page).getByRole('button', { name: 'Next' }).click()

  await dialog(page).getByText('Add to an existing frame').click()
  await dialog(page).locator('select').last().selectOption(frameId)
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden() // committed -- no "insufficient space" refusal

  const positions = await page.evaluate(() => {
    const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[] } } } }).__loop.graph.getState()
    return g.nodes.map((n) => ({ id: n.id, ...n.position }))
  })
  const occupant = positions.find((n) => n.id === 'occupant')!
  const created = positions.find((n) => n.id !== 'occupant')!
  // the new node landed inside the frame's interior, clear of the occupant
  expect(created.x).toBeGreaterThanOrEqual(100)
  expect(created.y).toBeGreaterThanOrEqual(100)
  const overlapsOccupant = Math.abs(created.x - occupant.x) < 260 && Math.abs(created.y - occupant.y) < 120
  expect(overlapsOccupant).toBe(false)
})

for (const loc of ['ko', 'ja'] as const) {
  test(`${loc} — real DOM node boxes stay inside their generated frame, never overlapping each other`, async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate((l) => (window as unknown as { __loop: { i18n: { getState: () => { setLocale: (s: string) => void } } } }).__loop.i18n.getState().setLocale(l), loc)
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(loc)
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: 0, y: 0, zoom: 1 },
        { duration: 0 },
      ),
    )

    // the data-import button collapses into the toolbar's ⋯ overflow menu at
    // some viewport/locale combinations (it has the lowest collapse priority
    // of any toolbar control) -- open that first if it isn't directly visible.
    const importButtonText = loc === 'ko' ? '스프레드시트 데이터 ▾' : 'スプレッドシートデータ ▾'
    const importBtn = page.getByRole('button', { name: importButtonText, exact: true })
    if (!(await importBtn.isVisible())) {
      await page.locator('.toolbar__overflow-btn').click()
    }
    await importBtn.click()
    await page.getByRole('menuitem').first().click() // "Import new spreadsheet…" -- always the first item
    await expect(dialog(page)).toBeVisible()
    await dialog(page).locator('.import__tableHead input').fill(
      loc === 'ko' ? '아주 길고 긴 테이블 이름 그리고 더 길게' : '非常に長いテーブル名前でさらに長くする',
    )
    const paste = dialog(page).locator('textarea').first()
    const longLabel1 = loc === 'ko' ? '매우 길고 긴 상품 이름 프리미엄 한정판 특별 에디션' : '非常に長い商品名のプレミアム限定版特別エディション'
    const longLabel2 = loc === 'ko' ? '또 다른 매우 길고 긴 두 번째 상품 이름 특별판' : 'もう一つの非常に長い二番目の商品名特別版'
    await paste.fill(`item_key,name,weight\nitm_a,${longLabel1},10\nitm_b,${longLabel2},20`)

    const headerRow = dialog(page).locator('.import__preview thead tr').first()
    await headerRow.locator('th').nth(0).locator('select').selectOption('key')
    await headerRow.locator('th').nth(1).locator('select').selectOption('label')
    await headerRow.locator('th').nth(2).locator('select').selectOption('number')

    await dialog(page).locator('.mcdlg__foot .btn--primary').click() // -> placement
    // "one frame per table" placement -- second radio option
    const radios = dialog(page).locator('input[type="radio"]')
    await radios.nth(1).click()
    await dialog(page).locator('.mcdlg__foot .btn--primary').click() // -> review
    await dialog(page).locator('.mcdlg__foot .btn--primary').click() // commit
    await expect(dialog(page)).toBeHidden()

    const frames = await page.evaluate(
      () => (window as unknown as { __loop: { frame: { getState: () => { frames: { id: string; rect: { x: number; y: number; w: number; h: number } }[] } } } }).__loop.frame.getState().frames,
    )
    expect(frames).toHaveLength(1)
    const frameRectFlow = frames[0].rect

    const nodeIds = await page.evaluate(
      () => (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string }[] } } } }).__loop.graph.getState().nodes.map((n) => n.id),
    )
    expect(nodeIds).toHaveLength(2)

    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)

    // the pan/zoom is pinned to (0,0)/1, so flow units == canvas-LOCAL
    // pixels -- but the canvas pane itself sits below the toolbar, so a
    // flow-space rect (from store state) needs the pane's own screen
    // origin added before comparing against a `getBoundingClientRect()`
    // (viewport-space) node box.
    const paneOrigin = await page.evaluate(() => {
      const r = document.querySelector('.react-flow')!.getBoundingClientRect()
      return { x: r.left, y: r.top }
    })
    const frame = {
      x: paneOrigin.x + frameRectFlow.x,
      y: paneOrigin.y + frameRectFlow.y,
      w: frameRectFlow.w,
      h: frameRectFlow.h,
    }

    const boxes = await Promise.all(
      nodeIds.map((id) =>
        page.evaluate(
          (nid) => document.querySelector(`.react-flow__node[data-id="${nid}"] .nodef`)!.getBoundingClientRect(),
          id,
        ),
      ),
    )

    // every node's REAL rendered box stays inside the frame's interior (not
    // just its top-left corner -- the unit-level bug this replaces)
    for (const b of boxes) {
      expect(b.left).toBeGreaterThanOrEqual(frame.x)
      expect(b.top).toBeGreaterThanOrEqual(frame.y)
      expect(b.right).toBeLessThanOrEqual(frame.x + frame.w + 1)
      expect(b.bottom).toBeLessThanOrEqual(frame.y + frame.h + 1)
    }
    // and the two nodes' real rendered boxes never overlap each other
    const [a, b] = boxes
    const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    expect(overlap).toBe(false)
  })
}

test('the full 5-table gacha worked example (docs/data-import.md §DI4): atomic import -> undo -> redo -> reload keeps every triple + value', async ({ page }) => {
  await openWizard(page)

  type TableCfg = {
    name: string
    paste: string
    roles: string[]
    fk?: Record<number, string>
    groupByHeader?: string
  }
  const tables: TableCfg[] = [
    {
      name: 'Items',
      paste:
        'item_key,display_name,rarity,category\nitm_blade_ssr,Ember Blade,SSR,weapon\nitm_blade_sr,Iron Blade,SR,weapon\nitm_charm_r,Lucky Charm,R,accessory',
      roles: ['key', 'label', 'ignored', 'ignored'],
    },
    {
      name: 'Banners',
      paste: 'banner_key,banner_name\npremium_pickup,Premium Pickup\npremium_standard,Premium Standard',
      roles: ['key', 'label'],
    },
    {
      name: 'GachaPoolEntries',
      // item_key BEFORE banner_key so the composed label term order matches
      // docs/data-import.md §DI8's literal example: "... Ember Blade ·
      // Premium Pickup · weight" (terms join in column-declaration order).
      paste:
        'pool_entry_key,item_key,banner_key,weight\nppe_pickup_blade_ssr,itm_blade_ssr,premium_pickup,10\nppe_pickup_blade_sr,itm_blade_sr,premium_pickup,90\nppe_pickup_charm_r,itm_charm_r,premium_pickup,900',
      roles: ['key', 'foreignKey', 'foreignKey', 'number'],
      fk: { 1: 'Items', 2: 'Banners' },
      groupByHeader: 'banner_key',
    },
    {
      name: 'Packages',
      paste: 'package_key,package_name,price_krw\npkg_starter,Starter Pack,4900\npkg_whale,Whale Pack,49900',
      roles: ['key', 'label', 'number'],
    },
    {
      name: 'PackageItems',
      paste:
        'package_item_key,package_key,item_key,quantity\npkgitem_starter_blade_sr,pkg_starter,itm_blade_sr,1\npkgitem_starter_charm_r,pkg_starter,itm_charm_r,3\npkgitem_whale_blade_ssr,pkg_whale,itm_blade_ssr,1',
      roles: ['key', 'foreignKey', 'foreignKey', 'number'],
      fk: { 1: 'Packages', 2: 'Items' },
      groupByHeader: 'package_key',
    },
  ]

  for (let ti = 0; ti < tables.length; ti++) {
    const cfg = tables[ti]
    if (ti > 0) await dialog(page).getByRole('button', { name: 'Add another table' }).click()
    const tbl = dialog(page).locator('.import__table').nth(ti)
    await tbl.getByLabel('Table name').fill(cfg.name)
    await tbl.getByPlaceholder('Paste CSV or TSV text here').fill(cfg.paste)
    const headRow = tbl.locator('.import__preview thead tr').first()
    for (let ci = 0; ci < cfg.roles.length; ci++) {
      const th = headRow.locator('th').nth(ci)
      await th.locator('select').first().selectOption(cfg.roles[ci])
      if (cfg.roles[ci] === 'foreignKey' && cfg.fk?.[ci]) {
        await th.locator('select').nth(1).selectOption({ label: cfg.fk[ci] })
      }
    }
    if (cfg.groupByHeader) {
      const groupRow = tbl.locator('.import__preview thead tr').nth(1)
      await groupRow.locator('select').selectOption({ label: cfg.groupByHeader })
    }
  }

  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).getByText('Place on the canvas, no frames')).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Next' }).click()
  await expect(dialog(page).getByText(/Ready to import/)).toBeVisible()

  const fullGs = (p: Page) =>
    p.evaluate(() => {
      const g = (
        window as unknown as {
          __loop: { graph: { getState: () => { nodes: { id: string; data?: Record<string, unknown> }[]; past: unknown[] } } }
        }
      ).__loop.graph.getState()
      return { nodes: g.nodes.map((n) => ({ id: n.id, data: n.data })), pastLen: g.past.length }
    })

  const pastBefore = (await fullGs(page)).pastLen
  await dialog(page).getByRole('button', { name: 'Import' }).click()
  await expect(dialog(page)).toBeHidden()

  const committed = await fullGs(page)
  expect(committed.pastLen).toBe(pastBefore + 1) // ONE atomic history entry
  expect(committed.nodes.map((n) => n.data?.label as string).sort()).toEqual(
    [
      'GachaPoolEntries · Ember Blade · Premium Pickup · weight',
      'GachaPoolEntries · Iron Blade · Premium Pickup · weight',
      'GachaPoolEntries · Lucky Charm · Premium Pickup · weight',
      'Packages · Starter Pack · price_krw',
      'Packages · Whale Pack · price_krw',
      'PackageItems · Starter Pack · Iron Blade · quantity',
      'PackageItems · Starter Pack · Lucky Charm · quantity',
      'PackageItems · Whale Pack · Ember Blade · quantity',
    ].sort(),
  )
  const tripleBefore = committed.nodes
    .map((n) => ({
      id: n.id,
      sourceTableId: n.data?.sourceTableId,
      sourceKey: n.data?.sourceKey,
      sourceColumnId: n.data?.sourceColumnId,
      value: n.data?.value,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const tablesBefore = await dataImportTables(page)
  expect(tablesBefore).toHaveLength(5) // every plan table gets a record, even the 2 pure-lookup ones

  // Undo removes the whole batch in one step
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await fullGs(page)).nodes.length).toBe(0)
  expect(await dataImportTables(page)).toHaveLength(0)

  // Redo restores it byte-identical
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(async () => (await fullGs(page)).nodes.length).toBe(8)
  const afterRedo = await fullGs(page)
  const tripleAfterRedo = afterRedo.nodes
    .map((n) => ({
      id: n.id,
      sourceTableId: n.data?.sourceTableId,
      sourceKey: n.data?.sourceKey,
      sourceColumnId: n.data?.sourceColumnId,
      value: n.data?.value,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  expect(tripleAfterRedo).toEqual(tripleBefore)

  // wait for the debounced autosave, then reload from storage
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('loop-studio:graph:v1') ?? '{}').dataImports?.length ?? 0
        } catch {
          return 0
        }
      }),
    )
    .toBe(5)
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))

  const afterReload = await fullGs(page)
  expect(afterReload.nodes).toHaveLength(8)
  const tripleAfterReload = afterReload.nodes
    .map((n) => ({
      id: n.id,
      sourceTableId: n.data?.sourceTableId,
      sourceKey: n.data?.sourceKey,
      sourceColumnId: n.data?.sourceColumnId,
      value: n.data?.value,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  expect(tripleAfterReload).toEqual(tripleBefore) // every triple + value survives a reload byte-identical

  const tablesAfterReload = await dataImportTables(page)
  expect(tablesAfterReload).toHaveLength(5)
})

test('Undo removes the whole imported batch in one step; Redo restores it', async ({ page }) => {
  await openWizard(page)
  await dialog(page).getByLabel('Table name').fill('Items')
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
