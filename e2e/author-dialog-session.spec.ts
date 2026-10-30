import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { openFileMenu, openFileSubmenu } from './support/workbenchMenus'

// issue #412 — reproduction on current main. The Author dialog reads its
// fields from the storage port once, when DialogHost mounts it at boot
// (`useState(readAuthor)`), and never again on open. Which author value does
// the dialog show, and which store does Save write, after a session switch —
// and after a document switch?

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
const save = (page: Page) => dialog(page).locator('.btn--primary').click()
const cancel = (page: Page) => dialog(page).locator('.btn').filter({ hasNotText: /save/i }).first().click()

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

test.describe('the Author dialog across a session switch (#412)', () => {
  test.describe('booted as a temporary session, then switched to the personal browser', () => {
    test.use({ storageMode: 'temporary' })
    test('the dialog shows empty fields although the browser holds a name, and Save without typing deletes the stored author', async ({ page }) => {
      await seedAuthor(page, 'Ada')
      await openApp(page)
      expect(await mode(page)).toBe('temporary')
      expect(await storedAuthor(page)).toBe(JSON.stringify({ name: 'Ada' })) // the browser's record, untouched by the temporary session

      await toPersonal(page)
      const f = await openAuthorDialog(page)
      // READ: the fields are what the dialog read at mount, from the temporary
      // session's empty memory — not the personal browser's record
      await expect(f.name).toHaveValue('') // ← current main (the browser holds "Ada")
      // WRITE: Save goes to the personal browser now, and an empty value removes the record
      await save(page)
      await expect(dialog(page)).toHaveCount(0)
      expect(await storedAuthor(page)).toBeNull() // ← current main: the stored author is gone
    })
  })

  test.describe('booted as the personal browser, then switched to a temporary session', () => {
    test('the dialog still shows the browser\'s name in the temporary session; Save there writes only to memory', async ({ page }) => {
      await seedAuthor(page, 'Ada')
      await openApp(page)
      await resetAll(page)
      const f0 = await openAuthorDialog(page)
      await expect(f0.name).toHaveValue('Ada') // the personal browser: as expected
      await cancel(page)

      await toTemporary(page)
      const f = await openAuthorDialog(page)
      // READ: the value read at mount, from the personal browser, shown on a
      // surface whose copy says a temporary session reads nothing stored
      await expect(f.name).toHaveValue('Ada') // ← current main
      await f.name.fill('Bob')
      await save(page)
      // WRITE: the temporary session's memory; the browser's record is untouched
      expect(await storedAuthor(page)).toBe(JSON.stringify({ name: 'Ada' }))
    })
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
