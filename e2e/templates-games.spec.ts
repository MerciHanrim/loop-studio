// #545 — the game examples as a group (Hanrim / Lumi, 2026-11-10). File ▸ Templates lists the
// process and industry Templates, then "Games ›", which turns the submenu's rows into the game
// Templates under a "‹ Templates" row; the phone's Templates sheet does the same in its sheet,
// with each Template a full-width row (its name, its description under it); Help ▸ Example
// notes puts the game notes under a "Games" heading. Opening a Template is as before.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { fileSubmenu, openFileMenu, openFileSubmenu, pickLocale, pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, any> }
const GAMES = ['mmo-progression', 'gacha-general', 'gacha-standard', 'gacha-pickup', 'gacha-banner-zones']
const TOP = ['desalination', 'coffee-roasting-batch', 'coffee-roastery']

const shownIds = (page: Page) => fileSubmenu(page).locator('[data-template]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.template))
const focusedHtml = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.outerHTML.slice(0, 140) ?? 'none')

test.describe('#545 — the game examples as a group', () => {
  test('File ▸ Templates: the process and industry Templates, then Games ›, which turns into the game Templates and back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    const sub = await openFileSubmenu(page, 'templates')
    expect(await shownIds(page)).toEqual(TOP)
    const games = sub.locator('[data-template-group="games"]')
    await expect(games).toHaveAttribute('role', 'menuitem')
    await expect(games).toHaveAttribute('aria-haspopup', 'menu')
    await expect(games.locator('.menu__name')).toHaveText('Games')
    await games.click()
    await expect(sub.locator('[data-template-back]')).toBeVisible()
    await expect(sub.locator('[data-template-back] .menu__name')).toHaveText('Templates')
    await expect.poll(() => shownIds(page)).toEqual(GAMES)
    // the row chosen is gone, so focus moves with it: to the first game
    await expect(sub.locator(`[data-template="${GAMES[0]}"]`)).toBeFocused()
    // the back row turns the rows back, focus on Games
    await sub.locator('[data-template-back]').click()
    await expect.poll(() => shownIds(page)).toEqual(TOP)
    await expect(sub.locator('[data-template-group="games"]')).toBeFocused()
  })

  // #545 follow-up (Hanrim / Lumi, 2026-11-11): the "›" of Games and the "‹" of the way back
  // dropped under their names, as the rows stacked their marks like a description
  for (const locale of ['en', 'ko'] as const) {
    test(`${locale}: "Games ›" and "‹ Templates" keep the mark on the name's line`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openApp(page)
      if (locale !== 'en') await pickLocale(page, locale)
      const sub = await openFileSubmenu(page, 'templates')
      const place = (row: string) =>
        sub.locator(row).evaluate((el) => {
          const n = el.querySelector('.menu__name')!.getBoundingClientRect()
          const c = el.querySelector('.dmenu__chev')!.getBoundingClientRect()
          const r = el.getBoundingClientRect()
          return { oneLine: c.top < n.bottom - 1 && c.bottom > n.top + 1, after: c.left >= n.right, before: c.right <= n.left, atEnd: r.right - c.right, h: Math.round(r.height) }
        })
      // the height to match is File's own "Templates ›" row: a name and its mark on one line
      // (a plain row without a mark is lower, as the mark's glyph is the larger)
      const plainH = await page.locator('.toolbar__filemenu-pop [data-submenu="templates"]').evaluate((el) => Math.round(el.getBoundingClientRect().height))
      const games = await place('[data-template-group="games"]')
      expect(games, 'Games: "›" on the name’s line, after it, at the row’s end').toMatchObject({ oneLine: true, after: true })
      expect(games.atEnd).toBeLessThan(24)
      expect(games.h).toBeLessThanOrEqual(plainH)
      await sub.locator('[data-template-group="games"]').click()
      await expect(sub.locator('[data-template-back]')).toBeVisible()
      const back = await place('[data-template-back]')
      expect(back, 'the way back: "‹" on the name’s line, before it').toMatchObject({ oneLine: true, before: true })
      expect(back.h).toBeLessThanOrEqual(plainH)
    })
  }

  test('the keyboard: Arrow Right or Enter into Games, Escape or Arrow Left back to the Templates, and Escape again closes the submenu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await openFileMenu(page)
    const tRow = page.locator('.toolbar__filemenu-pop [data-submenu="templates"]')
    await tRow.focus()
    await page.keyboard.press('ArrowRight')
    const sub = fileSubmenu(page)
    await expect(sub.locator(`[data-template="${TOP[0]}"]`)).toBeFocused()
    const gamesRow = sub.locator('[data-template-group="games"]')
    const firstGame = sub.locator(`[data-template="${GAMES[0]}"]`)
    const backRow = sub.locator('[data-template-back]')
    await page.keyboard.press('End')
    await expect(gamesRow, await focusedHtml(page)).toBeFocused()
    // Arrow Right goes in, focus on the first game
    await page.keyboard.press('ArrowRight')
    await expect(firstGame).toBeFocused()
    await expect.poll(() => shownIds(page)).toEqual(GAMES)
    // Home reaches the back row; End the last game
    await page.keyboard.press('Home')
    await expect(backRow).toBeFocused()
    await page.keyboard.press('End')
    await expect(sub.locator(`[data-template="${GAMES.at(-1)}"]`)).toBeFocused()
    // Escape goes back to the Templates (the submenu stays open), focus on Games
    await page.keyboard.press('Escape')
    await expect(sub).toBeVisible()
    await expect.poll(() => shownIds(page)).toEqual(TOP)
    await expect(gamesRow).toBeFocused()
    // Enter goes in; Arrow Left comes back
    await page.keyboard.press('Enter')
    await expect(firstGame).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => shownIds(page)).toEqual(TOP)
    await expect(gamesRow).toBeFocused()
    // the back row by keyboard: in, Home to it, Enter
    await page.keyboard.press('Enter')
    await expect(firstGame).toBeFocused()
    await page.keyboard.press('Home')
    await expect(backRow).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => shownIds(page)).toEqual(TOP)
    await expect(gamesRow).toBeFocused()
    // Escape at the Templates closes the submenu, as before, back to its row
    await page.keyboard.press('Escape')
    await expect(fileSubmenu(page)).toHaveCount(0)
    await expect(tRow).toBeFocused()
  })

  test('a game Template opens from the group, by keyboard, as before', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await openFileMenu(page)
    await page.locator('.toolbar__filemenu-pop [data-submenu="templates"]').focus()
    const sub = fileSubmenu(page)
    await page.keyboard.press('ArrowRight')
    await expect(sub.locator(`[data-template="${TOP[0]}"]`)).toBeFocused()
    await page.keyboard.press('End')
    await expect(sub.locator('[data-template-group="games"]')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(sub.locator(`[data-template="${GAMES[0]}"]`)).toBeFocused()
    // to the Pickup gacha and open it (an empty document: no confirmation)
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
    await expect(sub.locator('[data-template="gacha-pickup"]')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length)).toBeGreaterThan(10)
    // and the helper's way, which opens Games first
    await resetAll(page)
    await pickTemplate(page, 'mmo-progression')
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length)).toBe(97)
  })

  test('the phone at 320 × 640: full-width rows, the Games sheet, Escape back, and the last game reached by scrolling and opened', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await openApp(page)
    // a document open, so opening a Template asks to replace it, as before
    await importGraph(page, readFileSync(new URL('../examples/coffee-roastery.json', import.meta.url), 'utf8'))
    await page.locator('.mob-more').click()
    await page.locator('.sheet [data-more-row="templates"]').click()
    const sheet = page.locator('.sheet')
    expect(await sheet.locator('[data-template]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.template))).toEqual(TOP)
    // each row: the name above its description, both across the row
    const layout = await sheet.locator('.sheet__row--stacked').evaluateAll((els) =>
      els.map((r) => {
        const n = r.querySelector('.sheet__row-name')!.getBoundingClientRect()
        const d = r.querySelector('.sheet__row-sub')!.getBoundingClientRect()
        const b = r.getBoundingClientRect()
        return { nameAbove: n.bottom <= d.top + 0.5, nameWide: n.width > b.width * 0.8, inside: b.right <= window.innerWidth + 0.5 }
      }),
    )
    expect(layout).toHaveLength(4) // three Templates and the Games row
    for (const l of layout) expect(l).toEqual({ nameAbove: true, nameWide: true, inside: true })
    await sheet.locator('[data-template-group="games"]').click()
    expect(await sheet.locator('[data-template]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.template))).toEqual(GAMES)
    // Escape goes back to the Templates, focus on Games
    await page.keyboard.press('Escape')
    await expect(sheet.locator('[data-template-group="games"]')).toBeFocused()
    await sheet.locator('[data-template-group="games"]').click()
    // the last game: scrolled to, wholly above the run bar, then chosen
    const last = sheet.locator('[data-template="gacha-banner-zones"]')
    await last.scrollIntoViewIfNeeded()
    const clear = await page.evaluate(() => {
      const r = document.querySelector('.sheet [data-template="gacha-banner-zones"]')!.getBoundingClientRect()
      const bar = document.querySelector('.pstrip--mobile')!.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= bar.top + 0.5
    })
    expect(clear, 'the last game scrolls wholly into view above the run bar').toBe(true)
    await last.click()
    await page.locator('.mcdlg--confirm .btn--primary').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length)).toBeGreaterThan(40)
  })

  test('Help ▸ Example notes: the process and industry notes, then the games under a Games heading', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await page.getByRole('button', { name: 'Help' }).click()
    await page.getByRole('menuitem', { name: 'Example notes' }).click()
    const groups = page.locator('.mcdlg--example-notes .example-notes__group')
    await expect(groups).toHaveCount(2)
    expect(await groups.nth(0).locator('[data-example]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.example))).toEqual(TOP)
    await expect(groups.nth(1)).toHaveAttribute('role', 'group')
    await expect(page.getByRole('group', { name: 'Games' })).toBeVisible()
    expect(await groups.nth(1).locator('[data-example]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.example))).toEqual(GAMES)
  })
})
