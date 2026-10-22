import type { Page } from '@playwright/test'
import { expect, FIXTURE_POOLS_4, importGraph, openApp, readFixture, readRiskyFactory, resetAll, runMc, test } from './support/loop'

// docs/timeline-series-contract.md §7 — the Distribution view's own minimum
// (Lumi, 2026-10-20). The live timeline keeps the 152 px default; the
// Distribution view, which did not fit it (a 0 px band chart, its Pool select
// past the area's edge), raises a lower area to 280 px on entering, keeps a
// taller one, holds the splitter at its minimum, still folds, and gives the
// earlier height back on leaving. A window too low for it caps the area so
// the canvas keeps its 160 px, and the view scrolls inside. Neither the run
// nor the canvas's zoom moves.

const DISTRIBUTION_MIN = 280

const state = (page: Page) =>
  page.evaluate(() => {
    const box = (s: string) => (document.querySelector(s) as HTMLElement | null)?.getBoundingClientRect() ?? null
    const area = box('.wb-analysis')!
    const inArea = (s: string) => { const b = box(s); return b ? b.top >= area.top - 0.5 && b.bottom <= area.bottom + 0.5 : null }
    const sim = (window as any).__loop.sim.getState()
    return {
      area: Math.round(area.height),
      canvas: Math.round(box('.react-flow')!.height),
      chart: Math.round(box('.band__svg')?.height ?? 0),
      poolSelect: inArea('.band__pool'),
      mean: inArea('.band__mean'),
      zoom: (window as any).__loop.rf.getViewport().zoom as number,
      run: `${sim.status}@${sim.stepIndex}`,
    }
  })
const splitter = (page: Page) => page.getByRole('separator', { name: 'Analysis area height' })
const viewTab = (page: Page, i: 0 | 1) => page.locator('.timeline__viewtab').nth(i)

async function stepOnce(page: Page) {
  await page.locator('.pstrip__step-btn').click()
  await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().stepIndex)).toBe(1)
  await expect.poll(() => page.evaluate(() => (window as any).__loop.sim.getState().activeTransitionId)).toBe(null)
}

test.describe('the Distribution view has its own minimum (contract §7)', () => {
  test('152 → 280 on entering, not below 280 there, folds, 152 again on leaving; the run and the zoom stay', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readFixture())
    await stepOnce(page)
    const before = await state(page)
    expect(before.area).toBe(152)

    await runMc(page, { baseSeed: 1, runs: 200, steps: 30, tracked: FIXTURE_POOLS_4 })
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
    await expect.poll(async () => (await state(page)).area).toBe(DISTRIBUTION_MIN)
    const shown = await state(page)
    expect(shown.chart, 'the band chart is drawn').toBeGreaterThan(60)
    expect([shown.poolSelect, shown.mean], 'its controls inside the area').toEqual([true, true])
    expect([shown.zoom, shown.run], 'the zoom and the run untouched').toEqual([before.zoom, before.run])

    // the splitter holds at the view's minimum
    await expect(splitter(page)).toHaveAttribute('aria-valuemin', String(DISTRIBUTION_MIN))
    await splitter(page).focus()
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
    expect((await state(page)).area).toBe(DISTRIBUTION_MIN)

    // folding the whole area still works, and opening brings the view back at its height
    await page.locator('.pstrip__collapse').click()
    await expect(page.locator('.wb-analysis.is-collapsed')).toHaveCount(1)
    await page.locator('.pstrip__collapse').click()
    await expect.poll(async () => (await state(page)).area).toBe(DISTRIBUTION_MIN)

    // leaving gives the earlier height back; entering again raises it again
    await viewTab(page, 0).click()
    await expect.poll(async () => (await state(page)).area).toBe(152)
    await expect(splitter(page)).toHaveAttribute('aria-valuemin', '96')
    await viewTab(page, 1).click()
    await expect.poll(async () => (await state(page)).area).toBe(DISTRIBUTION_MIN)
    const last = await state(page)
    expect([last.zoom, last.run]).toEqual([before.zoom, before.run])
  })

  test('an area already taller than the minimum is kept, and kept on leaving', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readFixture())
    await splitter(page).focus()
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp') // 152 + 192
    await expect.poll(async () => (await state(page)).area).toBe(344)
    await runMc(page, { baseSeed: 1, runs: 50, steps: 20, tracked: FIXTURE_POOLS_4 })
    await expect(page.locator('.timeline__viewtab.is-on')).toHaveText('DISTRIBUTION')
    expect((await state(page)).area).toBe(344)
    await viewTab(page, 0).click()
    expect((await state(page)).area).toBe(344)
  })

  test('a window too low for it: the canvas keeps 160 px and the view scrolls inside to its end', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 440 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, readRiskyFactory())
    await runMc(page, { baseSeed: 1, runs: 100, steps: 60 })
    await expect(page.locator('.timeline__viewtab.is-on')).toBeVisible()
    await expect.poll(async () => (await state(page)).canvas).toBe(160)
    const s = await state(page)
    expect(s.area).toBeLessThan(DISTRIBUTION_MIN)
    // the part below the stats row scrolls (the row's Export menu, opening
    // upward, must not sit inside a scroller that would cut it)
    const dist = page.locator('.dist__body')
    expect(await dist.evaluate((d) => d.scrollHeight > d.clientHeight + 1), 'the view scrolls').toBe(true)
    await dist.hover()
    await page.mouse.wheel(0, 600)
    await expect.poll(() => dist.evaluate((d) => Math.abs(d.scrollTop + d.clientHeight - d.scrollHeight) <= 1)).toBe(true)
    const end = await page.evaluate(() => {
      const a = (document.querySelector('.wb-analysis') as HTMLElement).getBoundingClientRect()
      const c = (document.querySelector('.band__svg') as SVGSVGElement).getBoundingClientRect()
      return { inside: c.bottom <= a.bottom + 0.5 && c.top >= a.top - 0.5, h: c.height }
    })
    expect(end.inside, 'the chart reached, whole, inside the area').toBe(true)
    expect(end.h).toBeGreaterThan(60)
    // and the Export menu still opens whole and answers there
    await page.locator('.dist__stats .menu button', { hasText: 'Export' }).click()
    const item = page.getByRole('menuitem', { name: /Runs CSV/ })
    const hit = await item.evaluate((el) => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) })
    expect(hit, 'the Export menu item is on top where it is drawn').toBe(true)
  })
})
