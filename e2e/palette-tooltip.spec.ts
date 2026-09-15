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

test('drag-start clears the tooltip immediately', async ({ page }) => {
  await chip(page, 'converter').hover()
  await expect(tip(page, 'converter')).toBeVisible()

  await page.evaluate(() => {
    const el = document.querySelector('.chip--converter') as HTMLElement
    const dt = new DataTransfer()
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  })
  await expect(tip(page, 'converter')).toBeHidden()

  await page.evaluate(() => {
    const el = document.querySelector('.chip--converter') as HTMLElement
    el.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
  })
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
