import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { openFileMenu, openFileSubmenu } from './support/workbenchMenus'

// docs/workbench.md §WB2 — the menu bar's menus open from their trigger's
// start, inside the window; where a menu's rows do not fit they scroll, and
// the keyboard reaches its last row, which scrolls into view. File's two
// submenus (§WB2.2) open beside it, level with their row, inside the window.

/** a rect inside another, 1 px of slack */
const inside = (a: DOMRect | { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
  a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1

const geometry = (page: Page) =>
  page.evaluate(() => {
    const pop = document.querySelector('.toolbar__filemenu-pop') as HTMLElement
    const p = pop.getBoundingClientRect()
    const a = (document.activeElement as HTMLElement).getBoundingClientRect()
    return {
      pop: { left: p.left, right: p.right, top: p.top, bottom: p.bottom },
      active: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
      view: { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight },
      scrolls: pop.scrollHeight > pop.clientHeight,
      activeIsLast: document.activeElement === [...pop.querySelectorAll('[role="menuitem"]')].filter((e) => !(e as HTMLButtonElement).disabled).pop(),
    }
  })

for (const size of [
  { width: 1280, height: 800 },
  { width: 1024, height: 600 },
]) {
  test(`File at ${size.width} × ${size.height}: inside the window; the keyboard reaches the last row, scrolled into view`, async ({ page }) => {
    await page.setViewportSize(size)
    await openApp(page)
    await resetAll(page)
    const trigger = page.locator('.toolbar__filemenu > .wb-mb')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.toolbar__filemenu-pop')).toBeVisible()
    await page.keyboard.press('End')
    const g = await geometry(page)
    expect(inside(g.pop, g.view), 'the popup is inside the window').toBe(true)
    expect(g.activeIsLast, 'End lands on the last row').toBe(true)
    expect(inside(g.active, g.pop), 'the last row is scrolled into the popup').toBe(true)
    // from the closed trigger, ArrowUp enters at the last row too
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await page.keyboard.press('ArrowUp')
    const g2 = await geometry(page)
    expect(g2.activeIsLast).toBe(true)
    expect(inside(g2.active, g2.pop)).toBe(true)
    // and the pointer: the popup's own scroll brings the last row to it
    await page.keyboard.press('Escape')
    await openFileMenu(page)
    const last = page.locator('.toolbar__filemenu-pop [role="menuitem"]').last()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
  })

  test(`File's submenus at ${size.width} × ${size.height}: beside File, level with their row, inside the window`, async ({ page }) => {
    await page.setViewportSize(size)
    await openApp(page)
    await resetAll(page)
    for (const which of ['templates', 'export'] as const) {
      const sub = await openFileSubmenu(page, which)
      const box = await page.evaluate((w) => {
        const r = (el: Element | null) => el!.getBoundingClientRect().toJSON() as { left: number; right: number; top: number; bottom: number }
        return {
          file: r(document.querySelector('.toolbar__filemenu-pop')),
          row: r(document.querySelector(`[data-submenu="${w}"]`)),
          sub: r(document.querySelector('.dmenu--sub')),
          view: { left: 0, right: innerWidth, top: 0, bottom: innerHeight },
        }
      }, which)
      expect(inside(box.sub, box.view), `${which}: inside the window`).toBe(true)
      expect(box.sub.left >= box.file.right - 1 || box.sub.right <= box.file.left + 1, `${which}: beside File, not over it`).toBe(true)
      expect(Math.abs(box.sub.top + 4 - box.row.top), `${which}: its first row level with its row`).toBeLessThanOrEqual(1)
      await expect(sub.locator('[role="menuitem"]').first()).toBeInViewport()
    }
  })
}
