import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { closeMenu, openViewMenu, pickLocale } from './support/workbenchMenus'

// docs/workbench.md §WB2 — a menu's check row reads "mark | name" on ONE line:
// View's four toggles (Focus, Filters, Activity overlay, Minimap) and Edit ▸
// Lock editing. The mark keeps its column when it is off, so the name starts
// at the same place on and off. v0.29.0 stacked the mark over the name (the
// shared `.menu__item` is a column, and the check rows did not set a row).

type Box = { left: number; right: number; top: number; bottom: number }
type Geo = { mark: Box; name: Box; row: Box }

/** the row's mark and name boxes, as laid out */
const geometry = (row: Locator): Promise<Geo> =>
  row.evaluate((el) => {
    const box = (e: Element) => {
      const r = e.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    return { mark: box(el.querySelector('.wb-menu__mark')!), name: box(el.querySelector('.menu__name')!), row: box(el) }
  })

/** the mark sits beside the name, before it, on the name's line */
function expectOneLine(g: Geo, what: string) {
  const markMid = (g.mark.top + g.mark.bottom) / 2
  expect(markMid, `${what}: the mark is on the name's line`).toBeGreaterThanOrEqual(g.name.top - 0.5)
  expect(markMid, `${what}: the mark is on the name's line`).toBeLessThanOrEqual(g.name.bottom + 0.5)
  expect(g.mark.right, `${what}: the mark comes before the name`).toBeLessThanOrEqual(g.name.left + 0.5)
  expect(g.mark.right - g.mark.left, `${what}: the mark keeps its column`).toBeGreaterThanOrEqual(13.5)
}

const VIEW_ROWS = ['focus', 'filter', 'activity', 'minimap'] as const
const viewToggle = (page: Page, hook: string) => page.locator(`.wb-viewmenu__pop [data-view-row="${hook}"]`)
const editTrigger = (page: Page) => page.locator('[data-menu="edit"] > .wb-mb')
const lockRow = (page: Page) => page.locator('[data-menu="edit"] [role="menuitemcheckbox"]')

async function openEdit(page: Page) {
  const t = editTrigger(page)
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click()
  await expect(lockRow(page)).toBeVisible()
}

for (const locale of ['en', 'ko'] as const) {
  for (const forced of [false, true]) {
    test(`check rows read "mark | name" on one line, on and off (${locale}${forced ? ', forced colours' : ''})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      if (forced) await page.emulateMedia({ forcedColors: 'active' })
      await openApp(page)
      await resetAll(page)
      if (locale === 'ko') await pickLocale(page, 'ko')

      // View: each toggle, off and on, by a click (View stays open across its
      // rows); the name does not move when the mark appears
      await openViewMenu(page)
      for (const hook of VIEW_ROWS) {
        const row = viewToggle(page, hook)
        const before = await row.getAttribute('aria-pressed')
        const a = await geometry(row)
        expectOneLine(a, `${hook} (${before})`)
        await row.click()
        await openViewMenu(page)
        await expect(row).not.toHaveAttribute('aria-pressed', before!)
        const b = await geometry(row)
        expectOneLine(b, `${hook} (toggled)`)
        expect(b.name.left, `${hook}: the name starts at the same place on and off`).toBeCloseTo(a.name.left, 1)
        // back as it was, so the next row's menu sits over the same canvas
        await row.click()
        await openViewMenu(page)
        await expect(row).toHaveAttribute('aria-pressed', before!)
      }
      await page.locator('.toolbar__actions .wb-viewmenu > .wb-mb').click()
      await expect(page.locator('.wb-viewmenu__pop')).toHaveCount(0)

      // Edit ▸ Lock editing: off, then on by a click (the menu closes), then
      // off again by the keyboard
      await openEdit(page)
      await expect(lockRow(page)).toHaveAttribute('aria-checked', 'false')
      const off = await geometry(lockRow(page))
      expectOneLine(off, 'lock (off)')
      await lockRow(page).click()
      await expect(page.locator('[data-menu="edit"] [role="menu"]')).toHaveCount(0)
      await openEdit(page)
      await expect(lockRow(page)).toHaveAttribute('aria-checked', 'true')
      const on = await geometry(lockRow(page))
      expectOneLine(on, 'lock (on)')
      expect(on.name.left, 'lock: the name starts at the same place on and off').toBeCloseTo(off.name.left, 1)
      await closeMenu(page, 'edit')
      await editTrigger(page).focus()
      await page.keyboard.press('ArrowUp')
      await expect(lockRow(page)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('[data-menu="edit"] [role="menu"]')).toHaveCount(0)
      await openEdit(page)
      await expect(lockRow(page)).toHaveAttribute('aria-checked', 'false')
      await closeMenu(page, 'edit')
    })
  }
}

test('View toggles work from the keyboard: Tab reaches a toggle, Space flips it, the row stays one line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page)
  await resetAll(page)
  const trigger = page.locator('.toolbar__actions .wb-viewmenu > .wb-mb')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.wb-viewmenu__pop')).toBeVisible()
  const row = viewToggle(page, 'activity')
  for (let i = 0; i < 12 && !(await row.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(row).toBeFocused()
  const before = await row.getAttribute('aria-pressed')
  await page.keyboard.press('Space')
  await expect(row).not.toHaveAttribute('aria-pressed', before!)
  expectOneLine(await geometry(row), 'activity (keyboard)')
  await page.keyboard.press('Space')
  await expect(row).toHaveAttribute('aria-pressed', before!)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})
