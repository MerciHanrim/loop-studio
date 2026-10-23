import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, routesSettled, test } from './support/loop'

// docs/workbench.md §WB1a — the side panels at the window's width (Lumi,
// 2026-10-20), checked by operating them:
//   ≥ 1280 px    the list and the properties both open; each folds
//   900–1279 px  the list folded, the properties open
//   below 900 px both folded; each opens as an overlay, one at a time
// A selection never opens a panel (an open properties panel shows the new
// selection), and a fold or an open never moves or zooms the canvas.

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Supply', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'Stock', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'out', type: 'drain', position: { x: 400, y: 0 }, data: { kind: 'drain', label: 'Sales', activation: 'automatic', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e1', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    { id: 'e2', source: 'pool', target: 'out', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
  ],
})

const left = (page: Page) => page.locator('#wb-panel-left')
const right = (page: Page) => page.locator('#wb-panel-right')
const toggle = (page: Page, side: 'left' | 'right') => page.locator(`[data-panel-toggle="${side}"]`)
const viewport = (page: Page) => page.evaluate(() => (window as any).__loop.rf.getViewport() as { x: number; y: number; zoom: number })
const positions = (page: Page) => page.evaluate(() => (window as any).__loop.graph.getState().nodes.map((n: any) => [n.id, n.position.x, n.position.y]))
const state = (page: Page) =>
  page.evaluate(() => {
    const at = (id: string) => {
      const el = document.getElementById(id) as HTMLElement
      return el.hidden ? 'folded' : el.classList.contains('is-overlay') ? 'overlay' : 'open'
    }
    return { left: at('wb-panel-left'), right: at('wb-panel-right') }
  })

async function load(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 })
  await openApp(page)
  await resetAll(page)
  await importGraph(page, G)
  await routesSettled(page)
  await page.evaluate(() => (window as any).__loop.rf.setViewport({ x: 40, y: 120, zoom: 1 }, { duration: 0 }))
}
const clickNode = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`).click()

test.describe('the side panels by width (§WB1a)', () => {
  test('1280: both open; each folds and opens again, and the canvas does not move or zoom', async ({ page }) => {
    await load(page, 1280)
    expect(await state(page)).toEqual({ left: 'open', right: 'open' })
    await expect(toggle(page, 'left')).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle(page, 'left')).toHaveAttribute('aria-controls', 'wb-panel-left')
    const vp = await viewport(page)
    const pos = await positions(page)
    const paneW = () => page.evaluate(() => Math.round(document.querySelector('.react-flow')!.getBoundingClientRect().width))
    const w0 = await paneW()
    await toggle(page, 'left').click()
    expect(await state(page)).toEqual({ left: 'folded', right: 'open' })
    expect(await paneW(), 'the canvas takes the list\'s room').toBe(w0 + 272)
    await toggle(page, 'right').click()
    expect(await state(page)).toEqual({ left: 'folded', right: 'folded' })
    expect(await viewport(page), 'no fit, no zoom').toEqual(vp)
    await toggle(page, 'left').click()
    await toggle(page, 'right').click()
    expect(await state(page)).toEqual({ left: 'open', right: 'open' })
    expect(await viewport(page)).toEqual(vp)
    expect(await positions(page), 'no node moved').toEqual(pos)
  })

  test('1024: the list folded, the properties open; a selection does not open the list', async ({ page }) => {
    await load(page, 1024)
    expect(await state(page)).toEqual({ left: 'folded', right: 'open' })
    await clickNode(page, 'pool')
    await expect(right(page).locator('.wb-panel__name')).toHaveText('Stock')
    expect(await state(page)).toEqual({ left: 'folded', right: 'open' })
    // opened, the list is in the layout (not over the canvas)
    await toggle(page, 'left').click()
    expect(await state(page)).toEqual({ left: 'open', right: 'open' })
    await expect(left(page).locator('.wb-row[data-node="pool"]')).toBeVisible()
  })

  test('800: both folded; a selection opens nothing; opened, the properties are an overlay that follows the selection; one overlay at a time; Escape returns to the button', async ({ page }) => {
    await load(page, 800)
    expect(await state(page)).toEqual({ left: 'folded', right: 'folded' })
    const vp = await viewport(page)
    const pos = await positions(page)
    const paneW0 = await page.evaluate(() => Math.round(document.querySelector('.react-flow')!.getBoundingClientRect().width))
    expect(paneW0, 'the canvas has the window').toBe(800)

    await clickNode(page, 'pool')
    expect(await state(page), 'a selection never opens a panel').toEqual({ left: 'folded', right: 'folded' })

    await toggle(page, 'right').click()
    expect(await state(page)).toEqual({ left: 'folded', right: 'overlay' })
    await expect(right(page).locator('.wb-panel__name')).toHaveText('Stock')
    // the focus went into it
    expect(await right(page).evaluate((el) => el.contains(document.activeElement))).toBe(true)
    // over the canvas: the canvas keeps its width and its view
    expect(await page.evaluate(() => Math.round(document.querySelector('.react-flow')!.getBoundingClientRect().width))).toBe(paneW0)
    // the selection changes on the canvas: the open panel shows it
    await clickNode(page, 'src')
    await expect(right(page).locator('.wb-panel__name')).toHaveText('Supply')
    expect(await state(page)).toEqual({ left: 'folded', right: 'overlay' })

    // one overlay at a time
    await toggle(page, 'left').click()
    expect(await state(page)).toEqual({ left: 'overlay', right: 'folded' })
    // the focus goes into it a frame after the click (`focusInto`); an Escape
    // pressed before that lands on the toggle, outside the overlay (2026-10-20:
    // it did, and the overlay stayed open)
    await expect.poll(() => left(page).evaluate((el) => el.contains(document.activeElement))).toBe(true)
    // Escape closes it and gives the focus back to its button
    await page.keyboard.press('Escape')
    expect(await state(page)).toEqual({ left: 'folded', right: 'folded' })
    await expect(toggle(page, 'left')).toBeFocused()

    expect(await viewport(page), 'no fit, no zoom').toEqual(vp)
    expect(await positions(page), 'no node moved').toEqual(pos)
  })

  test('a choice is kept for its width band; another band shows its own defaults', async ({ page }) => {
    await load(page, 1280)
    await toggle(page, 'right').click()
    expect(await state(page)).toEqual({ left: 'open', right: 'folded' })
    await page.setViewportSize({ width: 1024, height: 800 })
    await expect.poll(() => state(page)).toEqual({ left: 'folded', right: 'open' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(() => state(page), 'back in its band, the choice holds').toEqual({ left: 'open', right: 'folded' })
  })
})
