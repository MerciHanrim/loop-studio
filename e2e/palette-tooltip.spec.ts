import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Hanrim's UX report (2026-09-15): clicking a palette chip to create a node
// left that chip's hover tooltip stuck open — DOM focus remains on the
// button after a mouse click, and the tooltip was keyed off `:focus-within`,
// which doesn't distinguish a mouse click from keyboard focus. Clicking a
// DIFFERENT chip just moved the stuck tooltip onto that one instead.
//
// Contract (src/components/Toolbar.tsx / src/index.css):
//  - hover shows the tooltip;
//  - a click that creates a node closes that tooltip immediately, even if
//    the pointer never left the chip;
//  - only leaving and re-entering the SAME chip re-arms its hover tooltip;
//  - a different chip's tooltip never lingers from a previous click;
//  - keyboard Tab still shows the tooltip (`:focus-visible`, not `:focus`);
//  - a drag-start also clears the tooltip immediately.

const chip = (page: Page, kind: string) => page.locator(`.chip--${kind}`)
const tip = (page: Page, kind: string) => page.locator(`#palette-tip-${kind}`)
const visibleTipCount = (page: Page) =>
  page.locator('.palette-tip').evaluateAll(
    (els) => els.filter((el) => getComputedStyle(el).display !== 'none').length,
  )

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await resetAll(page)
})

test('click sequence: each click creates its node and leaves no stuck tooltip', async ({ page }) => {
  const nodeCount = () => page.locator('.react-flow__node').count()
  const before = await nodeCount()

  // 1: Gate hover -> tooltip shows
  await chip(page, 'gate').hover()
  await expect(tip(page, 'gate')).toBeVisible()

  // 2: Gate click -> node created, tooltip gone even though the pointer
  // never left the button
  await chip(page, 'gate').click()
  await expect.poll(nodeCount).toBe(before + 1)
  await expect(tip(page, 'gate')).toBeHidden()
  expect(await visibleTipCount(page)).toBe(0)

  // 3: End hover then click -> node created, End's OWN tooltip also gone
  await chip(page, 'end').hover()
  await expect(tip(page, 'end')).toBeVisible()
  await chip(page, 'end').click()
  await expect.poll(nodeCount).toBe(before + 2)
  await expect(tip(page, 'end')).toBeHidden()
  expect(await visibleTipCount(page)).toBe(0)

  // 4: Parameter hover then click -> node created, tooltip gone
  await chip(page, 'parameter').hover()
  await expect(tip(page, 'parameter')).toBeVisible()
  await chip(page, 'parameter').click()
  await expect.poll(nodeCount).toBe(before + 3)
  await expect(tip(page, 'parameter')).toBeHidden()

  // 5: after every click above, the palette shows zero visible tooltips
  expect(await visibleTipCount(page)).toBe(0)
})

test('leaving and re-entering the same chip re-arms its hover tooltip', async ({ page }) => {
  await chip(page, 'pool').hover()
  await expect(tip(page, 'pool')).toBeVisible()
  await chip(page, 'pool').click()
  await expect(tip(page, 'pool')).toBeHidden()

  // move away, then back — the tooltip must be re-armed
  await page.locator('.toolbar__brand').hover()
  await chip(page, 'pool').hover()
  await expect(tip(page, 'pool')).toBeVisible()
})

test('a different chip never inherits a stuck tooltip from the previous click', async ({ page }) => {
  await chip(page, 'source').hover()
  await chip(page, 'source').click()
  await expect(tip(page, 'source')).toBeHidden()

  await chip(page, 'drain').hover()
  await expect(tip(page, 'drain')).toBeVisible()
  await expect(tip(page, 'source')).toBeHidden()
})

test('drag-start clears the tooltip immediately; dragend alone does not re-arm it', async ({ page }) => {
  await chip(page, 'converter').hover()
  await expect(tip(page, 'converter')).toBeVisible()

  await page.evaluate(() => {
    const el = document.querySelector('.chip--converter') as HTMLElement
    const dt = new DataTransfer()
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  })
  await expect(tip(page, 'converter')).toBeHidden()

  // P2 regression (review, 2026-09-15): `onDragEnd` used to also clear
  // `suppressedTip`, so a cancelled drag (or one that ends with the pointer
  // still over the same chip) re-armed `:hover` and popped the tooltip back
  // before the pointer ever left the button. dragend alone must NOT re-show
  // it — only leaving and re-entering the chip does.
  await page.evaluate(() => {
    const el = document.querySelector('.chip--converter') as HTMLElement
    el.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
  })
  await expect(tip(page, 'converter')).toBeHidden()

  await chip(page, 'pool').hover()
  await chip(page, 'converter').hover()
  await expect(tip(page, 'converter')).toBeVisible()
})

test('keyboard Tab to a chip still shows its tooltip (:focus-visible, not a click)', async ({ page }) => {
  // seed a starting point, then reach the target chip via REAL keyboard Tab
  // presses — what actually drives the browser's `:focus-visible` heuristic,
  // unlike a programmatic `.focus()` call
  await chip(page, 'pool').focus()
  for (let i = 0; i < 7; i++) await page.keyboard.press('Tab') // pool -> ... -> register
  await expect(chip(page, 'register')).toBeFocused()
  await expect(tip(page, 'register')).toBeVisible()
})

// ── Escape and pointer retention (docs/accessibility.md, Hanrim 2026-09-21) ──
// A tooltip a reader is trying to read used to vanish the moment the pointer
// left the chip, because `.palette-tip` was `pointer-events: none`, and Escape
// did not close it at all.

test('Escape closes only the tooltip, leaves focus on the trigger, and the next Escape is the canvas’s again', async ({ page }) => {
  // arm the canvas behaviour Escape would otherwise reach
  await page.evaluate(() => (window as any).__loop.ui.getState().setRegionSelectArmed(true))
  const armed = () => page.evaluate(() => (window as any).__loop.ui.getState().regionSelectArmed as boolean)
  expect(await armed()).toBe(true)

  await chip(page, 'gate').focus()
  await chip(page, 'gate').hover()
  await expect(tip(page, 'gate')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(tip(page, 'gate')).toBeHidden()
  await expect(chip(page, 'gate'), 'focus stays on the trigger').toBeFocused()
  expect(await armed(), 'the same press did NOT also reach the canvas').toBe(true)

  // with the tooltip gone the key belongs to the canvas again
  await page.keyboard.press('Escape')
  expect(await armed()).toBe(false)
})

test('Escape keeps the tooltip shut while the pointer sits still, and leaving re-arms it', async ({ page }) => {
  await chip(page, 'pool').hover()
  await expect(tip(page, 'pool')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tip(page, 'pool')).toBeHidden()
  // the pointer never moved — the same rule a click uses: no re-show until
  // the pointer leaves and comes back
  await expect(tip(page, 'pool')).toBeHidden()
  await page.mouse.move(640, 700)
  await chip(page, 'pool').hover()
  await expect(tip(page, 'pool')).toBeVisible()
})

test('the pointer can travel onto the tooltip and read it; leaving both closes it', async ({ page }) => {
  const chipBox = (await chip(page, 'converter').boundingBox())!
  await chip(page, 'converter').hover()
  await expect(tip(page, 'converter')).toBeVisible()
  const tipBox = (await tip(page, 'converter').boundingBox())!

  // the tooltip never covers its own trigger
  expect(tipBox.y, 'the tooltip sits below the chip, not over it').toBeGreaterThanOrEqual(
    chipBox.y + chipBox.height,
  )

  // walk the pointer down through the gap and onto the tooltip, the way a
  // hand does — not a jump, so the chip's `mouseleave` really fires on the way
  const midX = tipBox.x + tipBox.width / 2
  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2)
  await page.mouse.move(midX, tipBox.y + tipBox.height / 2, { steps: 8 })
  await expect(tip(page, 'converter'), 'still readable with the pointer on it').toBeVisible()

  // and it stays put while the pointer moves around inside it
  await page.mouse.move(tipBox.x + 8, tipBox.y + tipBox.height - 4, { steps: 4 })
  await expect(tip(page, 'converter')).toBeVisible()

  // leaving both closes it
  await page.mouse.move(640, 700, { steps: 8 })
  await expect(tip(page, 'converter')).toBeHidden()
  expect(await visibleTipCount(page)).toBe(0)

  // nothing is left behind at that spot for the canvas to lose a click to
  const under = await page.evaluate(
    ([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.palette-tip') !== null,
    [midX, tipBox.y + tipBox.height / 2] as const,
  )
  expect(under, 'no hidden tooltip hit area remains').toBe(false)
})

test('a fast sweep across the palette leaves no ghost tooltip', async ({ page }) => {
  const first = (await chip(page, 'pool').boundingBox())!
  const last = (await chip(page, 'register').boundingBox())!
  await page.mouse.move(first.x + 4, first.y + first.height / 2)
  await page.mouse.move(last.x + last.width - 4, last.y + last.height / 2, { steps: 3 })
  await page.mouse.move(640, 700, { steps: 3 })
  await expect.poll(() => visibleTipCount(page), { timeout: 3000 }).toBe(0)
})
