import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { fileSubmenu, openFileMenu, openFileSubmenu, pickLocale } from './support/workbenchMenus'

// docs/workbench.md §WB2.2 — File: New, Import | Templates ›, Export › |
// the two structure rows | Set the export author…, Storage & privacy…. Every
// row is a name on one line; File and each submenu describe the current row
// in one area at their foot. A submenu opens on a click (no hover timer), or
// Arrow Right / Enter / Space on its row; Arrow Left or Escape closes it
// alone; Tab closes File. Touch: a press selects a Template or a format and
// shows its description with an explicit Open / Export button.

const file = (page: Page) => page.locator('.toolbar__filemenu-pop')
const trigger = (page: Page) => page.locator('.toolbar__filemenu > .wb-mb')
const shown = (panel: Locator) => panel.locator('.dmenu__desc.is-shown')
const names = (panel: Locator) => panel.locator('[role="menuitem"] .menu__name').allInnerTexts()

/** a row is one line: its name's box is one line box tall */
const oneLine = (row: Locator) =>
  row.evaluate((el) => {
    const n = el.querySelector('.menu__name') as HTMLElement
    const lh = parseFloat(getComputedStyle(n).lineHeight) || parseFloat(getComputedStyle(n).fontSize) * 1.25
    return n.getBoundingClientRect().height <= lh * 1.5
  })

for (const locale of ['en', 'ko'] as const) {
  test(`structure (${locale}): File's rows, the two submenus, every row a name on one line, no description under a row`, async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    if (locale === 'ko') await pickLocale(page, 'ko')
    await openFileMenu(page)
    expect(await names(file(page))).toEqual(
      locale === 'en'
        ? ['New', 'Import', 'Templates', 'Export', 'Save selected structure…', 'Insert saved structure…', 'Set the export author…', 'Storage and privacy…']
        : ['새로 만들기', '가져오기', '템플릿', '내보내기', '선택한 구조 저장…', '저장한 구조 삽입…', '작성자 정보 설정…', '저장 및 개인정보…'],
    )
    await expect(page.locator('.toolbar__filemenu .menu__blurb')).toHaveCount(0)
    for (const row of await file(page).locator('[role="menuitem"]').all()) expect(await oneLine(row)).toBe(true)

    const templates = await openFileSubmenu(page, 'templates')
    // 0.30.0: eight — Early MMO is in the menu again, after Coffee
    await expect(templates.locator('[data-template]')).toHaveCount(8)
    await expect(templates.locator('[data-template="mmo-progression"] .menu__name')).toHaveText(
      locale === 'en' ? 'Early MMO progression (levels 1–15)' : '초반 MMO 성장 (1–15레벨)',
    )
    for (const row of await templates.locator('[role="menuitem"]').all()) expect(await oneLine(row)).toBe(true)
    const exports = await openFileSubmenu(page, 'export')
    await expect(templates).toHaveCount(1) // the same panel, now Export: one submenu at a time
    expect(await names(exports)).toEqual(
      locale === 'en' ? ['Graph JSON', 'Workspace JSON', 'Project revision', 'Make a proposal'] : ['그래프 JSON', '워크스페이스 JSON', '프로젝트 리비전', '제안 만들기'],
    )
    await expect(page.locator('.toolbar__filemenu .menu__blurb')).toHaveCount(0)
  })
}

test('the submenu rows: menu semantics, open by a click only (no hover timer), one at a time', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await openFileMenu(page)
  const tRow = file(page).locator('[data-submenu="templates"]')
  const eRow = file(page).locator('[data-submenu="export"]')
  await expect(tRow).toHaveAttribute('aria-haspopup', 'menu')
  await expect(tRow).toHaveAttribute('aria-expanded', 'false')
  // pointing alone opens nothing, however long
  await eRow.hover()
  await page.waitForTimeout(400)
  await expect(fileSubmenu(page)).toHaveCount(0)
  await tRow.click()
  await expect(tRow).toHaveAttribute('aria-expanded', 'true')
  const sub = fileSubmenu(page)
  await expect(sub).toBeVisible()
  const menu = sub.locator('[role="menu"]')
  await expect(menu).toHaveAttribute('aria-label', 'Templates')
  expect(await tRow.getAttribute('aria-controls')).toBe(await menu.getAttribute('id'))
  // Export replaces it
  await eRow.click()
  await expect(tRow).toHaveAttribute('aria-expanded', 'false')
  await expect(eRow).toHaveAttribute('aria-expanded', 'true')
  await expect(sub.locator('[role="menu"]')).toHaveAttribute('aria-label', 'Export')
  // its row again closes it
  await eRow.click()
  await expect(fileSubmenu(page)).toHaveCount(0)
  await expect(file(page)).toBeVisible()

  // a switch carries nothing over: a touch selection in one submenu leaves no
  // description and no Open / Export button in the other. The switch is a
  // click that moves no focus (a browser need not focus the row it taps), so
  // the submenu's own state is what is checked, both ways.
  const touchSelect = async (row: Locator) => {
    await row.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true })
    await row.dispatchEvent('click', { detail: 1 })
  }
  for (const [from, to, row] of [
    [tRow, eRow, '[data-template="gacha-pickup"]'],
    [eRow, tRow, '[role="menuitem"]:has-text("Graph JSON")'],
  ] as const) {
    await from.click()
    await touchSelect(sub.locator(row))
    await expect(sub.locator('.dmenu__act')).toBeVisible()
    await to.dispatchEvent('click', { detail: 1 })
    await expect(to).toHaveAttribute('aria-expanded', 'true')
    await expect(sub.locator('.dmenu__act'), 'no button carried over').toHaveCount(0)
    await expect(shown(sub), 'no description carried over: the hint').toHaveClass(/dmenu__hint/)
    await to.click() // closed again
    await expect(fileSubmenu(page)).toHaveCount(0)
  }
})

test('the description area: the pointed row, else the focused one; none for a row without one; the hint for none; one height', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  const sub = await openFileSubmenu(page, 'templates')
  // opened with the pointer: nothing current yet, the hint
  await expect(shown(sub)).toHaveText('Select an item to see its description')
  await expect(shown(sub)).toHaveClass(/dmenu__hint/)
  const area = sub.locator('.dmenu__area')
  const h0 = (await area.boundingBox())!.height
  const rows = sub.locator('[data-template]')
  for (let i = 0; i < 7; i++) {
    const row = rows.nth(i)
    await row.hover()
    const desc = await shown(sub).innerText()
    // the area shows the row's own description, which describes the row
    await expect(row).toHaveAccessibleDescription(desc)
    expect(desc.length).toBeGreaterThan(10)
    expect((await area.boundingBox())!.height, 'the area keeps its height row to row').toBeCloseTo(h0, 0)
  }
  // pointing does not move focus (a screen reader says nothing on a hover)
  const focusedBefore = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))
  await rows.nth(2).hover()
  expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))).toBe(focusedBefore)
  // the pointer leaves the rows: the hint again (nothing in the submenu has focus)
  await page.mouse.move(5, 790)
  await expect(shown(sub)).toHaveClass(/dmenu__hint/)

  // File's own area: a structure row's description; a row without one (New)
  // shows none, not the previous row's
  const save = file(page).locator('[role="menuitem"]').filter({ hasText: 'Save selected structure' })
  await save.hover()
  await expect(shown(file(page))).toHaveText('Saves the selected nodes and the connections between them to a file.')
  await file(page).locator('[role="menuitem"]').filter({ hasText: /^New$/ }).hover()
  await expect(shown(file(page))).toHaveCount(0)
  const author = file(page).locator('[role="menuitem"]').filter({ hasText: 'Set the export author' })
  await expect(author).toHaveAccessibleDescription('device-local label attached, unverified, to the file')
  await expect(save).toHaveAccessibleName('Save selected structure…')
})

test('the keyboard: Arrow Right / Enter / Space open a submenu at its first row; Arrow Left and Escape close it alone; Escape again closes File', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await trigger(page).focus()
  await page.keyboard.press('Enter')
  const tRow = file(page).locator('[data-submenu="templates"]')
  const eRow = file(page).locator('[data-submenu="export"]')
  for (let i = 0; i < 8 && !(await tRow.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown')
  await expect(tRow).toBeFocused()
  // Arrow Right: in, at the first Template, described
  await page.keyboard.press('ArrowRight')
  const sub = fileSubmenu(page)
  const first = sub.locator('[data-template]').first()
  await expect(first).toBeFocused()
  await expect(shown(sub)).toHaveText(await first.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby')!)!.textContent!))
  // the arrows stay in the submenu, and wrap
  await page.keyboard.press('ArrowUp')
  await expect(sub.locator('[data-template]').last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(first).toBeFocused()
  // Arrow Left: out, back on its row
  await page.keyboard.press('ArrowLeft')
  await expect(fileSubmenu(page)).toHaveCount(0)
  await expect(tRow).toBeFocused()
  // Enter: in again
  await page.keyboard.press('Enter')
  await expect(sub.locator('[data-template]').first()).toBeFocused()
  // Escape: the submenu alone
  await page.keyboard.press('Escape')
  await expect(fileSubmenu(page)).toHaveCount(0)
  await expect(file(page)).toBeVisible()
  await expect(tRow).toBeFocused()
  // Space on Export
  await page.keyboard.press('ArrowDown')
  await expect(eRow).toBeFocused()
  await page.keyboard.press('Space')
  await expect(sub.locator('[role="menuitem"]').first()).toBeFocused()
  // a disabled format (Make a proposal: no project is open) is never landed on
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => (document.activeElement as HTMLButtonElement).disabled)).toBe(false)
  }
  // Escape twice: the submenu, then File, focus on File's button
  await page.keyboard.press('Escape')
  await expect(eRow).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(file(page)).toHaveCount(0)
  await expect(trigger(page)).toBeFocused()
  // focus moving to another of File's rows closes an open submenu: opened
  // with the pointer, focus stays on its row; Arrow Up moves it to Templates
  await page.keyboard.press('Enter')
  await eRow.click()
  await expect(fileSubmenu(page)).toBeVisible()
  await expect(eRow).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(tRow).toBeFocused()
  await expect(fileSubmenu(page)).toHaveCount(0)
})

test('Tab in a submenu closes File and moves on from its button; a keyboard choice returns focus to File', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  const fileTrigger = trigger(page)
  await fileTrigger.focus()
  await page.keyboard.press('Enter')
  await file(page).locator('[data-submenu="export"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(fileSubmenu(page).locator('[role="menuitem"]').first()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(file(page)).toHaveCount(0)
  await expect(fileSubmenu(page)).toHaveCount(0)
  // focus moved on from File's button: to the control after it
  const next = await page.evaluate(() => document.activeElement?.textContent?.trim())
  expect(next).not.toBe('File')
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)

  // Graph JSON chosen with Enter: the download, and focus on File's button
  await fileTrigger.focus()
  await page.keyboard.press('Enter')
  await file(page).locator('[data-submenu="export"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(fileSubmenu(page).locator('[role="menuitem"]').first()).toBeFocused()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  await download
  await expect(fileSubmenu(page)).toHaveCount(0)
  await expect(fileTrigger).toBeFocused()
})

test('why a row is off: a short line under its name, part of its description, the name unchanged (proposal; insert under the edit lock)', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  const exports = await openFileSubmenu(page, 'export')
  const proposal = exports.locator('[role="menuitem"]').filter({ hasText: 'Make a proposal' })
  await expect(proposal).toBeDisabled()
  await expect(proposal.locator('.dmenu__note')).toHaveText('Export a Project revision first')
  await expect(proposal.locator('.dmenu__note')).toBeVisible()
  await expect(proposal).toHaveAccessibleName('Make a proposal')
  await expect(proposal).toHaveAccessibleDescription('Export a Project revision first a copy to edit and send back for review')
  // readable ink, not the row's disabled one
  const ink = await proposal.evaluate((el) => ({ note: getComputedStyle(el.querySelector('.dmenu__note')!).color, row: getComputedStyle(el).color }))
  expect(ink.note).not.toBe(ink.row)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))
  await openFileMenu(page)
  const insert = file(page).locator('[role="menuitem"]').filter({ hasText: 'Insert saved structure' })
  await expect(insert).toBeDisabled()
  await expect(insert.locator('.dmenu__note')).toHaveText('Unavailable while editing is locked')
  await expect(insert).toHaveAccessibleName('Insert saved structure…')
  await expect(insert).toHaveAccessibleDescription('Unavailable while editing is locked Adds a structure file you saved to this document.')
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(false))
  await openFileMenu(page)
  await expect(insert).toBeEnabled()
  await expect(insert.locator('.dmenu__note')).toHaveCount(0)
})

test('Korean: the disabled notes and the hint read as agreed', async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await pickLocale(page, 'ko')
  const exports = await openFileSubmenu(page, 'export')
  await expect(shown(exports)).toHaveText('항목을 선택하면 설명이 표시됩니다')
  await expect(exports.locator('.dmenu__note')).toHaveText('먼저 프로젝트 리비전을 내보내세요')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window as any).__loop.ui.getState().setCanvasLocked(true))
  await openFileMenu(page)
  await expect(file(page).locator('.dmenu__note')).toHaveText('편집 잠금 중에는 삽입할 수 없습니다')
})

test('a long Korean description reads whole; a short window: the area gives way to two lines and scrolls, the rows keep their room, nothing is cut', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 420 })
  await openApp(page)
  await resetAll(page)
  await pickLocale(page, 'ko')
  const sub = await openFileSubmenu(page, 'templates')
  const view = page.viewportSize()!
  const g = await sub.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const rows = el.querySelector('.dmenu__rows') as HTMLElement
    const area = el.querySelector('.dmenu__area') as HTMLElement
    const descs = [...el.querySelectorAll<HTMLElement>('.dmenu__desc')]
    return {
      top: r.top,
      bottom: r.bottom,
      rowsShown: rows.clientHeight,
      rowsAll: rows.scrollHeight,
      areaShown: area.clientHeight,
      areaAll: area.scrollHeight,
      areaScrolls: getComputedStyle(area).overflowY,
      cut: descs.filter((d) => d.scrollHeight > d.clientHeight + 1).length,
      clamp: descs.filter((d) => getComputedStyle(d).webkitLineClamp !== 'none').length,
    }
  })
  expect(g.top).toBeGreaterThanOrEqual(0)
  expect(g.bottom).toBeLessThanOrEqual(view.height)
  expect(g.cut, 'no description is cut').toBe(0)
  expect(g.clamp, 'no line clamp').toBe(0)
  expect(g.areaScrolls).toBe('auto')
  // the area gave way first: rows that do not fit only once it is at its floor
  if (g.rowsAll > g.rowsShown + 1) expect(g.areaShown).toBeLessThanOrEqual(46)
  expect(g.rowsShown, 'the rows keep more room than the area').toBeGreaterThan(g.areaShown)
  // the longest description (Pickup) is reached whole by the area's own scroll
  await sub.locator('[data-template="gacha-pickup"]').hover()
  const pickup = shown(sub)
  await expect(pickup).toHaveText('천장과 픽업 보장이 있는 배너 하나. 픽업 외 SSR 다음에 나오는 SSR은 픽업으로 확정됩니다.')
  await pickup.scrollIntoViewIfNeeded()
  await expect(pickup).toBeInViewport({ ratio: 1 })
})

for (const size of [
  { width: 1280, height: 800 },
  // a tablet, landscape and portrait (the desktop layout, by touch)
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
]) test.describe(`touch at ${size.width} × ${size.height}`, () => {
  test.use({ hasTouch: true, viewport: size })

  test('a press selects a Template and shows its description with Open; only Open runs it. A click runs at once', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const tap = async (l: Locator) => {
      const b = (await l.boundingBox())!
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    }
    await tap(trigger(page))
    await expect(file(page)).toBeVisible()
    await tap(file(page).locator('[data-submenu="templates"]'))
    const sub = fileSubmenu(page)
    await expect(sub).toBeVisible()
    const sb = (await sub.boundingBox())!
    expect(sb.x).toBeGreaterThanOrEqual(0)
    expect(sb.x + sb.width, 'the submenu inside the window').toBeLessThanOrEqual(size.width)
    const pickup = sub.locator('[data-template="gacha-pickup"]')
    await tap(pickup)
    // selected, described, not run: the document unchanged, the menu open
    const nodes = () => page.evaluate(() => (window as any).__loop.graph.getState().nodes.length)
    await expect(shown(sub)).toHaveText('Pity and a pickup guarantee: after an off-pickup SSR, the next SSR is the pickup.')
    const open = sub.locator('.dmenu__act')
    await expect(open).toHaveText('Open')
    expect(await nodes()).toBe(0)
    // a second press on the same row is no hidden run either
    await tap(pickup)
    await page.waitForTimeout(300)
    expect(await nodes()).toBe(0)
    await expect(open).toBeVisible()
    // another row: its description and the button
    await tap(sub.locator('[data-template="deadlock"]'))
    await expect(shown(sub)).toHaveText('The same line with no shipment step: stock fills to capacity and everything stops.')
    // nothing ran so far: the document is still the empty one
    expect(await page.evaluate(() => (window as any).__loop.graph.getState().nodes.length)).toBe(0)
    // Open runs it (into the empty document: no replace confirmation)
    await tap(open)
    await expect.poll(() => page.evaluate(() => (window as any).__loop.graph.getState().nodes.length)).toBeGreaterThan(0)
    await expect(file(page)).toHaveCount(0)

    // the mouse: a click runs the row at once (the document has nodes now:
    // the replace confirmation)
    await trigger(page).click()
    await file(page).locator('[data-submenu="templates"]').click()
    await fileSubmenu(page).locator('[data-template="gacha-pickup"]').click()
    await expect(page.locator('.mcdlg--confirm')).toBeVisible()
  })

  test('a touch selection ends when the keyboard or the mouse moves to another row: the area and its button follow the current row', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const tap = async (l: Locator) => {
      const b = (await l.boundingBox())!
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    }
    await tap(trigger(page))
    await tap(file(page).locator('[data-submenu="templates"]'))
    const sub = fileSubmenu(page)
    const pickup = sub.locator('[data-template="gacha-pickup"]')
    const open = sub.locator('.dmenu__act')
    const descOf = (row: Locator) => row.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby')!)!.textContent)
    // the keyboard: Arrow Down from the selected row
    await tap(pickup)
    await expect(open).toBeVisible()
    await page.keyboard.press('ArrowDown')
    const next = sub.locator('[data-template="gacha-banner-zones"]')
    await expect(next).toBeFocused()
    await expect(shown(sub)).toHaveText((await descOf(next))!)
    await expect(open, 'no button for a row that is not the current one').toHaveCount(0)
    // the mouse: pointing at another row
    await tap(pickup)
    await expect(open).toBeVisible()
    const deadlock = sub.locator('[data-template="deadlock"]')
    await deadlock.hover()
    await expect(shown(sub)).toHaveText((await descOf(deadlock))!)
    await expect(open).toHaveCount(0)
    // nothing ran
    expect(await page.evaluate(() => (window as any).__loop.graph.getState().nodes.length)).toBe(0)
  })

  test('a press selects an export format and shows Export; Export downloads it', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const tap = async (l: Locator) => {
      const b = (await l.boundingBox())!
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    }
    await tap(trigger(page))
    await tap(file(page).locator('[data-submenu="export"]'))
    const sub = fileSubmenu(page)
    const graph = sub.locator('[role="menuitem"]').filter({ hasText: 'Graph JSON' })
    let downloaded = false
    page.on('download', () => (downloaded = true))
    await tap(graph)
    await expect(shown(sub)).toHaveText('the diagram + recommended run settings')
    await page.waitForTimeout(300)
    expect(downloaded, 'a press only selects').toBe(false)
    const run = sub.locator('.dmenu__act')
    await expect(run).toHaveText('Export')
    const download = page.waitForEvent('download')
    await tap(run)
    expect((await download).suggestedFilename()).toBe('loop-studio-graph.json')
  })
})

test('forced colours: the description area, the notes and the › marks are drawn in the system text colour', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await openApp(page)
  await resetAll(page)
  const sub = await openFileSubmenu(page, 'export')
  const c = await page.evaluate(() => {
    const col = (s: string) => getComputedStyle(document.querySelector(s)!).color
    return { desc: col('.dmenu--sub .dmenu__desc.is-shown'), note: col('.dmenu--sub .dmenu__note'), chev: col('.toolbar__filemenu-pop .dmenu__chev'), name: col('.toolbar__filemenu-pop .menu__name') }
  })
  expect(c.desc).toBe(c.name)
  expect(c.note).toBe(c.name)
  expect(c.chev).toBe(c.name)
  await expect(sub).toBeVisible()
  // the open submenu's row stays marked: an outline in the text colour
  const mark = await page.locator('[data-submenu="export"]').evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, color: getComputedStyle(el).outlineColor }))
  expect(mark.style).toBe('solid')
  expect(mark.color).toBe(c.name)
})
