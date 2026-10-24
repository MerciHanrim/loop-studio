import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// The workbench's control strips — the menu bar, the tool row and the status
// bar — are commands, not text to copy: a drag that starts in a gap or on a
// label there (`연결`, a separator) must not select their words. A canvas click
// cannot clear such a selection (React Flow's pan cancels `selectstart`), so it
// stayed on screen. Panels, inputs, help and data keep their text selectable.
// And the storage gate moves focus to its heading as the reading start without
// drawing the keyboard ring round it when the heading is clicked; Tab still
// shows the ring on its buttons and checkboxes.

/** a real mouse drag between two viewport points */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

const selection = (page: Page) => page.evaluate(() => getSelection()?.toString() ?? '')
const clearSelection = (page: Page) => page.evaluate(() => getSelection()?.removeAllRanges())

/** a point inside `strip` that is over no button: its first gap, scanned on its middle line */
function gapIn(page: Page, strip: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const r = el.getBoundingClientRect()
    const y = r.top + r.height / 2
    for (let x = r.left + 2; x < r.right - 2; x += 2) {
      const hit = document.elementFromPoint(x, y)
      if (hit && el.contains(hit) && !hit.closest('button, a, input, [role="menuitem"]')) return { x, y }
    }
    return null
  }, strip)
}

/** the box of the first element matching `sel` */
const boxOf = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, y: r.top + r.height / 2 }
  })

test.describe('the control strips select no text', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openApp(page)
  })

  test('a drag from a gap in the menu bar selects none of the menu names', async ({ page }) => {
    const start = await gapIn(page, '.wb-menubar')
    expect(start, 'a gap in the menu bar').not.toBeNull()
    const end = await boxOf(page, '.wb-menubar button >> nth=2')
    await drag(page, start!, { x: end.right - 2, y: start!.y })
    expect(await selection(page)).toBe('')
  })

  test('a drag across the tool row’s Connect label, from the separator before it, selects nothing', async ({ page }) => {
    const label = await boxOf(page, '.wb-connect .wb-tcap')
    await drag(page, { x: label.left - 6, y: label.y }, { x: label.right + 4, y: label.y })
    expect(await selection(page)).toBe('')
  })

  test('a drag across the status bar’s text selects nothing', async ({ page }) => {
    const bar = await boxOf(page, '.wb-status')
    await drag(page, { x: bar.left + 4, y: bar.y }, { x: bar.left + 260, y: bar.y })
    expect(await selection(page)).toBe('')
  })

  test('a panel’s text still selects, and so does a search field’s value', async ({ page }) => {
    const hint = await boxOf(page, 'p.inspector__hint')
    await drag(page, { x: hint.left + 2, y: hint.top + 6 }, { x: hint.right - 4, y: hint.top + 6 })
    expect((await selection(page)).length, 'the Inspector hint is selectable').toBeGreaterThan(5)
    await clearSelection(page)

    const search = page.locator('.wb-search input[type="search"]')
    await search.fill('Faucet')
    const box = (await search.boundingBox())!
    await drag(page, { x: box.x + 4, y: box.y + box.height / 2 }, { x: box.x + box.width - 4, y: box.y + box.height / 2 })
    const range = await search.evaluate((i: HTMLInputElement) => [i.selectionStart, i.selectionEnd])
    expect(range[1]! - range[0]!, 'the field’s text is selected by a drag').toBeGreaterThan(0)
  })

  test('a menu opened from the menu bar keeps its text selectable (its description area)', async ({ page }) => {
    await page.locator('.toolbar__filemenu > button').click()
    const hint = page.locator('.toolbar__filemenu-pop .dmenu__hint')
    await expect(hint).toBeVisible()
    const box = (await hint.boundingBox())!
    await drag(page, { x: box.x + 2, y: box.y + box.height / 2 }, { x: box.x + box.width - 2, y: box.y + box.height / 2 })
    expect((await selection(page)).length, 'the File menu’s hint is selectable').toBeGreaterThan(5)
  })
})

test.describe('the storage gate’s heading', () => {
  test.use({ storageMode: 'gate' })

  test('takes the first focus; a click on it draws no focus ring; Tab rings the buttons and the checkboxes', async ({ page }) => {
    await page.goto('/')
    const heading = page.locator('.gate__title')
    await expect(heading).toBeVisible()
    await expect(heading).toBeFocused()
    const ringed = (sel: string) => page.locator(sel).evaluate((el) => el.matches(':focus-visible'))
    expect(await ringed('.gate__title')).toBe(false)

    // the first mouse click on the heading
    await heading.click()
    await expect(heading).toBeFocused()
    expect(await ringed('.gate__title'), 'no keyboard ring after a mouse click').toBe(false)
    expect(await heading.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')

    // the keyboard: Tab reaches the first choice's button, then its checkbox, each ringed
    await page.keyboard.press('Tab')
    const first = page.locator('.gate [data-gate-choice="personal"] button')
    await expect(first).toBeFocused()
    expect(await ringed('.gate [data-gate-choice="personal"] button')).toBe(true)
    await page.keyboard.press('Tab')
    const box = page.locator('.gate [data-gate-choice="personal"] input[type="checkbox"]')
    await expect(box).toBeFocused()
    expect(await ringed('.gate [data-gate-choice="personal"] input[type="checkbox"]')).toBe(true)
  })
})
