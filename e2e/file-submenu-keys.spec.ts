import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// issue #422 item 4 (Lumi, 2026-11-01) — File and its open submenu each have
// a `useMenuKeyboard` hook, both capture `keydown` on `window`. Ownership: the
// submenu's hook takes the keys only while focus is IN the submenu; File's
// takes them everywhere else, its submenu row included. One key is one focus
// step. With the submenu opened by pointer, focus stays on its row: an arrow
// moves to the next File row and that closes the submenu; Escape there closes
// the submenu and keeps File open. With the submenu opened from the keyboard,
// the arrows walk the submenu and both menus stay open.
//
// Until now the submenu's hook took the keys wherever focus was, so one key
// reached two hooks; a real key press moved focus once only because React
// had already closed the submenu (and removed its listener) between the two
// listeners. A key dispatched from script has no such pause, so it shows the
// two owners directly.

const fileBtn = (page: Page) => page.getByRole('button', { name: 'File', exact: true })
const exportRow = (page: Page) => page.locator('[data-submenu="export"]')
const menus = (page: Page) => page.locator('[role="menu"]')
const subItems = (page: Page) => page.locator('[role="menu"]').nth(1).locator('[role="menuitem"]')
const label = (page: Page) => page.evaluate(() => (document.activeElement?.textContent ?? '').trim())

/** record every focus move from now on */
const recordFocus = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __moves: string[] }
    w.__moves = []
    document.addEventListener('focusin', (e) => w.__moves.push((e.target as HTMLElement).textContent?.trim() ?? ''), true)
  })
const moves = (page: Page) => page.evaluate(() => (window as unknown as { __moves: string[] }).__moves)
/** two animation frames: whatever the key set off has rendered */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

/** File open by pointer, Export's submenu open by pointer: focus stays on the Export row */
async function pointerOpened(page: Page) {
  await openApp(page)
  await resetAll(page)
  await fileBtn(page).click()
  await exportRow(page).click()
  await expect(menus(page)).toHaveCount(2)
  await expect(exportRow(page)).toBeFocused()
  await expect(exportRow(page)).toHaveAttribute('aria-expanded', 'true')
}

/** the next File row after Export, as the arrow should reach it */
const rowAfterExport = (page: Page) =>
  page.evaluate(() => {
    const pop = document.querySelector('[data-submenu="export"]')!.closest('[role="menu"]')!
    const rows = [...pop.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((el) => el.closest('[role="menu"]') === pop)
    const i = rows.findIndex((el) => el.matches('[data-submenu="export"]'))
    return (rows[i + 1]?.textContent ?? '').trim()
  })

test.describe('File and its submenu: one owner per key (#422)', () => {
  test('submenu opened by pointer, focus on its row: one ArrowDown is one step, to the next File row, and the submenu closes', async ({ page }) => {
    await pointerOpened(page)
    const next = await rowAfterExport(page)
    await recordFocus(page)
    await page.keyboard.press('ArrowDown')
    await settle(page)
    expect(await moves(page)).toEqual([next])
    await expect(menus(page)).toHaveCount(1)
    await expect(exportRow(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('the same key dispatched from script (no pause between listeners): still one step', async ({ page }) => {
    await pointerOpened(page)
    const next = await rowAfterExport(page)
    await recordFocus(page)
    await page.evaluate(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
    await settle(page)
    expect(await moves(page)).toEqual([next])
    await expect(menus(page)).toHaveCount(1)
  })

  test('submenu opened by pointer: Escape on its row closes the submenu only, File stays open with focus on the row', async ({ page }) => {
    await pointerOpened(page)
    await recordFocus(page)
    await page.keyboard.press('Escape')
    await settle(page)
    await expect(menus(page)).toHaveCount(1)
    await expect(exportRow(page)).toBeFocused()
    await expect(exportRow(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('submenu opened from the keyboard: the arrows walk the submenu one step a key, and both menus stay open', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await fileBtn(page).click()
    await exportRow(page).focus()
    await page.keyboard.press('ArrowRight')
    await expect(menus(page)).toHaveCount(2)
    const items = await subItems(page).evaluateAll((els) => els.filter((el) => !(el as HTMLButtonElement).disabled).map((el) => (el.textContent ?? '').trim()))
    expect(items.length).toBeGreaterThan(1)
    await expect.poll(() => label(page)).toBe(items[0])
    await recordFocus(page)
    await page.keyboard.press('ArrowDown')
    await settle(page)
    expect(await moves(page)).toEqual([items[1]])
    await expect(menus(page)).toHaveCount(2)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp') // wraps to the submenu's last row, not into File
    await settle(page)
    expect(await moves(page)).toEqual([items[1], items[0], items[items.length - 1]])
    await expect(menus(page)).toHaveCount(2)
  })
})
