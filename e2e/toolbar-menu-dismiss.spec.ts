import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Regression, 2026-09-16: every toolbar menu closed itself on a bubble-phase
// `window` 'mousedown' listener. React Flow's own node-drag setup calls
// `event.stopImmediatePropagation()` on a node's pointerdown/mousedown (its
// own d3-drag-style click-vs-drag disambiguation, confirmed directly by
// instrumenting a real click) — so a click that lands on a canvas NODE
// (unlike the empty pane, which never intercepts it) never reached that
// listener, and the menu stayed open. Fixed with one shared hook
// (src/components/toolbar/useOutsideDismiss.ts) listening in the CAPTURE
// phase on `document` for click/wheel, plus a `resize` listener, using
// `event.composedPath()` rather than `element.contains(event.target)`. Click
// is gated on `event.detail < 2` — see that file for why (a review found the
// dismiss listener also needs to ignore the trailing click of a real
// double-click, which `mousedown`/`pointerdown` alone can't distinguish from
// a genuinely separate fast click).
//
// This file tests the DISMISS contract directly (does the menu actually
// close, on which interactions, while which interactions are preserved).
// Tooltip suppression while a menu is open is covered by the pre-existing
// palette-tooltip-menu-suppression.spec.ts, which this fix leaves working —
// its own regression here was a downstream symptom of THIS bug (a menu
// stuck open by a failed outside-click never cleared `menuOpenStore`, so
// the palette's tooltip stayed suppressed too); no separate tooltip-logic
// defect was found (see PR description for the isolation steps).

const menuBtn = (page: Page, label: RegExp) =>
  page.locator('.toolbar__actions .menu > button', { hasText: label })

async function addNode(page: Page) {
  await page.evaluate(() => {
    ;(window as any).__loop.graph.getState().addNodeAt('pool', { x: 240, y: 200 })
  })
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
}

const node = (page: Page) => page.locator('.react-flow__node').first()

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
  await addNode(page)
})

test.describe('outside interactions close an open Tier-1 menu', () => {
  test('Templates: clicking a canvas NODE closes it (not just the empty pane)', async ({ page }) => {
    await menuBtn(page, /^Templates ▾$/).click()
    const pop = page.locator('.toolbar__actions .menu__pop').first()
    await expect(pop).toBeVisible()
    await node(page).click()
    await expect(pop).toBeHidden()
    // the click also did its normal job — this isn't "nothing happened"
    await expect(page.locator('aside.inspector, .sheet[aria-label="Inspector — read only"]')).toContainText(
      /pool/i,
    )
  })

  test('Templates: clicking the empty canvas pane also closes it (control case, already worked)', async ({
    page,
  }) => {
    await menuBtn(page, /^Templates ▾$/).click()
    const pop = page.locator('.toolbar__actions .menu__pop').first()
    await expect(pop).toBeVisible()
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
    await expect(pop).toBeHidden()
  })

  const groups: [RegExp, string][] = [
    [/^Insert module ▾$/, '.toolbar__actions .menu__pop'],
    [/^File ▾$/, '.toolbar__filemenu-pop'],
    [/^Data ▾$/, '.toolbar__actions .menu__pop'],
    [/^Settings ▾$/, '.toolbar__settingsmenu-pop'],
  ]
  for (const [label, popSel] of groups) {
    test(`${label.source} closes on a canvas node click`, async ({ page }) => {
      await menuBtn(page, label).click()
      const pop = page.locator(popSel).first()
      await expect(pop).toBeVisible()
      await node(page).click()
      await expect(pop).toBeHidden()
    })
  }

  test('Templates closes on an Inspector click', async ({ page }) => {
    await node(page).click() // select it first so Inspector has real content
    await menuBtn(page, /^Templates ▾$/).click()
    const pop = page.locator('.toolbar__actions .menu__pop').first()
    await expect(pop).toBeVisible()
    await page.locator('aside.inspector, .sheet[aria-label="Inspector — read only"]').click()
    await expect(pop).toBeHidden()
  })

  test('Templates closes on a Timeline click', async ({ page }) => {
    await menuBtn(page, /^Templates ▾$/).click()
    const pop = page.locator('.toolbar__actions .menu__pop').first()
    await expect(pop).toBeVisible()
    await page.locator('.timeline__panel').click({ position: { x: 10, y: 10 } })
    await expect(pop).toBeHidden()
  })

  test('Templates closes on a canvas wheel (zoom/scroll)', async ({ page }) => {
    await menuBtn(page, /^Templates ▾$/).click()
    const pop = page.locator('.toolbar__actions .menu__pop').first()
    await expect(pop).toBeVisible()
    await page.locator('.react-flow__pane').dispatchEvent('wheel', { deltaY: 100 })
    await expect(pop).toBeHidden()
  })

  // review, Lumi/Hanrim 2026-09-16: the original bug report's "moving the
  // viewed canvas area" explicitly includes panning, not just zoom/scroll —
  // and switching the dismiss listener to `click` (to fix the double-click
  // guard, see useOutsideDismiss.ts) silently broke this, since `click`
  // never fires for a genuine drag gesture (mousedown, move, mouseup
  // elsewhere) — only a stationary down+up. Confirmed directly before
  // fixing it: a pan-drag left the menu open. Fixed by switching to
  // `mousedown` (still gated on `event.detail`, so the double-click guard
  // holds), which fires immediately at the START of the drag.
  test('Templates closes when a canvas PAN DRAG starts (not just a plain click)', async ({ page }) => {
    await menuBtn(page, /^Templates ▾$/).click()
    const pop = page.locator('.toolbar__actions .menu__pop').first()
    await expect(pop).toBeVisible()

    const box = (await page.locator('.react-flow__pane').boundingBox())!
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 150, startY + 100, { steps: 10 })
    await page.mouse.up()

    await expect(pop).toBeHidden()
  })

  test('Templates closes on a window resize', async ({ page }) => {
    await menuBtn(page, /^Templates ▾$/).click()
    const pop = page.locator('.toolbar__actions .menu__pop').first()
    await expect(pop).toBeVisible()
    await page.setViewportSize({ width: 1300, height: 800 })
    await expect(pop).toBeHidden()
  })
})

test.describe('interactions inside a menu (or its own nested submenu) do not dismiss it', () => {
  test('a click inside File\'s scrollable popover keeps it open', async ({ page }) => {
    await menuBtn(page, /^File ▾$/).click()
    const pop = page.locator('.toolbar__filemenu-pop')
    await expect(pop).toBeVisible()
    // scroll inside the popover itself
    await pop.dispatchEvent('wheel', { deltaY: 20 })
    await expect(pop).toBeVisible()
    // a plain click on the popover's own background (not an item) also stays inside
    await pop.click({ position: { x: 4, y: 4 } })
    await expect(pop).toBeVisible()
  })

  test('Theme flyout: clicking inside it keeps Settings (its parent) open too', async ({ page }) => {
    await menuBtn(page, /^Settings ▾$/).click()
    const settingsPop = page.locator('.toolbar__settingsmenu-pop')
    await expect(settingsPop).toBeVisible()
    await settingsPop.locator('.settings-row', { hasText: /theme/i }).click()
    const themePop = page.locator('.theme-menu__pop')
    await expect(themePop).toBeVisible()

    // click an option inside Theme's own flyout
    await themePop.locator('[role="menuitemradio"], button, [role="option"]').first().click()
    await expect(settingsPop).toBeVisible() // parent survives an internal click
  })

  test('Language flyout: clicking an option keeps Settings (its parent) open too', async ({ page }) => {
    await menuBtn(page, /^Settings ▾$/).click()
    const settingsPop = page.locator('.toolbar__settingsmenu-pop')
    await expect(settingsPop).toBeVisible()
    await settingsPop.locator('.settings-row.lang-switch').click()
    const langPop = page.locator('.lang-menu__pop')
    await expect(langPop).toBeVisible()

    await langPop.locator('[role="option"]').first().click()
    await expect(settingsPop).toBeVisible() // parent survives an internal click
  })
})

test.describe('Escape / Dialog / Share are unaffected by the outside-dismiss fix', () => {
  test('Escape still closes Templates (existing contract untouched)', async ({ page }) => {
    await menuBtn(page, /^Templates ▾$/).click()
    const pop = page.locator('.toolbar__actions .menu__pop').first()
    await expect(pop).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()
  })

  test('a lifted dialog (New) survives the outside-dismiss triggers wheel/resize behind it', async ({
    page,
  }) => {
    // NOTE: clicking the canvas while the dialog is open is deliberately NOT
    // part of this test — ConfirmDialog has its own pre-existing, intentional
    // backdrop: a mousedown anywhere outside the dialog box hits its
    // `.mcdlg__scrim` first and cancels it (ConfirmDialog.tsx's own
    // `dismissOnBackdrop` contract, unrelated to this fix). That's expected,
    // correct behavior, not something a "canvas click" test should trip over.
    // The actual regression risk this fix could introduce is wheel/resize —
    // useOutsideDismiss's two NEW trigger types — reaching past the dialog.
    const fileBtn = menuBtn(page, /^File ▾$/)
    await fileBtn.click()
    await page.getByRole('menuitem', { name: 'New' }).click()
    const dlg = page.locator('.mcdlg--confirm')
    await expect(dlg).toBeVisible()
    // File's own popover is already closed behind it (closeAncestors), so
    // there is no active menu left for useOutsideDismiss to be triggered by —
    // confirm a wheel scroll / window resize genuinely doesn't touch the
    // dialog either way.
    await page.locator('.react-flow__pane').dispatchEvent('wheel', { deltaY: 100 })
    await expect(dlg).toBeVisible()
    await page.setViewportSize({ width: 1300, height: 800 })
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
  })

  test('Share\'s result panel: an internal click (Copy) keeps it open; a node click closes it', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {} },
      })
    })
    const shareBtn = page.locator('.toolbar__actions button', { hasText: /^Share$/ })
    await shareBtn.click()
    await page.locator('.mcdlg--confirm').getByRole('button', { name: /create link/i }).click()
    const panel = page.locator('.share-pop')
    await expect(panel).toBeVisible()

    await panel.getByRole('button', { name: /copy/i }).click()
    await expect(panel).toBeVisible() // internal click preserved

    await node(page).click()
    await expect(panel).toBeHidden() // outside click still dismisses it
  })

  test('switching directly between two Tier-1 triggers still closes the old one and opens the new one', async ({
    page,
  }) => {
    await menuBtn(page, /^File ▾$/).click()
    await expect(page.locator('.toolbar__filemenu-pop')).toBeVisible()
    await menuBtn(page, /^Data ▾$/).click()
    await expect(page.locator('.toolbar__filemenu-pop')).toHaveCount(0)
    await expect(page.locator('.toolbar__actions .menu__pop')).toBeVisible()
    await page.keyboard.press('Escape')
  })
})
