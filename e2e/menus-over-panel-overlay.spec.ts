import type { Locator, Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Below 900 px a side panel opens as an OVERLAY over the canvas
// (docs/workbench.md §WB1a). The menu bar's popups open over it: the bars
// stack above the overlays and below the dialogs (workbench.css
// `.toolbar.wb-bars`). Measured 2026-10-22 at 820 px before that: an open
// panel covered the part of the File popup over it — the start of every row —
// and took the clicks there.

type Bridge = { __loop: Record<string, { getState: () => any }> }
const nodeCount = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length as number)

async function openOverlay(page: Page, side: 'left' | 'right') {
  await page.locator(`.wb-status [data-panel-toggle="${side}"]`).click()
  await expect(page.locator(side === 'left' ? '.wb-left.is-overlay' : '.rightcol.is-overlay')).toBeVisible()
}
const overlayBox = (page: Page, side: 'left' | 'right') => page.locator(side === 'left' ? '.wb-left.is-overlay' : '.rightcol.is-overlay').boundingBox()

/** each row of a popup, hit-tested at its start, centre and end: what is under
 *  the point is the row itself (not the panel) */
async function rowsAnswer(pop: Locator): Promise<string[]> {
  return pop.evaluate((p) => {
    const bad: string[] = []
    for (const r of p.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], button.menu__item, .wb-mb')) {
      const b = r.getBoundingClientRect()
      if (b.width === 0 || b.bottom > innerHeight || b.top < 0) continue
      // a row scrolled out of a scrolling popup is not on screen to answer
      const pb = p.getBoundingClientRect()
      if (b.bottom > pb.bottom || b.top < pb.top) continue
      for (const x of [b.left + 4, b.left + b.width / 2, b.right - 4]) {
        const hit = document.elementFromPoint(x, b.top + b.height / 2)
        if (!hit || !r.contains(hit)) bad.push(`${(r.textContent ?? '').trim().slice(0, 24)} @x${Math.round(x)} → ${hit ? hit.closest('aside, .rightcol, header, div')?.className.split(' ')[0] : 'none'}`)
      }
    }
    return bad
  })
}

test.describe('the menu bar over an open side panel (narrow band)', () => {
  test.use({ viewport: { width: 820, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
  })

  test('File over the list: every row answers at its start, centre and end; a Template row of its submenu answers and opens it', async ({ page }) => {
    await openOverlay(page, 'left')
    const panel = (await overlayBox(page, 'left'))!
    await page.locator('.toolbar__filemenu > .wb-mb').click()
    const pop = page.locator('.toolbar__filemenu-pop')
    await expect(pop).toBeVisible()
    const pb = (await pop.boundingBox())!
    expect(pb.x, 'the popup starts over the panel').toBeLessThan(panel.x + panel.width)
    expect(await rowsAnswer(pop)).toEqual([])
    // a click at the Templates row's start, which lies over the panel, opens
    // the submenu (docs/workbench.md §WB2.2), in the same layer
    const parent = pop.locator('[data-submenu="templates"]')
    const parentBox = (await parent.boundingBox())!
    expect(parentBox.x + 10, 'the click point lies over the panel').toBeLessThan(panel.x + panel.width)
    await page.mouse.click(parentBox.x + 10, parentBox.y + parentBox.height / 2)
    const sub = page.locator('.dmenu--sub')
    await expect(sub).toBeVisible()
    expect(await rowsAnswer(sub)).toEqual([])
    const row = sub.locator('[data-template]').first()
    const rb = (await row.boundingBox())!
    await page.mouse.click(rb.x + 10, rb.y + rb.height / 2)
    await expect.poll(() => nodeCount(page), { message: 'the Template opened' }).toBeGreaterThan(0)
  })

  test('File by the keyboard with the list open: the arrows reach a Template row and Enter opens it', async ({ page }) => {
    await openOverlay(page, 'left')
    const trig = page.locator('.toolbar__filemenu > .wb-mb')
    await trig.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.toolbar__filemenu-pop')).toBeVisible()
    // File ▸ Templates: Arrow Right on its row opens it at the first Template
    const parent = page.locator('.toolbar__filemenu-pop [data-submenu="templates"]')
    for (let i = 0; i < 12 && !(await parent.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown')
    await expect(parent).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const first = page.locator('.dmenu--sub [data-template]').first()
    await expect(first).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => nodeCount(page), { message: 'the Template opened' }).toBeGreaterThan(0)
  })

  test('View over the properties: every row answers; a toggle clicked at its end, where the panel was, toggles', async ({ page }) => {
    await openOverlay(page, 'right')
    const panel = (await overlayBox(page, 'right'))!
    await page.locator('.toolbar__actions .wb-viewmenu > .wb-mb').click()
    const pop = page.locator('.wb-viewmenu__pop')
    await expect(pop).toBeVisible()
    const pb = (await pop.boundingBox())!
    expect(pb.x + pb.width, 'the popup ends over the panel').toBeGreaterThan(panel.x)
    expect(await rowsAnswer(pop)).toEqual([])
    const row = pop.locator('[data-view-row="minimap"]')
    const before = await row.getAttribute('aria-pressed')
    const rb = (await row.boundingBox())!
    expect(rb.x + rb.width - 10, 'the click point lies over the panel').toBeGreaterThan(panel.x)
    await page.mouse.click(rb.x + rb.width - 10, rb.y + rb.height / 2)
    await expect(row).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
    // and by the keyboard: focus on the row, Enter toggles it back
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-pressed', before ?? 'false')
  })

  test('a dialog stays above the bars: with a dialog open, the menu bar takes no click and no popup comes over the dialog', async ({ page }) => {
    await openOverlay(page, 'left')
    await page.locator('[data-tour="help-trigger"]').click()
    await page.getByRole('menuitem', { name: 'About Loop Studio', exact: true }).click()
    const dialog = page.locator('.mcdlg--about')
    await expect(dialog).toBeVisible()
    const fb = (await page.locator('.toolbar__filemenu > .wb-mb').boundingBox())!
    const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return { inBar: !!e?.closest('header.toolbar'), cls: e?.className ?? '' } }, [fb.x + fb.width / 2, fb.y + fb.height / 2] as const)
    expect(hit.inBar, `what lies over File while the dialog is open: ${hit.cls}`).toBe(false)
    // the click lands on the dialog's own layer (its scrim closes it, as an
    // outside click does), never on File: no popup opens
    await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2)
    await expect(page.locator('.toolbar__filemenu-pop')).toHaveCount(0)
  })

  test('⋯ and a group inside it, over the list: every row answers', async ({ page }) => {
    // no English desktop width collapses a group into ⋯, so the bar is pinned
    // narrow the way menu-keyboard.spec does (480 px: ⋯ holds Help, Run, Insert)
    await page.addStyleTag({ content: '.toolbar { max-width: 480px !important; }' })
    await openOverlay(page, 'left')
    const more = page.locator('.toolbar__overflow-btn')
    await expect(more, '⋯ holds groups').toBeVisible()
    await more.click()
    const pop = page.locator('.toolbar__overflow-pop')
    await expect(pop).toBeVisible()
    const panel = (await overlayBox(page, 'left'))!
    const pb = (await pop.boundingBox())!
    expect(pb.x, 'the ⋯ popup starts over the panel').toBeLessThan(panel.x + panel.width)
    expect(await rowsAnswer(pop)).toEqual([])
    // a group's own popup opened from inside ⋯ answers too
    const inner = pop.locator('.wb-mb').first()
    await inner.click()
    const sub = pop.locator('.menu__pop, .wb-viewmenu__pop').first()
    await expect(sub).toBeVisible()
    expect(await rowsAnswer(sub)).toEqual([])
  })
})
