import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, readRiskyFactory, resetAll, test } from './support/loop'

// docs/mobile.md §MV10 — the mobile View/Run layout. Runs under the `mobile`
// Playwright project (390x844 portrait; tests rotate to 844x390). Slice 1 scope:
// dynamic-viewport height, no sideways scroll, safe-area reserved as real space,
// a full-bleed canvas, no minimap, one re-fit on rotation. The fixed run bar,
// the compact top bar, the sheets, and the editing lock land in Slices 2-3.

const PORTRAIT = { width: 390, height: 844 }
const LANDSCAPE = { width: 844, height: 390 }

async function loadDiagram(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
}

/** document does not scroll sideways */
async function noHScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement
    return el.scrollWidth - el.clientWidth
  })
  expect(over, 'no horizontal document overflow').toBeLessThanOrEqual(0)
}

function rectInside(inner: { x: number; y: number; width: number; height: number } | null, w: number, h: number, slack = 1): boolean {
  if (!inner) return false
  return (
    inner.x >= -slack &&
    inner.y >= -slack &&
    inner.x + inner.width <= w + slack &&
    inner.y + inner.height <= h + slack
  )
}

test.describe('mobile view/run — Slice 1 layout', () => {
  test('portrait: full-bleed canvas, no minimap, no sideways scroll', async ({ page }) => {
    await loadDiagram(page)
    await noHScroll(page)

    // minimap is not rendered on mobile (§MV-D10)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
    // the desktop Inspector column is out of the mobile flow (Slice 3 → sheet)
    await expect(page.locator('.inspector')).toBeHidden()

    const canvas = await page.locator('.canvas').boundingBox()
    expect(canvas).not.toBeNull()
    // canvas spans the full width and takes most of the screen
    expect(canvas!.width).toBeGreaterThanOrEqual(PORTRAIT.width - 2)
    const cover = (canvas!.width * canvas!.height) / (PORTRAIT.width * PORTRAIT.height)
    expect(cover, 'canvas covers most of the viewport').toBeGreaterThan(0.6)
  })

  test('landscape: still no sideways scroll, canvas still fills', async ({ page }) => {
    await loadDiagram(page)
    await page.setViewportSize(LANDSCAPE)
    await page.waitForTimeout(120)
    await noHScroll(page)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)

    const canvas = await page.locator('.canvas').boundingBox()
    expect(canvas!.width).toBeGreaterThanOrEqual(LANDSCAPE.width - 2)
    const cover = (canvas!.width * canvas!.height) / (LANDSCAPE.width * LANDSCAPE.height)
    expect(cover).toBeGreaterThan(0.6)
  })

  test('safe-area insets are reserved as real padding', async ({ page }) => {
    await loadDiagram(page)
    // mock non-zero insets the way a notched device reports them
    await page.addStyleTag({
      content: ':root{--sai-top:47px;--sai-right:0px;--sai-bottom:34px;--sai-left:0px;}',
    })
    await page.waitForTimeout(60)

    const padTop = await page.locator('.toolbar').evaluate((el) => parseFloat(getComputedStyle(el).paddingTop))
    const padBottom = await page.locator('.pstrip').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
    expect(padTop, 'toolbar reserves the top inset').toBeGreaterThanOrEqual(47)
    expect(padBottom, 'run strip reserves the bottom inset').toBeGreaterThanOrEqual(34)

    // still no overflow, canvas still fills
    await noHScroll(page)
    const canvas = await page.locator('.canvas').boundingBox()
    expect(canvas!.width).toBeGreaterThanOrEqual(PORTRAIT.width - 2)
  })

  test('dynamic viewport height: the run controls stay on-screen when height shrinks and grows', async ({ page }) => {
    await loadDiagram(page)
    for (const h of [844, 620, 700, 844]) {
      await page.setViewportSize({ width: PORTRAIT.width, height: h })
      await page.waitForTimeout(80)
      const strip = await page.locator('.pstrip').boundingBox()
      expect(strip, `run strip present at height ${h}`).not.toBeNull()
      expect(strip!.y + strip!.height, `run strip bottom within viewport at height ${h}`).toBeLessThanOrEqual(h + 1)
      expect(strip!.y, `run strip top within viewport at height ${h}`).toBeGreaterThanOrEqual(0)
      await noHScroll(page)
    }
  })

  test('rotation re-fits the diagram exactly once; same-orientation pan/zoom does not', async ({ page }) => {
    await loadDiagram(page)
    await page.waitForTimeout(200)

    const viewportTransform = () =>
      page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)

    // pan within portrait — the viewport transform changes, and it is NOT reset
    const before = await viewportTransform()
    const c = (await page.locator('.canvas').boundingBox())!
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
    await page.mouse.down()
    await page.mouse.move(c.x + c.width / 2 - 60, c.y + c.height / 2 - 40, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(120)
    const afterPan = await viewportTransform()
    expect(afterPan, 'pan moved the viewport').not.toBe(before)

    // rotate — a single re-fit brings every node back inside the canvas
    await page.setViewportSize(LANDSCAPE)
    await page.waitForTimeout(300)
    const canvas = (await page.locator('.canvas').boundingBox())!
    const nodes = await page.locator('.react-flow__node').all()
    expect(nodes.length).toBeGreaterThan(0)
    for (const n of nodes) {
      const b = await n.boundingBox()
      expect(rectInside(b, canvas.x + canvas.width, canvas.y + canvas.height, 8), 'node inside canvas after rotation re-fit').toBe(true)
    }
    await noHScroll(page)
  })

  test('resizing back to a desktop width restores the desktop layout', async ({ page }) => {
    await loadDiagram(page)
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0)

    await page.setViewportSize({ width: 1200, height: 800 })
    await page.waitForTimeout(150)

    await expect(page.locator('.react-flow__minimap')).toHaveCount(1)
    await expect(page.locator('.inspector')).toBeVisible()
  })
})
