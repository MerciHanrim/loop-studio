import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { fitCount, frames, misfits, readRows, ROWS_GRAPH, zoomOne } from './support/rowFit'

// issue #332 on the phone (the `mobile` project, 390 × 844, touch): the same
// fit as on the desktop — every Pool / Parameter / Register row starts at the
// title text and keeps 8 px inside the drawn outline, light and dark, and
// panning takes no measurement.

const load = async (page: Page) => {
  await openApp(page)
  await resetAll(page)
  await importGraph(page, ROWS_GRAPH)
  await page.locator('.react-flow__node[data-id="Converter"]').waitFor({ state: 'attached' })
  await page.evaluate(() => document.fonts.ready)
  await zoomOne(page)
  await frames(page, 2)
}

test.describe('#332 value and detail rows inside the vessel, phone', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: every row starts at the title and keeps 8 px inside the outline`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await load(page)
      const rows = await readRows(page)
      expect(rows.length).toBe(21)
      expect(misfits(rows)).toEqual([])
    })
  }

  test('panning the canvas takes no measurement', async ({ page }) => {
    await load(page)
    const n0 = await fitCount(page)
    await page.evaluate(() =>
      (window as unknown as { __loop: { rf: { setViewport: (v: object, o: object) => void } } }).__loop.rf.setViewport(
        { x: -300, y: -100, zoom: 1 },
        { duration: 0 },
      ),
    )
    await frames(page, 20)
    expect(await fitCount(page)).toBe(n0)
  })
})
