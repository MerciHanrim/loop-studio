import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expect, openApp, resetAll, test } from './support/loop'

// Issue #334 — every whole-document replacement is a document BOUNDARY, driven
// through the real UI (the dev bridge only reads state, it never makes the
// swap): File → New, a temporary session without the document, Delete work
// data, a Template, an imported file and a share link.
//  - the undo history starts empty: Undo and Redo are disabled, and Ctrl+Z
//    cannot bring the previous document back (the confirmation before the
//    swap is the safety net);
//  - the lock is the NEW document's: New / a temporary session / Delete work
//    data start unlocked, a locked Template or file opens locked, also after a
//    reload.

type Bridge = { __loop: Record<string, { getState: () => any }> }

const MMO = readFileSync(new URL('../examples/mmo-progression.json', import.meta.url), 'utf8') // canvasLocked: true
const COFFEE = readFileSync(new URL('../examples/coffee-roastery.json', import.meta.url), 'utf8') // no lock

const lockBtn = (page: Page) => page.locator('.react-flow__controls-button.rf-lock')
const undoBtn = (page: Page) => page.locator('.toolbar button[title^="Undo"]')
const redoBtn = (page: Page) => page.locator('.toolbar button[title^="Redo"]')
const nodeCount = (page: Page) => page.locator('.react-flow__node').count()
const history = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return { past: g.past.length, future: g.future.length, nodes: g.nodes.length }
  })

/** the confirmation the app asks before replacing a diagram that is not the
 *  untouched sample — pressed when it appears */
async function confirmIfAsked(page: Page): Promise<void> {
  const confirm = page.locator('.mcdlg--confirm .mcdlg__foot button').nth(1)
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click()
  await expect(page.locator('.mcdlg--confirm')).toHaveCount(0)
}
async function fileNew(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New', exact: true }).click()
  await confirmIfAsked(page)
}
async function openTemplate(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  await page.locator('[role=menuitem]').filter({ hasText: name }).first().click()
  await confirmIfAsked(page)
}
async function importFile(page: Page, text: string): Promise<void> {
  await page.locator('input[type=file][accept*="json"]').first().setInputFiles({ name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') })
  await confirmIfAsked(page)
}
/** a palette click: adds a node only while the canvas is unlocked */
async function addPool(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pool', exact: true }).click()
}
/** an edited session: the palette added two Pools, one was undone */
async function editedSession(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await addPool(page)
  await addPool(page)
  await undoBtn(page).click()
  await expect(undoBtn(page)).toBeEnabled()
  await expect(redoBtn(page)).toBeEnabled()
}
async function expectUnlockedEmptyHistory(page: Page): Promise<void> {
  await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.canvas.canvas--locked')).toHaveCount(0)
  await expect(undoBtn(page)).toBeDisabled()
  await expect(redoBtn(page)).toBeDisabled()
  expect(await history(page)).toMatchObject({ past: 0, future: 0 })
}
async function reload(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __loop: { autosave: { flush: () => void } } }).__loop.autosave.flush())
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
  await expect(page.locator('.react-flow')).toBeVisible()
}

// the Storage and privacy area (e2e/storage-sessions.spec.ts has the full flows)
const storageDialog = (page: Page) => page.locator('.mcdlg--storage')
async function storageAction(page: Page, action: 'to-temporary' | 'delete-work'): Promise<void> {
  await page.locator('.toolbar__settingsmenu > button').click()
  await page.locator('[data-settings-row="storage-privacy"]').click()
  await expect(storageDialog(page)).toHaveAttribute('data-storage-step', 'menu')
  await storageDialog(page).locator(`[data-storage-action="${action}"]`).click()
  await storageDialog(page).locator('[data-storage-confirm]').click()
  if (action === 'delete-work') {
    await expect(storageDialog(page).locator('[data-storage-notice="done"]')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await expect(storageDialog(page)).toHaveCount(0)
}

test.describe('#334 — a new document starts unlocked, with no history', () => {
  test('File → New from the locked MMO template: unlocked, empty, Undo and Redo disabled; a palette click edits; a reload keeps it unlocked', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openTemplate(page, 'Early MMO progression')
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'true')

    await fileNew(page)
    expect(await nodeCount(page)).toBe(0)
    await expectUnlockedEmptyHistory(page)
    await addPool(page)
    await expect(page.locator('.react-flow__node')).toHaveCount(1)

    await reload(page)
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('a temporary session without the document, from a locked template: unlocked, no history', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openTemplate(page, 'Early MMO progression')
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await storageAction(page, 'to-temporary')
    expect(await nodeCount(page)).toBe(0)
    await expectUnlockedEmptyHistory(page)
  })

  test('Delete work data, from a locked template: unlocked, no history', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await openTemplate(page, 'Early MMO progression')
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await storageAction(page, 'delete-work')
    expect(await nodeCount(page)).toBe(0)
    await expectUnlockedEmptyHistory(page)
  })
})

test.describe('#334 — every other document starts with an empty history and its own lock', () => {
  test('a Template: Undo and Redo disabled, Ctrl+Z brings nothing back', async ({ page }) => {
    await editedSession(page)
    await openTemplate(page, 'Coffee roastery')
    const opened = await history(page)
    expect(opened).toMatchObject({ past: 0, future: 0 })
    await expect(undoBtn(page)).toBeDisabled()
    await expect(redoBtn(page)).toBeDisabled()
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    expect((await history(page)).nodes).toBe(opened.nodes)
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('an imported file: Undo and Redo disabled; a locked file opens locked and stays so after a reload', async ({ page }) => {
    await editedSession(page)
    await importFile(page, COFFEE)
    expect(await history(page)).toMatchObject({ past: 0, future: 0 })
    await expect(undoBtn(page)).toBeDisabled()
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'false')

    await importFile(page, MMO)
    expect(await history(page)).toMatchObject({ past: 0, future: 0 })
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await reload(page)
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'true')

    // and back: an unlocked file from a locked session opens unlocked
    await importFile(page, COFFEE)
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('a share link: Undo and Redo disabled after it opens, and its own lock', async ({ page }) => {
    await editedSession(page)
    const payload = await page.evaluate(async (text) => {
      const M = await import('/src/model/share.ts')
      return (await M.encodeShareText(text)).payload
    }, MMO)
    await page.goto('about:blank')
    page.once('dialog', (d) => void d.accept()) // the stored diagram is not the untouched sample
    await page.goto('/#g1=' + payload)
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await page.waitForFunction(() => location.hash === '')
    await expect.poll(async () => (await history(page)).nodes).toBeGreaterThan(50)
    expect(await history(page)).toMatchObject({ past: 0, future: 0 })
    await expect(undoBtn(page)).toBeDisabled()
    await expect(redoBtn(page)).toBeDisabled()
    await expect(lockBtn(page)).toHaveAttribute('aria-pressed', 'true')
  })
})
