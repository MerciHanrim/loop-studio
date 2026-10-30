import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { openFileMenu, openFileSubmenu } from './support/workbenchMenus'

// issue #412 — the Author dialog and a session switch (Lumi, 2026-10-30). The
// dialog is mounted once at boot; its draft is re-read from the storage port
// on every closed → open transition, and only then, so it shows the CURRENT
// session's record: the browser's stored name after temporary → personal (and
// an untouched Save keeps it), nothing after personal → temporary (and a Save
// there reaches only the temporary memory). Typing is never overwritten while
// the dialog is open; a document switch is not a trigger, the author being the
// session's, not the document's. Until v0.31.0 the fields were read once at
// boot: empty over a stored name after temporary → personal (a Save then
// deleted the record), the browser's name inside a temporary session.

const AUTHOR_KEY = 'loop-studio:author'
const storedAuthor = (page: Page) => page.evaluate((k) => localStorage.getItem(k), AUTHOR_KEY)
const seedAuthor = (page: Page, name: string) =>
  page.addInitScript(
    ([k, n]) => {
      try {
        if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ name: n }))
      } catch {
        /* opaque origin */
      }
    },
    [AUTHOR_KEY, name] as const,
  )
const mode = (page: Page) => page.evaluate(() => (window as unknown as { __loop: { storage: { mode: () => string } } }).__loop.storage.mode())

const dialog = (page: Page) => page.locator('.mcdlg--confirm').filter({ has: page.locator('input[type="text"]') })
async function openAuthorDialog(page: Page) {
  await openFileMenu(page)
  await page.locator('.toolbar__filemenu-pop [role="menuitem"]').filter({ hasText: 'Set the export author' }).click()
  await expect(dialog(page)).toBeVisible()
  return { name: dialog(page).locator('input[type="text"]'), note: dialog(page).locator('textarea') }
}
async function save(page: Page) {
  await dialog(page).locator('.btn--primary').click()
  await expect(dialog(page)).toHaveCount(0)
}
async function cancel(page: Page) {
  await dialog(page).locator('.btn').filter({ hasNotText: /save/i }).first().click()
  await expect(dialog(page)).toHaveCount(0)
}

const storageDialog = (page: Page) => page.locator('.mcdlg--storage')
async function toTemporary(page: Page) {
  await openFileMenu(page)
  await page.locator('[data-settings-row="storage-privacy"]').click()
  await expect(storageDialog(page)).toHaveAttribute('data-storage-step', 'menu')
  await storageDialog(page).locator('[data-storage-action="to-temporary"]').click()
  await storageDialog(page).locator('[data-storage-confirm]').click()
  await expect(storageDialog(page)).toHaveCount(0)
  expect(await mode(page)).toBe('temporary')
}
async function toPersonal(page: Page) {
  await page.locator('[data-session-chip="temporary"]').click()
  await page.locator('.session-chip__pop').getByRole('menuitem', { name: /Save in this browser/ }).click()
  await expect(storageDialog(page)).toHaveAttribute('data-storage-step', 'toPersonal')
  await storageDialog(page).locator('[data-storage-confirm]').click()
  await expect(storageDialog(page)).toHaveCount(0)
  expect(await mode(page)).toBe('personal')
}

test.describe('the Author dialog reads the current session on open (#412)', () => {
  test.describe('booted as a temporary session, then switched to the personal browser', () => {
    test.use({ storageMode: 'temporary' })
    test('the dialog shows the browser\'s stored name, and Save without typing keeps it', async ({ page }) => {
      await seedAuthor(page, 'Ada')
      await openApp(page)
      expect(await mode(page)).toBe('temporary')
      // in the temporary session the dialog shows nothing of the browser's
      const f0 = await openAuthorDialog(page)
      await expect(f0.name).toHaveValue('')
      await cancel(page)

      await toPersonal(page)
      const f = await openAuthorDialog(page)
      await expect(f.name).toHaveValue('Ada') // re-read on open: the personal browser's record
      await save(page)
      expect(await storedAuthor(page)).toBe(JSON.stringify({ name: 'Ada' })) // an untouched Save changes nothing
    })
  })

  test.describe('booted as the personal browser, then switched to a temporary session', () => {
    test('the dialog shows nothing of the browser\'s name; a Save there reaches only the temporary memory', async ({ page }) => {
      await seedAuthor(page, 'Ada')
      await openApp(page)
      await resetAll(page)
      const f0 = await openAuthorDialog(page)
      await expect(f0.name).toHaveValue('Ada')
      await cancel(page)

      await toTemporary(page)
      const f = await openAuthorDialog(page)
      await expect(f.name).toHaveValue('') // re-read on open: the temporary memory, empty
      await f.name.fill('Bob')
      await save(page)
      expect(await storedAuthor(page)).toBe(JSON.stringify({ name: 'Ada' })) // the browser's record is untouched
      // and the temporary session's own record is what it shows next
      const f2 = await openAuthorDialog(page)
      await expect(f2.name).toHaveValue('Bob')
      await cancel(page)
    })
  })

  test('typing is not overwritten while the dialog is open; Cancel discards it and the next open re-reads the record', async ({ page }) => {
    await seedAuthor(page, 'Ada')
    await openApp(page)
    await resetAll(page)
    const f = await openAuthorDialog(page)
    await f.name.fill('Grace')
    await f.note.fill('a note')
    // a store change while the dialog is open is not pulled into the draft
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ name: 'Someone else' })), AUTHOR_KEY)
    await page.waitForTimeout(100)
    await expect(f.name).toHaveValue('Grace')
    await expect(f.note).toHaveValue('a note')
    await cancel(page)
    const f2 = await openAuthorDialog(page)
    await expect(f2.name).toHaveValue('Someone else') // the next open reads the record as it stands
    await expect(f2.note).toHaveValue('')
    await f2.name.fill('Grace')
    await save(page)
    expect(await storedAuthor(page)).toBe(JSON.stringify({ name: 'Grace' }))
  })

  test('a document switch alone: the author is the session\'s, not the document\'s — the same value before and after a Template load', async ({ page }) => {
    await seedAuthor(page, 'Ada')
    await openApp(page)
    await resetAll(page)
    const f0 = await openAuthorDialog(page)
    await expect(f0.name).toHaveValue('Ada')
    await cancel(page)
    const sub = await openFileSubmenu(page, 'templates')
    await sub.locator('[data-template="coffee-roastery"]').click()
    const confirm = page.locator('.mcdlg--confirm .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __loop: { graph: { getState: () => { nodes: unknown[] } } } }).__loop.graph.getState().nodes.length)).toBeGreaterThan(5)
    const f = await openAuthorDialog(page)
    await expect(f.name).toHaveValue('Ada')
    await cancel(page)
    expect(await storedAuthor(page)).toBe(JSON.stringify({ name: 'Ada' }))
  })
})
