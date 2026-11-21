import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// Review U2 (2026-11-22) — a two-finger pinch keeps the content under the
// fingers where it is. The pan surface's pinch read the fingers' midpoint in
// page coordinates as if it were a pane coordinate, so the content under the
// fingers moved by the pane's offset × (1 − the zoom ratio): on the phone a 2×
// pinch moved it up by the whole top bar (57 px), and on a touch desktop in Pan
// mode, with the left panel open, by the panel's width as well.
// Real touches through CDP, so the browser makes its own pointer events.

type L = { __loop: Record<string, { getState: () => any; setState: (s: object) => void; getViewport: () => any }> }
type Pt = { x: number; y: number }

async function load(page: Page, panMode: boolean) {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node[data-id="ore_stock"]')).toBeVisible()
  if (panMode) await page.evaluate(() => (window as unknown as L).__loop.ui.setState({ panMode: true }))
  await expect(page.locator('.pan-surface')).toHaveClass(/pan-surface--active/)
}

const pane = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('.react-flow')!.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })
const viewport = (page: Page) => page.evaluate(() => (window as unknown as L).__loop.rf.getViewport() as { x: number; y: number; zoom: number })

/** two fingers about `c`, horizontally, from ±d0 to ±d1 apart in six moves */
async function pinch(page: Page, c: Pt, d0: number, d1: number) {
  const cdp = await page.context().newCDPSession(page)
  const at = (d: number) => [
    { x: c.x - d, y: c.y, id: 1 },
    { x: c.x + d, y: c.y, id: 2 },
  ]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(d0) } as never)
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(d0 + ((d1 - d0) * i) / 6) } as never)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] } as never)
  await cdp.detach()
}

/** pinch about the pane's centre; where the content that was under it is now, and the zoom ratio */
async function pinchAtCentre(page: Page, d0: number, d1: number) {
  const p = await pane(page)
  const c = { x: Math.round(p.left + p.width / 2), y: Math.round(p.top + p.height / 2) }
  const v0 = await viewport(page)
  const f = { x: (c.x - p.left - v0.x) / v0.zoom, y: (c.y - p.top - v0.y) / v0.zoom }
  await pinch(page, c, d0, d1)
  await expect.poll(async () => (await viewport(page)).zoom).not.toBe(v0.zoom)
  const v1 = await viewport(page)
  const now = { x: p.left + v1.x + f.x * v1.zoom, y: p.top + v1.y + f.y * v1.zoom }
  return { pane: p, ratio: v1.zoom / v0.zoom, drift: { x: now.x - c.x, y: now.y - c.y } }
}

const SIZES = [
  { name: 'phone, portrait 390 × 844', width: 390, height: 844, mobile: true },
  { name: 'phone, landscape 844 × 390', width: 844, height: 390, mobile: true },
  { name: 'touch desktop 1280 × 800, Pan mode, the left panel open', width: 1280, height: 800, mobile: false },
]

for (const s of SIZES) {
  test.describe(s.name, () => {
    test.use({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: true })

    test('a pinch in and a pinch out keep the content under the fingers where it is', async ({ page }) => {
      await load(page, !s.mobile)
      const p = await pane(page)
      // the case itself: the pane is offset from the page (the top bar; on the desktop the left panel too)
      expect(p.top, 'the pane starts below a bar').toBeGreaterThan(40)
      if (!s.mobile) expect(p.left, 'the left panel is open').toBeGreaterThan(200)

      const zoomIn = await pinchAtCentre(page, 30, 60)
      expect(zoomIn.ratio, 'the pinch zoomed in').toBeGreaterThan(1.3)
      expect(Math.abs(zoomIn.drift.x), `zoom in, sideways drift ${zoomIn.drift.x.toFixed(1)} px`).toBeLessThanOrEqual(1)
      expect(Math.abs(zoomIn.drift.y), `zoom in, vertical drift ${zoomIn.drift.y.toFixed(1)} px`).toBeLessThanOrEqual(1)

      const zoomOut = await pinchAtCentre(page, 60, 30)
      expect(zoomOut.ratio, 'the pinch zoomed out').toBeLessThan(0.75)
      expect(Math.abs(zoomOut.drift.x), `zoom out, sideways drift ${zoomOut.drift.x.toFixed(1)} px`).toBeLessThanOrEqual(1)
      expect(Math.abs(zoomOut.drift.y), `zoom out, vertical drift ${zoomOut.drift.y.toFixed(1)} px`).toBeLessThanOrEqual(1)
    })
  })
}
