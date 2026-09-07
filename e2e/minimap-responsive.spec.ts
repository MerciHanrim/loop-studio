import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/mobile.md §MV-D10 / docs/dense-graph-pan.md — the minimap is a fixed
// ~202×152 overlay; it only earns its space on a canvas pane large enough to
// want an overview. `Canvas.tsx` `minimapFits` renders it only when the
// `.react-flow` pane is at least 640 × 380 px (and never on mobile), so a
// narrow / short desktop window is not two-thirds minimap. This locks:
//   • the threshold (both axes, inclusive), read against the real pane size
//   • the two named cases (1280 shows, 820 hides)
//   • a resize round-trip across the boundary leaves nodes + viewport intact
//   • toggling the minimap never adds horizontal scroll or resizes the pane

const GRAPH = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'a', type: 'source', position: { x: 40, y: 60 }, data: { kind: 'source', label: 'A', activation: 'automatic', mode: 'pushAny' } },
    { id: 'b', type: 'pool', position: { x: 300, y: 60 }, data: { kind: 'pool', label: 'B', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
    { id: 'c', type: 'drain', position: { x: 560, y: 60 }, data: { kind: 'drain', label: 'C', activation: 'passive', mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e1', type: 'loop', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
    { id: 'e2', type: 'loop', source: 'b', target: 'c', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '1' } },
  ],
})

const paneSize = (p: Page) =>
  p.evaluate(() => {
    const rf = document.querySelector('.react-flow') as HTMLElement | null
    return rf ? { w: rf.clientWidth, h: rf.clientHeight } : { w: 0, h: 0 }
  })
const minimapCount = (p: Page) => p.locator('.react-flow__minimap').count()
const viewport = (p: Page) =>
  p.evaluate(() => {
    const rf = (window as unknown as { __loop: { rf: { getViewport: () => { x: number; y: number; zoom: number } } } }).__loop.rf
    return rf.getViewport()
  })
const nodePositions = (p: Page) =>
  p.evaluate(() =>
    Object.fromEntries(
      (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string; position: { x: number; y: number } }[] } } } }).__loop.graph
        .getState()
        .nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    ),
  )

test.describe('minimap — visible only when the pane can host it', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, GRAPH)
    await expect(page.locator('.react-flow__node[data-id="b"]')).toBeVisible()
  })

  test('threshold: shown ⇒ pane ≥ 640 × 380; pane ≥ 640 × 380 on a desktop-width window ⇒ shown; below either axis ⇒ hidden', async ({ page }) => {
    // the assertion reads the REAL pane size so the 640 × 380 line is exact
    // whatever the surrounding chrome does. `w >= 760` keeps the "sufficient"
    // direction clear of the separate mobile-layout breakpoint (< 720).
    for (const size of [
      { w: 1280, h: 800 },
      { w: 1100, h: 720 },
      { w: 960, h: 700 },
      { w: 900, h: 430 }, // short → pane height under 380
      { w: 760, h: 900 }, // narrow → pane width under 640 once the Inspector column is in
      { w: 640, h: 800 },
      { w: 500, h: 900 },
    ]) {
      await page.setViewportSize({ width: size.w, height: size.h })
      await page.waitForTimeout(150)
      const pane = await paneSize(page)
      const shown = (await minimapCount(page)) === 1
      const label = `window ${size.w}×${size.h} → pane ${pane.w}×${pane.h}, minimap ${shown ? 'shown' : 'hidden'}`
      // necessary: the minimap never renders on a pane below the line
      if (shown) expect(pane.w >= 640 && pane.h >= 380, label).toBe(true)
      // sufficient: at / above the line on a desktop-width window it renders
      if (pane.w >= 640 && pane.h >= 380 && size.w >= 760) expect(shown, label).toBe(true)
      // and it is gone whenever the pane is under the line
      if (pane.w < 640 || pane.h < 380) expect(shown, label).toBe(false)
    }
  })

  test('1280 window shows the minimap; 820 window hides it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()

    await page.setViewportSize({ width: 820, height: 620 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
  })

  test('resizing across the boundary does not reset nodes or the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
    // a deliberate, non-default camera
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: -123, y: 45, zoom: 1.37 },
        { duration: 0 },
      ),
    )
    const vp0 = await viewport(page)
    const pos0 = await nodePositions(page)

    for (const size of [
      { w: 560, h: 700 }, // minimap gone
      { w: 1200, h: 800 }, // minimap back
      { w: 700, h: 360 }, // gone again (height)
      { w: 1280, h: 800 }, // back
    ]) {
      await page.setViewportSize({ width: size.w, height: size.h })
      await page.waitForTimeout(150)
    }

    expect(await viewport(page)).toEqual(vp0)
    expect(await nodePositions(page)).toEqual(pos0)
  })

  test('showing / hiding the minimap adds no horizontal scroll and does not resize the pane', async ({ page }) => {
    // measure the pane at a size that shows the minimap
    await page.setViewportSize({ width: 1100, height: 760 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
    const paneShown = await paneSize(page)
    const noHScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
    expect(await noHScroll()).toBe(true)
    // the minimap sits inside the pane (an absolute Panel), never past its right edge
    const inside = await page.evaluate(() => {
      const rf = document.querySelector('.react-flow') as HTMLElement
      const mm = document.querySelector('.react-flow__minimap') as HTMLElement
      const r = rf.getBoundingClientRect(), m = mm.getBoundingClientRect()
      return m.right <= r.right + 1 && m.bottom <= r.bottom + 1 && m.left >= r.left - 1
    })
    expect(inside).toBe(true)

    // hide it, then show it again at the SAME window size range — the pane
    // width/height are driven by the layout, not by the minimap
    await page.setViewportSize({ width: 600, height: 760 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    expect(await noHScroll()).toBe(true)

    await page.setViewportSize({ width: 1100, height: 760 })
    await page.waitForTimeout(150)
    await expect(page.locator('.react-flow__minimap')).toBeVisible()
    expect(await paneSize(page)).toEqual(paneShown)
    expect(await noHScroll()).toBe(true)
  })
})
