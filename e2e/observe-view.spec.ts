// #538 — the observation view (Lumi, 2026-11-10). A text toggle in the run row hides both side
// panels and the tool row; the canvas takes the room at the same zoom, with the model point
// that was at its centre still at its centre; the run goes on. A second press or Esc puts the
// panels, the tool row and the viewport back exactly; Esc goes to an open menu first. A
// status-bar panel toggle leaves the view and opens its panel. Focus never stays on what the
// view hides. The phone has no panels and no toggle. docs/workbench.md §WB1b.
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { openMonteCarloDialog, openViewMenu, pickTemplate } from './support/workbenchMenus'

type Bridge = { __loop: Record<string, any> }

const toggle = (page: Page) => page.getByRole('button', { name: 'Observation view' })
const pressed = async (page: Page) => (await toggle(page).getAttribute('aria-pressed')) === 'true'

/** what the view changes: the panels, the tool row, the canvas, the viewport, the flow point at the pane's centre, the run */
const look = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const vp = l.rf.getViewport() as { x: number; y: number; zoom: number }
    const pane = document.querySelector('.react-flow')!.getBoundingClientRect()
    const shown = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null
      return !!el && !el.hidden && el.getBoundingClientRect().width > 0
    }
    const strip = document.querySelector('.pstrip') as HTMLElement
    const sr = strip.getBoundingClientRect()
    const controls = [...strip.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0)
    return {
      left: shown('#wb-panel-left'),
      right: shown('#wb-panel-right'),
      toolRow: shown('.wb-toolrow'),
      toggleShown: (document.querySelector('.pstrip__observe')?.getClientRects().length ?? 0) > 0,
      paneW: pane.width,
      vp,
      centre: { x: (pane.width / 2 - vp.x) / vp.zoom, y: (pane.height / 2 - vp.y) / vp.zoom },
      step: l.sim.getState().stepIndex as number,
      status: l.sim.getState().status as string,
      runRowWhole: controls.every((r) => r.left >= sr.left - 0.5 && r.right <= sr.right + 0.5 && r.top >= sr.top - 0.5 && r.bottom <= sr.bottom + 0.5),
    }
  })

async function template(page: Page) {
  await resetAll(page)
  await pickTemplate(page, 'desalination')
  await expect(page.locator('.react-flow__node')).toHaveCount(43)
}

test.describe('#538 — the observation view', () => {
  for (const [w, h, foldLeft] of [[1920, 1080, true], [1280, 800, true], [1024, 768, false]] as const) {
    test(`${w} × ${h}: entered and left while Play runs — zoom and centre kept, the run goes on, everything back exactly`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width: w, height: h })
      await openApp(page)
      await template(page)
      // a user's own panel choice for this band, to come back exactly
      if (foldLeft) await page.locator('#wb-toggle-left').click()
      await expect.poll(async () => (await look(page)).left).toBe(false)
      await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().setSpeed(300))
      await page.locator('.pstrip .pb-btn--primary').click()
      await expect.poll(async () => (await look(page)).step).toBeGreaterThan(2)
      const before = await look(page)

      // the run row's toggle when the row has room for it, else View ▸ Observation view
      // (at 1024 with the properties panel open the row folds it, fit step 3)
      if (await toggle(page).isVisible()) await toggle(page).click()
      else {
        await openViewMenu(page)
        await page.locator('.wb-viewmenu__pop [data-view-row="observe"]').click()
      }
      test.info().annotations.push({ type: 'way in', description: `${w}: ${before.toggleShown ? 'the run row toggle' : 'View ▸ Observation view'}` })
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
      const inView = await look(page)
      expect([inView.left, inView.right, inView.toolRow], 'both panels and the tool row are hidden').toEqual([false, false, false])
      expect(inView.paneW, 'the canvas takes the room').toBeGreaterThan(before.paneW)
      expect(inView.vp.zoom, 'the zoom is kept').toBe(before.vp.zoom)
      expect(Math.abs(inView.centre.x - before.centre.x), 'the model point at the centre stays there (x)').toBeLessThan(0.5)
      expect(Math.abs(inView.centre.y - before.centre.y), 'the model point at the centre stays there (y)').toBeLessThan(0.5)
      expect(inView.runRowWhole, 'the run row is whole').toBe(true)
      await expect.poll(async () => (await look(page)).step, { message: 'the run goes on in the view' }).toBeGreaterThan(inView.step + 2)
      expect((await look(page)).status).toBe('running')

      await toggle(page).click()
      // (by its class: where the row folds it again, it leaves the accessibility tree)
      await expect(page.locator('.pstrip__observe')).toHaveAttribute('aria-pressed', 'false')
      const back = await look(page)
      expect([back.left, back.right, back.toolRow], 'the panels and the tool row as they were').toEqual([before.left, before.right, before.toolRow])
      expect(back.vp, 'the viewport exactly as it was').toEqual(before.vp)
      expect(back.status).toBe('running')
      expect(back.runRowWhole).toBe(true)
    })
  }

  test('Esc: an open menu takes the first Esc, the next leaves the view; a status-bar panel toggle leaves it and opens its panel', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openApp(page)
    await template(page)
    const before = await look(page)
    await toggle(page).click()
    await openViewMenu(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.wb-viewmenu__pop')).toHaveCount(0)
    expect(await pressed(page), 'the View menu took the first Esc').toBe(true)
    await page.keyboard.press('Escape')
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    const back = await look(page)
    expect([back.left, back.right, back.toolRow]).toEqual([before.left, before.right, before.toolRow])
    expect(back.vp).toEqual(before.vp)

    // the File menu (a menu bar menu with its own keyboard) the same way
    await toggle(page).click()
    await page.locator('.toolbar__actions .wb-mb').first().click()
    await expect(page.locator('[role="menu"]').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="menu"]')).toHaveCount(0)
    expect(await pressed(page), 'the File menu took the first Esc').toBe(true)
    await page.keyboard.press('Escape')
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')

    // fold the right panel, enter, then the status bar's right toggle: the view ends and that panel opens
    await page.locator('#wb-toggle-right').click()
    await toggle(page).click()
    await page.locator('#wb-toggle-right').click()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    const via = await look(page)
    expect([via.left, via.right, via.toolRow]).toEqual([true, true, true])
  })

  // #613 item 2 — the view's Esc listener runs in the capture phase, before the Timeline's
  // popovers answer the same key: one Esc closed the popover (or let the pinned step go) and
  // left the view as well. The first Esc is the popover's; the next leaves the view, as for a
  // menu above. Each popover opened with the mouse; the CSV menu also from the keyboard, where
  // focus goes into the menu (with the mouse it stays on the menu's button).
  test.describe('Esc: a Timeline popover takes the first Esc, the next leaves the view (#613 item 2)', () => {
    async function recorded(page: Page) {
      await page.setViewportSize({ width: 1920, height: 1080 })
      await openApp(page)
      await template(page)
      await page.evaluate(() => {
        const s = (window as unknown as Bridge).__loop.sim
        while (s.getState().stepIndex < 10) s.getState().advance()
      })
    }
    /** one Esc: `gone` must hold and the view must stay; the next Esc leaves the view */
    async function firstEscIsThePopovers(page: Page, gone: () => Promise<void>) {
      await page.keyboard.press('Escape')
      await gone()
      await page.waitForTimeout(200) // room for a leave that should not come
      expect(await pressed(page), 'the popover took the first Esc; the view stays').toBe(true)
      await page.keyboard.press('Escape')
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    }
    /** the CSV control is a menu while a view unit is on (SEMANTICS-M4 §M4-8) */
    async function csvMenu(page: Page) {
      await page.evaluate(() => (window as unknown as Bridge).__loop.viewUnits.getState().setViewUnit('water', 'L'))
      const trigger = page.locator('.timeline__csv[aria-haspopup="true"]')
      await expect(trigger).toBeVisible()
      return { trigger, pop: page.locator('.timeline .menu__pop[role="menu"]') }
    }

    test('the Series popover', async ({ page }) => {
      await recorded(page)
      await toggle(page).click()
      await page.locator('.timeline__series').click()
      const pop = page.locator('.tl-series')
      await expect(pop).toBeVisible()
      await firstEscIsThePopovers(page, () => expect(pop).toBeHidden())
    })

    test('the pinned step', async ({ page }) => {
      await recorded(page)
      await toggle(page).click()
      const svg = page.locator('.timeline__svg')
      const box = (await svg.boundingBox())!
      await svg.click({ position: { x: box.width * 0.6, y: box.height / 2 } })
      await page.mouse.move(2, 2) // no hover preview over the pinned reading
      const pinned = page.locator('.timeline__reading:not([data-preview])')
      await expect(pinned).toBeVisible()
      await expect(page.locator('.timeline__plot')).toBeFocused()
      await firstEscIsThePopovers(page, () => expect(pinned).toBeHidden())
    })

    test('the Timeline CSV menu, opened with the mouse', async ({ page }) => {
      await recorded(page)
      const { trigger, pop } = await csvMenu(page)
      await toggle(page).click()
      await trigger.click()
      await expect(pop).toBeVisible()
      await expect(trigger).toBeFocused() // with the mouse, focus stays on the button
      await firstEscIsThePopovers(page, async () => {
        await expect(pop).toBeHidden()
        await expect(trigger).toBeFocused()
      })
    })

    test('the Timeline CSV menu, opened from the keyboard (focus inside the menu)', async ({ page }) => {
      await recorded(page)
      const { trigger, pop } = await csvMenu(page)
      await toggle(page).click()
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(pop).toBeVisible()
      await expect(pop.locator('[role="menuitem"]').first()).toBeFocused()
      await firstEscIsThePopovers(page, async () => {
        await expect(pop).toBeHidden()
        await expect(trigger).toBeFocused()
      })
    })

    test('the Distribution Export menu', async ({ page }) => {
      test.setTimeout(120_000)
      await recorded(page)
      await openMonteCarloDialog(page)
      const dlg = page.locator('.mcdlg[aria-labelledby="mcdlg-title"]')
      await dlg.locator('.mcdlg__foot .btn--primary').click()
      await expect(page.locator('.dist')).toBeVisible({ timeout: 90_000 })
      if (await dlg.isVisible()) {
        await page.keyboard.press('Escape')
        await expect(dlg).toBeHidden()
      }
      await toggle(page).click()
      const trigger = page.locator('.dist__stats .menu button', { hasText: 'Export' })
      await trigger.click()
      const pop = page.locator('.dist__stats .menu__pop')
      await expect(pop).toBeVisible()
      await firstEscIsThePopovers(page, async () => {
        await expect(pop).toBeHidden()
        await expect(trigger).toBeFocused()
        await expect(page.locator('.dist')).toBeVisible()
      })
    })

    // control: with nothing open, the first Esc leaves the view (the menus' case is above)
    test('control: with no popover open, one Esc leaves the view', async ({ page }) => {
      await recorded(page)
      await toggle(page).click()
      await page.keyboard.press('Escape')
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    })
  })

  test('focus on what the view hides moves to the toggle; Tab never reaches a hidden control', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await template(page)
    // a selected node gives the properties panel its fields
    await page.locator('.react-flow__node[data-id="ro"]').click()
    await expect(page.locator('#wb-panel-right input').first()).toBeVisible()
    for (const [where, target] of [
      ['the left panel', page.getByPlaceholder('Find in model')],
      ['the right panel', page.locator('#wb-panel-right input').first()],
      ['the tool row', page.locator('.wb-toolrow button').first()],
    ] as const) {
      await target.focus()
      await expect(target, `focus is in ${where}`).toBeFocused()
      // a pointer press that does not move focus (Safari's, or a script's)
      await toggle(page).evaluate((b: HTMLButtonElement) => b.click())
      await expect(toggle(page), `focus left ${where} for the toggle`).toBeFocused()
      // Tab both ways from the toggle: no stop inside a hidden element
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press(key)
          expect(await page.evaluate(() => !!document.activeElement?.closest('[hidden]')), `${key} ${i + 1} from the toggle stays out of hidden parts`).toBe(false)
        }
        await toggle(page).focus()
      }
      await toggle(page).click()
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    }
  })

  test('900 × 768, keyboard only: the run row folds the toggle; View ▸ Observation view enters with focus on the toggle; Esc leaves with focus on View; the View row leaves too', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 768 })
    await openApp(page)
    await template(page)
    const strip = page.locator('.pstrip')
    const viewBtn = page.locator('.toolbar__actions .wb-viewmenu > .wb-mb')
    const row = page.locator('.wb-viewmenu__pop [data-view-row="observe"]')
    // the medium band: the properties panel takes room, the row is short, the toggle gives way
    await expect.poll(() => strip.getAttribute('data-fit')).toMatch(/^[34]$/)
    await expect(page.locator('.pstrip__observe')).toBeHidden()
    const before = await look(page)

    /** View by keyboard, Tab to its Observation view row, Enter */
    const viaView = async () => {
      await viewBtn.focus()
      await page.keyboard.press('Enter')
      await expect(row).toBeVisible()
      for (let i = 0; i < 12 && !(await row.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
      await expect(row, 'Tab reaches the Observation view row').toBeFocused()
      await page.keyboard.press('Enter')
    }

    await viaView()
    await expect(row).toHaveCount(0)
    await expect(page.locator('.pstrip__observe')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.pstrip__observe'), 'in the view the row has room: the toggle is back').toBeVisible()
    await expect(page.locator('.pstrip__observe'), 'focus lands on the toggle').toBeFocused()
    const inView = await look(page)
    expect([inView.left, inView.right, inView.toolRow]).toEqual([false, false, false])
    expect(inView.vp.zoom).toBe(before.vp.zoom)

    // Esc with focus on the toggle: the view ends, the row folds the toggle again, focus goes to View
    await page.keyboard.press('Escape')
    await expect(page.locator('.pstrip__observe')).toBeHidden()
    await expect(viewBtn, 'focus is not left on the folded toggle').toBeFocused()
    const back = await look(page)
    expect([back.left, back.right, back.toolRow]).toEqual([before.left, before.right, before.toolRow])
    expect(back.vp).toEqual(before.vp)

    // in again by the View row, out by the View row: its mark says on, and focus returns to View
    await viaView()
    await expect(page.locator('.pstrip__observe')).toBeFocused()
    await viewBtn.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    for (let i = 0; i < 12 && !(await row.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.locator('.pstrip__observe')).toBeHidden()
    await expect(viewBtn).toBeFocused()
    expect((await look(page)).vp).toEqual(before.vp)
  })

  test('the phone: no observation view toggle', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await expect(page.locator('.pstrip__observe')).toHaveCount(0)
  })
})
