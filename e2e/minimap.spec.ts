import { ensureTimelineOpen, expandMinimap, expect, importGraph, openApp, readRiskyFactory, resetAll, resetView, test, snap } from './support/loop'

// The existing visual specs frame `.timeline` and don't touch the canvas, so the
// minimap legibility fix (per-kind node hues, viewport outline, mask, frame
// tokens) has no pixel guard. These two shots + two semantic checks pin it.

async function minimapReady(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page)
  // the minimap starts folded (docs/workbench.md §WB2.1) — these shots are of
  // the open minimap, opened as the user's stored choice
  await expandMinimap(page)
  // The Timeline panel now starts collapsed (timeline-series-contract §7), so
  // the layout the shot frames is made first — panel open — and the camera is
  // then the product's own Reset view at that layout, not whatever fit ran at
  // mount on the taller pane. (The previous baselines inherited the MOUNT fit
  // of the initial document; this camera is a deterministic function of the
  // imported graph and the final pane, so the baselines were re-captured once.)
  await ensureTimelineOpen(page)
  await resetAll(page)
  await importGraph(page, readRiskyFactory())
  await expect(page.locator('.react-flow__node')).toHaveCount(18)
  await resetView(page)
  // the MiniMap renders a <rect> per node only once React Flow has measured it
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(18, { timeout: 10_000 })
  await page.evaluate(() => document.fonts.ready)
}

/** rgb() string that `var(--ink-2)` resolves to in the current theme */
const viewOutlineRgb = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--ink-2)'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  })

test.describe('minimap — legibility', () => {
  test('semantic: multiple node hues + viewport outline is the strong neutral', async ({ page }) => {
    await minimapReady(page)

    // node fills are per-kind, not one flat colour (risky-factory has 6 kinds)
    const fills = await page.$$eval('.react-flow__minimap-node', (els) =>
      els.map((el) => getComputedStyle(el as SVGElement).fill),
    )
    expect(fills).toHaveLength(18)
    expect(new Set(fills).size).toBeGreaterThanOrEqual(4)

    // the mask (everything outside the viewport) is stroked with --ink-2
    // (colour review A, step 3, 2026-10-21: it was --accent; "where you are" is
    // not a run, and a hue blends with the pool / source node fills). The CSS
    // rule and MinimapDock's maskStrokeColor both name it: React Flow hands the
    // prop on as an inline custom property; the computed stroke is the rule.
    const mask = await page.$eval('.react-flow__minimap-mask', (el) => {
      const VAR = '--xy-minimap-mask-stroke-color-props'
      const host = el.closest<HTMLElement | SVGElement>(`[style*="${VAR}"]`)
      return { computed: getComputedStyle(el as SVGElement).stroke, prop: host?.style.getPropertyValue(VAR).trim() ?? null }
    })
    expect(mask.computed).toBe(await viewOutlineRgb(page))
    expect(mask.prop).toBe('var(--ink-2)')
  })

  test('light', async ({ page }) => {
    await minimapReady(page)
    await expect(page.locator('.react-flow__minimap')).toHaveScreenshot(...snap(page, 'minimap-light'))
  })

  test('dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await minimapReady(page)
    await expect(page.locator('.react-flow__minimap')).toHaveScreenshot(...snap(page, 'minimap-dark'))
  })
})
