import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Audit ①-4 — two reproduced data-loss cases, pinned in the real browser:
//  1. a document over the browser's localStorage quota: the autosave write is
//     refused → a PERSISTENT notice with an export button, gone again once a
//     write succeeds; nothing is thrown or logged as an error (the `test`
//     fixture fails on any console.error / pageerror).
//  2. an edit made 150 ms before a reload (inside the 400 ms debounce) is
//     kept, because the pending write is flushed on `pagehide`.
// Chromium's per-origin quota is ~5M characters; two 20,000-row × 4-column
// data-import tables serialize to ~9.8M, deterministically over it.

type Bridge = { __loop: Record<string, { getState: () => any }> }

function bigTable(rows: number, cols: number, id: string) {
  const columns: { sourceColumnId: string; role: string; header: string }[] = [{ sourceColumnId: 'key', role: 'key', header: 'id' }]
  for (let c = 0; c < cols; c++) columns.push({ sourceColumnId: `n${c}`, role: 'number', header: `col ${c}` })
  const rowsArr = []
  for (let r = 0; r < rows; r++) {
    const number: Record<string, number> = {}
    for (let c = 0; c < cols; c++) number[`n${c}`] = r * 1.5 + c
    rowsArr.push({ sourceKey: `item_${r}`, number, label: {}, foreignKey: {} })
  }
  return { sourceTableId: id, label: 'Big', columns, rows: rowsArr }
}

const storedPoolLabel = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('loop-studio:graph:v1')
    if (!raw) return null
    return JSON.parse(raw).nodes.find((n: any) => n.data.kind === 'pool')?.data.label ?? null
  })
const livePoolLabel = (page: Page) =>
  page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.find((n: any) => n.data.kind === 'pool')?.data.label ?? null)
const relabelPool = (page: Page, label: string) =>
  page.evaluate((l) => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    const p = g.nodes.find((n: any) => n.data.kind === 'pool')
    g.updateNodeData(p.id, { label: l })
  }, label)

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().addNodeAt('pool', { x: 0, y: 0 }))
  await page.waitForTimeout(600) // the seed's own autosave lands
})

test('over the storage quota: a persistent notice with an export action, no error; clears when a write succeeds again', async ({
  page,
}) => {
  await expect(page.locator('.boot-notice--autosave')).toHaveCount(0)
  const storedBefore = await storedPoolLabel(page)
  await page.evaluate((ts) => (window as unknown as Bridge).__loop.dataImport.getState().loadTables(ts), [
    bigTable(20_000, 4, 'a'),
    bigTable(20_000, 4, 'b'),
  ])
  await relabelPool(page, 'AFTER-BIG-IMPORT')

  const notice = page.locator('.boot-notice--autosave')
  await expect(notice).toBeVisible()
  await expect(notice).toHaveAttribute('data-reason', 'quota')
  await expect(notice).toContainText(/storage is full/i)
  expect(await storedPoolLabel(page)).toBe(storedBefore) // the last good record is kept, not clobbered

  // the way out: the export button downloads the FULL live document
  const dl = page.waitForEvent('download')
  await notice.getByRole('button').click()
  const file = await dl
  expect(file.suggestedFilename()).toBe('loop-studio-graph.json')
  const text = await (await import('node:fs')).promises.readFile((await file.path())!, 'utf8')
  const doc = JSON.parse(text)
  expect(doc.dataImports).toHaveLength(2)
  expect(doc.nodes.find((n: any) => n.data.kind === 'pool').data.label).toBe('AFTER-BIG-IMPORT')

  // it stays while the document is still too big…
  await relabelPool(page, 'STILL-TOO-BIG')
  await page.waitForTimeout(600)
  await expect(notice).toBeVisible()
  // …and clears by itself once a write succeeds (the document shrinks)
  await page.evaluate(() => (window as unknown as Bridge).__loop.dataImport.getState().loadTables([]))
  await relabelPool(page, 'SMALL-AGAIN')
  await expect(notice).toHaveCount(0)
  expect(await storedPoolLabel(page)).toBe('SMALL-AGAIN')
})

test('an edit 150 ms before a reload is kept (pending autosave flushed on pagehide)', async ({ page }) => {
  await relabelPool(page, 'EDIT-THEN-RELOAD')
  await page.waitForTimeout(150) // well inside the 400 ms debounce
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  expect(await livePoolLabel(page)).toBe('EDIT-THEN-RELOAD')
  expect(await storedPoolLabel(page)).toBe('EDIT-THEN-RELOAD')
})

test('the tab going hidden flushes the pending autosave too (hidden transition simulated)', async ({ page }) => {
  // headless Chromium never reports a page as hidden, so the transition is
  // simulated the way the browser delivers it: `document.visibilityState`
  // reads 'hidden' and a `visibilitychange` event fires. The real pagehide
  // path is covered by the reload test above.
  await relabelPool(page, 'EDIT-THEN-HIDE')
  await page.waitForTimeout(100) // inside the 400 ms debounce
  expect(await storedPoolLabel(page)).not.toBe('EDIT-THEN-HIDE')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(await storedPoolLabel(page)).toBe('EDIT-THEN-HIDE')
})

// issue #614 item 5 — the start notice, the language notice and the autosave notice each sat
// in the one fixed place at the top, at one z-index, so with two at once the later one painted
// over the other: on main `ba39e719` the autosave notice covered the language notice's
// Dismiss. They now stack, each whole and each pressable; one alone keeps its place.
test.describe('#614 item 5 — two notices at once', () => {
  const failLanguage = async (page: Page) => {
    await page.route('**/i18n/locales/ko/**', (r) => r.abort())
    await page.route('**/i18n/templateLabels/ko*', (r) => r.abort())
    await page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().setLocale('ko'))
    await expect(page.locator('.boot-notice[role="status"]')).toBeVisible()
  }
  const failAutosave = async (page: Page) => {
    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException('quota', 'QuotaExceededError')
      }
    })
    await relabelPool(page, 'AUTOSAVE-REFUSED')
    await expect(page.locator('.boot-notice--autosave')).toBeVisible()
  }
  const box = (page: Page, sel: string) => page.locator(sel).evaluate((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom } })
  /** the notice's place when alone: its top, and its centre against the window's */
  const place = (page: Page, sel: string) =>
    page.locator(sel).evaluate((e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), centred: Math.abs(b.left + b.width / 2 - window.innerWidth / 2) <= 1 } })
  /** the aborted language load's network errors are expected; nothing else is */
  const onlyExpected = (errors: string[]) => {
    expect(errors.filter((e) => !/ERR_FAILED|Failed to load resource/i.test(e))).toEqual([])
    errors.length = 0
  }

  test('the language notice and the autosave notice do not overlap, and both Dismiss and Export can be pressed', async ({ page, errors }) => {
    await failLanguage(page)
    await failAutosave(page)
    const lang = await box(page, '.boot-notice[role="status"]')
    const save = await box(page, '.boot-notice--autosave')
    const overlap = Math.max(0, Math.min(lang.r, save.r) - Math.max(lang.l, save.l)) * Math.max(0, Math.min(lang.b, save.b) - Math.max(lang.t, save.t))
    expect(overlap, 'the two notices share no area').toBe(0)
    /** the element on top at a button's centre is the button */
    const onTop = (sel: string) =>
      page.locator(sel).evaluate((btn) => {
        const b = btn.getBoundingClientRect()
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        return hit === btn || btn.contains(hit)
      })
    expect(await onTop('.boot-notice[role="status"] button'), 'the language notice’s Dismiss is on top').toBe(true)
    expect(await onTop('.boot-notice--autosave button'), 'the autosave notice’s Export is on top').toBe(true)
    await page.locator('.boot-notice[role="status"] button').click()
    await expect(page.locator('.boot-notice[role="status"]')).toHaveCount(0)
    await expect(page.locator('.boot-notice--autosave'), 'the autosave notice stays').toBeVisible()
    onlyExpected(errors)
  })

  test('control: one notice alone keeps its place at the top, centred', async ({ page, errors }) => {
    await failLanguage(page)
    expect(await place(page, '.boot-notice[role="status"]'), 'the language notice').toEqual({ top: 8, centred: true })
    await page.locator('.boot-notice[role="status"] button').click()
    await failAutosave(page)
    expect(await place(page, '.boot-notice--autosave'), 'the autosave notice').toEqual({ top: 8, centred: true })
    onlyExpected(errors)
  })
})
