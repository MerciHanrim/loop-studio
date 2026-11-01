import type { Locator, Page } from '@playwright/test'
import { ensureTimelineOpen, expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// issue #422 item 3 (Lumi, 2026-11-01) — `f` (Focus view) and `[` / `]` (the
// neighbour walk) are canvas commands: they act only while the canvas has the
// keyboard. With focus in the left panel, the timeline, the status bar or a
// field they do nothing to the canvas. Until now they ran anywhere outside a
// text field (and, since #403, outside a modal).

type Bridge = { __loop: { ui: { getState: () => { focusMode: boolean } }; graph: { getState: () => { selectedNodeId: string | null } } } }
const state = (page: Page) =>
  page.evaluate(() => {
    const w = (window as unknown as Bridge).__loop
    return { focus: w.ui.getState().focusMode, selected: w.graph.getState().selectedNodeId }
  })
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)

async function load(page: Page) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await ensureTimelineOpen(page)
  await node(page, 'ore_stock').click()
  await expect.poll(async () => (await state(page)).selected).toBe('ore_stock')
}

/** with focus on `target`, the three keys leave the canvas as it was */
async function keysDoNothing(page: Page, target: Locator) {
  await target.focus()
  await expect(target).toBeFocused()
  const before = await state(page)
  expect(before).toEqual({ focus: false, selected: 'ore_stock' })
  for (const key of ['f', ']', '[']) {
    await page.keyboard.press(key)
    expect(await state(page), `${key} with focus on ${await target.evaluate((el) => el.outerHTML.slice(0, 60))}`).toEqual(before)
  }
}

test.describe('f, [ and ] act only while the canvas has the keyboard (#422)', () => {
  test('a left-panel tab: nothing happens to the canvas', async ({ page }) => {
    await load(page)
    await keysDoNothing(page, page.locator('.wb-tabs [role="tab"]').first())
  })

  test('the timeline: nothing happens to the canvas', async ({ page }) => {
    await load(page)
    // the chart's own height handle, a focusable control of the timeline itself
    await keysDoNothing(page, page.locator('.timeline [role="separator"][tabindex="0"]').first())
  })

  test('the status bar: nothing happens to the canvas', async ({ page }) => {
    await load(page)
    await keysDoNothing(page, page.locator('.wb-status button').first())
  })

  test('a field (the Inspector’s Label): the key is typed, nothing happens to the canvas', async ({ page }) => {
    await load(page)
    const label = page.locator('.inspector').getByRole('textbox', { name: 'Label', exact: true })
    await label.focus()
    const before = await state(page)
    const text = await label.inputValue()
    await page.keyboard.press('f')
    await expect(label).toHaveValue(`${text}f`)
    expect(await state(page)).toEqual(before)
  })

  test('on the canvas they act: focus on the selected node, and on no control at all', async ({ page }) => {
    await load(page)
    await node(page, 'ore_stock').focus()
    await page.keyboard.press(']')
    await expect.poll(async () => (await state(page)).selected).not.toBe('ore_stock')
    await page.keyboard.press('f')
    await expect.poll(async () => (await state(page)).focus).toBe(true)
    // nothing focused (the page itself), as right after the app opens
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    await page.keyboard.press('f')
    await expect.poll(async () => (await state(page)).focus).toBe(false)
  })
})
